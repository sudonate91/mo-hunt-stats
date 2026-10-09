"""County dimension + county boundary GeoJSON for Missouri.

Writes:
  data/county.json       115 rows: fips, name, mdc_region, land_area_sq_mi, centroid, bear_management_zone, cwd_zone
  data/counties.geojson  115 features (properties: fips, name), simplified, ordered by fips

Sources (all cached under data/raw/):
  - Census 2020 Gazetteer counties file (ALAND_SQMI, internal points)
  - Census cartographic boundary file cb_2023_us_county_500k (polygons)
  - MDC ArcGIS "MDC Regions" polygon layer (county -> region via point-in-polygon on the
    Census internal point, cross-checked against each region's Num_Cnty attribute)

Run from scraper/:  python -m mohunt.county_dim
"""
from __future__ import annotations

import csv
import io
import json
import math
import sys
import zipfile
from collections import Counter
from pathlib import Path

import shapefile  # pyshp

from .fetch import RAW_DIR, REPO_ROOT, fetch, fetch_bytes

STATE_FIPS = "29"
COUNTIES_JSON = Path(__file__).with_name("counties.json")
OUT_COUNTY = REPO_ROOT / "data" / "county.json"
OUT_GEOJSON = REPO_ROOT / "data" / "counties.geojson"

GAZETTEER_URL = (
    "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/"
    "2020_Gaz_counties_national.zip"
)
CB_URL = "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_500k.zip"
MDC_REGIONS_URL = (
    "https://gisblue.mdc.mo.gov/arcgis/rest/services/Boundaries/MDC_Administrative_Boundaries/"
    "MapServer/5/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson"
)
MDC_REGIONS = {
    "Northwest", "Northeast", "Kansas City", "Central",
    "St. Louis", "Southwest", "Ozark", "Southeast",
}

SIMPLIFY_TOLERANCE = 0.002  # degrees
COORD_DECIMALS = 4
MAX_GEOJSON_BYTES = 400_000

# Spot checks requested in the phase-2 brief.
EXPECTED_REGION = {
    "St. Louis": ["Franklin", "Jefferson", "St. Louis", "St. Charles"],
    "Kansas City": ["Jackson", "Clay", "Platte", "Cass"],
    "Central": ["Boone", "Cole", "Callaway"],
    "Southwest": ["Greene", "Taney", "Christian"],
    "Ozark": ["Howell", "Texas", "Shannon"],
    "Southeast": ["Cape Girardeau", "Butler"],
    "Northeast": ["Adair", "Marion"],
    "Northwest": ["Buchanan", "Nodaway"],
}


# --------------------------------------------------------------------------- geometry helpers

def _ring_area2(ring: list) -> float:
    """Twice the signed area (positive = counter-clockwise)."""
    s = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        s += x1 * y2 - x2 * y1
    return s


def _seg_dist(p, a, b) -> float:
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _dp(points: list, tol: float) -> list:
    """Iterative Douglas-Peucker on an open polyline; keeps both endpoints."""
    n = len(points)
    if n < 3:
        return list(points)
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        best, idx = -1.0, -1
        for k in range(i + 1, j):
            d = _seg_dist(points[k], points[i], points[j])
            if d > best:
                best, idx = d, k
        if idx != -1 and best > tol:
            keep[idx] = True
            stack.append((i, idx))
            stack.append((idx, j))
    return [p for p, kept in zip(points, keep) if kept]


def simplify_ring(ring: list, tol: float) -> list:
    """Simplify a closed ring, round coords, drop repeats. Returns [] if it degenerates."""
    if ring[0] != ring[-1]:
        ring = ring + [ring[0]]
    # Split the closed ring at the vertex farthest from its start so DP has a real baseline.
    start = ring[0]
    far = max(range(len(ring)), key=lambda k: math.hypot(ring[k][0] - start[0], ring[k][1] - start[1]))
    simplified = _dp(ring[: far + 1], tol)[:-1] + _dp(ring[far:], tol)
    out: list = []
    for x, y in simplified:
        pt = [round(x, COORD_DECIMALS), round(y, COORD_DECIMALS)]
        if not out or out[-1] != pt:
            out.append(pt)
    if out[0] != out[-1]:
        out.append(out[0])
    if len(out) < 4 or _ring_area2(out) == 0:
        return []
    return out


