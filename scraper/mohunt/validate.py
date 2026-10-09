"""Validation and table selection.

Rules (errors fail the build; warnings are printed):
  1. Every parsed county table must satisfy: county rows sum to MDC's printed Total row for
     all four columns, and each row's classes sum to its row total.
  2. When a page has two tables for one portion (a primary table and a by-county recap), the
     first table that passes rule 1 is used. A losing table is a warning naming the MDC typo.
     If both pass but disagree, that is an error unless an ERRATA entry pins the disagreement.
  3. Non-subtotal portions must sum to the Grand Totals table when one exists.
  4. ERRATA documents known MDC page defects and exactly how they are handled. Each entry pins
     what the defect looks like; if MDC fixes the page, the stale entry fails the build loudly.
"""
from __future__ import annotations

from dataclasses import dataclass, replace

from .deer import CLASS_COLUMNS, CountyRow, DeerPage, HarvestTable, ParseError, classify


@dataclass(frozen=True)
class Erratum:
    kind: str  # "recap_misaligned" | "derive_from_all_firearms"
    note: str
    counties: frozenset[str] = frozenset()  # recap_misaligned: FIPS whose values differ


ERRATA: dict[tuple[int, str], Erratum] = {
    (2019, "late_antlerless"): Erratum(
        "derive_from_all_firearms",
        "MDC's 2019 'Antlerless Firearms / All Counties' table lists values against the wrong county "
        "names (e.g. Callaway's 397 appears on the Caldwell row) and its rows sum to 10,995 vs the printed "
        "10,597. Rebuilt per county as All Firearms minus early youth, November, late youth and "
        "alternative methods; the result matches MDC's printed totals and Top 5 exactly.",
    ),
    (2025, "managed_hunts"): Erratum(
        "recap_misaligned",
        "The 114-row Managed Hunts recap puts Callaway/Camden/Cape Girardeau values on the Caldwell/Callaway/"
        "Camden rows. The 34-county primary table is used.",
        frozenset({"29025", "29027", "29029", "29031"}),
    ),
}

FIREARM_PARTS_FOR_DERIVATION = ("early_youth", "november", "late_youth", "alternative_methods")


def column_sums(t: HarvestTable) -> dict[str, int]:
    sums = {c: sum(r.counts[c] for r in t.rows) for c in CLASS_COLUMNS}
    sums["total"] = sum(r.total for r in t.rows)
    return sums


def check_table(t: HarvestTable, season_year: int) -> list[str]:
    errs = []
    sums = column_sums(t)
    for col, printed in t.printed_total.items():
        if sums[col] != printed:
            errs.append(f"{season_year} {t.title!r} [{col}]: county rows sum to {sums[col]}, MDC prints {printed}")
    for r in t.rows:
        if sum(r.counts.values()) != r.total:
            errs.append(f"{season_year} {t.title!r} {r.county_name}: classes sum to {sum(r.counts.values())}, row total {r.total}")
    seen: dict[str, str] = {}
    for r in t.rows:
        if r.county_fips in seen:
            errs.append(f"{season_year} {t.title!r}: duplicate county {r.county_name!r} (also {seen[r.county_fips]!r})")
        seen[r.county_fips] = r.county_name
    return errs


def _nonzero(t: HarvestTable) -> dict[str, tuple[int, ...]]:
    return {r.county_fips: (*r.counts.values(), r.total) for r in t.rows if r.total or any(r.counts.values())}


def derive_from_all_firearms(chosen: dict[str, HarvestTable], season_year: int, bad: HarvestTable) -> HarvestTable:
    af = chosen["all_firearms"]
    acc = {r.county_fips: (r.county_name, dict(r.counts), r.total) for r in af.rows}
    for part in FIREARM_PARTS_FOR_DERIVATION:
        for r in chosen[part].rows:
            name, counts, total = acc[r.county_fips]
            for k, v in r.counts.items():
                counts[k] -= v
            acc[r.county_fips] = (name, counts, total - r.total)
    rows = [CountyRow(n, f, c, tot) for f, (n, c, tot) in acc.items() if tot or any(c.values())]
    if any(min(r.counts.values()) < 0 or r.total < 0 for r in rows):
        raise ParseError(f"{season_year}: derivation of late_antlerless produced negative counts")
    return replace(bad, rows=rows, derived=True, title=f"{bad.title} (derived: All Firearms minus other firearm portions)")


