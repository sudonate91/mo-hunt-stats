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

from .counties import is_county, to_fips

INDEX_URL = "https://mdc.mo.gov/hunting-trapping/species/deer/deer-harvest-reports/deer-harvest-summaries"
SEASON_URL_NEW = "https://mdc.mo.gov/hunting-trapping/species/deer/deer-harvest-reports/deer-harvest-summaries/deer-harvest-summary-{a}-{b}"
SEASON_URL_OLD = "https://mdc.mo.gov/hunting-trapping/species/deer/deer-reports/deer-harvest-summaries/deer-harvest-summary-{a}-{b}"

CLASS_COLUMNS = ("antlered_buck", "button_buck", "doe")
EXPECTED_HEADERS = (["county", "antlered buck", "button buck", "doe", "total"], ["season/portion", "antlered buck", "button buck", "doe", "total"])

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


class ParseError(RuntimeError):
    pass


@dataclass
class CountyRow:
    county_name: str
    county_fips: str
    counts: dict[str, int]  # class -> count
    total: int


@dataclass
class HarvestTable:
    title: str
    portion: str
    is_subtotal: bool
    method: str
    youth: bool
    rows: list[CountyRow]
    printed_total: dict[str, int]  # class + 'total' -> MDC's printed Total row
    index: int  # position among <table>s on the page
    derived: bool = False  # rebuilt from other tables (see validate.ERRATA)


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


def parse_int(text: str) -> int:
    """'1,231' -> 1231, '1231' -> 1231, '' / '-' -> 0."""
    s = text.replace(",", "").replace("\xa0", "").strip()
    if s in ("", "-", "—"):
        return 0
    if not re.fullmatch(r"\d+", s):
        raise ParseError(f"not an integer: {text!r}")
    return int(s)


def _text(el: Tag) -> str:
    return re.sub(r"\s+", " ", el.get_text(" ", strip=True)).strip()


def table_title(table: Tag) -> str:
    """Caption if it is specific; otherwise the nearest preceding heading, minus a 'Title ' prefix."""
    cap = table.find("caption")
    cap_text = _text(cap) if cap else ""
    if cap_text and cap_text.lower() not in GENERIC_CAPTIONS:
        return cap_text
    prev = table.find_previous(["h2", "h3", "h4", "strong"])
    while prev is not None and (not _text(prev) or re.fullmatch(r"[\d,]+", _text(prev))):
        prev = prev.find_previous(["h2", "h3", "h4", "strong"])
    head = _text(prev) if prev else ""
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


def _rows(table: Tag) -> list[list[str]]:
    out = []
    for tr in table.find_all("tr"):
        cells = [_text(c) for c in tr.find_all(["th", "td"])]
        if any(cells):
            out.append(cells)
    return out


def parse_county_table(table: Tag, index: int) -> HarvestTable:
    title = table_title(table)
    portion, is_subtotal, method, youth = classify(title)
    rows = _rows(table)
    header_idx = next((i for i, r in enumerate(rows) if [c.lower() for c in r] in EXPECTED_HEADERS), None)
    if header_idx is None:
        raise ParseError(f"{title!r}: header row not found; first row = {rows[0] if rows else None}")
    body = [r for i, r in enumerate(rows) if i != header_idx and [c.lower() for c in r] not in EXPECTED_HEADERS]
    county_rows: list[CountyRow] = []
    printed: dict[str, int] | None = None
    for r in body:
        if len(r) != 5:
            raise ParseError(f"{title!r}: row with {len(r)} cells: {r}")
        label, *nums = r
        values = [parse_int(n) for n in nums]
        if label.strip().lower() == "total":
            if printed is not None:
                raise ParseError(f"{title!r}: two Total rows")
            printed = dict(zip([*CLASS_COLUMNS, "total"], values))
            continue
        if not is_county(label):
            raise ParseError(f"{title!r}: unknown county {label!r}")
        county_rows.append(CountyRow(label, to_fips(label), dict(zip(CLASS_COLUMNS, values[:3])), values[3]))
    if printed is None:
        raise ParseError(f"{title!r}: no printed Total row")
    return HarvestTable(title, portion, is_subtotal, method, youth, county_rows, printed, index)


def parse_summary_table(table: Tag) -> list[SummaryRow]:
    out = []
    for r in _rows(table):
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
