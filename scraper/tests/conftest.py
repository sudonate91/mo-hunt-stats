"""Shared fixtures. Uses only the cached HTML in data/raw/deer/; never touches the network."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from mohunt import fetch as _fetch  # noqa: E402
from mohunt.build import load_deer_page  # noqa: E402
from mohunt.validate import check_page  # noqa: E402

SEASONS = list(range(2015, 2026))


def _no_network(*a, **k):  # pragma: no cover
    raise AssertionError("network access attempted in tests")


# Block the network at import time too (pages are parsed during test collection).
_fetch.requests.get = _no_network

_cache: dict[int, object] = {}


def get_page(year: int):
    if year not in _cache:
        cache = _fetch.RAW_DIR / "deer" / f"{year}-{year + 1}.html"
        assert cache.exists(), f"missing cached HTML {cache}"
        _cache[year] = load_deer_page(year)
    return _cache[year]


@pytest.fixture(scope="session")
def pages():
    return {y: get_page(y) for y in SEASONS}


@pytest.fixture(scope="session")
def checked(pages):
    return {y: check_page(p) for y, p in pages.items()}