def _orient(ring: list, ccw: bool) -> list:
    return ring if (_ring_area2(ring) > 0) == ccw else ring[::-1]


def simplify_geometry(geom: dict, tol: float) -> dict:
    """Simplify a GeoJSON Polygon/MultiPolygon; outer rings CCW, holes CW (RFC 7946)."""
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    out_polys = []
    for poly in polys:
        rings = []
        for r_idx, ring in enumerate(poly):
            pts = [tuple(p[:2]) for p in ring]
            simp = simplify_ring(pts, tol)
            if not simp:
                # Fall back to a finer tolerance before giving up on the ring.
                simp = simplify_ring(pts, tol / 10) or simplify_ring(pts, 0.0)
            if not simp:
                if r_idx == 0:
                    break  # outer ring gone -> drop whole polygon (tiny island)
                continue
            rings.append(_orient(simp, ccw=(r_idx == 0)))
        if rings:
            out_polys.append(rings)
    if not out_polys:
        raise ValueError("geometry collapsed during simplification")
    if len(out_polys) == 1:
        return {"type": "Polygon", "coordinates": out_polys[0]}
    return {"type": "MultiPolygon", "coordinates": out_polys}


def area_centroid(geom: dict) -> tuple[float, float]:
    """Area-weighted centroid over all rings (holes subtract)."""
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    a_tot = cx = cy = 0.0
    for poly in polys:
        for r_idx, ring in enumerate(poly):
            ring = _orient([tuple(p[:2]) for p in ring], ccw=(r_idx == 0))
            for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
                cross = x1 * y2 - x2 * y1
                a_tot += cross
                cx += (x1 + x2) * cross
                cy += (y1 + y2) * cross
    return cx / (3 * a_tot), cy / (3 * a_tot)


def _point_in_ring(x: float, y: float, ring: list) -> bool:
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            inside = not inside
    return inside


def point_in_geometry(x: float, y: float, geom: dict) -> bool:
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    for poly in polys:
        if _point_in_ring(x, y, poly[0]) and not any(_point_in_ring(x, y, h) for h in poly[1:]):
            return True
    return False


# --------------------------------------------------------------------------- sources

def load_gazetteer() -> dict[str, dict]:
    raw = fetch_bytes(GAZETTEER_URL, RAW_DIR / "census" / "2020_Gaz_counties_national.zip")
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        name = next(n for n in zf.namelist() if n.endswith(".txt"))
        text = zf.read(name).decode("latin-1")
    reader = csv.DictReader(io.StringIO(text), delimiter="\t")
    reader.fieldnames = [f.strip() for f in reader.fieldnames]
    out = {}
    for row in reader:
        geoid = row["GEOID"].strip()
        if geoid.startswith(STATE_FIPS):
            out[geoid] = {
                "land_area_sq_mi": float(row["ALAND_SQMI"]),
                "intpt": (float(row["INTPTLONG"].strip()), float(row["INTPTLAT"].strip())),
            }
    return out


def load_county_shapes() -> dict[str, dict]:
    raw = fetch_bytes(CB_URL, RAW_DIR / "census" / "cb_2023_us_county_500k.zip")
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        base = "cb_2023_us_county_500k"
        reader = shapefile.Reader(
            shp=io.BytesIO(zf.read(f"{base}.shp")),
            shx=io.BytesIO(zf.read(f"{base}.shx")),
            dbf=io.BytesIO(zf.read(f"{base}.dbf")),
        )
        out = {}
        for sr in reader.iterShapeRecords():
            rec = sr.record.as_dict()
            if rec["STATEFP"] == STATE_FIPS:
                out[rec["GEOID"]] = sr.shape.__geo_interface__
    return out


def load_mdc_regions() -> list[dict]:
    text = fetch(MDC_REGIONS_URL, RAW_DIR / "mdc" / "mdc_regions_layer5.geojson")
    feats = json.loads(text)["features"]
    for f in feats:
        props = {k.lower(): v for k, v in f["properties"].items()}
        f["_region"] = props["region"].strip()
        f["_num_cnty"] = props.get("num_cnty")
    return feats


# --------------------------------------------------------------------------- main

