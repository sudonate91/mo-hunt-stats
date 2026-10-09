/** Pure helpers shared by the Map view, the county card and the county page. */
import { METRICS, type MetricDef } from '../../data/metrics'
import { mask, maskCounties, sumByCode, type Filter } from '../../data/query'
import type { Attributes, County, CwdJson, Dataset, Species } from '../../data/types'
import type { Metric } from '../../state/filters'

/** Seasons present in the data and inside the filter's year range. */
export function yearsInRange(d: Dataset, f: Filter): number[] {
  const ys = d.years.filter((y) => y >= f.yearFrom && y <= f.yearTo)
  return ys.length ? ys : d.years.slice(-1)
}

export function clampYear(y: number, years: number[]): number {
  if (!years.length) return y
  return Math.min(years[years.length - 1], Math.max(years[0], y))
}

export const metricsFor = (sp: Species): MetricDef[] => METRICS.filter((m) => m.species.includes(sp))
export const applicableMetric = (id: Metric, sp: Species): Metric => (metricsFor(sp).some((m) => m.id === id) ? id : 'count')

/** The `n` counties with the closest centroids (equirectangular distance). */
export function nearest(counties: County[], fips: string, n = 5): County[] {
  const me = counties.find((c) => c.fips === fips)
  if (!me) return []
  const k = Math.cos((me.centroid[1] * Math.PI) / 180)
  return counties
    .filter((c) => c.fips !== fips)
    .map((c) => ({ c, d: ((c.centroid[0] - me.centroid[0]) * k) ** 2 + (c.centroid[1] - me.centroid[1]) ** 2 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((x) => x.c)
}

/** Sum by a coded column for one county and one season under `f` with `patch` applied (region ignored). */
export function countyBreakdown(d: Dataset, f: Filter, regionOf: (fips: string) => string, countyIdx: number, year: number,
  by: 'portion' | 'cls', patch: Partial<Filter> = {}): Map<string, number> {
  const m = mask(d, { ...f, ...patch, region: '', yearFrom: year, yearTo: year }, regionOf)
  const mc = maskCounties(d, m, new Set([countyIdx]))
  return by === 'portion' ? sumByCode(d, mc, d.portion, d.dict.portion) : sumByCode(d, mc, d.cls, d.dict.cls)
}

export interface Share { num: number; den: number }

/** Turkey public-land and crossbow shares for one county-season from turkey_attributes (null = not reported). */
export function turkeyShares(d: Dataset, f: Filter, regionOf: (fips: string) => string, attrs: Attributes | null, fips: string,
  countyIdx: number, year: number): { publicLand: Share | null; crossbow: Share | null } {
  if (!attrs) return { publicLand: null, crossbow: null }
  const byPortion = countyBreakdown(d, f, regionOf, countyIdx, year, 'portion', { classes: [], portions: [] })
  const pl: Share = { num: 0, den: 0 }
  let hasPl = false, xb: Share | null = null
  for (const p of d.dict.portion) {
    if (f.portions.length && !f.portions.includes(p)) continue
    const a = attrs.byKey.get(`${year}:${p}:${fips}`)
    if (!a) continue
    const den = byPortion.get(p) ?? 0
    pl.num += a.public_land; pl.den += den; hasPl = true
    if (p === 'fall_archery') xb = { num: a.crossbow, den }
  }
  return { publicLand: hasPl ? pl : null, crossbow: xb }
}

export interface CwdStat { samples: number; positives: number; cumSamples: number; cumPositives: number; since: number }

export function cwdFor(cwd: CwdJson | null, fips: string, year: number): CwdStat | null {
  if (!cwd) return null
  let samples = 0, positives = 0, cumSamples = 0, cumPositives = 0, since = Infinity, found = false
  for (const r of cwd.rows) {
    if (r.county_fips !== fips || r.year > year) continue
    cumSamples += r.samples; cumPositives += r.positives; since = Math.min(since, r.year)
    if (r.year === year) { samples = r.samples; positives = r.positives; found = true }
  }
  if (!found && !cumSamples) return null
  return { samples, positives, cumSamples, cumPositives, since: Number.isFinite(since) ? since : year }
}

/** Ordinal suffix: 1st, 2nd, 3rd, 11th… */
export function ordinal(n: number): string {
  const s = n % 100
  if (s >= 11 && s <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}
