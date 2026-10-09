"""Parse MDC deer harvest summary pages into tidy harvest facts.

Page layouts differ by season (see STATUS.md):
  * 2015-16 .. 2022-23: table title in <caption>; Total row FIRST; no thousands separators.
  * 2019-20, 2020-21: generic captions ("All Counties"/"Top 5 Counties"); the title lives in the
    preceding <h2>Title ...</h2>.
  * 2023-24 ..: title in the preceding <h3>/<h2>; Total row LAST; commas in numbers.
  * 2022-23 ..: extra by-county recap tables (Archery / Firearms / Managed Hunts / Grand Totals).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from bs4 import BeautifulSoup, Tag

from .tables import (  # noqa: F401  (re-exported for tests and other modules)
    CountyRow,
    HarvestTable,
    ParseError,
    parse_int,
    table_rows,
    text_of,
)
from .tables import parse_county_table as _parse_generic

INDEX_URL = "https://mdc.mo.gov/hunting-trapping/species/deer/deer-harvest-reports/deer-harvest-summaries"
SEASON_URL_NEW = "https://mdc.mo.gov/hunting-trapping/species/deer/deer-harvest-reports/deer-harvest-summaries/deer-harvest-summary-{a}-{b}"
SEASON_URL_OLD = "https://mdc.mo.gov/hunting-trapping/species/deer/deer-reports/deer-harvest-summaries/deer-harvest-summary-{a}-{b}"

CLASS_COLUMNS = ("antlered_buck", "button_buck", "doe")
HEADER_MAP = {
    "antlered buck": "class:antlered_buck",
    "button buck": "class:button_buck",
    "doe": "class:doe",
    "total": "total",
}

# (regex on lowercased title, portion slug, is_subtotal, method, youth). Order matters.
PORTION_RULES: list[tuple[str, str, bool, str, bool]] = [
    (r"opening weekend", "opening_weekend", True, "firearm", False),
    (r"early antlerless", "early_antlerless", False, "firearm", False),
    (r"antlerless", "late_antlerless", False, "firearm", False),
    (r"early youth", "early_youth", False, "firearm", True),
    (r"late youth", "late_youth", False, "firearm", True),
    (r"urban", "urban", False, "firearm", False),
    (r"\bcwd\b", "cwd", False, "firearm", False),
    (r"alternative", "alternative_methods", False, "firearm", False),
    (r"archery", "archery", False, "archery", False),
    (r"november|fall (deer )?firearms report", "november", False, "firearm", False),
    (r"all firearms|firearm season|^firearms$", "all_firearms", True, "firearm", False),
    (r"managed hunt", "managed_hunts", False, "mixed", False),
    (r"grand total", "grand_total", True, "mixed", False),
]
GENERIC_CAPTIONS = {"all counties", "top 5 counties"}
SKIP_TITLES = (r"top 5", r"all methods")
SUMMARY_TITLES = r"season summary|other totals"


@dataclass
class SummaryRow:
    label: str
    counts: dict[str, int]


@dataclass
class DeerPage:
    season_year: int
    source_url: str
    tables: list[HarvestTable]
    summary: list[SummaryRow] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)


def season_url(season_year: int) -> str:
    tmpl = SEASON_URL_NEW if season_year >= 2025 else SEASON_URL_OLD
    return tmpl.format(a=season_year, b=season_year + 1)


def table_title(table: Tag) -> str:
    """Caption if it is specific; otherwise the nearest preceding heading, minus a 'Title ' prefix."""
    cap = table.find("caption")
    cap_text = text_of(cap) if cap else ""
    if cap_text and cap_text.lower() not in GENERIC_CAPTIONS:
        return cap_text
    prev = table.find_previous(["h2", "h3", "h4", "strong"])
    while prev is not None and (not text_of(prev) or re.fullmatch(r"[\d,]+", text_of(prev))):
        prev = prev.find_previous(["h2", "h3", "h4", "strong"])
    head = text_of(prev) if prev else ""
    head = re.sub(r"^title\s+", "", head, flags=re.I)
    if cap_text:  # generic caption: combine so "Top 5" is still detectable
        return f"{head} {cap_text}"
    return head


def classify(title: str) -> tuple[str, bool, str, bool]:
    t = title.lower()
    for pat, slug, sub, method, youth in PORTION_RULES:
        if re.search(pat, t):
            return slug, sub, method, youth
    raise ParseError(f"cannot map table title to a portion: {title!r}")


def parse_county_table(table: Tag, index: int) -> HarvestTable:
    title = table_title(table)
    portion, is_subtotal, method, youth = classify(title)
    return _parse_generic(table, index, title, portion, is_subtotal, method, youth, HEADER_MAP)


def parse_summary_table(table: Tag) -> list[SummaryRow]:
    out = []
    for r in table_rows(table):
        if len(r) != 5 or r[0].lower() == "season/portion":
            continue
        try:
            vals = [parse_int(x) for x in r[1:]]
        except ParseError:
            continue
        out.append(SummaryRow(r[0], dict(zip([*CLASS_COLUMNS, "total"], vals))))
    return out


def parse_deer_page(html: str, season_year: int, source_url: str) -> DeerPage:
    soup = BeautifulSoup(html, "lxml")
    page = DeerPage(season_year, source_url, [])
    for i, table in enumerate(soup.find_all("table")):
        title = table_title(table)
        low = title.lower()
        if re.search(SUMMARY_TITLES, low):
            page.summary.extend(parse_summary_table(table))
            continue
        if any(re.search(p, low) for p in SKIP_TITLES):
            page.skipped.append(title)
            continue
        page.tables.append(parse_county_table(table, i))
    if not page.tables:
        raise ParseError(f"{source_url}: no county tables found")
    return page
