"""Geographic overlays for the county choropleth (rivers, lakes, ecoregions, interstates, public land).

Writes:
  data/overlays.geojson  one FeatureCollection; every feature has properties {layer, name}.
                         Clipped to a Missouri bbox (+~0.1 deg), coordinates rounded to 3 dp, simplified so the whole
                         file stays <= MAX_BYTES. Layers are added in priority order; a layer whose source is
                         unreachable, or that would push the file over budget, is skipped with a message.

Sources (raw downloads cached under data/raw/overlays/, git-ignored):
  rivers       Natural Earth 10m rivers_lake_centerlines + rivers_north_america (public domain)
  lakes        Natural Earth 10m lakes + lakes_north_america (public domain)
  ecoregions   US EPA Level III ecoregions, Missouri file (public domain; Albers USGS, inverse-projected here)
  interstates  Census TIGER/Line 2023 primary roads, RTTYP == 'I' (public domain)
  public_land  MDC conservation areas >= 1,000 acres (MDC ArcGIS) + Mark Twain National Forest (USFS EDW ownership)

Run from scraper/:  python -m mohunt.overlays
"""
from __future__ import annotations

import io
import json
import math
import sys
import zipfile
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlencode

import shapefile  # pyshp

from .county_dim import _dp, _orient, _ring_area2
from .fetch import RAW_DIR, REPO_ROOT, fetch, fetch_bytes

OUT = REPO_ROOT / "data" / "overlays.geojson"
CACHE = RAW_DIR / "overlays"
MAX_BYTES = 250_000
DECIMALS = 3
BBOX = (-95.9, 35.9, -88.9, 40.7)  # lon min, lat min, lon max, lat max

NE = "https://naturalearth.s3.amazonaws.com/10m_physical/"
EPA_URLS = [
    "https://dmap-prod-oms-edc.s3.us-east-1.amazonaws.com/ORD/Ecoregions/mo/mo_eco_l3.zip",
    "https://gaftp.epa.gov/EPADataCommons/ORD/Ecoregions/mo/mo_eco_l3.zip",
    "https://dmap-prod-oms-edc.s3.us-east-1.amazonaws.com/ORD/Ecoregions/us/us_eco_l3.zip",
]
TIGER_ROADS = "https://www2.census.gov/geo/tiger/TIGER2023/PRIMARYROADS/tl_2023_us_primaryroads.zip"
MDC_CA = ("https://gisblue.mdc.mo.gov/arcgis/rest/services/Discover_Nature/MDC_Administrative_Areas/"
          "MapServer/5/query?")
USFS_OWN = "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_BasicOwnership_02/MapServer/0/query?"

WANT_RIVERS = ["Missouri", "Mississippi", "Osage", "Gasconade", "Meramec", "Grand", "Chariton",
               "Current", "White", "Black", "St. Francis"]
WANT_LAKES = ["Lake of the Ozarks", "Truman", "Table Rock", "Bull Shoals", "Mark Twain Lake", "Stockton"]

TOL = {"rivers": 0.004, "lakes": 0.003, "ecoregions": 0.01, "interstates": 0.005, "public_land": 0.01}
MIN_ACRES = 1000
ACRES_PER_KM2 = 247.105


# --------------------------------------------------------------------------- geometry

def _inside(p) -> bool:
    return BBOX[0] <= p[0] <= BBOX[2] and BBOX[1] <= p[1] <= BBOX[3]


def _bbox_hits(bb) -> bool:
    return not (bb[2] < BBOX[0] or bb[0] > BBOX[2] or bb[3] < BBOX[1] or bb[1] > BBOX[3])


def _clip_segment(a, b):
    """Liang-Barsky: the part of segment a-b inside BBOX, or None."""
    (x0, y0), (x1, y1) = a, b
    dx, dy = x1 - x0, y1 - y0
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, x0 - BBOX[0]), (dx, BBOX[2] - x0), (-dy, y0 - BBOX[1]), (dy, BBOX[3] - y0)):
        if p == 0:
            if q < 0:
                return None
            continue
        r = q / p
        if p < 0:
            if r > t1:
                return None
            t0 = max(t0, r)
        else:
            if r < t0:
                return None
            t1 = min(t1, r)
    return (x0 + t0 * dx, y0 + t0 * dy), (x0 + t1 * dx, y0 + t1 * dy)


