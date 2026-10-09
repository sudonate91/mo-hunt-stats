"""CLI: scrape deer pages -> data/harvest.parquet + data/harvest.json (+ validation report).

    python -m mohunt.build            # uses cached HTML in data/raw/ when present
    python -m mohunt.build --refresh  # re-fetch every page (polite: 2 s between requests)
"""
from __future__ import annotations

import argparse
import json
import sys

import pyarrow as pa
import pyarrow.parquet as pq

from .deer import CLASS_COLUMNS, DeerPage, HarvestTable, parse_deer_page, season_url
from .fetch import RAW_DIR, REPO_ROOT, fetch
from .validate import check_page

DATA_DIR = REPO_ROOT / "data"
DEER_SEASONS = range(2015, 2026)

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


def load_deer_page(season_year: int, *, refresh: bool = False) -> DeerPage:
    url = season_url(season_year)
    html = fetch(url, RAW_DIR / "deer" / f"{season_year}-{season_year + 1}.html", refresh=refresh)
    return parse_deer_page(html, season_year, url)


def page_to_rows(page: DeerPage, chosen: dict[str, HarvestTable]) -> list[dict]:
    rows = []
    for t in chosen.values():
        for r in t.rows:
            for cls in CLASS_COLUMNS:
                rows.append({
                    "state": "MO", "species": "deer", "season_year": page.season_year, "season": "fall",
                    "portion": t.portion, "portion_label": t.title, "method": t.method, "youth": t.youth,
                    "is_subtotal": t.is_subtotal, "derived": t.derived, "county_fips": r.county_fips, "class": cls,
                    "count": r.counts[cls], "source_url": page.source_url,
                })
    return rows


JSON_COLUMNS = ["species", "season_year", "season", "portion", "method", "youth", "is_subtotal", "derived",
                "county_fips", "class", "count"]


def compact_json(rows: list[dict]) -> dict:
    """Column-ordered row arrays; the per-(species, year, portion) labels and URLs live in a lookup."""
    labels: dict[str, dict] = {}
    for r in rows:
        key = f"{r['species']}:{r['season_year']}:{r['portion']}"
        labels.setdefault(key, {"portion_label": r["portion_label"], "source_url": r["source_url"]})
    return {
        "state": "MO",
        "columns": JSON_COLUMNS,
        "rows": [[r[c] for c in JSON_COLUMNS] for r in rows],
        "labels": labels,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-fetch pages even if cached")
    ap.add_argument("--seasons", type=int, nargs="*", default=list(DEER_SEASONS))
    args = ap.parse_args(argv)

    all_rows: list[dict] = []
    errors: list[str] = []
    warnings: list[str] = []
    for y in args.seasons:
        page = load_deer_page(y, refresh=args.refresh)
        chosen, e, w = check_page(page)
        errors += e
        warnings += w
        all_rows += page_to_rows(page, chosen)
        portions = sorted(chosen)
        print(f"{y}-{y + 1}: {len(page.tables)} tables, {len(page.skipped)} skipped, "
              f"{len(e)} errors, {len(w)} warnings; portions={portions}")
    for w in warnings:
        print("WARN", w)
    if errors:
        for e in errors:
            print("ERROR", e, file=sys.stderr)
        print(f"validation failed with {len(errors)} error(s); outputs not written", file=sys.stderr)
        return 1

    DATA_DIR.mkdir(exist_ok=True)
    table = pa.Table.from_pylist(all_rows, schema=SCHEMA)
    pq.write_table(table, DATA_DIR / "harvest.parquet", compression="zstd")
    (DATA_DIR / "harvest.json").write_text(json.dumps(compact_json(all_rows), separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(all_rows)} rows -> data/harvest.parquet, data/harvest.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
