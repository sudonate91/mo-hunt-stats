/** Head-to-head computation for two places (county fips or `region:<name>`). */
import { useMemo } from 'preact/hooks'
import { countyMetric, countySeries, formatMetric, metricDef } from '../../data/metrics'
import { PORTION_LABEL, filterKey, mask, type Filter } from '../../data/query'
import type { Dataset } from '../../data/types'
import type { StackedGroup } from '../charts/BarChart'
import type { LineSeries } from '../charts/LineChart'
import { publicLandParts } from '../../data/facts'
import { fmt, pct, seasonLabel } from '../charts/format'
import { attrs, counties, ds, regionOf } from '../../state/data'
import { applicableMetric, compare, filter, homeCounty, metric, year } from '../../state/filters'
import { basePortions, portionColor, resolvePlace, sumSeries, yearsIn, type Place } from '../analysis/agg'

export const SIDE_COLORS = ['#ff6a13', '#4cc9f0'] as const

export interface StatRow { label: string; values: [number, number]; text: [string, string]; better: 'high' | 'low' | null; highlight?: boolean }

export interface H2H {
  places: [Place, Place]
  keys: [string, string]
  rows: StatRow[]
  x: number[]
  series: LineSeries[]
  mix: StackedGroup[]
  mixCats: { key: string; label: string }[]
  mixColors: string[]
}

const DEFAULT_A = '29071' // Franklin

/** County-index × portion-code totals for one season. */
function countyPortion(d: Dataset, m: Uint8Array, y: number): Float64Array[] {
  const out = d.dict.county.map(() => new Float64Array(d.dict.portion.length))
  for (let i = 0; i < d.n; i++) if (m[i] && d.year[i] === y) out[d.county[i]][d.portion[i]] += d.count[i]
  return out
}