def clip_line(pts: list) -> list[list]:
    """Split a polyline into the runs that lie inside BBOX."""
    runs: list[list] = []
    cur: list = []
    for a, b in zip(pts, pts[1:]):
        seg = _clip_segment(a, b)
        if seg is None:
            if cur:
                runs.append(cur)
                cur = []
            continue
        s, e = seg
        if not cur:
            cur = [s]
        elif cur[-1] != s:
            runs.append(cur)
            cur = [s]
        cur.append(e)
        if e != b:  # left the box
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    return [r for r in runs if len(r) >= 2]


def clip_ring(ring: list) -> list:
    """Sutherland-Hodgman clip of a closed ring against BBOX."""
    def clip(pts, inside, cross):
        out = []
        for i, cur in enumerate(pts):
            prev = pts[i - 1]
            if inside(cur):
                if not inside(prev):
                    out.append(cross(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(cross(prev, cur))
        return out

    def at_x(x):
        return lambda p, q: (x, p[1] + (q[1] - p[1]) * (x - p[0]) / (q[0] - p[0]))

    def at_y(y):
        return lambda p, q: (p[0] + (q[0] - p[0]) * (y - p[1]) / (q[1] - p[1]), y)

    pts = [tuple(p) for p in ring[:-1]] if ring[0] == ring[-1] else [tuple(p) for p in ring]
    for inside, cross in (
        (lambda p: p[0] >= BBOX[0], at_x(BBOX[0])),
        (lambda p: p[0] <= BBOX[2], at_x(BBOX[2])),
        (lambda p: p[1] >= BBOX[1], at_y(BBOX[1])),
        (lambda p: p[1] <= BBOX[3], at_y(BBOX[3])),
    ):
        if not pts:
            return []
        pts = clip(pts, inside, cross)
    return pts + [pts[0]] if len(pts) >= 3 else []


def _round(pts: list) -> list:
    out: list = []
    for x, y in pts:
        p = [round(x, DECIMALS), round(y, DECIMALS)]
        if not out or out[-1] != p:
            out.append(p)
    return out


def simplify_line(pts: list, tol: float) -> list:
    out = _round(_dp(pts, tol))
    return out if len(out) >= 2 else []


def ring_acres(ring: list) -> float:
    lat = sum(p[1] for p in ring) / len(ring)
    deg2 = abs(_ring_area2(ring)) / 2
    return deg2 * 111.32 ** 2 * math.cos(math.radians(lat)) * ACRES_PER_KM2


def simplify_poly_ring(ring: list, tol: float) -> list:
    if ring[0] != ring[-1]:
        ring = ring + [ring[0]]
    start = ring[0]
    far = max(range(len(ring)), key=lambda k: math.hypot(ring[k][0] - start[0], ring[k][1] - start[1]))
    out = _round(_dp(ring[: far + 1], tol)[:-1] + _dp(ring[far:], tol))
    if out and out[0] != out[-1]:
        out.append(out[0])
    if len(out) < 4 or _ring_area2(out) == 0:
        return []
    return out


def polygons_of(geom: dict) -> list[list[list]]:
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    if geom["type"] == "MultiPolygon":
        return geom["coordinates"]
    return []


def lines_of(geom: dict) -> list[list]:
    if geom["type"] == "LineString":
        return [geom["coordinates"]]
    if geom["type"] == "MultiLineString":
        return geom["coordinates"]
    return []


def process_polygons(polys: list, tol: float, min_acres: float = 0.0) -> list:
    """Clip, simplify, drop small parts; outer rings CCW, holes CW."""
    out = []
    for poly in polys:
        rings = []
        for r_idx, ring in enumerate(poly):
            pts = [tuple(p[:2]) for p in ring]
            clipped = clip_ring(pts)
            if not clipped:
                if r_idx == 0:
                    break
                continue
            if min_acres and ring_acres(clipped) < min_acres:
                if r_idx == 0:
                    break
                continue
            simp = simplify_poly_ring(clipped, tol)
            if not simp:
                if r_idx == 0:
                    break
                continue
            rings.append(_orient(simp, ccw=(r_idx == 0)))
        if rings:
            out.append(rings)
    return out


def merge_lines(lines: list[list]) -> list[list]:
    """Greedily chain polylines that share an endpoint (TIGER/NE split rivers and roads into many pieces)."""
    lines = [list(map(tuple, l)) for l in lines if len(l) >= 2]
    changed = True
    while changed:
        changed = False
        ends: dict = defaultdict(list)
        for i, l in enumerate(lines):
            ends[l[0]].append(i)
            ends[l[-1]].append(i)
        used = [False] * len(lines)
        merged = []
        for i, l in enumerate(lines):
            if used[i]:
                continue
            used[i] = True
            cur = list(l)
            grown = True
            while grown:
                grown = False
                for j in ends[cur[-1]]:
                    if not used[j]:
                        o = lines[j]
                        cur += (o[1:] if o[0] == cur[-1] else o[::-1][1:])
                        used[j] = grown = changed = True
                        break
                if grown:
                    continue
                for j in ends[cur[0]]:
                    if not used[j]:
                        o = lines[j]
                        cur = (o[:-1] if o[-1] == cur[0] else o[::-1][:-1]) + cur
                        used[j] = grown = changed = True
                        break
            merged.append(cur)
        lines = merged
    return lines


def line_feature(layer: str, name: str, lines: list[list], tol: float) -> dict | None:
    parts = []
    for l in merge_lines([run for line in lines for run in clip_line([tuple(p[:2]) for p in line])]):
        s = simplify_line(l, tol)
        if len(s) >= 2:
            parts.append(s)
    if not parts:
        return None
    geom = ({"type": "LineString", "coordinates": parts[0]} if len(parts) == 1
            else {"type": "MultiLineString", "coordinates": parts})
    return {"type": "Feature", "properties": {"layer": layer, "name": name}, "geometry": geom}


def poly_feature(layer: str, name: str, polys: list) -> dict | None:
    if not polys:
        return None
    geom = ({"type": "Polygon", "coordinates": polys[0]} if len(polys) == 1
            else {"type": "MultiPolygon", "coordinates": polys})
    return {"type": "Feature", "properties": {"layer": layer, "name": name}, "geometry": geom}


# --------------------------------------------------------------------------- inverse Albers (EPA ecoregions)

class AlbersInverse:
    """Ellipsoidal Albers equal-area conic, inverse (Snyder 1987, eqs. 14-18, 3-16)."""

    def __init__(self, lat1, lat2, lat0, lon0, a=6378137.0, inv_f=298.257222101):
        f = 1 / inv_f
        self.a, self.e2 = a, 2 * f - f * f
        self.e = math.sqrt(self.e2)
        self.lon0 = math.radians(lon0)
        m1, m2 = self._m(math.radians(lat1)), self._m(math.radians(lat2))
        q1, q2, q0 = (self._q(math.radians(x)) for x in (lat1, lat2, lat0))
        self.n = (m1 * m1 - m2 * m2) / (q2 - q1)
        self.C = m1 * m1 + self.n * q1
        self.rho0 = a * math.sqrt(self.C - self.n * q0) / self.n

    def _m(self, phi):
        return math.cos(phi) / math.sqrt(1 - self.e2 * math.sin(phi) ** 2)

    def _q(self, phi):
        s, e = math.sin(phi), self.e
        return (1 - self.e2) * (s / (1 - self.e2 * s * s) - (1 / (2 * e)) * math.log((1 - e * s) / (1 + e * s)))

    def __call__(self, x, y):
        rho = math.hypot(x, self.rho0 - y)
        theta = math.atan2(x, self.rho0 - y)
        q = (self.C - (rho * self.n / self.a) ** 2) / self.n
        phi = math.asin(max(-1.0, min(1.0, q / 2)))
        e, e2 = self.e, self.e2
        for _ in range(15):
            s = math.sin(phi)
            d = ((1 - e2 * s * s) ** 2 / (2 * math.cos(phi))) * (
                q / (1 - e2) - s / (1 - e2 * s * s) + (1 / (2 * e)) * math.log((1 - e * s) / (1 + e * s)))
            phi += d
            if abs(d) < 1e-12:
                break
        return math.degrees(self.lon0 + theta / self.n), math.degrees(phi)


# --------------------------------------------------------------------------- sources

def _shp(zip_bytes: bytes, base: str | None = None) -> shapefile.Reader:
    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    if base is None:
        base = next(n for n in zf.namelist() if n.endswith(".shp"))[:-4]
    return shapefile.Reader(shp=io.BytesIO(zf.read(f"{base}.shp")), shx=io.BytesIO(zf.read(f"{base}.shx")),
                            dbf=io.BytesIO(zf.read(f"{base}.dbf")))


def _ne(name: str) -> shapefile.Reader:
    return _shp(fetch_bytes(NE + name + ".zip", CACHE / f"{name}.zip"), name)


def _ne_name(rec: dict) -> str:
    return (rec.get("name_en") or rec.get("name") or "").strip()


def layer_rivers() -> list[dict]:
    by_name: dict[str, list] = defaultdict(list)
    for src in ("ne_10m_rivers_lake_centerlines", "ne_10m_rivers_north_america"):
        for sr in _ne(src).iterShapeRecords():
            if not sr.shape.points or not _bbox_hits(sr.shape.bbox):
                continue
            name = " ".join(_ne_name(sr.record.as_dict()).split())
            if name:
                by_name[name] += lines_of(sr.shape.__geo_interface__)
    feats = [line_feature("rivers", n, ls, TOL["rivers"]) for n, ls in sorted(by_name.items())]
    feats = [f for f in feats if f]
    got = {f["properties"]["name"] for f in feats}
    print(f"rivers: {len(feats)} named rivers; wanted present: {[r for r in WANT_RIVERS if r in got]}; "
          f"missing: {[r for r in WANT_RIVERS if r not in got]}")
    return feats


def _lake_name(name: str) -> str:
    small = {"Of", "The", "De", "And"}
    words = name.split()
    return " ".join(w.lower() if i and w in small else w for i, w in enumerate(words))


def layer_lakes() -> list[dict]:
    by_name: dict[str, list] = defaultdict(list)
    for src in ("ne_10m_lakes", "ne_10m_lakes_north_america"):
        for sr in _ne(src).iterShapeRecords():
            if not sr.shape.points or not _bbox_hits(sr.shape.bbox):
                continue
            # Lakes: the full `name` ("Lake Of The Ozarks"), not the short `name_en` ("Ozarks").
            rec = sr.record.as_dict()
            name = _lake_name((rec.get("name") or "").strip() or _ne_name(rec))
            if name:
                by_name[name] += polygons_of(sr.shape.__geo_interface__)
    feats = [poly_feature("lakes", n, process_polygons(p, TOL["lakes"])) for n, p in sorted(by_name.items())]
    feats = [f for f in feats if f]
    got = " | ".join(f["properties"]["name"] for f in feats).lower()
    print(f"lakes: {len(feats)}; wanted missing: {[l for l in WANT_LAKES if l.lower() not in got]}")
    return feats


def layer_ecoregions() -> list[dict]:
    raw = None
    for url in EPA_URLS:
        try:
            raw = fetch_bytes(url, CACHE / Path(url).name)
            break
        except Exception as exc:  # noqa: BLE001 - try the next mirror
            print(f"ecoregions: {url} failed ({exc})")
    if raw is None:
        raise RuntimeError("no EPA ecoregion source reachable")
    reader = _shp(raw)
    prj = zipfile.ZipFile(io.BytesIO(raw))
    prj_text = next((prj.read(n).decode() for n in prj.namelist() if n.endswith(".prj")), "")
    if "Albers" not in prj_text or "Central_Meridian\",-96" not in prj_text:
        raise RuntimeError(f"unexpected ecoregion projection: {prj_text[:120]}")
    inv = AlbersInverse(29.5, 45.5, 23.0, -96.0)
    by_name: dict[str, list] = defaultdict(list)
    for sr in reader.iterShapeRecords():
        name = sr.record.as_dict()["US_L3NAME"].strip()
        for poly in polygons_of(sr.shape.__geo_interface__):
            geo_poly = [[inv(x, y) for x, y, *_ in ring] for ring in poly]
            # pyshp groups by ring orientation; recheck that the outer ring touches the bbox.
            xs = [p[0] for p in geo_poly[0]]
            ys = [p[1] for p in geo_poly[0]]
            if _bbox_hits((min(xs), min(ys), max(xs), max(ys))):
                by_name[name].append(geo_poly)
    feats = [poly_feature("ecoregions", n, process_polygons(p, TOL["ecoregions"], min_acres=5000))
             for n, p in sorted(by_name.items())]
    feats = [f for f in feats if f]
    print(f"ecoregions: {[f['properties']['name'] for f in feats]}")
    return feats


def layer_interstates() -> list[dict]:
    reader = _shp(fetch_bytes(TIGER_ROADS, CACHE / "tl_2023_us_primaryroads.zip"))
    by_name: dict[str, list] = defaultdict(list)
    for sr in reader.iterShapeRecords():
        rec = sr.record.as_dict()
        if rec["RTTYP"] != "I" or not _bbox_hits(sr.shape.bbox):
            continue
        name = " ".join(rec["FULLNAME"].replace("I- ", "I-").split())
        # Ramps/spurs share the route name; keep the route itself ("I- 70", "I- 44"...).
        by_name[name] += lines_of(sr.shape.__geo_interface__)
    feats = [line_feature("interstates", n, ls, TOL["interstates"]) for n, ls in sorted(by_name.items())]
    feats = [f for f in feats if f]
    print(f"interstates: {[f['properties']['name'] for f in feats]}")
    return feats


def layer_public_land() -> list[dict]:
    feats = []
    q = urlencode({
        "where": f"Acreage >= {MIN_ACRES} AND Public_Site = 'Y'", "outFields": "Area_Name,Acreage",
        "returnGeometry": "true", "outSR": "4326", "maxAllowableOffset": "0.001", "f": "geojson",
    })
    ca = json.loads(fetch(MDC_CA + q, CACHE / "mdc_conservation_areas_1000ac.geojson"))["features"]
    for f in ca:
        if not f.get("geometry"):
            continue
        name = (f["properties"].get("Area_Name") or "").strip()
        polys = process_polygons(polygons_of(f["geometry"]), TOL["public_land"], min_acres=50)
        ft = poly_feature("public_land", name, polys)
        if ft:
            feats.append(ft)
    print(f"public_land: {len(feats)} MDC conservation areas >= {MIN_ACRES:,} acres")
    q = urlencode({
        "where": "FORESTNAME = 'Mark Twain National Forest'", "outFields": "forestname",
        "returnGeometry": "true", "outSR": "4326", "maxAllowableOffset": "0.002", "f": "geojson",
    })
    try:
        nf = json.loads(fetch(USFS_OWN + q, CACHE / "usfs_mark_twain_ownership.geojson"))["features"]
        polys = [p for f in nf if f.get("geometry") for p in polygons_of(f["geometry"])]
        ft = poly_feature("public_land", "Mark Twain National Forest",
                          process_polygons(polys, TOL["public_land"], min_acres=MIN_ACRES))
        if ft:
            feats.append(ft)
            print(f"public_land: Mark Twain National Forest, {len(polygons_of(ft['geometry']))} blocks "
                  f">= {MIN_ACRES:,} acres")
    except Exception as exc:  # noqa: BLE001 - the forest is a nice-to-have on top of MDC areas
        print(f"public_land: Mark Twain National Forest skipped ({exc})")
    return feats


LAYERS = [("rivers", layer_rivers), ("lakes", layer_lakes), ("ecoregions", layer_ecoregions),
          ("interstates", layer_interstates), ("public_land", layer_public_land)]


def _dump(features: list) -> str:
    return json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":"))


def main() -> int:
    features: list[dict] = []
    report = []
    for layer, build in LAYERS:
        try:
            feats = build()
        except Exception as exc:  # noqa: BLE001 - a missing source skips the layer, not the build
            report.append(f"{layer}: SKIPPED (source unavailable: {exc})")
            continue
        size_before = len(_dump(features).encode())
        trial = _dump(features + feats)
        added = len(trial.encode()) - size_before
        if len(trial.encode()) > MAX_BYTES:
            report.append(f"{layer}: SKIPPED ({added:,} bytes would push the file over {MAX_BYTES:,})")
            continue
        features += feats
        report.append(f"{layer}: {len(feats)} features, {added:,} bytes")
    if not features:
        print("no overlay layers available", file=sys.stderr)
        return 1
    OUT.write_text(_dump(features), encoding="utf-8")
    print("\n".join(report))
    print(f"wrote {OUT} ({OUT.stat().st_size:,} bytes, {len(features)} features)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
