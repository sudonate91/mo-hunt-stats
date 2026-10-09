"""MDC deer population status report parser tests. Cached PDFs only (data/raw/mdc/); conftest blocks the network."""
from __future__ import annotations

from functools import lru_cache

import pytest

import conftest  # noqa: F401  (blocks the network, sets sys.path)
from mohunt import counties, effort

YEARS = effort.YEARS


@lru_cache(maxsize=None)
def tables(year):
    return effort.parse_regional_tables(year)


@lru_cache(maxsize=None)
def rows(year):
    return {r["county_fips"]: r for r in effort.county_effort_rows(year)}


@lru_cache(maxsize=1)
def permits():
    return effort.statewide_permits()[0]


def test_pdfs_cached():
    for y in YEARS:
        assert effort.pdf_path(y).exists(), f"missing cached report {effort.pdf_path(y)}"


@pytest.mark.parametrize("year", YEARS)
def test_regional_totals_reconcile(year):
    ts = tables(year)
    effort.validate_tables(year, ts)  # raises on any mismatch
    assert len({t["region"] for t in ts}) == 8
    for t in ts:
        printed = dict(zip(t["columns"], t["totals"]))["harvest"]
        assert printed[0] == "t"
        assert sum(r["harvest"] for r in t["rows"].values()) == printed[1]


@pytest.mark.parametrize("year", YEARS)
def test_114_counties_no_city(year):
    r = rows(year)
    assert len(r) == 114
    assert "29510" not in r


def test_column_sets_by_year():
    def cols(y):
        return {f for f in effort.EFFORT_FIELDS if any(r[f] is not None for r in rows(y).values())}

    base = {"harvest"}
    assert cols(2018) == cols(2019) == base | {"harvest_per_sqmi", "trips_per_kill_firearms", "public_land_acres",
                                             "public_areas"}
    assert cols(2020) == base | {"firearms_hunters_per_sqmi", "archery_hunters_per_sqmi",
                                 "trips_per_kill_firearms", "trips_per_kill_archery"}
    assert cols(2021) == cols(2022) == base | {"harvest_per_sqmi", "firearms_hunters_per_sqmi",
                                               "archery_hunters_per_sqmi", "trips_per_kill_firearms",
                                               "trips_per_kill_archery"}
    assert cols(2023) == cols(2024) == base | {"harvest_per_sqmi", "firearms_hunters_per_sqmi",
                                               "archery_hunters_per_sqmi"}


def test_perry_2024():
    r = rows(2024)[counties.to_fips("Perry")]
    assert (r["harvest"], r["harvest_per_sqmi"], r["firearms_hunters_per_sqmi"], r["archery_hunters_per_sqmi"]) == (
        2791, 6.2, 8.9, 1.9)
    assert r["trips_per_kill_firearms"] is None


def test_franklin_2021():
    r = rows(2021)[counties.to_fips("Franklin")]
    assert r["firearms_hunters_per_sqmi"] == 12.7


def test_multiword_counties_parsed():
    for name in ["Cape Girardeau", "New Madrid", "St. Charles", "Ste. Genevieve", "St. Francois", "St. Louis",
                 "St. Clair", "DeKalb", "McDonald"]:
        fips = counties.to_fips(name)
        for y in YEARS:
            assert fips in rows(y), (name, y)


def test_cell_errata_nulled():
    r = rows(2018)
    assert r[counties.to_fips("Johnson")]["harvest_per_sqmi"] is None
    assert r[counties.to_fips("Polk")]["harvest_per_sqmi"] is None


@pytest.mark.parametrize("year", YEARS)
def test_harvest_matches_parquet(year):
    stats = effort.crosscheck_harvest(list(rows(year).values()))[year]
    assert stats["missing"] == 0
    assert stats["over5"] <= 0.10 * stats["n"]
    if year >= 2021:
        assert not stats["over1"]


def test_permits_2023_2024():
    p = {(r["year"], r["permit_type"]): r for r in permits()}
    for y in (2023, 2024):
        for slug in ["archery_any_deer", "landowner_archery_any_deer", "youth_archery_any_deer", "archery_antlerless",
                     "firearms_any_deer", "firearms_antlerless", "resident_firearms", "non_resident_firearms"]:
            assert (y, slug) in p, (y, slug)
    r = p[(2024, "firearms_any_deer")]
    assert (r["permits_issued"], r["deer_harvested"]) == (316336, 78714)
    assert r["permit_label"] == "Firearms Any-Deer"


def test_permits_dedup_prefers_later_report():
    keys = [(r["year"], r["permit_type"]) for r in permits()]
    assert len(keys) == len(set(keys))
    assert {r["year"] for r in permits()} == set(range(YEARS[0] - 1, YEARS[-1] + 1))
    p = {(r["year"], r["permit_type"]): r for r in permits()}
    assert p[(2023, "firearms_any_deer")]["source_report"] == 2024
    # 2018-2019 "Permittee Archery Any-Deer" shares a slug with the later "Archery Any-Deer"
    assert p[(2018, "archery_any_deer")]["permits_issued"] == 117142


def test_permit_slug():
    assert effort.permit_slug("Permittee Firearms Any-Deer") == "firearms_any_deer"
    assert effort.permit_slug("Nonresident Archery") == "non_resident_archery"
    assert effort.permit_slug("Non-Resident Firearms") == "non_resident_firearms"


@pytest.mark.parametrize("year", YEARS)
def test_hunters(year):
    hs = {r["method"]: r for r in effort.parse_hunters(year)}
    assert set(hs) == {"archery", "firearms", "combined"}
    for m, r in hs.items():
        s = r["hunters_0_deer"] + r["hunters_1_deer"] + r["hunters_2_deer"] + r["hunters_3plus_deer"]
        assert (s == r["hunters_total"]) == ((year, m) not in effort.KNOWN_HUNTER_MISMATCHES)
    assert hs["combined"]["hunters_total"] >= hs["firearms"]["hunters_total"] >= hs["archery"]["hunters_total"]
    if year == 2024:
        assert hs["firearms"]["hunters_total"] == 447284


def test_header_detection():
    assert effort.columns_from_header(
        "County Total Harvest Harvest per Square Mile Firearms Hunters per Square Mile Archery Hunters per Square Mile"
    ) == ["harvest", "harvest_per_sqmi", "firearms_hunters_per_sqmi", "archery_hunters_per_sqmi"]
    assert effort.columns_from_header(
        "County Total Harvest Deer Harvested Per Square Mile Trips per Kill (Firearms) Public Land Hunting Acres "
        "Number Public Hunting Areas"
    ) == ["harvest", "harvest_per_sqmi", "trips_per_kill_firearms", "public_land_acres", "public_areas"]
