/** Leaderboard computation: one pass per (filter, metric, year). */
import { useMemo } from 'preact/hooks'
import { countyMetric, countySeries, rankValues, type MetricDef } from '../../data/metrics'
import { filterKey } from '../../data/query'
import { attrs, counties, ds, regionOf } from '../../state/data'
import { filter, metric, year } from '../../state/filters'

export interface BoardRow {
  idx: number
  fips: string
  name: string
  region: string
  value: number
  rank: number
  delta: number | null // + = moved up
  spark: number[]
  share: number // share of statewide count (count metric only)
}

export interface Board { rows: BoardRow[]; def: MetricDef; sparkYears: number[]; hasPrev: boolean }

const SPARK_N = 6

export function useBoard(): Board | null {
  const d = ds.value, cs = counties.value, f = filter.value, y = year.value, m = metric.value, a = attrs.value
  const ro = regionOf.value
  const fk = filterKey(f)
  return useMemo(() => {
    if (!d || !cs) return null
    const yi = d.years.indexOf(y)
    const sparkYears = yi < 0 ? [] : d.years.slice(Math.max(0, yi - SPARK_N + 1), yi + 1)
    const res = countyMetric(d, cs, f, ro, m, y, a)
    const def = res.def
    const cur = yi < 0 ? new Float64Array(d.dict.county.length).fill(NaN) : res.values
    const hasPrev = yi > 0 && d.years[yi - 1] === y - 1
    const prev = hasPrev ? countyMetric(d, cs, f, ro, m, y - 1, a).values : null
    // Sparkline is always harvest (one pass over the fact table), whatever the ranked metric.
    const series = countySeries(d, f, ro)
    const s0 = Math.max(0, yi - SPARK_N + 1)
    const rank = rankValues(cur)
    const prevRank = prev ? rankValues(prev) : null
    let stateTotal = 0
    if (m === 'count') {
      const st = f.region ? countyMetric(d, cs, { ...f, region: '' }, ro, 'count', y).values : cur
      for (const v of st) if (Number.isFinite(v)) stateTotal += v
    }
    const rows: BoardRow[] = []
    for (let i = 0; i < cur.length; i++) {
      if (!Number.isFinite(cur[i])) continue
      const c = cs[i]
      const pr = prevRank?.[i] ?? 0
      rows.push({
        idx: i, fips: c.fips, name: c.name, region: c.mdc_region, value: cur[i], rank: rank[i],
        delta: pr > 0 && rank[i] > 0 ? pr - rank[i] : null,
        spark: yi < 0 ? [] : Array.from(series[i].slice(s0, yi + 1)),
        share: stateTotal > 0 ? cur[i] / stateTotal : NaN,
      })
    }
    rows.sort((p, q) => p.rank - q.rank)
    return { rows, def, sparkYears, hasPrev }
  }, [d, cs, fk, y, m, a, ro])
}
