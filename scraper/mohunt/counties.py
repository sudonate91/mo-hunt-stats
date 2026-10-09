"""Missouri county name -> FIPS normalization."""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

_DATA = Path(__file__).with_name("counties.json")


class UnknownCountyError(ValueError):
    pass


def _norm(name: str) -> str:
    """Lowercase, drop punctuation except spaces, collapse whitespace, drop a trailing 'county'."""
    s = name.lower().replace("\xa0", " ")
    s = re.sub(r"\(.*?\)", " ", s)  # 'Saint Louis City (City)' -> 'saint louis city'
    s = re.sub(r"[^a-z ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r" county$", "", s)
    return s


@lru_cache(maxsize=1)
def _lookup() -> dict[str, str]:
    rows = json.loads(_DATA.read_text(encoding="utf-8"))
    table: dict[str, str] = {}
    for row in rows:
        for alias in [row["name"], *row["aliases"]]:
            key = _norm(alias)
            if table.get(key, row["fips"]) != row["fips"]:
                raise RuntimeError(f"county alias collision: {alias!r} maps to both {table[key]} and {row['fips']}")
            table[key] = row["fips"]
    # spellings seen on MDC pages that the base alias list may not carry
    extra = {
        "carrol": "29033",
        "cedar": "29039",
        "mcdonald": "29119",
        "dekalb": "29063",
        "saint louis city": "29510",
        "st louis city": "29510",
        "sainte genevieve": "29186",
        "saint genevieve": "29186",
    }
    for k, v in extra.items():
        table.setdefault(k, v)
    return table


@lru_cache(maxsize=1)
def names_by_fips() -> dict[str, str]:
    rows = json.loads(_DATA.read_text(encoding="utf-8"))
    return {r["fips"]: r["name"] for r in rows}


def to_fips(name: str) -> str:
    key = _norm(name)
    try:
        return _lookup()[key]
    except KeyError:
        raise UnknownCountyError(f"unknown Missouri county name: {name!r}") from None


def is_county(name: str) -> bool:
    return _norm(name) in _lookup()
