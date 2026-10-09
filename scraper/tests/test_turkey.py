"""Turkey scraper tests. Cached HTML only (data/raw/turkey/<year>.html); the network is blocked by conftest."""
from __future__ import annotations

import json
from functools import lru_cache

import pytest

import conftest  # noqa: F401  (blocks the network, sets sys.path)
from mohunt import counties
from mohunt.build import load_page, page_to_rows
from mohunt.tables import ParseError, is_total_label
from mohunt.turkey import classify
from mohunt.validate import check_page, column_sums

YEARS = list(range(2015, 2027))

SPRING_ONLY = {"spring_youth", "spring"}
EXPECTED_PORTIONS = {
    2015: {"spring_youth", "spring_opening_day", "spring_first_week", "spring", "fall_firearms", "fall_archery"},
    2026: {"spring_youth", "spring"},
}
for _y in range(2016, 2026):
    EXPECTED_PORTIONS[_y] = {"spring_youth", "spring", "fall_firearms", "fall_archery"}

METHOD = {"spring_youth": "mixed", "spring_opening_day": "mixed", "spring_first_week": "mixed", "spring": "mixed",
          "fall_firearms": "firearm", "fall_archery": "archery"}


@lru_cache(maxsize=None)
def _loaded(year: int):
    """(page, chosen, errors, warnings). check_page applies the cell_fix in place, so it must run exactly once."""
    page = load_page("turkey", year)
    chosen, errors, warnings = check_page(page, "turkey")
    return page, chosen, errors, warnings


def page_of(y):
    return _loaded(y)[0]


def chosen_of(y):
    return _loaded(y)[1]


def _table_cases():
    cases = []
    for y in YEARS:
        for t in page_of(y).tables:
            cases.append(pytest.param(y, t.index, id=f"{y}-t{t.index}-{t.portion}"))
    return cases


@pytest.fixture(scope="session")
def turkey_loaded():
    return {y: _loaded(y) for y in YEARS}


# 1 ----------------------------------------------------------------------------------------------
@pytest.mark.parametrize("year,index", _table_cases())
def test_county_rows_sum_to_printed_total(year, index):
    t = next(t for t in page_of(year).tables if t.index == index)
    sums = column_sums(t)
    assert set(sums) == set(t.printed_total)
    for col, printed in t.printed_total.items():
        assert sums[col] == printed, f"{t.title!r} [{col}]"
    for r in t.rows:
        assert sum(r.counts.values()) == r.total, f"{t.title!r} {r.county_name}"


# 2 ----------------------------------------------------------------------------------------------
@pytest.mark.parametrize("year", YEARS)
def test_check_page_no_errors(year):
    assert _loaded(year)[2] == []


@pytest.mark.parametrize("year", YEARS)
def test_warnings(year):
    warnings = _loaded(year)[3]
    joined = "\n".join(warnings)
    if year == 2020:
        assert "Total row taken from the preceding Top 5 table" in joined
        assert len(warnings) >= 1
    elif year == 2021:
        assert "swapped order" in joined
        assert "Benton" in joined or "Bearded Hen cell prints 1" in joined
        assert sum("'Bearded Hen' column read as adult_hen" in w for w in warnings) == 2
    else:
        assert warnings == []


def test_2020_only_expected_warnings():
    assert all("preceding Top 5 table" in w for w in _loaded(2020)[3])


# 3 ----------------------------------------------------------------------------------------------
@pytest.mark.parametrize("year", YEARS)
def test_expected_portions(year):
    assert set(chosen_of(year)) == EXPECTED_PORTIONS[year]


@pytest.mark.parametrize("year", YEARS)
def test_portion_attributes(year):
    page = page_of(year)
    chosen = chosen_of(year)
    for portion, t in chosen.items():
        assert t.is_subtotal is (portion in {"spring_opening_day", "spring_first_week"}), portion
        assert t.method == METHOD[portion], portion
        assert t.youth is (portion == "spring_youth"), portion
    rows, _ = page_to_rows("turkey", page, chosen)
    for r in rows:
        assert r["season"] == r["portion"].split("_")[0]
        assert r["season"] in ("spring", "fall")
        assert r["species"] == "turkey" and r["state"] == "MO"


# 4 ----------------------------------------------------------------------------------------------
@pytest.mark.parametrize("year", YEARS)
def test_classes(year):
    for portion, t in chosen_of(year).items():
        cls = set(t.classes)
        if portion.startswith("spring"):
            assert cls >= {"adult_gobbler", "bearded_hen", "juvenile_gobbler"}, (year, portion)
            if year == 2022 and portion == "spring":
                assert cls >= {"adult_hen", "gobbler"}
        else:
            assert cls >= {"adult_gobbler", "adult_hen", "juvenile_gobbler", "juvenile_hen"}, (year, portion)
            if year == 2022 and portion == "fall_archery":
                assert "bearded_hen" in cls


