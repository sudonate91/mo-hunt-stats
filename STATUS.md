# STATUS

## Phase: 3–8 built and reviewed — complete, ready to push

### Phases 3–8 done (user said "keep going until done", so no per-phase stops after phase 1)
- `web/`: Vite + Preact + TS strict + Tailwind v4 + uPlot. Signals mirrored to URL params (`view, sp, y, yr, s, p, m, yo, c, r, co, metric, sel, cmp`).
- Data layer: compact JSON → dictionary-coded typed arrays; masks memoized; county map pre-projected (Albers) to SVG paths
  by `scripts/build-map.mjs` (no map library).
- Views: Map (choropleth, year scrubber + play, small multiples, linked trend chart, county card), County page, Ranks
  (rank change vs last year, sparklines, home county pinned), Trends (up to 5 county overlays, per-sq-mi, index, species compare),
  Seasons (portion stack, class split, opening-weekend / youth / spring:fall stats), Compare (county or region head-to-head),
  Records (record book, streaks, jumps/drops, auto fact cards), About.
- Derived metrics in `src/data/metrics.ts`: per sq mi, change YoY, vs 5-yr avg, hotspot z-score, buck:doe, button share,
  archery/youth/opening-weekend shares, turkey public-land and crossbow shares, streaks, records.
- PWA: app shell precached, `/data/*.json` stale-while-revalidate, update toast; share chart as PNG with MDC credit; home county
  in localStorage (default Perry 29157); dark blaze-orange theme.
- CI: `.github/workflows/pipeline.yml` scrape → validate → build → bundle budget (`scripts/check-bundle.mjs`, baseline in
  `web/bundle-baseline.json`) → Lighthouse mobile ≥ 90 → Pages deploy. Weekly Mon Sep–Jan, monthly otherwise.
- Budget: initial JS 18.8 KB gz (limit 150), CSS 6.3 KB, all lazy JS 120 KB, data ≈ 290 KB gz.

### Review fixes applied (Sonnet review → 11 confirmed bugs, all fixed)
- Attribute shares only over portions with attribute rows; competition ranking with zero/NaN unranked; turkey YoY and
  5-yr comparisons spring-only when the latest year has no fall data; URL params validated and clamped; season year
  clamped to the filter range; MAX_YEAR follows the data; SW serves precached index.html for every navigation;
  icon paths respect the Pages base; negative bars; species compare uses one reduced filter on both sides; share
  buttons on every chart and the map; roving tabindex on the map; Escape closes menus.

### Known gaps
- `county.json` `bear_management_zone` / `cwd_zone` are null (zones don't follow county lines; needs a decision).
- Phone layout stacks map then chart (chart below the fold at 360×740); both are on screen on tablet/desktop.
- Swipe/pinch and Android share sheet untested on a real device.
- CWD `year` = permit (fall) year, matched 1:1 to deer season year.

## Phase 2 (turkey, county dimension, GeoJSON, CWD) — done

### Phase 2 done
- `scraper/mohunt/turkey.py`: 12 pages (2015–2026; 2026 is spring only). Portions `spring_youth`, `spring`, `fall_firearms`,
  `fall_archery`, plus 2015-only subtotals `spring_opening_day`, `spring_first_week`. Public Land / Crossbow columns
  (2018 archery; all tables 2023+) → `data/turkey_attributes.*`.
- `scraper/mohunt/tables.py`: species-agnostic county-table parser shared by deer and turkey.
- `scraper/mohunt/county_dim.py` → `data/county.json` (fips, name, mdc_region, land_area_sq_mi, centroid) and
  `data/counties.geojson` (Census cb_2023 500k, Douglas-Peucker 0.002°, 4 dp, 93 KB). Region from MDC ArcGIS
  Boundaries/MDC_Administrative_Boundaries/MapServer/5 by Census interior point, checked against MDC's Num_Cnty per region.
  Note: MDC places Crawford and Washington in the St. Louis region. `bear_management_zone` / `cwd_zone` are null (TODO).
- `scraper/mohunt/cwd.py` → `data/cwd.json`: county × year 2016–2026 (2026 in progress) from
  CWD_Fall_Reporting_Dashboard layers 28/29 with sex/age splits; cross-checked against per-sample counts in layers 26/27.
- Output budget: all JSON ≈ 290 KB gzipped (deer 155, turkey 76, cwd 23, geojson 24).

### Turkey page defects handled (pinned in `validate.ERRATA` / `turkey.COLUMN_SWAPS`)
- **2021 Spring**: county rows print Bearded Hen and Juvenile Gobbler in the opposite order from the header and Total row. Swapped back.
- **2021 Youth Spring, Benton**: Bearded Hen cell prints 1 but row total and column total both imply 0. Set to 0.
- **2021 Fall Firearms / Archery**: the Adult Hen column is labelled "Bearded Hen"; read as `adult_hen`.
- **2020 Fall Firearms**: the Total row sits in the Top 5 table; taken from there.
- **2022 Spring**: stray `adult_hen` (2 birds) and age-unknown `gobbler` (1 bird) columns kept as classes.
- **2015**: Total rows labelled "Grand Totals:"; spring has opening-day and first-week subtotal tables.

### Bug fixed
- `counties.json` alias `st. louis (city)` normalized to `st louis` and overrode St. Louis County; found by the CWD builder.
  Removed; `counties._lookup` now raises on alias collisions.

## Phase 1 (deer scraper) — done

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
- Push to GitHub, enable Pages (source: GitHub Actions), watch the first pipeline run.

### Model escalations
- None. Main session is Fable (the session the user started); it did the scraper build directly instead of spawning an
  Opus builder, since the parser needed iterative inspection of 11 page layouts. Haiku built the first FIPS table but got
  codes wrong (McDonald, St. Louis, missing Douglas); replaced by a deterministic build from the Census code file.
  Sonnet wrote the pytest suites. Opus built county_dim.py, cwd.py and all web views (3 parallel builders). Sonnet reviewed the web app.
