# STATUS

## Phase: 1 (deer scraper) — built, awaiting review

### Done
- `scraper/mohunt/`: polite fetcher with raw cache (`data/raw/deer/*.html`), deer page parser, county→FIPS
  normalizer (Census 2020 codes, `data/raw/census/st29_mo_cou2020.txt`), validator, build CLI.
- `data/harvest.parquet` + `data/harvest.json` (compact columnar JSON, ~170 KB gzipped): 11 seasons, 32,715 rows,
  115 county codes (114 counties + St. Louis City, which appears once in 2015 archery).
- Validation: every emitted table's county rows sum to MDC's printed Total for all four columns; recap tables
  must agree with primaries; non-subtotal portions sum to the Grand Totals table (2022+).

### MDC page defects handled (see `validate.ERRATA`, every one pinned so a fix on MDC's side fails the build)
- **2019 Antlerless Firearms**: county names misaligned against values; rows sum to 10,995 vs printed 10,597.
  Rebuilt per county as All Firearms − (early youth + November + late youth + alternative methods). Result matches
  MDC's printed totals and Top 5 exactly. Rows flagged `derived=true`.
- **2023, 2024 All Firearms**: Platte row total is a stale "760" (classes sum to 798 / 684). The by-county
  "Firearms" recap is correct and is used instead.
- **2025 Managed Hunts recap**: four county rows misaligned; the 34-county primary table is used.
- **2015 Season Summary** disagrees with its own tables (November 186,542 vs 189,936; Alt Methods 11,078 vs 10,808).
  Tables win; the summary box is an advisory warning only.
- 2016-17 has no Managed Hunts county table (statewide figure only), so that season has no `managed_hunts` rows.
- 2015-16 "Antlerless Firearms" (Nov 25–Dec 6) is slugged `late_antlerless` so trends line up with today's
  Late Antlerless portion; MDC's original title is kept in `portion_label`.

### Layout variants the parser handles
| Seasons | Title location | Total row | Numbers |
| --- | --- | --- | --- |
| 2015–2018, 2021–2022 | `<caption>` | first | no commas |
| 2019–2020 | generic captions; `<h2>Title …</h2>` above | first | no commas |
| 2023–2025 | preceding `<h3>`/`<h2>` | last | commas |

### Next
- Phase 2: turkey scraper, county dimension (FIPS, sq mi, MDC region), county GeoJSON, CWD pull from ArcGIS.

### Model escalations
- None. Main session is Fable (the session the user started); it did the scraper build directly instead of spawning an
  Opus builder, since the parser needed iterative inspection of 11 page layouts. Haiku built the first FIPS table but got
  codes wrong (McDonald, St. Louis, missing Douglas); replaced by a deterministic build from the Census code file.
  Sonnet wrote the pytest suite.
