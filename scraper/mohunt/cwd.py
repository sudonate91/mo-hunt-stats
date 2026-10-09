"""Chronic Wasting Disease sampling by county and season, from MDC's ArcGIS REST service.

Source: Terrestrial/CWD_Fall_Reporting_Dashboard MapServer
  table 28  Sampling_HH_County_Aggregate_Current   (current season, PERMITYEAR = this fall)
  table 29  Sampling_HH_County_Aggregate_Previous  (one row per county x previous season)
  tables 26/27  per-sample rows (current / previous); used only as a cross-check via
                server-side group-by counts, so we never download ~300k sample rows.

PERMITYEAR is the fall season year (harvest dates of PERMITYEAR 2016 fall in Nov 2016),
so it maps directly to `year` / season_year.

Run from scraper/:  python -m mohunt.cwd [--refresh]
Writes data/cwd.json.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
from collections import defaultdict
from datetime import date

from .counties import to_fips
from .fetch import RAW_DIR, REPO_ROOT, fetch

SERVICE = (
    "https://gisblue.mdc.mo.gov/arcgis/rest/services/Terrestrial/"
    "CWD_Fall_Reporting_Dashboard/MapServer"
)
CACHE = RAW_DIR / "mdc" / "cwd"
OUT = REPO_ROOT / "data" / "cwd.json"

CURRENT_AGG = 28
PREVIOUS_AGG = 29
CURRENT_SAMPLES = 26
PREVIOUS_SAMPLES = 27

# Buckets in the service that are not a Missouri county. Their samples are excluded
# from county rows but counted (and reported) so statewide totals still reconcile.
NON_COUNTY = {"", "unknown", "out of state"}
# Misspellings seen in this service only.
ALIASES = {"st. claire": "St. Clair"}

SEXES = ("male", "female")
AGES = ("adult", "yearling", "fawn")
RESULTS = ("Positive", "Not_Detected", "Pending")


def _get_json(url: str, cache_name: str, refresh: bool) -> dict:
    data = json.loads(fetch(url, CACHE / cache_name, refresh=refresh))
    if "error" in data:
        raise RuntimeError(f"ArcGIS error for {url}: {data['error']}")
    return data


def query_all(layer: int, refresh: bool) -> list[dict]:
    """All rows of a table, paging with resultOffset while exceededTransferLimit is set."""
    rows: list[dict] = []
    offset = 0
    while True:
        url = (
            f"{SERVICE}/{layer}/query?where=1%3D1&outFields=*&returnGeometry=false"
            f"&orderByFields=OBJECTID&resultOffset={offset}&resultRecordCount=2000&f=json"
        )
        data = _get_json(url, f"table_{layer}_off{offset}.json", refresh)
        feats = data.get("features", [])
        rows.extend(f["attributes"] for f in feats)
        if not data.get("exceededTransferLimit") or not feats:
            return rows
        offset += len(feats)


def sample_counts_by_year(layer: int, refresh: bool) -> dict[int, int]:
    """Per-season count of per-sample rows, computed server-side."""
    stats = json.dumps(
        [{"statisticType": "count", "onStatisticField": "OBJECTID", "outStatisticFieldName": "n"}]
    )
    url = (
        f"{SERVICE}/{layer}/query?where=1%3D1&groupByFieldsForStatistics=PERMITYEAR"
        f"&outStatistics={urllib.parse.quote(stats)}&f=json"
    )
    data = _get_json(url, f"stats_{layer}.json", refresh)
    return {int(f["attributes"]["PERMITYEAR"]): f["attributes"]["n"] for f in data["features"]}


def _county_fips(name: str | None) -> str | None:
    """FIPS for a county name, None for a known non-county bucket; raises on anything else."""
    key = (name or "").strip().lower()
    if key in NON_COUNTY:
        return None
    return to_fips(ALIASES.get(key, name))


def _split(row: dict, keys: tuple[str, ...], samples: int, positives: int) -> dict:
    """Per-class {samples, positives}; samples = tested (positive + not detected + pending).
    'unknown' takes the remainder (unrecorded class, unsuitable, not sampled) so the
    split always sums to the row totals."""
    out = {}
    for k in keys:
        cap = k.capitalize()
        s = sum(row[f"Total_{r}_{cap}"] or 0 for r in RESULTS if f"Total_{r}_{cap}" in row)
        out[k] = {"samples": s, "positives": row[f"Total_Positive_{cap}"] or 0}
    rem_s = samples - sum(v["samples"] for v in out.values())
    rem_p = positives - sum(v["positives"] for v in out.values())
    if rem_s < 0 or rem_p < 0 or rem_p > rem_s:
        raise ValueError(f"split exceeds row totals: {row}")
    out["unknown"] = {"samples": rem_s, "positives": rem_p}
    return out


def build_rows(refresh: bool = False) -> tuple[list[dict], dict]:
    sources = [
        (CURRENT_AGG, "Total_Samples", "Total_Positives"),
        (PREVIOUS_AGG, "Samples_By_Year", "Positives_by_Year"),
    ]
    rows: dict[tuple[str, int], dict] = {}
    excluded: dict[int, dict] = defaultdict(lambda: {"samples": 0, "positives": 0})
    agg_totals: dict[int, int] = defaultdict(int)
    names: dict[tuple[str, int], list[str]] = {}

    for layer, s_field, p_field in sources:
        for r in query_all(layer, refresh):
            year = int(r["PERMITYEAR"])
            samples = r[s_field] or 0
            positives = r[p_field] or 0
            agg_totals[year] += samples
            fips = _county_fips(r["County"])
            if fips is None:
                excluded[year]["samples"] += samples
                excluded[year]["positives"] += positives
                continue
            if positives > samples:
                raise ValueError(f"positives > samples: {r}")
            new = {
                "county_fips": fips,
                "year": year,
                "samples": samples,
                "positives": positives,
                "splits": {
                    "by_sex": _split(r, SEXES, samples, positives),
                    "by_age": _split(r, AGES, samples, positives),
                },
            }
            old = rows.get((fips, year))
            name_key = (r["County"] or "").strip().lower()
            names.setdefault((fips, year), []).append(name_key)
            if old is None:
                rows[(fips, year)] = new
                continue
            if not any(n in ALIASES for n in names[(fips, year)]):
                raise ValueError(
                    f"two rows map to {fips} in {year} (layer {layer}, {r['County']!r}); "
                    "check the county name mapping"
                )
            # The service sometimes carries a second row for a misspelled name
            # (e.g. 'St. Claire' beside 'St Clair'); sum it into the county row.
            print(f"merging duplicate {r['County']!r} {year} into {fips}", file=sys.stderr)
            old["samples"] += samples
            old["positives"] += positives
            for split in ("by_sex", "by_age"):
                for k, v in new["splits"][split].items():
                    old["splits"][split][k]["samples"] += v["samples"]
                    old["splits"][split][k]["positives"] += v["positives"]

    # Cross-check: county aggregates (incl. non-county buckets) must equal the
    # per-sample row counts for every season.
    per_sample = {**sample_counts_by_year(PREVIOUS_SAMPLES, refresh),
                  **sample_counts_by_year(CURRENT_SAMPLES, refresh)}
    mismatches = {y: (agg_totals.get(y), per_sample.get(y))
                  for y in set(agg_totals) | set(per_sample)
                  if agg_totals.get(y) != per_sample.get(y)}
    if mismatches:
        raise ValueError(f"aggregate vs per-sample counts differ (agg, samples): {mismatches}")

    out = sorted(rows.values(), key=lambda x: (x["year"], x["county_fips"]))
    return out, dict(excluded)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--refresh", action="store_true", help="re-fetch instead of using data/raw cache")
    args = ap.parse_args(argv)

    rows, excluded = build_rows(refresh=args.refresh)
    current_year = max(r["year"] for r in rows)
    payload = {
        "source": SERVICE,
        "fetched": date.today().isoformat(),
        "current_season": current_year,  # still in progress; counts include pending tests
        "excluded_non_county": {str(y): v for y, v in sorted(excluded.items())},
        "rows": rows,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")

    totals: dict[int, list[int]] = defaultdict(lambda: [0, 0, 0])
    for r in rows:
        t = totals[r["year"]]
        t[0] += 1
        t[1] += r["samples"]
        t[2] += r["positives"]
    print(f"wrote {OUT} ({len(rows)} rows)")
    print("year  counties  samples  positives  (excluded non-county samples/positives)")
    for y in sorted(totals):
        n, s, p = totals[y]
        e = excluded.get(y, {"samples": 0, "positives": 0})
        print(f"{y}  {n:8d}  {s:7d}  {p:9d}  ({e['samples']}/{e['positives']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
