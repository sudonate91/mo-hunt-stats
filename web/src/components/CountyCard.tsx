/** County dashboard for one county: ranks, trend, portion mix, species shares, CWD, neighbors, top-10 streak. */
import { useMemo } from 'preact/hooks'
import { countyMetric, countySeries, effortFor, effortYearRange, rankMetric, streak } from '../data/metrics'
import { PORTION_LABEL, SUBTOTAL_PORTIONS } from '../data/query'
import { attrs, counties, countyByFips, cwd, ds, effort, regionOf } from '../state/data'
import { filter, homeCounty, metric, selected, view, year } from '../state/filters'
import { HBarChart } from './charts/BarChart'
import { seasonLabel } from './charts/format'
import { LineChart, type LineSeries } from './charts/LineChart'
import { CwdBlock, DeerShares, Neighbors, PressureBlock, RankBlock, Section, TurkeyShares, type NeighborRow, type Pressure } from './CountyCardSections'
import { Icon } from './Icon'
import { applicableMetric, clampYear, countyBreakdown, cwdFor, nearest, turkeyShares, yearsInRange } from './map/derive'

const dec1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '–')
const select = (f: string) => { selected.value = f }
const desc = (a: number, b: number) => (Number.isFinite(b) ? b : -Infinity) - (Number.isFinite(a) ? a : -Infinity)

export function HomeToggle({ fips }: { fips: string }) {
  const on = homeCounty.value === fips
  return (
    <button type="button" aria-pressed={on} onClick={() => (homeCounty.value = on ? '' : fips)}
      class={`tap inline-flex items-center gap-1.5 rounded-lg px-3 text-sm border ${on ? 'bg-blaze text-black border-blaze font-semibold' : 'border-line text-fg-2 hover:border-fg-3'}`}>
      <Icon name="home" size={18} />{on ? 'Home county' : 'Set as home county'}
    </button>
  )
}

