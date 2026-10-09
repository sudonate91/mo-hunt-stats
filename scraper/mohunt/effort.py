"""County hunting effort, statewide permits and hunter success from MDC's annual deer reports.

Source: "Missouri Deer Season Summary & Population Status Report" PDFs (one per season, 2018-2024),
cached under data/raw/mdc/<year>_pop_status_report.pdf. Missing PDFs are fetched politely via fetch_bytes.

Writes data/effort.json:
  county_effort       county x year: harvest, per-sq-mi densities, trips per kill, public land (column set varies by year)
  statewide_permits   year x permit type: permits issued, deer harvested
  statewide_hunters   year x method: hunters by number of deer harvested

Validation (fails loudly):
  - every regional table: county harvest sums to the printed regional total (t=), each per-sq-mi column's county
    mean is within 0.15 of the printed average (a=), counties all belong to one MDC region, 8 regions, 114 counties
  - county harvest vs data/harvest.parquet: >1% off is a WARN; FAIL if >10% of a year's counties are >5% off
  - hunter distribution rows (0,1,2,3,4+) sum to the printed total hunters

Run from scraper/:  python -m mohunt.effort
"""
from __future__ import annotations

import datetime as dt
import io
import json
import re
import sys
from collections import Counter, defaultdict
from functools import lru_cache
from pathlib import Path

from pypdf import PdfReader

from . import counties
from .fetch import RAW_DIR, REPO_ROOT, fetch_bytes

REPORTS: dict[int, str] = {
    2018: "https://mdc.mo.gov/sites/default/files/2020-10/DeerPopStatusReport.pdf",
    2019: "https://mdc.mo.gov/sites/default/files/2021-01/2019DeerPopStatusReport.pdf",
    2020: "https://mdc.mo.gov/sites/default/files/2021-09/2020_Deer_Population_Status_Report_0.pdf",
    2021: "https://mdc.mo.gov/sites/default/files/2022-09/2021_Deer_Pop_Status_Report_0.pdf",
    2022: "https://mdc.mo.gov/sites/default/files/2023-09/2022DeerPopulationStatusReport.pdf",
    2023: "https://mdc.mo.gov/sites/default/files/2025-07/2023%20pop%20status%20report%2020250604.pdf",
    2024: "https://mdc.mo.gov/sites/default/files/2026-02/2024_pop_status_report.pdf",
}
YEARS = sorted(REPORTS)
PDF_DIR = RAW_DIR / "mdc"
OUT = REPO_ROOT / "data" / "effort.json"
HARVEST_PARQUET = REPO_ROOT / "data" / "harvest.parquet"
COUNTY_JSON = REPO_ROOT / "data" / "county.json"

ST_LOUIS_CITY = "29510"
EXPECTED_COUNTIES = 114
EXPECTED_REGIONS = 8
AVG_TOLERANCE = 0.15

EFFORT_FIELDS = [
    "harvest", "harvest_per_sqmi", "firearms_hunters_per_sqmi", "archery_hunters_per_sqmi",
    "trips_per_kill_firearms", "trips_per_kill_archery", "public_land_acres", "public_areas",
]
PER_SQMI = {"harvest_per_sqmi", "firearms_hunters_per_sqmi", "archery_hunters_per_sqmi"}
INT_FIELDS = {"harvest", "public_land_acres", "public_areas"}

# Printed regional averages (a=) that are not the mean of the printed county values. Pinned so a corrected
# report fails the build. 2020's hunter-density averages run 0.3-0.9 below the county mean in every region but
# one (Kansas City archery is above); the 2020 trips-per-kill averages in the same rows do match, so the county
# values parse correctly and MDC computed these averages some other way.
KNOWN_AVG_MISMATCHES: set[tuple[int, str, str]] = {
    (2020, "Central", "firearms_hunters_per_sqmi"),
    (2020, "Kansas City", "firearms_hunters_per_sqmi"),
    (2020, "Kansas City", "archery_hunters_per_sqmi"),
    (2020, "Northeast", "firearms_hunters_per_sqmi"),
    (2020, "Northwest", "firearms_hunters_per_sqmi"),
    (2020, "Ozark", "firearms_hunters_per_sqmi"),
    (2020, "Southeast", "firearms_hunters_per_sqmi"),
    (2020, "Southwest", "firearms_hunters_per_sqmi"),
    (2020, "St. Louis", "firearms_hunters_per_sqmi"),
    (2021, "St. Louis", "harvest_per_sqmi"),
}

