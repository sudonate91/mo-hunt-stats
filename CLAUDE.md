MO Hunt Stats (repo: mo-hunt-stats) — CLAUDE.md

Serverless Missouri hunting harvest visualizer. Full spec: docs/SPEC.md. Read it before starting work and follow it; ask before deviating.

Model assignment for subagents

Subagents do NOT inherit the parent model. Every spawn names its model explicitly by role:

Fable — only for decisions that poison downstream work if wrong: the fact-table schema, data-model changes, cross-cutting architecture. Not used for routine building.
Opus — main session / orchestrator for this repo, scraper and pipeline code, UI components, charts, map, debugging, performance fixes. Anything with objective pass/fail.
Sonnet — all reviewers and critics, test authoring for parsers, data-validation review, README / data dictionary, Lighthouse and bundle-size report triage.
Haiku — mechanical bulk work: county name / FIPS lookup tables, renames, formatting, log triage, routine file moves.

Default to the cheapest model that can do the job. Escalating to a more expensive model requires a one-line reason recorded in STATUS.md. When in doubt, do not escalate. No more than 3 subagents running at once.

Project rules
Work phase by phase as listed in the spec; stop for review at the end of each phase.
Never scrape extra.mdc.mo.gov (robots.txt disallows it). Cache raw HTML in data/raw/, send a user-agent with a contact URL, sleep between requests.
Scraper output must validate: county rows sum to MDC's printed totals for every table, or the build fails.
Performance budgets are hard limits: initial JS ≤ 150 KB gzipped, interactive < 2.5 s on 4G, filter re-render < 100 ms, Lighthouse mobile ≥ 90. CI fails on bundle-size regressions.
Responsive: design at 360 px first; phone < 640 px one column + bottom tabs; desktop > 1024 px filter sidebar, map center, chart rail. Map and at least one chart on screen at every size, with linked selection.
No DuckDB-WASM, no MapLibre, no heavy component libraries. Preact + plain TypeScript + uPlot + SVG.
Every chart and map shows units and a "Source: MDC" credit.
Keep STATUS.md current: phase, what's done, what's next, any model escalations and why.