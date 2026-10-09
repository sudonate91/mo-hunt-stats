from __future__ import annotations

import json

import pytest

from conftest import SEASONS, get_page
from mohunt import counties
from mohunt.build import SCHEMA, compact_json, page_to_rows
from mohunt.counties import UnknownCountyError, to_fips
from mohunt.deer import CLASS_COLUMNS, ParseError, classify, parse_int
from mohunt.validate import ERRATA, column_sums

# First table of that portion whose printed Total does not match its county rows.
KNOWN_DEFECTS = {
    (2019, "late_antlerless"): "MDC 2019 Antlerless table has values on wrong county rows (sum 10,995 vs printed 10,597); derived via validate.ERRATA",
    (2023, "all_firearms"): "MDC 2023 'All Firearms' primary table has a Platte typo; by-county recap is used",
    (2024, "all_firearms"): "MDC 2024 'All Firearms' primary table has a Platte typo; by-county recap is used",
}

_base7 = {"alternative_methods", "archery", "early_youth", "late_antlerless", "late_youth", "november", "opening_weekend"}
EXPECTED_PORTIONS = {
    2015: _base7 | {"urban", "managed_hunts"},
    2016: set(_base7),
    2017: set(_base7),
    2018: set(_base7),
    2019: _base7 | {"all_firearms"},
    2020: _base7 | {"all_firearms", "managed_hunts"},
    2021: _base7 | {"all_firearms", "managed_hunts"},
    2022: _base7 | {"all_firearms", "managed_hunts", "grand_total"},
}
for _y in (2023, 2024, 2025):
    EXPECTED_PORTIONS[_y] = _base7 | {"all_firearms", "managed_hunts", "grand_total", "early_antlerless", "cwd"}


def _table_cases():
    cases = []
    for y in SEASONS:
        seen: set[str] = set()
        for t in get_page(y).tables:
            first = t.portion not in seen
            seen.add(t.portion)
            marks = []
            if first and (y, t.portion) in KNOWN_DEFECTS:
                marks.append(pytest.mark.xfail(strict=True, reason=KNOWN_DEFECTS[(y, t.portion)]))
            cases.append(pytest.param(y, t.index, marks=marks, id=f"{y}-t{t.index}-{t.title[:45]}"))
    return cases


@pytest.mark.parametrize("year,index", _table_cases())
def test_county_rows_sum_to_printed_total(year, index):
    t = next(t for t in get_page(year).tables if t.index == index)
    sums = column_sums(t)
    for col in (*CLASS_COLUMNS, "total"):
        assert sums[col] == t.printed_total[col], f"{t.title!r} {col}"


def test_known_defects_cover_errata_derivations():
    assert {(y, p) for (sp, y, p), e in ERRATA.items() if sp == "deer" and e.kind == "derive_from_all_firearms"} <= set(KNOWN_DEFECTS)


@pytest.mark.parametrize("year", SEASONS)
def test_check_page_clean_and_portions(year, checked):
    chosen, errors, _ = checked[year]
    assert errors == []
    assert set(chosen) == EXPECTED_PORTIONS[year]


@pytest.mark.parametrize("year", [2022, 2023, 2024, 2025])
def test_portions_sum_to_grand_total(year, checked):
    chosen = checked[year][0]
    printed = sum(t.printed_total["total"] for t in chosen.values() if not t.is_subtotal)
    assert printed == chosen["grand_total"].printed_total["total"]
    rows = sum(sum(r.total for r in t.rows) for t in chosen.values() if not t.is_subtotal)
    assert rows == chosen["grand_total"].printed_total["total"]


def test_fips_mapping(pages):
    valid = {r["fips"] for r in json.loads(counties._DATA.read_text(encoding="utf-8"))}
    assert len(valid) == 115
    allf = set()
    for p in pages.values():
        for t in p.tables:
            fips = [r.county_fips for r in t.rows]
            assert set(fips) <= valid
            assert len(set(fips)) == len(fips), t.title
            allf |= set(fips)
    assert allf <= valid


def test_114_row_tables_have_114_distinct_fips(pages):
    n = 0
    for p in pages.values():
        for t in p.tables:
            if len(t.rows) == 114:
                n += 1
                assert len({r.county_fips for r in t.rows}) == 114
    assert n > 0


def test_parse_int():
    assert parse_int("1,231") == 1231
    assert parse_int("1231") == 1231
    assert parse_int("") == 0
    with pytest.raises(ParseError):
        parse_int("abc")


@pytest.mark.parametrize("title,slug,sub,youth", [
    ("Opening Weekend of November Firearms November 15-16, 2025", "opening_weekend", True, False),
    ("Archery Portion Sept 15-Nov 14, 2025 Nov 26, 2025-Jan 15, 2026", "archery", False, False),
    ("Late Antlerless Firearms December 7-15, 2024", "late_antlerless", False, False),
    ("Antlerless Firearms November 25-December 6, 2015", "late_antlerless", False, False),
    ("Title All Firearms", "all_firearms", True, False),
    ("Early Youth Firearms", "early_youth", False, True),
])
def test_classify(title, slug, sub, youth):
    s, is_sub, _method, y = classify(title)
    assert (s, is_sub, y) == (slug, sub, youth)


def test_classify_unknown():
    with pytest.raises(ParseError):
        classify("Something Entirely Different")


@pytest.mark.parametrize("name,fips", [
    ("Mcdonald", "29119"), ("McDonald", "29119"), ("Dekalb", "29063"), ("Saint Louis", "29189"),
    ("Saint Louis City (City)", "29510"), ("Sainte Genevieve", "29186"), ("Saint Francois", "29187"),
    ("Carrol", "29033"), ("Cedar<", "29039"),
])
def test_to_fips(name, fips):
    assert to_fips(name) == fips


def test_to_fips_unknown():
    with pytest.raises(UnknownCountyError):
        to_fips("Atlantis")


@pytest.mark.parametrize("year", SEASONS)
def test_top5_never_chosen(year, pages):
    p = pages[year]
    assert any("top 5" in s.lower() for s in p.skipped)
    assert all(len(t.rows) >= 15 for t in p.tables)
    assert all("top 5" not in t.title.lower() for t in p.tables)


def test_spot_values(checked):
    nov = checked[2025][0]["november"]
    assert nov.printed_total["total"] == 158171
    assert next(r for r in nov.rows if r.county_name.lower() == "adair").total == 1389
    assert checked[2015][0]["archery"].printed_total["total"] == 49759
    la = checked[2019][0]["late_antlerless"]
    assert la.derived is True
    by = {r.county_fips: r.total for r in la.rows}
    assert by["29027"] == 397
    assert by["29163"] == 305


@pytest.mark.parametrize("year", SEASONS)
def test_page_to_rows_and_json(year, pages, checked):
    page, chosen = pages[year], checked[year][0]
    rows, _attrs = page_to_rows("deer", page, chosen)
    assert len(rows) == 3 * sum(len(t.rows) for t in chosen.values())
    keys = set(SCHEMA.names)
    assert len(keys) == 14
    assert all(set(r) == keys for r in rows)
    cj = compact_json(rows)
    n = len(cj["counties"])
    assert all(len(s[3]) == n for s in cj["series"])
    assert sum(sum(s[3]) for s in cj["series"]) == sum(r["count"] for r in rows)
    assert set(cj["portions"]) == {t.portion for t in chosen.values()}
    assert cj["species"] == "deer"
