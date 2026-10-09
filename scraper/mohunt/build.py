"""CLI: scrape MDC pages -> data/harvest.parquet, data/harvest_<species>.json, data/turkey_attributes.*

    python -m mohunt.build            # uses cached HTML in data/raw/ when present
    python -m mohunt.build --refresh  # re-fetch every page (polite: 2 s between requests)
    python -m mohunt.build --species deer --seasons 2025
"""
from __future__ import annotations

import argparse
import json
import sys

import pyarrow as pa
import pyarrow.parquet as pq

from . import deer, turkey
from .fetch import RAW_DIR, REPO_ROOT, fetch
from .tables import HarvestTable
from .validate import check_page

DATA_DIR = REPO_ROOT / "data"
SEASONS = {"deer": list(range(2015, 2026)), "turkey": list(range(2015, 2027))}

SCHEMA = pa.schema([
    ("state", pa.string()),
    ("species", pa.string()),
    ("season_year", pa.int16()),
    ("season", pa.string()),
    ("portion", pa.string()),
    ("portion_label", pa.string()),
    ("method", pa.string()),
    ("youth", pa.bool_()),
    ("is_subtotal", pa.bool_()),
    ("derived", pa.bool_()),
    ("county_fips", pa.string()),
    ("class", pa.string()),
    ("count", pa.int32()),
    ("source_url", pa.string()),
])
ATTR_SCHEMA = pa.schema([
    ("state", pa.string()),
    ("species", pa.string()),
    ("season_year", pa.int16()),
    ("portion", pa.string()),
    ("county_fips", pa.string()),
    ("public_land", pa.int32()),
    ("crossbow", pa.int32()),
])
JSON_COLUMNS = ["season_year", "portion", "county_fips", "class", "count"]
PORTION_META_KEYS = ("season", "method", "youth", "is_subtotal")
ATTR_COLUMNS = ["species", "season_year", "portion", "county_fips", "public_land", "crossbow"]


def load_page(species: str, season_year: int, *, refresh: bool = False):
    if species == "deer":
        url = deer.season_url(season_year)
        html = fetch(url, RAW_DIR / "deer" / f"{season_year}-{season_year + 1}.html", refresh=refresh)
        return deer.parse_deer_page(html, season_year, url)
    if species == "turkey":
        url = turkey.season_url(season_year)
        html = fetch(url, RAW_DIR / "turkey" / f"{season_year}.html", refresh=refresh)
        return turkey.parse_turkey_page(html, season_year, url)
    raise ValueError(species)


def load_deer_page(season_year: int, *, refresh: bool = False):
    return load_page("deer", season_year, refresh=refresh)


def page_to_rows(species: str, page, chosen: dict[str, HarvestTable]) -> tuple[list[dict], list[dict]]:
    rows, attrs = [], []
    for t in chosen.values():
        season = "fall" if species == "deer" else t.portion.split("_")[0]
        for r in t.rows:
            for cls, n in r.counts.items():
                rows.append({
                    "state": "MO", "species": species, "season_year": page.season_year, "season": season,
                    "portion": t.portion, "portion_label": t.title, "method": t.method, "youth": t.youth,
                    "is_subtotal": t.is_subtotal, "derived": t.derived, "county_fips": r.county_fips,
                    "class": cls, "count": n, "source_url": page.source_url,
                })
            if r.extras:
                attrs.append({
                    "state": "MO", "species": species, "season_year": page.season_year, "portion": t.portion,
                    "county_fips": r.county_fips, "public_land": r.extras.get("public_land", 0),
                    "crossbow": r.extras.get("crossbow", 0),
                })
    return rows, attrs


def compact_json(rows: list[dict], columns: list[str] = JSON_COLUMNS, *, labels: bool = True) -> dict:
    """Browser format. With labels=True (harvest facts): pivoted — one array of counts per
    (season_year, portion, class) in a fixed county order, plus per-portion attributes and per-(year, portion)
    labels. Zeros are explicit so arrays are dense. Without labels (attributes): column-ordered row arrays."""
    if not labels:
        return {"state": "MO", "columns": columns, "rows": [[r[c] for c in columns] for r in rows]}
    county_order = sorted({r["county_fips"] for r in rows})
    cidx = {f: i for i, f in enumerate(county_order)}
    classes = sorted({r["class"] for r in rows})
    portions: dict[str, dict] = {}
    lab: dict[str, dict] = {}
    series: dict[tuple[int, str, str], list[int]] = {}
    for r in rows:
        meta = {k: r[k] for k in PORTION_META_KEYS}
        prev = portions.setdefault(r["portion"], meta)
        if prev != meta:
            raise RuntimeError(f"portion {r['portion']} has inconsistent attributes: {prev} vs {meta}")
        lab.setdefault(f"{r['species']}:{r['season_year']}:{r['portion']}",
                       {"portion_label": r["portion_label"], "source_url": r["source_url"], "derived": r["derived"]})
        arr = series.setdefault((r["season_year"], r["portion"], r["class"]), [0] * len(county_order))
        arr[cidx[r["county_fips"]]] += r["count"]
    return {
        "state": "MO",
        "species": rows[0]["species"] if rows else None,
        "counties": county_order,
        "classes": classes,
        "portions": portions,
        "series": [[y, p, c, arr] for (y, p, c), arr in sorted(series.items())],
        "labels": lab,
    }


def dump_json(path, obj) -> None:
    path.write_text(json.dumps(obj, separators=(",", ":")), encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-fetch pages even if cached")
    ap.add_argument("--species", nargs="*", default=list(SEASONS))
    ap.add_argument("--seasons", type=int, nargs="*")
    args = ap.parse_args(argv)

    all_rows: list[dict] = []
    all_attrs: list[dict] = []
    errors: list[str] = []
    warnings: list[str] = []
    for species in args.species:
        for y in args.seasons or SEASONS[species]:
            page = load_page(species, y, refresh=args.refresh)
            chosen, e, w = check_page(page, species)
            errors += e
            warnings += w
            rows, attrs = page_to_rows(species, page, chosen)
            all_rows += rows
            all_attrs += attrs
            print(f"{species} {y}: {len(page.tables)} tables, {len(page.skipped)} skipped, "
                  f"{len(e)} errors, {len(w)} warnings; portions={sorted(chosen)}")
    for w in warnings:
        print("WARN", w)
    if errors:
        for e in errors:
            print("ERROR", e, file=sys.stderr)
        print(f"validation failed with {len(errors)} error(s); outputs not written", file=sys.stderr)
        return 1

    DATA_DIR.mkdir(exist_ok=True)
    pq.write_table(pa.Table.from_pylist(all_rows, schema=SCHEMA), DATA_DIR / "harvest.parquet", compression="zstd")
    for species in args.species:
        dump_json(DATA_DIR / f"harvest_{species}.json",
                  compact_json([r for r in all_rows if r["species"] == species]))
    if all_attrs:
        pq.write_table(pa.Table.from_pylist(all_attrs, schema=ATTR_SCHEMA), DATA_DIR / "turkey_attributes.parquet",
                       compression="zstd")
        dump_json(DATA_DIR / "turkey_attributes.json", compact_json(all_attrs, ATTR_COLUMNS, labels=False))
    print(f"wrote {len(all_rows)} harvest rows, {len(all_attrs)} attribute rows -> data/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