# Hunter-distribution tables whose 0/1/2/3/4+ rows do not sum to the printed total hunters. 2019 firearms sums to
# 431,659 of 457,306 (94.4%); MDC's own percent column also sums to 94.4%, so the table, not the parse, is short.
KNOWN_HUNTER_MISMATCHES: set[tuple[int, str]] = {(2019, "firearms")}

# County cells that are plainly wrong in the PDF: (year, fips, field) -> printed value. Emitted as null.
# 2018 Johnson prints 0.3 deer/sq mi for 2,677 deer (2017: ~3.2, 2019: 3.5); 2018 Polk prints 9.1 for 2,848 deer
# (2019: 4.7). Both are about 10x / 2x the neighbouring years and the harvest/area ratio.
CELL_ERRATA: dict[tuple[int, str, str], float] = {
    (2018, "29101", "harvest_per_sqmi"): 0.3,
    (2018, "29167", "harvest_per_sqmi"): 9.1,
    # 2024 report prints Ste. Genevieve 3.0 / 1.3 and Macon 3.9 / 1.1 hunters per sq mi after 12.1-12.9 / 2.0-3.4 and
    # 6.7-8.2 / 2.2-3.4 in 2021-2023 with flat harvest: misprints that would top "deer per hunter". Nulled.
    (2024, "29186", "firearms_hunters_per_sqmi"): 3.0,
    (2024, "29186", "archery_hunters_per_sqmi"): 1.3,
    (2024, "29121", "firearms_hunters_per_sqmi"): 3.9,
    (2024, "29121", "archery_hunters_per_sqmi"): 1.1,
}

# Header phrase -> field. Matched against the lowercased, whitespace-collapsed header; columns are ordered by position.
HEADER_PATTERNS = [
    (r"total harvest", "harvest"),
    (r"(?:harvested deer|deer harvested|harvest) per square mile", "harvest_per_sqmi"),
    (r"firearms hunters per square mile", "firearms_hunters_per_sqmi"),
    (r"archery hunters per square mile", "archery_hunters_per_sqmi"),
    (r"trips per kill \(firearms\)", "trips_per_kill_firearms"),
    (r"trips per kill \(archery\)", "trips_per_kill_archery"),
    (r"public land hunting acres", "public_land_acres"),
    (r"number (?:of )?public hunting areas", "public_areas"),
]

HEADER_RE = re.compile(r"County\s+Total\s+Harvest\b")
TOTAL_RE = re.compile(r"Total\s*\(t\)\s*/\s*Avg\.?\s*\(a\)")
TA_RE = re.compile(r"([ta])\s*=\s*([\d,]*\.?\d+)")
NUM = r"-?[\d,]*\.?\d+"

NOTES = [
    "Hunter density (firearms/archery hunters per square mile) counts hunters who reported hunting in that county, "
    "per MDC permit and Telecheck records, for the whole season; it is people per county, not permits or tags. "
    "A hunter who hunted several counties is counted in each.",
    "County-level permit sales were last published by MDC for 2014; statewide_permits is statewide only.",
    "Column sets differ by report year: 2018-2019 harvest, harvest per sq mi, firearms trips per kill, public land "
    "acres and areas; 2020 harvest, firearms/archery hunters per sq mi and trips per kill (no harvest per sq mi); "
    "2021-2022 all six harvest/density/trips columns; 2023-2024 harvest and the three per-sq-mi densities only. "
    "Missing columns are null.",
    "Public land acres and areas in 2018 and 2019 print identical regional totals, so they appear to be a static "
    "inventory rather than a per-season measurement.",
    "Report harvest totals can predate late Telecheck corrections, so a few counties differ slightly from "
    "data/harvest.parquet (MDC's current harvest pages); harvest.parquet is the authoritative harvest.",
    "statewide_permits shows each year from the later report when two reports cover it. 'Permittee Archery "
    "Any-Deer' etc. (2018-2019 labels) are the same permits later labelled 'Archery Any-Deer' and share a slug.",
    "statewide_hunters 'hunters_*_deer' are hunters by number of deer harvested; 'combined' counts each person once "
    "across archery and firearms. hunters_3plus_deer = MDC's '3' + '4 or more' rows.",
    "harvest_per_sqmi is MDC's printed value. It is not harvest / Census land area: MDC's area base is about 6% "
    "smaller for most counties and much smaller for urban ones (St. Louis County ~2.3x, Jackson ~1.6x, Clay and "
    "St. Charles ~1.3x), so recompute from county.json land area if you need a consistent denominator.",
    "2018 harvest_per_sqmi for Johnson (printed 0.3) and Polk (printed 9.1) are obvious typos and are null.",
    "Some printed regional averages are not the mean of the county values (all 2020 firearms hunter-density "
    "averages, 2020 Kansas City archery density, 2021 St. Louis harvest per sq mi); the county values are kept "
    "as printed.",
    "statewide_hunters 2019 firearms: MDC's 0/1/2/3/4+ deer rows sum to 431,659, not the printed 457,306 "
    "firearms hunters (its percent column also sums to 94.4%); values are kept as printed.",
    "2018-2019 report harvest matches data/harvest.parquet exactly in only ~55% of counties and is almost always "
    "higher; 13-15 counties per year differ by >1% and 4 by >5% (Jackson ~19%, St. Charles ~12%, St. Louis County "
    "~9%, Clay/Carter ~5%). 2020 has 2 counties >1% off; 2021-2024 match within 1% (mostly exactly).",
    "St. Louis City is not in the regional tables (114 counties per year).",
]