def main() -> int:
    counties = sorted(json.loads(COUNTIES_JSON.read_text(encoding="utf-8")), key=lambda c: c["fips"])
    fips_list = [c["fips"] for c in counties]
    names = {c["fips"]: c["name"] for c in counties}
    assert len(fips_list) == 115, len(fips_list)

    gaz = load_gazetteer()
    shapes = load_county_shapes()
    regions = load_mdc_regions()
    errors: list[str] = []

    for label, src in (("gazetteer", gaz), ("boundary file", shapes)):
        missing = sorted(set(fips_list) - set(src))
        extra = sorted(set(src) - set(fips_list))
        if missing or extra:
            errors.append(f"{label}: missing {missing}, unexpected {extra}")
    found_regions = {f["_region"] for f in regions}
    if found_regions != MDC_REGIONS:
        errors.append(f"MDC region names differ from expected: {sorted(found_regions)}")
    if errors:
        raise SystemExit("\n".join(errors))

    # County -> MDC region: Census internal point (guaranteed inside the county) in region polygon.
    region_of: dict[str, str] = {}
    for fips in fips_list:
        x, y = gaz[fips]["intpt"]
        hits = [f["_region"] for f in regions if point_in_geometry(x, y, f["geometry"])]
        if len(hits) != 1:
            errors.append(f"{fips} {names[fips]}: matched regions {hits}")
        else:
            region_of[fips] = hits[0]

    counts = Counter(region_of.values())
    # MDC's Num_Cnty counts the 114 counties only (sums to 114); St. Louis City (29510) is extra.
    counties_only = Counter(r for f, r in region_of.items() if f != "29510")
    for f in regions:
        if f["_num_cnty"] is not None and counties_only[f["_region"]] != f["_num_cnty"]:
            errors.append(
                f"region {f['_region']}: {counties_only[f['_region']]} counties assigned, "
                f"MDC Num_Cnty says {f['_num_cnty']}"
            )
    by_name = {names[f]: f for f in fips_list}
    for region, cnames in EXPECTED_REGION.items():
        for n in cnames:
            got = region_of.get(by_name[n])
            if got != region:
                errors.append(f"spot check: {n} expected {region}, got {got}")
    if errors:
        raise SystemExit("county_dim validation failed:\n  " + "\n  ".join(errors))

    rows = []
    features = []
    for fips in fips_list:
        geom = shapes[fips]
        cx, cy = area_centroid(geom)
        rows.append({
            "fips": fips,
            "name": names[fips],
            "mdc_region": region_of[fips],
            "land_area_sq_mi": round(gaz[fips]["land_area_sq_mi"], 1),
            "centroid": [round(cx, 2), round(cy, 2)],
            # TODO: bear_management_zone — MDC publishes zones as polygons at
            # gisblue.mdc.mo.gov/arcgis/rest/services/Boundaries/Hunting_Zones/MapServer/0;
            # zones do not follow county lines, so a county may need a list or a "primary" zone.
            "bear_management_zone": None,
            # TODO: cwd_zone — derive from the annual CWD Management Zone county list.
            "cwd_zone": None,
        })
        simp = simplify_geometry(geom, SIMPLIFY_TOLERANCE)
        polys = [simp["coordinates"]] if simp["type"] == "Polygon" else simp["coordinates"]
        if any(len(r) < 4 for p in polys for r in p):
            raise SystemExit(f"{fips}: degenerate ring after simplification")
        features.append({
            "type": "Feature",
            "properties": {"fips": fips, "name": names[fips]},
            "geometry": simp,
        })

    OUT_COUNTY.parent.mkdir(parents=True, exist_ok=True)
    OUT_COUNTY.write_text(json.dumps(rows, indent=1) + "\n", encoding="utf-8")
    geojson = json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":"))
    OUT_GEOJSON.write_text(geojson, encoding="utf-8")

    size = OUT_GEOJSON.stat().st_size
    print(f"wrote {OUT_COUNTY} ({OUT_COUNTY.stat().st_size:,} bytes, {len(rows)} counties)")
    print(f"wrote {OUT_GEOJSON} ({size:,} bytes, {len(features)} features)")
    print("counties per region:", dict(sorted(counts.items())))
    if size > MAX_GEOJSON_BYTES:
        print(f"ERROR: GeoJSON exceeds {MAX_GEOJSON_BYTES:,} bytes", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
