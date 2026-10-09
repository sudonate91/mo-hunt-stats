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
python -m mohunt.build --refresh  # re-fetch MDC pages (2 s between requests, identifying user-agent)
python -m pytest -q
```

The build fails (exit 1, nothing written) if any table's county rows do not sum to MDC's printed total.
Raw HTML snapshots are committed under `data/raw/` so builds and tests are reproducible offline.

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

### `data/cwd.json`

`{source, fetched, current_season, rows:[{county_fips, year, samples, positives, splits:{by_sex, by_age}}]}` from MDC's
CWD_Fall_Reporting_Dashboard county aggregates, 2016 to the current season. `year` is the fall season (permit) year.

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
