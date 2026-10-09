"""Parse MDC turkey harvest summary pages (one page per calendar year, 2015..).

Each page carries the spring youth, spring regular, fall firearms and fall archery tables for that
year. Portion comes from the preceding <h2>Title ...</h2>; the <caption> only distinguishes
"Top N Counties" (skipped) from the full table. 2015 also prints spring opening-day and first-week
subtotal tables. From 2018 (archery) / 2023 (all) the tables add Public Land and Crossbow columns,
which are stored as per-county attributes rather than classes (they overlap the class counts).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from bs4 import BeautifulSoup, Tag

from .tables import HarvestTable, ParseError, is_total_label, parse_county_table, table_rows, text_of

SEASON_URL = "https://mdc.mo.gov/hunting-trapping/species/turkey/turkey-reports/turkey-harvest-summaries/{y}-turkey-harvest-summary"

# (regex on lowercased heading, portion, season, is_subtotal, method, youth)
PORTION_RULES: list[tuple[str, str, str, bool, str, bool]] = [
    (r"youth", "spring_youth", "spring", False, "mixed", True),
    (r"opening day", "spring_opening_day", "spring", True, "mixed", False),
    (r"first week", "spring_first_week", "spring", True, "mixed", False),
    (r"spring", "spring", "spring", False, "mixed", False),
    (r"fall.*firearm", "fall_firearms", "fall", False, "firearm", False),
    (r"archery", "fall_archery", "fall", False, "archery", False),
]

SPRING_HEADERS = {
    "adult gobbler": "class:adult_gobbler",
    "bearded hen": "class:bearded_hen",
    "juvenile gobbler": "class:juvenile_gobbler",
    "adult hen": "class:adult_hen",  # 2022 spring prints a stray Adult Hen column (2 birds)
    "gobbler": "class:gobbler",  # 2022 spring prints a stray age-unknown Gobbler column (1 bird)
    "total": "total",
    "turkey total": "total",
    "public land": "extra:public_land",
    "crossbow": "extra:crossbow",
    "": "skip",
}
FALL_HEADERS = {
    "adult gobbler": "class:adult_gobbler",
    "adult gobblers": "class:adult_gobbler",
    "adult hen": "class:adult_hen",
    "adult hens": "class:adult_hen",
    "juvenile gobbler": "class:juvenile_gobbler",
    "juvenile gobblers": "class:juvenile_gobbler",
    "juvenile hen": "class:juvenile_hen",
    "juvenile hens": "class:juvenile_hen",
    "bearded hen": "class:bearded_hen",
    "total": "total",
    "county total": "total",
    "public land": "extra:public_land",
    "crossbow": "extra:crossbow",
    "": "skip",
}
# (year, portion) -> two classes whose county-row columns MDC printed in the opposite order from the
# header and Total row. Pinned in validate.ERRATA so a fixed page fails the build.
COLUMN_SWAPS: dict[tuple[int, str], tuple[str, str]] = {
    (2021, "spring"): ("bearded_hen", "juvenile_gobbler"),
}
TOP_N = re.compile(r"top \d+ counties|statewide high counties")


@dataclass
class TurkeyPage:
    season_year: int
    source_url: str
    tables: list[HarvestTable]
    skipped: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def season_url(year: int) -> str:
    return SEASON_URL.format(y=year)


def heading_for(table: Tag) -> str:
    prev = table.find_previous(["h2", "h3"])
    while prev is not None and not text_of(prev).lower().startswith("title "):
        prev = prev.find_previous(["h2", "h3"])
    if prev is None:
        raise ParseError("no 'Title ...' heading before table")
    return re.sub(r"^title\s+", "", text_of(prev), flags=re.I)


def classify(heading: str) -> tuple[str, str, bool, str, bool]:
    h = heading.lower()
    for pat, portion, season, sub, method, youth in PORTION_RULES:
        if re.search(pat, h):
            return portion, season, sub, method, youth
    raise ParseError(f"cannot map turkey heading to a portion: {heading!r}")


def parse_turkey_page(html: str, year: int, source_url: str) -> TurkeyPage:
    soup = BeautifulSoup(html, "lxml")
    page = TurkeyPage(year, source_url, [])
    tables = soup.find_all("table")
    for i, table in enumerate(tables):
        cap = table.find("caption")
        cap_text = text_of(cap).lower() if cap else ""
        heading = heading_for(table)
        if TOP_N.search(cap_text):
            page.skipped.append(f"{heading} / {text_of(cap)}")
            continue
        portion, season, is_subtotal, method, youth = classify(heading)
        header_map = dict(SPRING_HEADERS if season == "spring" else FALL_HEADERS)
        header = [h.lower() for h in next(r for r in table_rows(table) if r and r[0].lower() == "county")]
        if season == "fall" and "bearded hen" in header and "adult hen" not in header:
            # 2021 fall tables label the Adult Hen column "Bearded Hen".
            header_map["bearded hen"] = "class:adult_hen"
            page.warnings.append(f"{year} {heading}: 'Bearded Hen' column read as adult_hen (no Adult Hen column)")
        fallback = table_rows(tables[i - 1]) if i > 0 else None
        t = parse_county_table(table, i, heading, portion, is_subtotal, method, youth, header_map,
                               fallback_total_rows=fallback)
        if not any(r and is_total_label(r[0]) for r in table_rows(table)):
            page.warnings.append(f"{year} {heading}: Total row taken from the preceding Top 5 table")
        if cap and not cap_text.startswith("all counties") and not re.search(r"spring|fall|turkey", cap_text):
            t.title = f"{heading} ({text_of(cap)})"  # keep MDC's date range, e.g. "Spring Total (4/20/2015-5/10/2015)"
        swap = COLUMN_SWAPS.get((year, portion))
        if swap:
            a, b = swap
            for r in t.rows:
                r.counts[a], r.counts[b] = r.counts[b], r.counts[a]
            page.warnings.append(f"{year} {heading}: county rows print {a} and {b} in swapped order vs the header; swapped back")
        page.tables.append(t)
    if not page.tables:
        raise ParseError(f"{source_url}: no county tables found")
    return page
