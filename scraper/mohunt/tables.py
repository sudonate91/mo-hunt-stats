"""Species-agnostic parsing of an MDC county harvest table."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from bs4 import Tag

from .counties import is_county, to_fips


class ParseError(RuntimeError):
    pass


@dataclass
class CountyRow:
    county_name: str
    county_fips: str
    counts: dict[str, int]  # class -> count
    total: int
    extras: dict[str, int] = field(default_factory=dict)  # e.g. public_land, crossbow (turkey)


@dataclass
class HarvestTable:
    title: str
    portion: str
    is_subtotal: bool
    method: str
    youth: bool
    rows: list[CountyRow]
    printed_total: dict[str, int]  # class + 'total' (+ extras) -> MDC's printed Total row
    index: int  # position among <table>s on the page
    derived: bool = False  # rebuilt from other tables (see validate.ERRATA)
    classes: tuple[str, ...] = ()  # class column order as printed


TOTAL_LABELS = {"total", "totals", "grand total", "grand totals"}


def is_total_label(label: str) -> bool:
    return re.sub(r"[^a-z ]", "", label.lower()).strip() in TOTAL_LABELS


def parse_int(text: str) -> int:
    """'1,231' -> 1231, '1231' -> 1231, '' / '-' -> 0."""
    s = text.replace(",", "").replace("\xa0", "").strip()
    if s in ("", "-", "—"):
        return 0
    if not re.fullmatch(r"\d+", s):
        raise ParseError(f"not an integer: {text!r}")
    return int(s)


def text_of(el: Tag) -> str:
    return re.sub(r"\s+", " ", el.get_text(" ", strip=True)).strip()


def table_rows(table: Tag) -> list[list[str]]:
    out = []
    for tr in table.find_all("tr"):
        cells = [text_of(c) for c in tr.find_all(["th", "td"])]
        if any(cells):
            out.append(cells)
    return out


def is_header(row: list[str]) -> bool:
    return bool(row) and row[0].strip().lower() in ("county", "season/portion")


def parse_county_table(
    table: Tag,
    index: int,
    title: str,
    portion: str,
    is_subtotal: bool,
    method: str,
    youth: bool,
    header_map: dict[str, str],
    *,
    fallback_total_rows: list[list[str]] | None = None,
) -> HarvestTable:
    """Parse one county table.

    header_map: lowercase printed column header -> "total" | "class:<slug>" | "extra:<slug>" | "skip".
    fallback_total_rows: rows from a neighbouring table to search for a Total row when this table lacks one
    (MDC occasionally prints the Total in the Top 5 table instead).
    """
    rows = table_rows(table)
    header_idx = next((i for i, r in enumerate(rows) if is_header(r)), None)
    if header_idx is None:
        raise ParseError(f"{title!r}: header row not found; first row = {rows[0] if rows else None}")
    header = [h.lower() for h in rows[header_idx]]
    cols: list[tuple[int, str, str]] = []  # (cell index, kind, slug)
    for i, h in enumerate(header[1:], start=1):
        if h not in header_map:
            raise ParseError(f"{title!r}: unexpected column header {h!r} (headers={rows[header_idx]})")
        spec = header_map[h]
        if spec == "skip":
            continue
        kind, _, slug = spec.partition(":")
        cols.append((i, kind, slug))
    classes = tuple(slug for _, kind, slug in cols if kind == "class")
    if "total" not in {kind for _, kind, _ in cols}:
        raise ParseError(f"{title!r}: no Total column")

    body = [r for i, r in enumerate(rows) if i != header_idx and not is_header(r)]

    def split(values: list[int]) -> tuple[dict[str, int], int, dict[str, int]]:
        counts, extras, total = {}, {}, 0
        for (ci, kind, slug), v in zip(cols, [values[ci - 1] for ci, _, _ in cols]):
            if kind == "class":
                counts[slug] = v
            elif kind == "extra":
                extras[slug] = v
            else:
                total = v
        return counts, total, extras

    county_rows: list[CountyRow] = []
    printed: dict[str, int] | None = None
    for r in body:
        if len(r) != len(header):
            raise ParseError(f"{title!r}: row has {len(r)} cells, header has {len(header)}: {r}")
        label, *nums = r
        values = [parse_int(n) for n in nums]
        if is_total_label(label):
            if printed is not None:
                raise ParseError(f"{title!r}: two Total rows")
            counts, total, extras = split(values)
            printed = {**counts, "total": total, **extras}
            continue
        if not is_county(label):
            raise ParseError(f"{title!r}: unknown county {label!r}")
        counts, total, extras = split(values)
        county_rows.append(CountyRow(label, to_fips(label), counts, total, extras))

    if printed is None and fallback_total_rows:
        for r in fallback_total_rows:
            if r and is_total_label(r[0]) and len(r) == len(header):
                counts, total, extras = split([parse_int(n) for n in r[1:]])
                printed = {**counts, "total": total, **extras}
                break
    if printed is None:
        raise ParseError(f"{title!r}: no printed Total row")
    return HarvestTable(title, portion, is_subtotal, method, youth, county_rows, printed, index, classes=classes)
