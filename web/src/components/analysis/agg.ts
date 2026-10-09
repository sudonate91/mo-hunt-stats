/** Small aggregation helpers shared by the analysis views (board, trends, seasons, head-to-head). */
import { PORTION_ORDER, SUBTOTAL_PORTIONS } from '../../data/query'
import type { County, Dataset, Species } from '../../data/types'

/** Sum count grouped by year index (ds.years) × dictionary code. Returns [yearIdx][code]. */
export function sumByYearCode(ds: Dataset, m: Uint8Array, codes: Uint8Array, dictLen: number): Float64Array[] {
  const yi = new Map(ds.years.map((y, i) => [y, i]))
  const out = ds.years.map(() => new Float64Array(dictLen))
  for (let i = 0; i < ds.n; i++) if (m[i]) out[yi.get(ds.year[i])!][codes[i]] += ds.count[i]
  return out
}

/** Sum a set of county series (from countySeries / sumByCountyYear) into one series. */
export function sumSeries(series: Float64Array[], idx: Iterable<number>): Float64Array {
  const out = new Float64Array(series[0]?.length ?? 0)
  for (const c of idx) {
    const s = series[c]
    if (s) for (let y = 0; y < out.length; y++) out[y] += s[y]
  }
  return out
}

/** Years of the dataset inside [from, to]. */
export function yearsIn(ds: Dataset, from: number, to: number): number[] {
  return ds.years.filter((y) => y >= from && y <= to)
}

/** Short x label for bars: 2015 → '15 when there are many bars. */
export function shortYear(y: number, many: boolean): string {
  return many ? `'${String(y).slice(2)}` : String(y)
}

/** Non-subtotal portions of a species in display order (consistent color per portion). */
export function basePortions(sp: Species): string[] {
  return PORTION_ORDER[sp].filter((p) => !SUBTOTAL_PORTIONS.has(p))
}

/** Fixed portion palette: index in basePortions(species) → color, so a portion keeps its color everywhere. */
export const PORTION_COLORS = [
  '#ff6a13', '#4cc9f0', '#ffd166', '#06d6a0', '#ef476f', '#b388ff', '#c0c0c0', '#8ac926', '#f78fb3', '#5e8bff',
]

export function portionColor(sp: Species, portion: string): string {
  const i = basePortions(sp).indexOf(portion)
  return PORTION_COLORS[(i < 0 ? 0 : i) % PORTION_COLORS.length]
}

/** A head-to-head / overlay place: county fips or `region:<name>`. */
export interface Place { key: string; label: string; idx: number[]; area: number; isRegion: boolean }

export function resolvePlace(key: string, ds: Dataset, counties: County[]): Place | null {
  if (!key) return null
  const byFips = new Map(counties.map((c) => [c.fips, c]))
  if (key.startsWith('region:')) {
    const r = key.slice(7)
    const idx: number[] = []
    let area = 0
    ds.dict.county.forEach((f, i) => {
      const c = byFips.get(f)
      if (c?.mdc_region === r) { idx.push(i); area += c.land_area_sq_mi }
    })
    return idx.length ? { key, label: `${r} region`, idx, area, isRegion: true } : null
  }
  const i = ds.dict.county.indexOf(key)
  const c = byFips.get(key)
  if (i < 0 || !c) return null
  return { key, label: c.name, idx: [i], area: c.land_area_sq_mi, isRegion: false }
}

/** Dataset year index for a calendar season year, or -1. */
export const yearIdx = (ds: Dataset, y: number) => ds.years.indexOf(y)
