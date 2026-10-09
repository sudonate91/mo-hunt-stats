import type { Dataset, Method, Season, Species } from './types'

/** Global filter state. Empty arrays mean "all". */
export interface Filter {
  species: Species
  yearFrom: number
  yearTo: number
  season: Season | ''
  portions: string[] // [] = all non-subtotal portions
  method: Method | ''
  youth: '' | 'y' | 'n'
  classes: string[]
  region: string
  counties: string[] // fips; [] = all. Used by overlays / head-to-head, not by the mask.
}

export const SUBTOTAL_PORTIONS = new Set([
  'opening_weekend', 'all_firearms', 'grand_total', 'spring_opening_day', 'spring_first_week',
])

export function filterKey(f: Filter): string {
  return [f.species, f.yearFrom, f.yearTo, f.season, f.portions.join(','), f.method, f.youth, f.classes.join(','), f.region].join('|')
}

const maskCache = new Map<string, Uint8Array>()

/** Row mask (1 = row passes). Region filtering needs the county→region map. */
export function mask(ds: Dataset, f: Filter, regionOf: (fips: string) => string): Uint8Array {
  const key = filterKey(f)
  const hit = maskCache.get(key)
  if (hit) return hit
  const n = ds.n
  const out = new Uint8Array(n)
  const want = (dict: string[], vals: string[]) => {
    const s = new Uint8Array(dict.length)
    for (const v of vals) { const i = dict.indexOf(v); if (i >= 0) s[i] = 1 }
    return s
  }
  const portionSel = f.portions.length ? want(ds.dict.portion, f.portions) : null
  const nonSub = ds.dict.portion.map((p) => (SUBTOTAL_PORTIONS.has(p) ? 0 : 1))
  const classSel = f.classes.length ? want(ds.dict.cls, f.classes) : null
  const seasonSel = f.season ? ds.dict.season.indexOf(f.season) : -1
  const methodSel = f.method ? ds.dict.method.indexOf(f.method) : -1
  const countySel = f.region ? new Uint8Array(ds.dict.county.map((c) => (regionOf(c) === f.region ? 1 : 0))) : null
  for (let i = 0; i < n; i++) {
    const y = ds.year[i]
    if (y < f.yearFrom || y > f.yearTo) continue
    const p = ds.portion[i]
    if (portionSel ? !portionSel[p] : !nonSub[p]) continue
    if (classSel && !classSel[ds.cls[i]]) continue
    if (f.season && ds.season[i] !== seasonSel) continue
    if (f.method && ds.method[i] !== methodSel) continue
    if (f.youth && ds.youth[i] !== (f.youth === 'y' ? 1 : 0)) continue
    if (countySel && !countySel[ds.county[i]]) continue
    out[i] = 1
  }
  if (maskCache.size > 64) maskCache.clear()
  maskCache.set(key, out)
  return out
}

/** Sum of count grouped by county index. */
export function sumByCounty(ds: Dataset, m: Uint8Array): Float64Array {
  const out = new Float64Array(ds.dict.county.length)
  for (let i = 0; i < ds.n; i++) if (m[i]) out[ds.county[i]] += ds.count[i]
  return out
}

/** Sum grouped by county index × year (years from ds.years). Returns [countyIdx][yearIdx]. */
export function sumByCountyYear(ds: Dataset, m: Uint8Array): Float64Array[] {
  const yi = new Map(ds.years.map((y, i) => [y, i]))
  const out = ds.dict.county.map(() => new Float64Array(ds.years.length))
  for (let i = 0; i < ds.n; i++) if (m[i]) out[ds.county[i]][yi.get(ds.year[i])!] += ds.count[i]
  return out
}

export function sumByYear(ds: Dataset, m: Uint8Array): Float64Array {
  const yi = new Map(ds.years.map((y, i) => [y, i]))
  const out = new Float64Array(ds.years.length)
  for (let i = 0; i < ds.n; i++) if (m[i]) out[yi.get(ds.year[i])!] += ds.count[i]
  return out
}

/** Sum grouped by an arbitrary dictionary-coded column. */
export function sumByCode(ds: Dataset, m: Uint8Array, codes: Uint8Array, dict: string[]): Map<string, number> {
  const out = new Float64Array(dict.length)
  for (let i = 0; i < ds.n; i++) if (m[i]) out[codes[i]] += ds.count[i]
  const map = new Map<string, number>()
  dict.forEach((k, i) => { if (out[i]) map.set(k, out[i]) })
  return map
}

export function total(ds: Dataset, m: Uint8Array): number {
  let t = 0
  for (let i = 0; i < ds.n; i++) if (m[i]) t += ds.count[i]
  return t
}

/** Restrict an existing mask to one year (for the map scrubber) without recomputing the filter. */
export function maskYear(ds: Dataset, m: Uint8Array, year: number): Uint8Array {
  const out = new Uint8Array(ds.n)
  for (let i = 0; i < ds.n; i++) if (m[i] && ds.year[i] === year) out[i] = 1
  return out
}

/** Restrict a mask to a set of county indices. */
export function maskCounties(ds: Dataset, m: Uint8Array, countyIdx: Set<number>): Uint8Array {
  const out = new Uint8Array(ds.n)
  for (let i = 0; i < ds.n; i++) if (m[i] && countyIdx.has(ds.county[i])) out[i] = 1
  return out
}

export function rank(values: ArrayLike<number>): Int32Array {
  const idx = Array.from({ length: values.length }, (_, i) => i).sort((a, b) => values[b] - values[a])
  const r = new Int32Array(values.length)
  idx.forEach((i, pos) => { r[i] = pos + 1 })
  return r
}

/** Portions available for a species, in display order. */
export const PORTION_ORDER: Record<Species, string[]> = {
  deer: ['archery', 'early_antlerless', 'early_youth', 'urban', 'november', 'opening_weekend', 'cwd', 'late_youth',
    'late_antlerless', 'alternative_methods', 'managed_hunts', 'all_firearms', 'grand_total'],
  turkey: ['spring_youth', 'spring', 'spring_opening_day', 'spring_first_week', 'fall_firearms', 'fall_archery'],
}

export const PORTION_LABEL: Record<string, string> = {
  archery: 'Archery', early_antlerless: 'Early antlerless', early_youth: 'Early youth', urban: 'Urban',
  november: 'November firearms', opening_weekend: 'Opening weekend', cwd: 'CWD portion', late_youth: 'Late youth',
  late_antlerless: 'Late antlerless', alternative_methods: 'Alternative methods', managed_hunts: 'Managed hunts',
  all_firearms: 'All firearms', grand_total: 'Grand total',
  spring_youth: 'Spring youth', spring: 'Spring', spring_opening_day: 'Spring opening day',
  spring_first_week: 'Spring first week', fall_firearms: 'Fall firearms', fall_archery: 'Fall archery',
}

export const CLASS_LABEL: Record<string, string> = {
  antlered_buck: 'Antlered bucks', button_buck: 'Button bucks', doe: 'Does',
  adult_gobbler: 'Adult gobblers', bearded_hen: 'Bearded hens', juvenile_gobbler: 'Juvenile gobblers',
  adult_hen: 'Adult hens', juvenile_hen: 'Juvenile hens', gobbler: 'Gobblers (age unknown)',
}

export const CLASS_ORDER: Record<Species, string[]> = {
  deer: ['antlered_buck', 'button_buck', 'doe'],
  turkey: ['adult_gobbler', 'juvenile_gobbler', 'bearded_hen', 'adult_hen', 'juvenile_hen', 'gobbler'],
}