class EffortError(RuntimeError):
    pass


# ----------------------------------------------------------------------------- PDF text

def pdf_path(year: int) -> Path:
    return PDF_DIR / f"{year}_pop_status_report.pdf"


@lru_cache(maxsize=None)
def report_text(year: int) -> str:
    """Full text of a report, pages joined by newlines. Fetches the PDF if it is not cached."""
    data = fetch_bytes(REPORTS[year], pdf_path(year))
    reader = PdfReader(io.BytesIO(data))
    return "\n".join((p.extract_text() or "") for p in reader.pages)


def _num(s: str) -> float:
    return float(s.replace(",", ""))


# ----------------------------------------------------------------------------- county names

@lru_cache(maxsize=1)
def _county_name_re() -> re.Pattern:
    rows = json.loads(Path(counties.__file__).with_name("counties.json").read_text(encoding="utf-8"))
    names: set[str] = set()
    for r in rows:
        if r["fips"] == ST_LOUIS_CITY:
            continue
        for n in [r["name"], *r["aliases"]]:
            names.add(n.lower())
    pats = []
    for n in sorted(names, key=len, reverse=True):
        words = re.split(r"[\s.]+", n.strip(". "))
        pats.append(r"[\s.]*".join(re.escape(w) for w in words if w) + (r"\.?" if n.endswith(".") else ""))
    return re.compile(r"(?<![A-Za-z])(" + "|".join(pats) + r")(?![A-Za-z])", re.IGNORECASE)


@lru_cache(maxsize=1)
def county_regions() -> dict[str, str]:
    return {r["fips"]: r["mdc_region"] for r in json.loads(COUNTY_JSON.read_text(encoding="utf-8"))}


# ----------------------------------------------------------------------------- regional tables

def columns_from_header(header: str) -> list[str]:
    h = re.sub(r"\s+", " ", header.lower())
    found = []
    for pat, field in HEADER_PATTERNS:
        m = re.search(pat, h)
        if m:
            found.append((m.start(), field))
    cols = [f for _, f in sorted(found)]
    if not cols or cols[0] != "harvest":
        raise EffortError(f"unrecognized regional table header: {header!r}")
    return cols


