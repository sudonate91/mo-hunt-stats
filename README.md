# MO Hunt Stats

Serverless visualizer for Missouri Department of Conservation (MDC) county-level hunting harvest data.
Static site on GitHub Pages, data rebuilt by GitHub Actions. Spec: [docs/SPEC.md](docs/SPEC.md). Progress: [STATUS.md](STATUS.md).

## Setup (scraper)

```bash
cd scraper
pip install -r requirements.txt
python -m mohunt.build            # deer + turkey: parse cached pages, validate, write data/harvest.*
python -m mohunt.county_dim       # data/county.json + data/counties.geojson (Census + MDC regions)
python -m mohunt.cwd              # data/cwd.json from MDC ArcGIS
python -m mohunt.overlays         # data/overlays.geojson: rivers, lakes, ecoregions, interstates, public land
python -m mohunt.effort           # data/effort.json from MDC's 2018-2024 deer population status report PDFs
python -m mohunt.build --refresh  # re-fetch MDC pages (2 s between requests, identifying user-agent)
python -m pytest -q
```

The build fails (exit 1, nothing written) if any table's county rows do not sum to MDC's printed total.
Raw HTML snapshots are committed under `data/raw/` so builds and tests are reproducible offline.

## Setup (web app)

```bash
cd web
npm ci
npm run dev        # http://localhost:5173 (copies data/*.json into public/data and projects the county map first)
npm run build      # typecheck + production build into web/dist
node scripts/check-bundle.mjs   # bundle budget: initial JS ≤ 150 KB gz, no >5% regression vs bundle-baseline.json
```

Stack: Vite, Preact, TypeScript (strict), Tailwind v4, uPlot for lines, hand-built SVG for bars and the county map
(pre-projected to path strings at build time by `scripts/build-map.mjs`, Albers conic). State lives in Preact signals and
mirrors to URL query params, so every view is shareable. PWA via vite-plugin-pwa (app shell precached, data JSON
stale-while-revalidate).

## CI / deployment

`.github/workflows/pipeline.yml`: scrape → validate (tests) → build → bundle budget + Lighthouse (mobile ≥ 90) → deploy to
GitHub Pages. Runs on push, weekly on Mondays during September–January, monthly otherwise. Scheduled runs re-fetch MDC
pages and commit refreshed `data/` back to `main`; a validation failure fails the run and the last good site stays live.
Enable Pages with source "GitHub Actions" in the repo settings.

## Data dictionary

### `data/harvest.parquet` — one row per state × species × season × portion × county × class

| Field | Type | Values / notes |
| --- | --- | --- |
| `state` | string | `MO` |
| `species` | string | `deer`, `turkey` |
| `season_year` | int16 | Season start year; deer 2025-26 → `2025` |
| `season` | string | `fall` for deer; `spring` / `fall` for turkey |
| `portion` | string | Deer: `early_antlerless`, `early_youth`, `november`, `opening_weekend`, `cwd`, `late_youth`, `late_antlerless`, `alternative_methods`, `all_firearms`, `archery`, `managed_hunts`, `urban` (2015 only), `grand_total`. Turkey: `spring_youth`, `spring`, `fall_firearms`, `fall_archery`, `spring_opening_day` and `spring_first_week` (2015 only) |
| `portion_label` | string | MDC's table title, including dates, verbatim |
| `method` | string | `firearm`, `archery`, `mixed` (managed hunts, grand total) |
| `youth` | bool | True for early/late youth portions |
| `is_subtotal` | bool | True for deer `opening_weekend` (⊂ november), `all_firearms`, `grand_total` and turkey `spring_opening_day`, `spring_first_week` (⊂ spring). Exclude when summing. |
| `derived` | bool | True when a table was rebuilt from other tables because MDC's page was defective (see STATUS.md) |
| `county_fips` | string | 5-digit Census FIPS, e.g. `29157` Perry. `29510` is St. Louis City. |
| `class` | string | Deer: `antlered_buck`, `button_buck`, `doe`. Turkey spring: `adult_gobbler`, `bearded_hen`, `juvenile_gobbler` (2022 also `adult_hen`, `gobbler`). Turkey fall: `adult_gobbler`, `adult_hen`, `juvenile_gobbler`, `juvenile_hen` |
| `count` | int32 | Animals checked |
| `source_url` | string | MDC page the row came from |

### `data/harvest_deer.json`, `data/harvest_turkey.json`

Same facts in compact form for the browser, split per species: `{"state","columns":[...],"rows":[[...]],"labels":{"species:year:portion":{"portion_label","source_url"}}}`.
`rows` are arrays ordered by `columns`.

### `data/turkey_attributes.parquet` / `.json`

Per county × season × portion: `public_land` and `crossbow` counts (subsets of the class counts, so not classes). Available for
2018 fall archery and every turkey table from 2023.

### `data/county.json`

`fips`, `name`, `mdc_region` (MDC's 8 regions, from MDC's ArcGIS region polygons), `land_area_sq_mi` (Census 2020 Gazetteer),
`centroid` [lon, lat], `bear_management_zone` and `cwd_zone` (null for now).

### `data/counties.geojson`

115 county polygons (Census cartographic boundary 2023, 1:500k, simplified), properties `fips`, `name`.

### `data/overlays.geojson`

Map overlays, one FeatureCollection, every feature `{layer, name}`; clipped to the Missouri bbox (lon −95.9…−88.9,
lat 35.9…40.7), coordinates to 3 decimals, simplified so the file stays ≤ 250 KB (the build drops a layer, last first,
rather than exceed it). Raw downloads are cached in `data/raw/overlays/` (git-ignored; the TIGER file is 38 MB).