export function CountyCard({ fips, full = false, onClose }: { fips: string; full?: boolean; onClose?: () => void }) {
  const d = ds.value, cs = counties.value, f = filter.value, rOf = regionOf.value
  const c = countyByFips.value.get(fips)
  const sp = f.species
  const y = d ? clampYear(year.value, yearsInRange(d, f)) : year.value
  const mId = applicableMetric(metric.value, sp)
  const at = attrs.value
  const cwdData = cwd.value
  const ci = d ? d.dict.county.indexOf(fips) : -1
  const season = seasonLabel(sp, y)

  const core = useMemo(() => {
    if (!d || !cs || ci < 0) return null
    const res = countyMetric(d, cs, { ...f, region: '' }, rOf, mId, y, at)
    const ranks = rankMetric(res.values, res.def)
    const reg = rOf(fips)
    const regVals = res.values.map((v, i) => (rOf(d.dict.county[i]) === reg ? v : NaN))
    const regRanks = rankMetric(regVals, res.def)
    const nRanked = (r: Int32Array) => r.reduce((n, v) => n + (v > 0 ? 1 : 0), 0) // rank 0 = unranked
    const series = countySeries(d, { ...f, region: '' }, rOf)
    const yi = d.years.indexOf(y)
    const top10 = yi >= 0 ? streak(series.map((s) => s.slice(0, yi + 1)), ci, 10) : 0
    const avg = d.years.map((_, j) => {
      let s = 0, n = 0
      for (const row of series) if (row[j] > 0) { s += row[j]; n++ }
      return n ? Math.round(s / n) : null
    })
    const trend: LineSeries[] = [
      { label: c?.name ?? fips, values: Array.from(series[ci]), color: '#ffd166' },
      { label: 'State avg per county', values: avg, color: '#b5b5b8', dash: [6, 4] },
    ]
    const neighbors: NeighborRow[] = [c, ...nearest(cs, fips, 5)].flatMap((x) => {
      if (!x) return []
      const i = d.dict.county.indexOf(x.fips)
      return [{ fips: x.fips, name: x.name, value: res.values[i], rank: ranks[i], self: x.fips === fips }]
    }).sort((a, b) => desc(a.value, b.value))
    return {
      res, reg, top10, trend, neighbors,
      state: [ranks[ci], nRanked(ranks)] as [number, number],
      region: [regRanks[ci], nRanked(regRanks)] as [number, number],
    }
  }, [d, cs, f, rOf, mId, y, at, ci, fips, c])

  const mix = useMemo(() => {
    if (!d || ci < 0) return null
    const portions = countyBreakdown(d, f, rOf, ci, y, 'portion', { portions: [] })
    const bars = [...portions].filter(([p, v]) => !SUBTOTAL_PORTIONS.has(p) && v > 0)
      .map(([p, v]) => ({ label: PORTION_LABEL[p] ?? p, value: v })).sort((a, b) => b.value - a.value)
    const cls = sp === 'deer' ? countyBreakdown(d, f, rOf, ci, y, 'cls', { classes: [] }) : null
    const tk = sp === 'turkey' ? turkeyShares(d, f, rOf, at, fips, ci, y) : null
    return { bars, cls, tk }
  }, [d, f, rOf, ci, y, sp, at, fips])

  const eff = effort.value
  const pressure = useMemo(() => {
    if (sp !== 'deer' || !d || !cs || ci < 0 || !c || !eff) return null
    const years = effortYearRange()
    const published = years.includes(y)
    const row = effortFor(y, fips)
    if (published && !row) return null // county not in MDC's regional tables (St. Louis City)
    const nRanked = (r: Int32Array) => r.reduce((n, v) => n + (v > 0 ? 1 : 0), 0)
    const g = { ...f, region: '' }
    let p: Pressure = { published, firearms: null, archery: null, hunters: NaN, deerPerHunter: NaN, rankDph: [0, 0], rankDensity: [0, 0], tripsFirearms: null, tripsArchery: null }
    if (row) {
      const dph = countyMetric(d, cs, g, rOf, 'deer_per_hunter', y, at)
      const dens = countyMetric(d, cs, g, rOf, 'hunters_per_sqmi', y, at)
      const rd = rankMetric(dph.values, dph.def), rh = rankMetric(dens.values, dens.def)
      const fh = row.firearms_hunters_per_sqmi, ah = row.archery_hunters_per_sqmi
      const h = fh != null && ah != null ? (fh + ah) * c.land_area_sq_mi : NaN
      p = {
        published, firearms: fh, archery: ah,
        hunters: Number.isFinite(h) ? Math.round(h / 100) * 100 : NaN,
        deerPerHunter: dph.values[ci], rankDph: [rd[ci], nRanked(rd)], rankDensity: [rh[ci], nRanked(rh)],
        tripsFirearms: row.trips_per_kill_firearms, tripsArchery: row.trips_per_kill_archery,
      }
    }
    // Trend of combined density across effort years that publish it, vs the state average per county.
    const dens = (r: { firearms_hunters_per_sqmi: number | null; archery_hunters_per_sqmi: number | null } | undefined) =>
      r && r.firearms_hunters_per_sqmi != null && r.archery_hunters_per_sqmi != null ? r.firearms_hunters_per_sqmi + r.archery_hunters_per_sqmi : null
    const x: number[] = [], self: (number | null)[] = [], avg: (number | null)[] = []
    for (const yy of years) {
      let s = 0, n = 0
      for (const fp of d.dict.county) { const v = dens(effortFor(yy, fp)); if (v != null && Number.isFinite(v)) { s += v; n++ } }
      if (!n) continue
      x.push(yy); self.push(dens(effortFor(yy, fips))); avg.push(Math.round((s / n) * 10) / 10)
    }
    const trend: LineSeries[] = [
      { label: c.name, values: self, color: '#ffd166' },
      { label: 'State avg per county', values: avg, color: '#b5b5b8', dash: [6, 4] },
    ]
    return { p, x, trend }
  }, [sp, d, cs, ci, c, eff, y, fips, f, rOf, at])

  const cw = useMemo(() => (sp === 'deer' ? cwdFor(cwdData, fips, y) : null), [sp, fips, y, cwdData])

  if (!c || !d || !core || !mix) return <div class="p-3 text-sm text-fg-3">No data for this county.</div>

  const cls = mix.cls
  const total = cls ? [...cls.values()].reduce((a, b) => a + b, 0) : 0

  return (
    <article class="rounded-xl bg-bg-2 border border-line p-3" aria-label={`${c.name} county card`}>
      <header class="flex items-start gap-2 mb-2">
        <div class="min-w-0 flex-1">
          <h2 class="text-lg font-bold leading-tight truncate">{c.name}{c.fips === '29510' ? '' : ' County'}</h2>
          <p class="text-xs text-fg-3">{c.mdc_region} region · {c.land_area_sq_mi.toLocaleString('en-US')} sq mi of land</p>
        </div>
        {onClose && (
          <button type="button" class="tap rounded-lg text-fg-2 hover:bg-bg-3 inline-flex items-center justify-center" aria-label="Clear selected county" onClick={onClose}>
            <Icon name="close" />
          </button>
        )}
      </header>
      <div class="flex flex-wrap gap-2 mb-3">
        <HomeToggle fips={fips} />
        {!full && (
          <button type="button" class="tap inline-flex items-center gap-1.5 rounded-lg px-3 text-sm border border-line text-fg-2 hover:border-fg-3" onClick={() => (view.value = 'county')}>
            <Icon name="county" size={18} />Full page
          </button>
        )}
      </div>
      <div class={full ? 'md:grid md:grid-cols-2 md:gap-x-6' : ''}>
        <div>
          <RankBlock value={core.res.values[ci]} def={core.res.def} state={core.state} region={core.region} regionName={core.reg} season={season} />
          <p class="text-sm text-fg-2 mt-2 min-h-[1.25rem]">
            {core.top10 > 0
              ? <>Top 10 statewide in harvest <strong class="text-sel">{core.top10} season{core.top10 > 1 ? 's' : ''} running</strong> through {season}.</>
              : <>Not in the statewide top 10 for harvest in {season}.</>}
          </p>
          <Section title={`${d.years.length}-season trend`}>
            <LineChart id="county-trend" x={d.years} series={core.trend} units="Animals checked per season" height={150} title={`${c.name} vs state average`} />
          </Section>
        </div>
        <div>
          <Section title={`Portion mix · ${season}`}>
            {mix.bars.length ? <HBarChart id="county-mix" title={`${c.name} portion mix · ${season}`} bars={mix.bars} units="Animals checked" /> : <p class="text-sm text-fg-3">No harvest under the current filter.</p>}
          </Section>
          {cls && <DeerShares bucks={cls.get('antlered_buck') ?? 0} does={cls.get('doe') ?? 0} buttons={cls.get('button_buck') ?? 0} total={total} season={season} />}
          {mix.tk && <TurkeyShares publicLand={mix.tk.publicLand} crossbow={mix.tk.crossbow} season={season} />}
          {pressure && (
            <PressureBlock p={pressure.p} season={season} chart={pressure.x.length > 1 && (
              <LineChart id="county-pressure" x={pressure.x} series={pressure.trend} height={140} yMin={0}
                units="Firearms + archery hunters per sq mi" title={`${c.name} hunters per sq mi`} format={dec1} />
            )} />
          )}
          {sp === 'deer' && <CwdBlock stat={cw} season={String(y)} />}
          <Neighbors rows={core.neighbors} def={core.res.def} onSelect={select} season={season} />
        </div>
      </div>
    </article>
  )
}