def parse_regional_tables(year: int) -> list[dict]:
    """Return one dict per regional table: {region, columns, rows: {fips: {field: value}}, totals: [(kind, value)]}."""
    text = report_text(year)
    name_re = _county_name_re()
    tables = []
    for hm in HEADER_RE.finditer(text):
        tm = TOTAL_RE.search(text, hm.end())
        if not tm:
            raise EffortError(f"{year}: regional table header at {hm.start()} has no Total (t)/Avg (a) row")
        nxt = HEADER_RE.search(text, hm.end())
        if nxt and nxt.start() < tm.start():
            raise EffortError(f"{year}: two regional table headers before a Total row (offset {hm.start()})")
        first = name_re.search(text, hm.end(), tm.start())
        if not first:
            raise EffortError(f"{year}: no county rows after header at offset {hm.start()}")
        header = text[hm.start():first.start()]
        cols = columns_from_header(header)
        body = text[first.start():tm.start()]
        n = len(cols)
        row_re = re.compile(
            name_re.pattern + r"\s+(" + r"\s+".join([NUM] * n) + r")(?![\d.,])", re.IGNORECASE)
        rows: dict[str, dict] = {}
        consumed = 0
        leftovers = []
        for m in row_re.finditer(body):
            gap = body[consumed:m.start()]
            if gap.strip():
                leftovers.append(gap.strip())
            consumed = m.end()
            fips = counties.to_fips(m.group(1))
            vals = m.group(2).split()
            if fips in rows:
                raise EffortError(f"{year}: county {m.group(1)!r} appears twice in one regional table")
            rows[fips] = {c: (int(_num(v)) if c in INT_FIELDS else _num(v)) for c, v in zip(cols, vals)}
        if body[consumed:].strip():
            leftovers.append(body[consumed:].strip())
        if leftovers:
            raise EffortError(f"{year}: unparsed text in regional table ({cols}): {leftovers!r}")
        line_end = text.find("\n", tm.end())
        totals = TA_RE.findall(text[tm.end(): line_end if line_end >= 0 else None])
        if len(totals) != n:
            raise EffortError(f"{year}: Total row has {len(totals)} values for {n} columns: {totals!r}")
        regs = {county_regions()[f] for f in rows}
        if len(regs) != 1:
            raise EffortError(f"{year}: regional table mixes MDC regions {sorted(regs)}")
        tables.append({"region": regs.pop(), "columns": cols, "rows": rows,
                       "totals": [(k, _num(v)) for k, v in totals]})
    return tables


def validate_tables(year: int, tables: list[dict]) -> list[str]:
    """Raise on any reconciliation failure; return informational lines."""
    info = []
    errors = []
    regions = Counter(t["region"] for t in tables)
    if len(regions) != EXPECTED_REGIONS or max(regions.values()) != 1:
        errors.append(f"{year}: expected {EXPECTED_REGIONS} distinct regional tables, got {dict(regions)}")
    n_counties = sum(len(t["rows"]) for t in tables)
    if n_counties != EXPECTED_COUNTIES:
        errors.append(f"{year}: expected {EXPECTED_COUNTIES} counties, got {n_counties}")
    for t in tables:
        rows = t["rows"].values()
        for col, (kind, printed) in zip(t["columns"], t["totals"]):
            vals = [r[col] for r in rows]
            if kind == "t":
                s = sum(vals)
                if s != printed:
                    msg = f"{year} {t['region']}: sum of {col} = {s:,.0f} but MDC prints t = {printed:,.0f}"
                    (errors if col == "harvest" else info).append(msg if col == "harvest" else "WARN " + msg)
            else:
                mean = sum(vals) / len(vals)
                off = abs(mean - printed)
                key = (year, t["region"], col)
                msg = f"{year} {t['region']}: mean {col} = {mean:.2f} vs printed a = {printed} (off {off:.2f})"
                if off > AVG_TOLERANCE:
                    if key in KNOWN_AVG_MISMATCHES:
                        info.append("KNOWN " + msg)
                    elif col in PER_SQMI:
                        errors.append(msg)
                    else:
                        info.append("WARN " + msg)
                elif key in KNOWN_AVG_MISMATCHES:
                    errors.append(f"stale KNOWN_AVG_MISMATCHES entry, now reconciles: {msg}")
    if errors:
        raise EffortError("regional table validation failed:\n  " + "\n  ".join(errors))
    return info


def county_effort_rows(year: int) -> list[dict]:
    """Parsed, validated rows for one report year (errata cells nulled). See validate_tables for the checks."""
    tables = parse_regional_tables(year)
    validate_tables(year, tables)
    return tables_to_rows(year, tables)


def tables_to_rows(year: int, tables: list[dict]) -> list[dict]:
    out = []
    for t in tables:
        for fips, vals in t["rows"].items():
            row = {"county_fips": fips, "year": year, **{f: vals.get(f) for f in EFFORT_FIELDS}}
            for (ey, ef, field), printed in CELL_ERRATA.items():
                if ey == year and ef == fips:
                    if row[field] != printed:
                        raise EffortError(f"stale CELL_ERRATA {year} {fips} {field}: expected printed {printed}, "
                                          f"found {row[field]}")
                    row[field] = None
            out.append(row)
    return sorted(out, key=lambda r: r["county_fips"])


# ----------------------------------------------------------------------------- harvest cross-check

