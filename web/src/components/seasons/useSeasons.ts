/** Season breakdown aggregates: portion and class mix by season, ranked portions and share stats for one season. */
import { useMemo } from 'preact/hooks'
import { CLASS_LABEL, CLASS_ORDER, PORTION_LABEL, filterKey, mask, type Filter } from '../../data/query'
import type { Dataset } from '../../data/types'
import type { Bar, StackedGroup } from '../charts/BarChart'
import { seasonLabel } from '../charts/format'
import { counties, ds, regionOf } from '../../state/data'
import { filter, year } from '../../state/filters'
import { basePortions, portionColor, shortYear, sumByYearCode, yearsIn } from '../analysis/agg'

export interface Stat { label: string; value: string; hint: string }

export interface Seasons {
  portionGroups: StackedGroup[]
  portionCats: { key: string; label: string }[]
  portionColors: string[]
  classGroups: StackedGroup[]
  classCats: { key: string; label: string }[]
  yearBars: Bar[]
  stats: Stat[]
  rangeLabel: string
}

/** Total of rows passing `m` in season year `y`, optionally limited to one county index. */
function totalIn(d: Dataset, m: Uint8Array, y: number, ci: number): number {
  let t = 0
  for (let i = 0; i < d.n; i++) if (m[i] && d.year[i] === y && (ci < 0 || d.county[i] === ci)) t += d.count[i]
  return t
}

const share = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : '–')

export function useSeasons(countyFips: string): Seasons | null {
  const d = ds.value, cs = counties.value, f = filter.value, y = year.value, ro = regionOf.value
  const fk = filterKey(f)
  return useMemo(() => {
    if (!d || !cs) return null
    const sp = f.species
    const full: Filter = { ...f, yearFrom: d.years[0], yearTo: d.years[d.years.length - 1] }
    // County scope ignores the region filter so a county outside the region still shows.
    const ci = countyFips ? d.dict.county.indexOf(countyFips) : -1
    const scoped = (patch: Partial<Filter>) => {
      const m = mask(d, { ...full, ...(ci >= 0 ? { region: '' } : {}), ...patch }, ro)
      if (ci < 0) return m
      const out = new Uint8Array(d.n)
      for (let i = 0; i < d.n; i++) if (m[i] && d.county[i] === ci) out[i] = 1
      return out
    }
    const m = scoped({})
    const byP = sumByYearCode(d, m, d.portion, d.dict.portion.length)
    const byC = sumByYearCode(d, m, d.cls, d.dict.cls.length)
    const x = yearsIn(d, f.yearFrom, f.yearTo)
    const xi = x.map((yy) => d.years.indexOf(yy))
    const many = x.length > 6

    const pCode = new Map(d.dict.portion.map((p, i) => [p, i]))
    const portions = basePortions(sp).filter((p) => pCode.has(p) && xi.some((i) => byP[i][pCode.get(p)!] > 0))
    const portionGroups = x.map((yy, k) => ({
      label: shortYear(yy, many),
      parts: Object.fromEntries(portions.map((p) => [p, byP[xi[k]][pCode.get(p)!]])),
    }))

    const cCode = new Map(d.dict.cls.map((c, i) => [c, i]))
    const classes = CLASS_ORDER[sp].filter((c) => cCode.has(c) && xi.some((i) => byC[i][cCode.get(c)!] > 0))
    const classGroups = x.map((yy, k) => ({
      label: shortYear(yy, many),
      parts: Object.fromEntries(classes.map((c) => [c, byC[xi[k]][cCode.get(c)!]])),
    }))

    const yi = d.years.indexOf(y)
    const yearBars: Bar[] = yi < 0 ? [] : portions
      .map((p) => ({ label: PORTION_LABEL[p] ?? p, value: byP[yi][pCode.get(p)!], id: p }))
      .filter((b) => b.value > 0)
      .sort((a, b) => b.value - a.value)

    const tot = (patch: Partial<Filter>) => totalIn(d, scoped(patch), y, ci)
    const stats: Stat[] = []
    if (sp === 'deer') {
      stats.push({ label: 'Opening weekend share of November', value: share(tot({ portions: ['opening_weekend'] }), tot({ portions: ['november'] })), hint: 'Opening weekend ÷ November firearms portion' })
      stats.push({ label: 'Youth share', value: share(tot({ portions: [], youth: 'y', method: '' }), tot({ portions: [], method: 'firearm', youth: '' })), hint: 'Early + late youth ÷ all firearms harvest' })
    } else {
      const spring = tot({ season: 'spring', portions: [] }), fall = tot({ season: 'fall', portions: [] })
      stats.push({ label: 'Spring vs fall ratio', value: fall > 0 ? `${(spring / fall).toFixed(1)} : 1` : spring > 0 ? 'no fall harvest' : '–', hint: `Spring ${spring.toLocaleString('en-US')} · fall ${fall.toLocaleString('en-US')}` })
    }

    return {
      portionGroups, portionCats: portions.map((p) => ({ key: p, label: PORTION_LABEL[p] ?? p })),
      portionColors: portions.map((p) => portionColor(sp, p)),
      classGroups, classCats: classes.map((c) => ({ key: c, label: CLASS_LABEL[c] ?? c })),
      yearBars, stats,
      rangeLabel: x.length ? `${seasonLabel(sp, x[0])} to ${seasonLabel(sp, x[x.length - 1])}` : '',
    }
  }, [d, cs, fk, y, ro, countyFips])
}
