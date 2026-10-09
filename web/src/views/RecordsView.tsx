/** Record book for the current slice (species, portions, classes, method, region, season range). */
import { useMemo } from 'preact/hooks'
import { HBarChart } from '../components/charts/BarChart'
import { fmt, pct, seasonLabel } from '../components/charts/format'
import { FactCards } from '../components/FactCards'
import { countySeries, records, streak } from '../data/metrics'
import { CLASS_LABEL, PORTION_LABEL, mask, maskYear, sumByYear, total } from '../data/query'
import { counties, countyByFips, ds, regionOf } from '../state/data'
import { filter, homeCounty, selected, view } from '../state/filters'

interface Row { key: string; fips: string; name: string; season: string; main: string; sub: string; up?: boolean }

function openCounty(fips: string) {
  selected.value = fips
  view.value = 'county'
}

function RecordList({ title, rows, empty }: { title: string; rows: Row[]; empty: string }) {
  const sel = selected.value, home = homeCounty.value
  return (
    <section class="rounded-xl border border-line bg-bg-2 p-3">
      <h2 class="text-sm font-semibold text-fg-2 mb-1">{title}</h2>
      {rows.length === 0 ? <p class="text-sm text-fg-3">{empty}</p> : (
        <ol class="divide-y divide-line">
          {rows.map((r, i) => (
            <li key={r.key}>
              <button type="button" onClick={() => openCounty(r.fips)}
                class={`w-full min-h-[44px] flex items-center gap-2 text-left text-sm py-1 hover:bg-bg-3 rounded ${r.fips === sel ? 'text-sel' : r.fips === home ? 'text-blaze-2' : ''}`}>
                <span class="w-5 text-fg-3 tabular-nums text-xs">{i + 1}</span>
                <span class="flex-1 min-w-0 truncate">{r.name} <span class="text-fg-3">{r.season}</span></span>
                <span class="text-right">
                  <span class={`block font-semibold tabular-nums ${r.up === undefined ? '' : r.up ? 'text-blaze-2' : 'text-[#67a9cf]'}`}>{r.main}</span>
                  <span class="block text-[11px] text-fg-3 tabular-nums">{r.sub}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <p class="text-[11px] text-fg-3 mt-1 text-right">Source: MDC</p>
    </section>
  )
}

export default function RecordsView() {
  const d = ds.value, c = counties.value, f = filter.value, ro = regionOf.value
  const byFips = countyByFips.value
  const book = useMemo(() => {
    if (!d || !c) return null
    // Restrict to the filter's season range so the record book follows the year slider.
    const y0 = d.years.findIndex((y) => y >= f.yearFrom)
    const y1 = d.years.findLastIndex((y) => y <= f.yearTo)
    if (y0 < 0 || y1 < y0) return null
    const years = d.years.slice(y0, y1 + 1)
    const series = countySeries(d, f, ro).map((s) => s.slice(y0, y1 + 1))
    // Jumps/drops ignore tiny bases (1 → 6 is +500% but not a record anyone cares about).
    const positive = series.flatMap((s) => [...s].filter((v) => v > 0)).sort((a, b) => a - b)
    const minBase = Math.max(10, Math.round((positive[Math.floor(positive.length / 2)] ?? 0) * 0.1))
    // A turkey year with spring results only (fall not reported yet) would read as a huge drop; keep it out of jumps/drops.
    const allYears = { yearFrom: d.years[0], yearTo: d.years[d.years.length - 1] }
    const fallIn = (y: number) => total(d, maskYear(d, mask(d, { ...f, ...allYears, season: 'fall' }, ro), y))
    const partial = d.species === 'turkey' && !f.season && years.length > 1
      && fallIn(years[years.length - 1]) === 0 && fallIn(years[years.length - 2]) > 0 ? years[years.length - 1] : 0
    const filtered = series.map((s) => s.map((v, i) => (v >= minBase && !(partial && i === s.length - 1) ? v : 0)))
    const rec = records(filtered, years)
    const highest = records(series, years).highest
    const streaks = series.map((_, i) => ({ i, n: streak(series, i, 10) }))
      .filter((s) => s.n >= 2 && series[s.i][series[s.i].length - 1] > 0).sort((a, b) => b.n - a.n).slice(0, 10)
    const state = sumByYear(d, mask(d, { ...f, yearFrom: d.years[0], yearTo: d.years[d.years.length - 1] }, ro)).slice(y0, y1 + 1)
    let best = 0, worst = 0
    state.forEach((v, i) => { if (v > state[best]) best = i; if (v > 0 && !(partial && i === state.length - 1) && (state[worst] === 0 || v < state[worst])) worst = i })
    const valueAt = (r: { county: number; year: number }, back: number) => series[r.county][years.indexOf(r.year) - back]
    return { years, rec, highest, streaks, state, best, worst, minBase, valueAt, partial }
  }, [d, c, f, ro])

  if (!d || !book) return <div class="p-4 text-fg-3">No seasons in the selected range.</div>
  const sp = d.species
  const name = (i: number) => byFips.get(d.dict.county[i])?.name ?? d.dict.county[i]
  const fipsOf = (i: number) => d.dict.county[i]
  const season = (y: number) => seasonLabel(sp, y)
  const noun = f.classes.length === 1 ? CLASS_LABEL[f.classes[0]] ?? f.classes[0] : sp === 'deer' ? 'Deer' : 'Turkeys'
  const slice = [noun, f.portions.length ? f.portions.map((p) => PORTION_LABEL[p] ?? p).join(' + ') : '', f.season, f.region ? `${f.region} region` : '']
    .filter(Boolean).join(' · ')
  const home = homeCounty.value, sel = selected.value

  const change = (label: 'jumps' | 'drops'): Row[] => book.rec[label].map((r) => ({
    key: `${r.county}:${r.year}`, fips: fipsOf(r.county), name: name(r.county), season: season(r.year),
    main: `${r.value > 0 ? '+' : ''}${pct(r.value, 0)}`, sub: `${fmt(book.valueAt(r, 1))} → ${fmt(book.valueAt(r, 0))}`, up: r.value > 0,
  }))
  const lastYear = book.years[book.years.length - 1]
  const streakRows: Row[] = book.streaks.map((s) => ({
    key: String(s.i), fips: fipsOf(s.i), name: name(s.i), season: '',
    main: `${s.n} seasons`, sub: `${season(lastYear - s.n + 1)} to ${season(lastYear)}`,
  }))
  const st = book.state

  return (
    <div class="p-4 max-w-6xl mx-auto">
      <FactCards limit={8} />

      <section class="mb-4 rounded-xl border border-line bg-bg-2 p-3 flex flex-wrap gap-x-6 gap-y-2 items-baseline">
        <h2 class="w-full text-xs uppercase tracking-wide text-fg-3">{slice} · {season(book.years[0])} to {season(lastYear)}</h2>
        <div>
          <div class="text-[11px] text-fg-3">{f.region ? 'Region' : 'Statewide'} record season</div>
          <div class="text-2xl font-bold text-blaze tabular-nums">{fmt(st[book.best])}</div>
          <div class="text-sm text-fg-2">{season(book.years[book.best])}</div>
        </div>
        <div>
          <div class="text-[11px] text-fg-3">Lowest season</div>
          <div class="text-xl font-semibold tabular-nums">{fmt(st[book.worst])}</div>
          <div class="text-sm text-fg-2">{season(book.years[book.worst])}</div>
        </div>
        <p class="text-[11px] text-fg-3 ml-auto self-end">Animals checked · Source: MDC</p>
      </section>

      <div class="grid gap-4 lg:grid-cols-2">
        <section class="rounded-xl border border-line bg-bg-2 p-3">
          <HBarChart id="records-highest" title={`Highest county-seasons · ${slice}`} units="Animals checked in one season"
            maxBars={10} onSelect={(id) => openCounty(id.split(':')[0])}
            bars={book.highest.map((r) => ({
              id: `${fipsOf(r.county)}:${r.year}`, label: name(r.county), value: r.value, sub: sp === 'deer' ? season(r.year).slice(2) : season(r.year), // "23-24" fits the bar rail
              highlight: fipsOf(r.county) === sel || fipsOf(r.county) === home,
            }))} />
        </section>
        <RecordList title={`Current top-10 streaks (through ${season(lastYear)})`} rows={streakRows}
          empty="No county has finished top 10 two seasons running in this slice." />
        <RecordList title="Biggest jumps" rows={change('jumps')} empty="Not enough seasons in range." />
        <RecordList title="Biggest drops" rows={change('drops')} empty="Not enough seasons in range." />
      </div>
      <p class="text-[11px] text-fg-3 mt-2">
        Jumps and drops compare a county with its previous season and only count seasons with at least {fmt(book.minBase)} animals.
        {book.partial ? ` ${book.partial} has spring results only so far, so it is left out of jumps, drops and the lowest season.` : ''}
        {' '}Tap any row to open the county.
      </p>
    </div>
  )
}