@lru_cache(maxsize=1)
def parquet_deer_harvest() -> dict[tuple[int, str], int]:
    import pyarrow.parquet as pq

    t = pq.read_table(HARVEST_PARQUET, columns=["species", "season_year", "is_subtotal", "county_fips", "count"])
    d = t.to_pydict()
    out: dict[tuple[int, str], int] = defaultdict(int)
    for sp, y, sub, f, c in zip(d["species"], d["season_year"], d["is_subtotal"], d["county_fips"], d["count"]):
        if sp == "deer" and not sub:
            out[(int(y), f)] += int(c)
    return dict(out)


def crosscheck_harvest(rows: list[dict]) -> dict[int, dict]:
    """Compare report harvest to harvest.parquet. Returns {year: {'over1': [...], 'over5': n, 'n': n}}; raises on FAIL."""
    ref = parquet_deer_harvest()
    by_year: dict[int, dict] = {}
    for r in rows:
        y = r["year"]
        st = by_year.setdefault(y, {"n": 0, "exact": 0, "over1": [], "over5": 0, "missing": 0})
        st["n"] += 1
        p = ref.get((y, r["county_fips"]))
        if p is None:
            st["missing"] += 1
            continue
        diff = r["harvest"] - p
        if diff == 0:
            st["exact"] += 1
        pct = abs(diff) / p if p else float("inf")
        if pct > 0.01:
            st["over1"].append((r["county_fips"], r["harvest"], p, diff, pct))
        if pct > 0.05:
            st["over5"] += 1
    failures = [f"{y}: {s['over5']}/{s['n']} counties differ from harvest.parquet by >5%"
                for y, s in sorted(by_year.items()) if s["n"] and s["over5"] > 0.10 * s["n"]]
    if failures:
        raise EffortError("harvest cross-check failed:\n  " + "\n  ".join(failures))
    return by_year


# ----------------------------------------------------------------------------- statewide permits

PERMIT_ROW_RE = re.compile(
    r"^\s*([A-Za-z][A-Za-z\- ]*?)\s+([\d,]+)\s+([\d,]+)\s+([-+<>]*\d*%)\s+([\d,]+)\s+([\d,]+)\s+([-+<>]*\d*%)\s*$")
YEARS_ROW_RE = re.compile(r"^\s*(\d{4})\s+(\d{4})\s+Change\s+(\d{4})\s+(\d{4})\s+Change\s*$")


def permit_slug(label: str) -> str:
    s = label.lower()
    s = re.sub(r"^permittee\s+", "", s)
    s = re.sub(r"\bnon-?\s*resident\b", "non_resident", s)
    s = re.sub(r"[^a-z_]+", "_", s).strip("_")
    return s


def parse_permits(year: int) -> list[dict]:
    text = report_text(year)
    start = text.find("Permit Type1")
    if start < 0:
        start = text.find("Permit Type")
    end = text.find("inclusive list of permit types", start)
    if start < 0 or end < 0:
        raise EffortError(f"{year}: permit-type table not found")
    years = None
    out = []
    for line in text[start:end].splitlines():
        ym = YEARS_ROW_RE.match(line)
        if ym:
            a, b, c, d = map(int, ym.groups())
            if (a, b) != (c, d) or b != year or a != year - 1:
                raise EffortError(f"{year}: unexpected permit-table year header {line!r}")
            years = (a, b)
            continue
        m = PERMIT_ROW_RE.match(line)
        if not m:
            continue
        if years is None:
            raise EffortError(f"{year}: permit row before the year header: {line!r}")
        label = re.sub(r"\s+", " ", m.group(1)).strip()
        for i, y in enumerate(years):
            out.append({"year": y, "permit_type": permit_slug(label), "permit_label": label,
                        "permits_issued": int(_num(m.group(2 + i))),
                        "deer_harvested": int(_num(m.group(5 + i))), "report_year": year})
    if len(out) < 20:
        raise EffortError(f"{year}: only {len(out) // 2} permit rows parsed")
    return out


def statewide_permits(years=YEARS) -> tuple[list[dict], list[str]]:
    """De-duplicate across reports, preferring the later report; return (rows, disagreements)."""
    best: dict[tuple[int, str], dict] = {}
    disagreements = []
    for y in years:
        for r in parse_permits(y):
            k = (r["year"], r["permit_type"])
            prev = best.get(k)
            if prev and (prev["permits_issued"], prev["deer_harvested"]) != (r["permits_issued"], r["deer_harvested"]):
                disagreements.append(
                    f"{k[0]} {k[1]}: {prev['report_year']} report {prev['permits_issued']:,}/{prev['deer_harvested']:,}"
                    f" vs {r['report_year']} report {r['permits_issued']:,}/{r['deer_harvested']:,} (kept later)")
            if not prev or r["report_year"] >= prev["report_year"]:
                best[k] = r
    rows = [{k: v for k, v in r.items() if k != "report_year"} | {"source_report": r["report_year"]}
            for r in best.values()]
    return sorted(rows, key=lambda r: (r["year"], r["permit_type"])), disagreements


