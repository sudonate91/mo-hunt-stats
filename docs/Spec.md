# Missouri Hunting Data Visualizer — Spec

Oct 9, 2026 · @Nate

## Overview

A free, serverless data visualizer for Missouri hunting harvest data that lets anyone slice 11+ years of MDC numbers by species, season, weapon, county, sex and year. It is version 1 of the bigger gamified idea: get the data pipeline and the fun views right first, add leaderboards and games later.

**Goals**

- Every county-level harvest number MDC publishes, normalized into one dataset
- Fast, good-looking slice-and-dice on a phone and a desktop
- Shareable views: every filter combo lives in the URL
- Zero running cost: static JSON + static site, rebuilt by GitHub Actions

**Non-goals for v1**

- User accounts, social features, leaderboards, predictions
- Scraping the robots-blocked live widget at extra.mdc.mo.gov
- Other states (keep the schema state-agnostic so they drop in later)

**Constraints**

- No paid server. Hosting = GitHub Pages; compute = GitHub Actions cron
- Web first as a PWA, so it installs on Android with no Play Store work; a Capacitor wrapper is optional later
- Respect MDC: low-frequency fetches, cache everything, credit MDC on every view

## Data sources

Four public sources cover everything v1 needs; deer and turkey summary pages are the core, with 11 seasons (2015 to 2025) each, county by county.