export function useH2H(): H2H | null {
  const d = ds.value, cs = counties.value, f = filter.value, y = year.value, ro = regionOf.value, a = attrs.value
  const metRaw = metric.value, [ka, kb] = compare.value, home = homeCounty.value
  const fk = filterKey(f)
  return useMemo(() => {
    if (!d || !cs) return null
    const sp = f.species
    const met = applicableMetric(metRaw, sp)
    const full: Filter = { ...f, region: '', yearFrom: d.years[0], yearTo: d.years[d.years.length - 1] }
    const all = countySeries(d, full, ro)
    const yi = d.years.indexOf(y)
    const col = all.map((s) => (yi < 0 ? NaN : s[yi]))

    // Defaults: home county (or Franklin) vs the top county this season.
    const pa = resolvePlace(ka || home || DEFAULT_A, d, cs) ?? resolvePlace(DEFAULT_A, d, cs)
    if (!pa) return null
    // B defaults to the best county this season that is not A; also used when B would duplicate A.
    let pb = kb ? resolvePlace(kb, d, cs) : null
    if (!pb || pb.key === pa.key) {
      const order = col.map((v, i) => [v, i] as const).filter(([v]) => Number.isFinite(v)).sort((p, q) => q[0] - p[0])
      const top = order.find(([, i]) => d.dict.county[i] !== pa.key)
      pb = top ? resolvePlace(d.dict.county[top[1]], d, cs) : null
    }
    if (!pb) return null
    const places: [Place, Place] = [pa, pb]
    const series = places.map((p) => sumSeries(all, p.idx))

    // Ranks: counties among counties, regions among regions.
    const regionNames = [...new Set(cs.map((c) => c.mdc_region))]
    const regionTotals = new Map(regionNames.map((r) => [r, resolvePlace(`region:${r}`, d, cs)?.idx.reduce((s, i) => s + (col[i] || 0), 0) ?? 0]))
    const rankOf = (p: Place): [number, number] => {
      if (p.isRegion) {
        const v = regionTotals.get(p.key.slice(7)) ?? 0
        return [1 + [...regionTotals.values()].filter((x) => x > v).length, regionTotals.size]
      }
      const v = col[p.idx[0]]
      const n = col.filter((x) => Number.isFinite(x) && x > 0).length
      return [Number.isFinite(v) && v > 0 ? 1 + col.filter((x) => x > v).length : NaN, n]
    }

    const at = (s: Float64Array, i: number) => (i >= 0 && i < s.length ? s[i] : NaN)
    const harvest = series.map((s) => at(s, yi))
    const prev = series.map((s) => at(s, yi - 1))
    // Previous five seasons (current excluded), matching the map's vs_5yr metric.
    const avg5 = series.map((s) => { const w = yi <= 0 ? [] : Array.from(s.slice(Math.max(0, yi - 5), yi)); return w.length ? w.reduce((p, q) => p + q, 0) / w.length : NaN })
    const best = series.map((s) => { let bi = 0; s.forEach((v, i) => { if (v > s[bi]) bi = i }); return [s[bi], d.years[bi]] as const })
    const ranks = places.map(rankOf)
    const two = <T,>(g: (k: 0 | 1) => T): [T, T] => [g(0), g(1)]

    const rows: StatRow[] = [
      { label: 'Harvest', values: two((k) => harvest[k]), text: two((k) => fmt(harvest[k])), better: 'high', highlight: met === 'count' },
      { label: 'Per sq mi', values: two((k) => harvest[k] / places[k].area), text: two((k) => { const v = harvest[k] / places[k].area; return Number.isFinite(v) ? v.toFixed(2) : '–' }), better: 'high', highlight: met === 'per_sqmi' },
      { label: 'Rank', values: two((k) => ranks[k][0]), text: two((k) => (Number.isFinite(ranks[k][0]) ? `#${ranks[k][0]} of ${ranks[k][1]}` : '–')), better: pa.isRegion === pb.isRegion ? 'low' : null },
      { label: 'Change vs last year', values: two((k) => (prev[k] > 0 ? harvest[k] / prev[k] - 1 : NaN)), text: two((k) => (prev[k] > 0 ? formatMetric(harvest[k] / prev[k] - 1, metricDef('change_yoy')) : '–')), better: 'high', highlight: met === 'change_yoy' },
      { label: 'Prev. 5-season avg', values: two((k) => avg5[k]), text: two((k) => fmt(avg5[k])), better: 'high' },
    ]

    if (sp === 'deer') {
      const bucks = countySeries(d, { ...full, classes: ['antlered_buck'] }, ro)
      const does = countySeries(d, { ...full, classes: ['doe'] }, ro)
      const r = two((k) => { const b = at(sumSeries(bucks, places[k].idx), yi), o = at(sumSeries(does, places[k].idx), yi); return o > 0 ? b / o : NaN })
      rows.push({ label: 'Buck : doe', values: r, text: two((k) => (Number.isFinite(r[k]) ? r[k].toFixed(2) : '–')), better: 'high', highlight: met === 'buck_doe' })
    } else {
      // Only (portion, county) pairs with attribute rows count, so unreported seasons show '–', not 0%.
      const parts = a && yi >= 0 ? publicLandParts(d, full, ro, y, a) : null
      const r = two((k) => {
        if (!parts) return NaN
        let num = 0, den = 0, any = false
        for (const i of places[k].idx) if (parts.has[i]) { any = true; num += parts.num[i]; den += parts.den[i] }
        return any && den > 0 ? num / den : NaN
      })
      rows.push({ label: 'Public-land share', values: r, text: two((k) => pct(r[k])), better: 'high', highlight: met === 'public_land_share' })
    }

    rows.push({ label: 'Best season ever', values: two((k) => best[k][0]), text: two((k) => (best[k][0] > 0 ? `${fmt(best[k][0])} (${seasonLabel(sp, best[k][1])})` : '–')), better: 'high' })

    // The current map/leaderboard metric when it is not already shown (county-level only).
    const shown = new Set(['count', 'per_sqmi', 'change_yoy', 'buck_doe', 'public_land_share'])
    if (!shown.has(met)) {
      const res = countyMetric(d, cs, full, ro, met, y, a)
      const v = two((k) => (places[k].isRegion ? NaN : res.values[places[k].idx[0]]))
      rows.push({ label: res.def.label, values: v, text: two((k) => (places[k].isRegion ? 'n/a for regions' : formatMetric(v[k], res.def))), better: 'high', highlight: true })
    }

    const x = yearsIn(d, f.yearFrom, f.yearTo)
    const lineSeries: LineSeries[] = places.map((p, k) => ({
      label: p.label, color: SIDE_COLORS[k], values: x.map((yy) => series[k][d.years.indexOf(yy)]),
    }))

    const cp = yi < 0 ? null : countyPortion(d, mask(d, full, ro), y)
    const pCode = new Map(d.dict.portion.map((p, i) => [p, i]))
    const sums = places.map((p) => {
      const out = new Map<string, number>()
      for (const pr of basePortions(sp)) {
        const c = pCode.get(pr)
        if (c === undefined || !cp) continue
        out.set(pr, p.idx.reduce((s, i) => s + cp[i][c], 0))
      }
      return out
    })
    const mixKeys = basePortions(sp).filter((p) => sums.some((m) => (m.get(p) ?? 0) > 0))
    const mix: StackedGroup[] = places.map((p, k) => {
      const tot = mixKeys.reduce((s, q) => s + (sums[k].get(q) ?? 0), 0)
      return { label: p.label, parts: Object.fromEntries(mixKeys.map((q) => [q, tot > 0 ? ((sums[k].get(q) ?? 0) / tot) * 100 : 0])) }
    })

    return {
      places, keys: [pa.key, pb.key], rows, x, series: lineSeries, mix,
      mixCats: mixKeys.map((q) => ({ key: q, label: PORTION_LABEL[q] ?? q })),
      mixColors: mixKeys.map((q) => portionColor(sp, q)),
    }
  }, [d, cs, fk, y, ro, a, metRaw, ka, kb, home])
}