| layer | geometry | source | license |
|---|---|---|---|
| `rivers` | (Multi)LineString, one per name | Natural Earth 10m `rivers_lake_centerlines` + `rivers_north_america` | public domain |
| `lakes` | (Multi)Polygon | Natural Earth 10m `lakes` + `lakes_north_america` | public domain |
| `ecoregions` | (Multi)Polygon, one per Level III name | US EPA Level III ecoregions of Missouri (`mo_eco_l3`, Albers → WGS84) | US government work, public domain |
| `interstates` | (Multi)LineString, one per route (`I-70`…) | Census TIGER/Line 2023 primary roads, `RTTYP = 'I'` | US government work, public domain |
| `public_land` | (Multi)Polygon | MDC conservation areas ≥ 1,000 acres (MDC ArcGIS `MDC_Administrative_Areas/5`); Mark Twain National Forest ownership blocks ≥ 1,000 acres (USFS EDW `BasicOwnership`) | MDC data per MDC's terms of use (attribution: MDC); USFS public domain |

Overlays are for eyeballing geography against harvest; they are generalized (~0.004–0.01°) and not for navigation.

### `data/cwd.json`

`{source, fetched, current_season, rows:[{county_fips, year, samples, positives, splits:{by_sex, by_age}}]}` from MDC's
CWD_Fall_Reporting_Dashboard county aggregates, 2016 to the current season. `year` is the fall season (permit) year.

### `data/effort.json`

County hunting effort and statewide permit / hunter statistics parsed from MDC's annual "Missouri Deer Season Summary &
Population Status Report" PDFs (2018–2024 seasons; cached in `data/raw/mdc/`). Wrapper:
`{source, reports:{year:url}, fetched, notes:[...], county_effort, statewide_permits, statewide_hunters}`. `notes` lists
every known source defect and caveat.

`county_effort` — one row per county × report year (114 counties; St. Louis City is not in the regional tables):

| Field | Type | Years | Notes |
| --- | --- | --- | --- |
| `county_fips` | string | all | 5-digit Census FIPS |
| `year` | int | all | Season start year |
| `harvest` | int | all | Report's total harvest (validated against `harvest.parquet`; prefer that for harvest) |
| `harvest_per_sqmi` | float | 2018–19, 2021–24 | MDC's printed value; MDC's area base is not Census land area (urban counties differ most) |
| `firearms_hunters_per_sqmi` | float | 2020–24 | Firearms hunters who hunted in the county per square mile |
| `archery_hunters_per_sqmi` | float | 2020–24 | Archery hunters who hunted in the county per square mile |
| `trips_per_kill_firearms` | float | 2018–22 | Hunting trips per deer harvested, firearms |
| `trips_per_kill_archery` | float | 2020–22 | Hunting trips per deer harvested, archery |
| `public_land_acres` | int | 2018–19 | Public land open to deer hunting (same inventory both years) |
| `public_areas` | int | 2018–19 | Number of public hunting areas |

Columns a year does not publish are `null`. Hunter density is the number of hunters who hunted that county, from MDC
permit and Telecheck records, for the whole season — people, not permits or tags; a hunter who hunted several counties
counts in each. County-level permit sales were last published by MDC for 2014, so permits below are statewide only.

`statewide_permits` — `{year, permit_type, permit_label, permits_issued, deer_harvested, source_report}` for 2017–2024.
Each report prints its year and the prior year; the later report wins. `permit_type` is a slug
(`archery_any_deer`, `landowner_archery_any_deer`, `youth_archery_any_deer`, `archery_antlerless`, `firearms_any_deer`,
`firearms_antlerless`, `resident_firearms`, `non_resident_firearms`, `resident_archery`, `non_resident_archery`, …);
`permit_label` is MDC's printed label (2018–19 reports prefix "Permittee").

`statewide_hunters` — `{year, method: archery|firearms|combined, hunters_total, hunters_0_deer, hunters_1_deer,
hunters_2_deer, hunters_3plus_deer}` from each report's hunter statistics table. `combined` counts each person once across
methods.

Validation (`python -m mohunt.effort` exits 1 on failure): county harvest sums to each region's printed total; each
per-square-mile column's county mean is within 0.15 of the printed regional average (known MDC exceptions are pinned in
`effort.KNOWN_AVG_MISMATCHES`); 8 regions and 114 counties per year; county harvest within 1% of `harvest.parquet` or a
WARN, and failure if more than 10% of a year's counties are over 5% off.

### County reference

`scraper/mohunt/counties.json`: `fips`, `name`, `aliases` (lowercase spellings MDC uses, e.g. `saint louis`, `mcdonald`, `dekalb`, `sainte genevieve`).
Built from the Census 2020 county code file; Ste. Genevieve is the one even-numbered Missouri county code (29186).

## How to add a new state

1. Add a `<state>/` module under `scraper/mohunt/` with a page parser that yields `HarvestTable`s (see `deer.py`) and
   a county table like `counties.json`.
2. Emit rows with the same fact-table columns; set `state` and reuse or extend the `portion`/`class` vocabularies.
3. Register the state's seasons in `build.py` and add fixtures under `data/raw/<state>/`.
4. The validator (`validate.py`) is state-agnostic: it only needs each table's county rows and printed totals.

## Credits

All harvest data: Missouri Department of Conservation. County codes and boundaries: US Census Bureau.
Map overlays: Natural Earth (rivers, lakes), US EPA (ecoregions), US Census TIGER/Line (interstates),
MDC and USDA Forest Service (public land).