# ----------------------------------------------------------------------------- statewide hunters

def parse_hunters(year: int) -> list[dict]:
    text = report_text(year)
    tot = re.search(r"Total\s+hunters\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)", text, re.IGNORECASE)
    dh = re.search(r"Deer\s+Harvested\s+Number\s+of\s+Hunters", text)
    if not tot or not dh:
        return []
    block = text[dh.end(): dh.end() + 600]
    dist: dict[str, tuple[int, int, int]] = {}
    for key, pat in (("0", r"^0"), ("1", r"^1"), ("2", r"^2"), ("3", r"^3"), ("4+", r"^4 or more")):
        m = re.search(pat + r"\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s*$", block, re.MULTILINE)
        if not m:
            raise EffortError(f"{year}: hunter distribution row {key!r} not found")
        dist[key] = tuple(int(_num(v)) for v in m.groups())
    out = []
    for i, method in enumerate(("archery", "firearms", "combined")):
        total = int(_num(tot.group(i + 1)))
        row = {"year": year, "method": method, "hunters_total": total,
               "hunters_0_deer": dist["0"][i], "hunters_1_deer": dist["1"][i], "hunters_2_deer": dist["2"][i],
               "hunters_3plus_deer": dist["3"][i] + dist["4+"][i]}
        s = row["hunters_0_deer"] + row["hunters_1_deer"] + row["hunters_2_deer"] + row["hunters_3plus_deer"]
        if (s != total) != ((year, method) in KNOWN_HUNTER_MISMATCHES):
            raise EffortError(f"{year} {method}: hunter distribution sums to {s:,}, total hunters is {total:,} "
                              f"(KNOWN_HUNTER_MISMATCHES lists {sorted(KNOWN_HUNTER_MISMATCHES)})")
        out.append(row)
    return out


# ----------------------------------------------------------------------------- build

def build() -> dict:
    effort: list[dict] = []
    for y in YEARS:
        tables = parse_regional_tables(y)
        for line in validate_tables(y, tables):
            print("  " + line)
        rows = tables_to_rows(y, tables)
        cols = [f for f in EFFORT_FIELDS if any(r[f] is not None for r in rows)]
        print(f"{y}: {len(rows)} counties in {len(tables)} regions; columns: {', '.join(cols)}")
        effort.extend(rows)

    xc = crosscheck_harvest(effort)
    for y, s in sorted(xc.items()):
        print(f"{y}: harvest vs harvest.parquet: {s['exact']}/{s['n']} exact, {len(s['over1'])} >1%, "
              f"{s['over5']} >5%, {s['missing']} missing")
        for fips, rep, par, diff, pct in s["over1"]:
            print(f"  WARN {y} {counties.names_by_fips()[fips]} ({fips}): report {rep:,} vs parquet {par:,} "
                  f"({diff:+,}, {pct:.1%})")

    permits, disagreements = statewide_permits()
    for d in disagreements:
        print(f"  NOTE permit revision: {d}")
    hunters = [r for y in YEARS for r in parse_hunters(y)]

    notes = list(NOTES)
    if disagreements:
        notes.append(f"{len(disagreements)} permit rows were revised between consecutive reports; the later report wins.")
    return {
        "source": "MDC Deer Season Summary & Population Status Reports",
        "reports": {str(y): REPORTS[y] for y in YEARS},
        "fetched": dt.date.today().isoformat(),
        "notes": notes,
        "county_effort": effort,
        "statewide_permits": permits,
        "statewide_hunters": hunters,
    }


def main(argv: list[str] | None = None) -> int:
    try:
        doc = build()
    except EffortError as e:
        print(f"FAIL: {e}", file=sys.stderr)
        return 1
    OUT.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(REPO_ROOT)}: {len(doc['county_effort'])} county rows, "
          f"{len(doc['statewide_permits'])} permit rows, {len(doc['statewide_hunters'])} hunter rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