def select_tables(page: DeerPage) -> tuple[dict[str, HarvestTable], list[str], list[str]]:
    """Pick one validated table per portion. Returns (chosen, errors, warnings)."""
    errors: list[str] = []
    warnings: list[str] = []
    y = page.season_year
    by_portion: dict[str, list[HarvestTable]] = {}
    for t in page.tables:
        by_portion.setdefault(t.portion, []).append(t)

    chosen: dict[str, HarvestTable] = {}
    deferred: list[tuple[str, HarvestTable]] = []
    for portion, cands in by_portion.items():
        results = [(t, check_table(t, y)) for t in cands]
        valid = [t for t, e in results if not e]
        erratum = ERRATA.get((y, portion))
        if erratum and erratum.kind == "derive_from_all_firearms":
            if valid:
                errors.append(f"{y} {portion}: ERRATA says the table is broken but it now validates; remove the entry")
            deferred.append((portion, cands[0]))
            continue
        if not valid:
            for t, e in results:
                errors.extend(e)
            continue
        chosen[portion] = valid[0]
        for t, e in results:
            if e:
                warnings.append(f"{y}: {t.title!r} has an MDC typo, using {valid[0].title!r} instead: {e[0]}")
        for t in valid[1:]:
            a, b = _nonzero(valid[0]), _nonzero(t)
            if a == b:
                continue
            diff = frozenset(k for k in set(a) | set(b) if a.get(k) != b.get(k))
            if erratum and erratum.kind == "recap_misaligned":
                if diff == erratum.counties and valid[0].printed_total == t.printed_total:
                    warnings.append(f"{y} {portion}: known recap misalignment ({len(diff)} counties); {erratum.note}")
                else:
                    errors.append(f"{y} {portion}: ERRATA pins differing counties {sorted(erratum.counties)} but found {sorted(diff)}")
            else:
                errors.append(f"{y}: {t.title!r} disagrees with {valid[0].title!r} on counties {sorted(diff)}")
    for portion, bad in deferred:
        need = ("all_firearms", *FIREARM_PARTS_FOR_DERIVATION)
        if not all(k in chosen for k in need):
            errors.append(f"{y} {portion}: cannot derive, missing {[k for k in need if k not in chosen]}")
            continue
        t = derive_from_all_firearms(chosen, y, bad)
        if column_sums(t) != bad.printed_total:
            errors.append(f"{y} {portion}: derived sums {column_sums(t)} != printed {bad.printed_total}")
            continue
        chosen[portion] = t
        warnings.append(f"{y} {portion}: {ERRATA[(y, portion)].note}")
    return chosen, errors, warnings


def _summary_slug(label: str) -> str:
    try:
        return classify(label)[0]
    except ParseError:
        return ""


def check_page(page: DeerPage) -> tuple[dict[str, HarvestTable], list[str], list[str]]:
    """Return (chosen tables by portion, errors, warnings). Errors fail the build."""
    chosen, errors, warnings = select_tables(page)

    gt = chosen.get("grand_total")
    if gt is not None:
        s = sum(t.printed_total["total"] for t in chosen.values() if not t.is_subtotal)
        if s != gt.printed_total["total"]:
            errors.append(f"{page.season_year}: portions sum to {s}, Grand Totals table prints {gt.printed_total['total']}")

    # Season Summary cross-check is advisory: MDC's summary box sometimes differs from the tables.
    for row in page.summary:
        t = chosen.get(_summary_slug(row.label))
        if t is not None and t.printed_total["total"] != row.counts["total"]:
            warnings.append(
                f"{page.season_year}: Season Summary {row.label!r}={row.counts['total']} "
                f"but table {t.title!r} prints {t.printed_total['total']}"
            )
    return chosen, errors, warnings