@pytest.mark.parametrize("year", YEARS)
def test_extras_present_when_expected(year):
    for portion, t in chosen_of(year).items():
        expect = year >= 2023 or (year == 2018 and portion == "fall_archery")
        has = {"public_land", "crossbow"} <= set(t.printed_total)
        if expect:
            assert has, (year, portion)
        else:
            assert "public_land" not in t.printed_total, (year, portion)


# 5 ----------------------------------------------------------------------------------------------
def test_spot_values():
    s25 = chosen_of(2025)["spring"]
    assert s25.printed_total["total"] == 46569
    assert s25.printed_total["public_land"] == 5543
    adair = next(r for r in s25.rows if r.county_name.lower() == "adair")
    assert adair.total == 537
    assert adair.extras["public_land"] == 41

    assert chosen_of(2015)["spring"].printed_total["total"] == 43991
    assert chosen_of(2015)["spring_youth"].printed_total["total"] == 4441

    adair21 = next(r for r in chosen_of(2021)["spring"].rows if r.county_name.lower() == "adair")
    assert adair21.counts == {"adult_gobbler": 312, "bearded_hen": 5, "juvenile_gobbler": 70}

    benton = next(r for r in chosen_of(2021)["spring_youth"].rows if r.county_fips == "29015")
    assert benton.counts["bearded_hen"] == 0

    assert chosen_of(2020)["fall_firearms"].printed_total["total"] == 2125
    assert chosen_of(2024)["fall_archery"].printed_total["crossbow"] == 688


# 6 ----------------------------------------------------------------------------------------------
@pytest.mark.parametrize("year", YEARS)
def test_top_n_tables_skipped(year):
    page = page_of(year)
    if year == 2018:  # the 2018 page prints only the four full tables (no Top-N tables in its HTML)
        assert page.skipped == []
    else:
        assert page.skipped
    assert all("Top" in s or "Statewide High" in s for s in page.skipped)
    assert all(len(t.rows) >= 100 for t in chosen_of(year).values())
    assert all(len(t.rows) >= 100 for t in page.tables)


# 7 ----------------------------------------------------------------------------------------------
@pytest.mark.parametrize("heading,portion,sub", [
    ("2019 Youth Spring Turkey", "spring_youth", False),
    ("Spring Opening Day", "spring_opening_day", True),
    ("First Week", "spring_first_week", True),
    ("Spring Total", "spring", False),
    ("2017 Fall Turkey Firearm Report", "fall_firearms", False),
    ("Season Harvest Totals Archery Turkey", "fall_archery", False),
])
def test_classify(heading, portion, sub):
    p, season, is_sub, method, youth = classify(heading)
    assert p == portion
    assert is_sub is sub
    assert season == portion.split("_")[0]
    assert method == METHOD[portion]
    assert youth is (portion == "spring_youth")


def test_classify_unknown():
    with pytest.raises(ParseError):
        classify("Something Entirely Different")


# 8 ----------------------------------------------------------------------------------------------
@pytest.mark.parametrize("label,expected", [
    ("Total", True), ("Totals", True), ("Grand Totals:", True), ("grand total", True), ("Adair", False),
])
def test_is_total_label(label, expected):
    assert is_total_label(label) is expected


# 9 ----------------------------------------------------------------------------------------------
@pytest.mark.parametrize("year", YEARS)
def test_attribute_rows(year):
    page, chosen = page_of(year), chosen_of(year)
    _, attrs = page_to_rows("turkey", page, chosen)
    with_extras = [t for t in chosen.values() if "public_land" in t.printed_total]
    assert len(attrs) == sum(len(t.rows) for t in with_extras)
    if year < 2018:
        assert attrs == []
    keys = {"state", "species", "season_year", "portion", "county_fips", "public_land", "crossbow"}
    assert all(set(a) == keys for a in attrs)
    assert {a["portion"] for a in attrs} <= {t.portion for t in with_extras}
    assert all(a["species"] == "turkey" and a["season_year"] == year for a in attrs)


# 10 ---------------------------------------------------------------------------------------------
def test_fips_subset_of_counties_json():
    valid = {r["fips"] for r in json.loads(counties._DATA.read_text(encoding="utf-8"))}
    assert len(valid) == 115
    for y in YEARS:
        rows, _ = page_to_rows("turkey", page_of(y), chosen_of(y))
        assert {r["county_fips"] for r in rows} <= valid
        for t in page_of(y).tables:
            fips = [r.county_fips for r in t.rows]
            assert len(set(fips)) == len(fips), (y, t.title)