| Source | What it has | Format | Years | Freshness |
| --- | --- | --- | --- | --- |
| [Deer Harvest Summaries](https://mdc.mo.gov/hunting-trapping/species/deer/deer-harvest-reports/deer-harvest-summaries) | 114 counties × every portion: early antlerless, early youth, November, opening weekend, CWD, late youth, late antlerless, alternative methods, archery, managed hunts, all-firearms. Columns: antlered buck, button buck, doe, total | HTML tables, one page per season | 2015-16 to 2025-26 | Final, posted after season |
| [Turkey Harvest Summaries](https://mdc.mo.gov/hunting-trapping/species/turkey/turkey-reports/turkey-harvest-summaries) | Spring youth, spring regular, fall firearms, fall archery. Spring: adult gobbler, bearded hen, juvenile gobbler. Fall: adult/juvenile gobbler and hen. Plus **public land** and **crossbow** counts per county | HTML tables, one page per year | 2015 to 2025 | Final, posted after season |
| [MDC ArcGIS REST](https://gisblue.mdc.mo.gov/arcgis/rest/services/Terrestrial?f=pjson): CWD\_Fall\_Reporting\_Dashboard | CWD samples and positives by county, township and section; per-sample harvest date, sex, age; current and previous years; county polygons with FIPS | JSON / GeoJSON query API | Multi-year | Updates during season |
| MDC news releases (bear, elk) | Statewide counts only, e.g. 9 bears in 2025 (7 male, 2 female) and 3 bull elk in 2025 ([source](https://mdc.mo.gov/newsroom/apply-mdc-elk-bear-hunting-permits-may-0)) | Prose | Since bear season began | Once a year, hand-entered |

**Reference data to add (no MDC dependency):** county land area in sq mi and FIPS (US Census), MDC region per county, county boundary GeoJSON (Census TIGER or the ArcGIS county layer).

**Not used in v1:** the live harvest widget at extra.mdc.mo.gov. Its robots.txt blocks bots; revisit only with MDC's permission.

**Scraper gotchas seen on the pages:** some numbers lack thousands separators (1231 vs 1,231); county spellings vary (Mcdonald, Dekalb, Saint/Sainte); the 2025-26 late antlerless header says 2024; turkey top-5 tables repeat rows from the all-counties table and must be skipped; tie rows appear in top-5 lists.

## Data model

One long, tidy table of harvest facts: one row per state × species × year × portion × county × animal class, with a count. Every view is a filter plus a group-by over this table.

**`harvest` fact table**

| Field | Example | Notes |
| --- | --- | --- |
| state | MO | Future-proofs other states |
| species | deer, turkey, bear, elk |  |
| season\_year | 2025 | Deer season 2025-26 = 2025 |
| season | fall, spring | Turkey splits; deer is always fall |
| portion | november, archery, early\_youth, cwd, opening\_weekend | Slug from MDC's table title |
| method | firearm, archery, mixed | Derived from portion |
| youth | true / false | Derived from portion |
| is\_subtotal | true for opening\_weekend, all\_firearms, grand totals | Excluded from sums to avoid double counting |
| county\_fips | 29157 | Perry County; join key for maps |
| class | antlered\_buck, button\_buck, doe, adult\_gobbler, bearded\_hen, juvenile\_hen | Species-specific vocabulary |
| count | 1879 |  |
| source\_url | MDC page | Every row traceable |

**Turkey extras:** public\_land and crossbow counts per county-portion, stored as a separate `turkey_attributes` table (they overlap the class counts, so they are not extra classes).

**`county` dimension:** fips, name, mdc\_region, land\_area\_sq\_mi, bear\_management\_zone, cwd\_zone flag.

**`cwd` table:** county\_fips, year, samples, positives, plus age and sex splits from ArcGIS.

**Validation:** the scraper checks that county rows sum to MDC's printed total for every table and fails the build if one doesn't.

## Pipeline

A scheduled GitHub Action rebuilds the dataset and site; nothing runs between builds, so hosting stays free.

&#91;embedded content: data pipeline · 3 sources, 3 build steps\]

If any table's county rows don't sum to MDC's printed total, the build fails and the live site keeps the last good data.

## Views & slice-n-dice

One global filter bar drives every view: species, years (range slider), season, portion, method (firearm / archery / crossbow), youth, class (bucks, does, gobblers, hens), region and county. Every filter state serializes to the URL.

**Core views**

1. **Map**: county choropleth for any metric, with a year scrubber that animates harvest across 11 seasons. Tap a county to open its card.
2. **County card**: a county's own dashboard. Rank statewide and in its region, 11-year trend, portion mix, buck:doe ratio, turkey public-land share, CWD samples, and neighbors compared.
3. **Leaderboard table**: sortable ranks for any metric, with rank change vs last year (↑3, ↓5).
4. **Trends**: line chart of any slice over years. Overlay up to 5 counties or compare species.
5. **Season breakdown**: how a season's harvest splits across portions (stacked bars or a treemap).
6. **Head-to-head**: pick two counties or two regions and get side-by-side stats. Good for local bragging rights.
7. **Calendar**: when harvest happens, built from portion date ranges, plus opening-weekend share of the season.

**Derived metrics (the fun part)**

- Deer per square mile of county
- Buck:doe ratio and button-buck share
- Archery share and crossbow share of turkey archery
- Turkey public-land share, by county
- Youth share: early youth + late youth as a share of firearms
- Opening weekend as a % of the November portion
- Change vs last year and vs the 5-year average
- Spring vs fall turkey ratio
- Hotspot index: z-score of a county's harvest per sq mi vs the state
- Streaks: years in a row a county finished top 10

**Fun extras**

- Auto-generated fact cards ("Franklin has led the November portion X years running")
- Record book: highest county-season ever, biggest jump, biggest drop
- Shareable PNG of any chart, with an MDC credit line
- Home county pinned to the top of every view (saved locally on the device)

## Tech stack & architecture

A static TypeScript web app over a few MB of prebuilt JSON; all filtering runs in the browser, so there is no backend.

| Layer | Choice | Why |
| --- | --- | --- |
| Scraper | Python 3.12 + requests + BeautifulSoup (or selectolax) | HTML tables parse easily; easy to run in Actions |
| Storage | Parquet + JSON files committed to the repo under `/data` | Versioned history, free, diffable |
| Query in browser | Plain TypeScript over prebuilt aggregates (Arquero only if needed) | Tens of thousands of rows filter in milliseconds with no multi-MB WASM download |
| Frontend | Vite + Preact + TypeScript | React API at about a tenth of the size |
| Charts | uPlot for lines; small hand-built SVG for bars | Tiny and very fast on low-end phones |
| Map | SVG map from county shapes pre-projected to path strings at build time | No map library or tiles to download |
| UI | Tailwind + a few hand-built components, dark "blaze orange on charcoal" theme | Unused CSS is purged; no component library weight |
| State | URL query params via a small store (Zustand) | Shareable views |
| Hosting | GitHub Pages | Free |
| Mobile | PWA (manifest + service worker, offline cache of data) | Installs on Android; Capacitor later if wanted |
| CI | GitHub Actions: scrape → validate → build → deploy | Free for public repos |

**Repo layout:** `scraper/` (Python), `data/` (outputs), `web/` (Vite app), `.github/workflows/`.

## Performance & mobile budget

The app must feel instant on a mid-range Android phone over rural 4G; these budgets are hard limits checked in CI.

| Metric | Budget |
| --- | --- |
| Initial JS, gzipped | 150 KB or less |
| Data, gzipped | 1.5 MB or less total, split per species; deer loads first |
| First load, mid-range Android on 4G | Interactive in under 2.5 s |
| Repeat load (cached PWA) | Under 1 s, works fully offline |
| Filter change to re-render | Under 100 ms |
| Lighthouse mobile performance | 90 or higher |

**How we hit it**

- Precompute aggregates at build time so the phone only filters and sums small arrays
- Split data files by species and load views lazily (route-level code splitting)
- Service worker precaches the app shell and data; refresh data in the background
- System font stack, no web fonts, no icon fonts (inline SVG icons)
- No layout shift: fixed chart heights, skeletons while loading

**Mobile-first layout**

- Designed at 360 px wide first, then scaled up to tablet and desktop
- Bottom tab bar for the main views; filters open in a bottom sheet within thumb reach
- Tap targets of 44 px or more; tap a county to select it (no hover-only info)
- Swipe between years on the map; pinch zoom only on the map
- Sticky county search with type-ahead; home county one tap away
- Respect reduced-motion and dark mode settings

**Responsive layouts (one codebase)**

The layout adapts to the screen with CSS breakpoints and container queries; the map and at least one chart are on screen at every size.

&#91;embedded content: responsive layouts · phone and desktop\]

| Screen width | Layout |
| --- | --- |
| Phone, under 640 px | One column: map on top, chart below, bottom tabs, filters in a bottom sheet |
| Tablet, 640 to 1024 px | Map and chart side by side in landscape; filters in a slide-over panel |
| Desktop, over 1024 px | Filter sidebar left, map center, chart rail and county card right; hover tooltips and keyboard shortcuts |

**Maps and graphs are the core of every view**

- Map and charts are linked: tap a county on the map and it highlights in every chart, and the reverse
- Map modes: choropleth for any metric, a year scrubber that animates 11 seasons, and small multiples (a mini map per year)
- Chart types: trend lines, stacked bars by portion, ranked bar leaderboards, scatter (harvest vs county area), and sparklines inside tables
- Charts redraw to their container size (ResizeObserver), so they fit any screen without separate phone and desktop versions
- Touch: tap for a value tooltip. Mouse: hover. Every chart has a "show as table" toggle for exact numbers
- Colorblind-safe color scales with a legend on every map

## Build order

Data first, then one great view, then breadth. Each step ends in something runnable.

1. **Scraper: deer.** Parse all 11 deer summary pages into the fact table. Save raw HTML snapshots to `data/raw/` and validate totals.
2. **Scraper: turkey + reference data.** Add turkey pages, public-land and crossbow columns, the county dimension (FIPS, area, region) and county GeoJSON.
3. **CWD pull.** Query the ArcGIS county aggregate tables and write `cwd.json`.
4. **App shell.** Vite app, filter bar, URL state, DuckDB-WASM loading the data.
5. **Map + county card.** The hero experience; polish it before moving on.
6. **Leaderboard, trends, season breakdown, head-to-head.**
7. **Derived metrics + record book + fact cards.**
8. **PWA + GitHub Actions** (weekly scrape during season, monthly otherwise) and deploy to Pages.
9. **Polish:** share-as-image, home county, dark theme, accessibility pass.

**Later (v2):** pick'em predictions, county draft leagues, Play Games leaderboards, other states.

## Claude Code setup: CLAUDE.md and model routing

Put a `CLAUDE.md` at the repo root that pins model assignment per role, because subagents otherwise inherit the parent model and burn the expensive tier on routine work.

| Role | Model | Work |
| --- | --- | --- |
| Architecture calls | Fable | Fact-table schema, data-model changes, cross-cutting design only |
| Orchestrator + builders | Opus | Main session, scraper, pipeline, UI, charts, map, debugging, perf fixes |
| Reviewers + tests + docs | Sonnet | Critics, parser tests, validation review, README, Lighthouse and bundle report triage |
| Mechanical bulk | Haiku | County/FIPS lookup tables, renames, formatting, log triage |

**Rules:** default to the cheapest model that can do the job; any escalation gets a one-line reason in `STATUS.md`; at most 3 subagents at once. The same file carries the project rules: phase-by-phase with review stops, no scraping extra.mdc.mo.gov, validation must pass, performance budgets, responsive layout, and the lightweight stack.

## Claude Code kickoff prompt

Export this doc as Markdown to `docs/SPEC.md` in a new repo, then paste the prompt below into Claude Code.

```markdown
You're building "MO Hunt Stats" (repo: mo-hunt-stats), a serverless data visualizer for Missouri hunting harvest data. The full spec is in docs/SPEC.md and project rules are in CLAUDE.md. Read both first and follow them; ask me before deviating. Assign every subagent's model explicitly per the CLAUDE.md table; never let subagents inherit your model.

Goal: every county-level harvest number MDC publishes, normalized into one tidy dataset, plus a fast, great-looking web app (PWA, Android-friendly) to slice and dice it by species, year, season, portion, weapon/method, youth, animal class, region and county. No backend, no paid hosting: GitHub Pages + GitHub Actions only.

Data sources (public, fetchable):
- Deer summaries, 2015-16 to 2025-26: https://mdc.mo.gov/hunting-trapping/species/deer/deer-harvest-reports/deer-harvest-summaries (follow each season link; county tables per portion; cols antlered buck / button buck / doe / total)
- Turkey summaries, 2015 to 2025: https://mdc.mo.gov/hunting-trapping/species/turkey/turkey-reports/turkey-harvest-summaries (spring youth, spring, fall firearms, fall archery; includes Public Land and Crossbow cols)
- MDC ArcGIS REST, CWD by county: https://gisblue.mdc.mo.gov/arcgis/rest/services/Terrestrial/CWD_Fall_Reporting_Dashboard/MapServer (use the County_Aggregate tables; query with f=json)
- US Census for county FIPS, land area and boundaries
Do NOT scrape extra.mdc.mo.gov/widgets/harvest_table (robots.txt disallows it). Be polite: cache raw HTML in data/raw/, use a user-agent with a contact URL, and sleep between requests.

Work in this order and stop for my review after each phase:
1. Python scraper for deer pages -> data/harvest.parquet + harvest.json using the fact-table schema in the spec. Skip "Top 5" tables, flag subtotal tables (opening weekend, all firearms, grand totals), normalize county names to FIPS (watch Mcdonald/Dekalb/Saint vs Sainte), and parse numbers with or without commas. Write tests that assert county rows sum to MDC's printed totals for every table.
2. Turkey scraper, county dimension (FIPS, sq mi, MDC region), county GeoJSON, CWD pull.
3. Vite + Preact + TS app in web/ with Tailwind; plain TypeScript over prebuilt aggregates (no DuckDB, no map library); global filter bar in a bottom sheet, synced to URL params.
4. Responsive shell (phone under 640px: one column + bottom tabs; tablet: side by side; desktop over 1024px: filter sidebar, map center, chart rail) with map and charts on screen at every size and linked selection between them. Hero views: county choropleth map with a year scrubber and small-multiples mode, plus a county card (ranks, 11-yr trend, portion mix, buck:doe, CWD).
5. Leaderboard (with rank change vs last year), trends overlay, season breakdown, head-to-head.
6. Derived metrics from the spec (per sq mi, ratios, shares, vs 5-yr avg, hotspot z-score, streaks), record book, auto fact cards.
7. PWA (offline data cache), share-chart-as-PNG with an MDC credit line, home county saved in localStorage, dark blaze-orange theme.
8. GitHub Actions: scrape -> validate -> build -> deploy to Pages; weekly Sep-Jan, monthly otherwise; fail loudly on validation errors.

Performance is a feature: hold the budgets in the spec's Performance & mobile budget section (initial JS 150 KB gz or less, interactive under 2.5 s on 4G, filter re-render under 100 ms, Lighthouse mobile 90+) and add a CI check that fails on bundle-size regressions. Standards: TypeScript strict, small components, mobile-first layout designed at 360px with bottom tabs and 44px tap targets, accessible color scales, every chart labeled with units and a "Source: MDC" credit. Keep a README with setup, data dictionary and how to add a new state.

Start with phase 1. Before writing code, show me your plan and the exact tables you found on one deer page.
```
