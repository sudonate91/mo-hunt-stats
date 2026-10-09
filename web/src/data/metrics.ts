/**
 * Derived metrics over the fact table. Every function is pure over (Dataset, Filter, counties) so views,
 * the map and the record book agree. Values are per county index (ds.dict.county order); NaN = undefined.
 */
import type { Metric } from '../state/filters'
import { mask, maskYear, sumByCounty, sumByCountyYear, type Filter } from './query'
import type { Attributes, County, Dataset, Species } from './types'

export interface MetricDef {
  id: Metric
  label: string
  units: string
  diverging: boolean // use a diverging color scale centered on 0 (or 1 for ratios)
  species: Species[] // where it applies
  format: 'int' | 'dec1' | 'dec2' | 'pct' | 'signed_pct' | 'signed_int' | 'z'
}

export const METRICS: MetricDef[] = [
  { id: 'count', label: 'Harvest', units: 'Animals checked', diverging: false, species: ['deer', 'turkey'], format: 'int' },
  { id: 'per_sqmi', label: 'Harvest per sq mi', units: 'Animals per square mile of land', diverging: false, species: ['deer', 'turkey'], format: 'dec2' },
  { id: 'change_yoy', label: 'Change vs last year', units: '% change vs previous season', diverging: true, species: ['deer', 'turkey'], format: 'signed_pct' },
  { id: 'vs_5yr', label: 'vs 5-year average', units: '% vs mean of the previous 5 seasons', diverging: true, species: ['deer', 'turkey'], format: 'signed_pct' },
  { id: 'zscore', label: 'Hotspot index', units: 'z-score of harvest per sq mi vs the state', diverging: true, species: ['deer', 'turkey'], format: 'z' },
  { id: 'buck_doe', label: 'Buck : doe ratio', units: 'Antlered bucks per doe', diverging: false, species: ['deer'], format: 'dec2' },
  { id: 'button_share', label: 'Button buck share', units: '% of harvest that were button bucks', diverging: false, species: ['deer'], format: 'pct' },
  { id: 'archery_share', label: 'Archery share', units: '% of season harvest taken by archery', diverging: false, species: ['deer'], format: 'pct' },
  { id: 'youth_share', label: 'Youth share', units: '% of firearms harvest taken in youth portions', diverging: false, species: ['deer'], format: 'pct' },
  { id: 'opening_share', label: 'Opening weekend share', units: '% of the November portion taken opening weekend', diverging: false, species: ['deer'], format: 'pct' },
  { id: 'public_land_share', label: 'Public land share', units: '% of harvest taken on public land', diverging: false, species: ['turkey'], format: 'pct' },
  { id: 'crossbow_share', label: 'Crossbow share', units: '% of fall archery harvest taken by crossbow', diverging: false, species: ['turkey'], format: 'pct' },
]

export const metricDef = (id: Metric) => METRICS.find((m) => m.id === id) ?? METRICS[0]

export function formatMetric(v: number, def: MetricDef): string {
  if (!Number.isFinite(v)) return '–'
  switch (def.format) {
    case 'int': return v.toLocaleString('en-US', { maximumFractionDigits: 0 })
    case 'dec1': return v.toFixed(1)
    case 'dec2': return v.toFixed(2)
    case 'pct': return `${(v * 100).toFixed(1)}%`
    case 'signed_pct': return `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`
    case 'signed_int': return `${v > 0 ? '+' : ''}${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    case 'z': return `${v > 0 ? '+' : ''}${v.toFixed(2)}σ`
  }
}

type RegionOf = (fips: string) => string

/** Sum per county for a single year under filter f (with optional overrides of portions/classes/method/youth). */
function countsFor(ds: Dataset, f: Filter, regionOf: RegionOf, year: number, patch: Partial<Filter> = {}): Float64Array {
  const m = mask(ds, { ...f, ...patch, yearFrom: ds.years[0], yearTo: ds.years[ds.years.length - 1] }, regionOf)
  return sumByCounty(ds, maskYear(ds, m, year))
}

/** Per-county series across all seasons under filter f (year range ignored so trends can show history). */
export function countySeries(ds: Dataset, f: Filter, regionOf: RegionOf, patch: Partial<Filter> = {}): Float64Array[] {
  const m = mask(ds, { ...f, ...patch, yearFrom: ds.years[0], yearTo: ds.years[ds.years.length - 1] }, regionOf)
  return sumByCountyYear(ds, m)
}

function div(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = b[i] > 0 ? a[i] / b[i] : NaN
  return out
}

function zscores(v: Float64Array, present: (i: number) => boolean): Float64Array {
  let n = 0, s = 0, s2 = 0
  for (let i = 0; i < v.length; i++) if (present(i) && Number.isFinite(v[i])) { n++; s += v[i]; s2 += v[i] * v[i] }
  const mean = s / n, sd = Math.sqrt(Math.max(0, s2 / n - mean * mean))
  const out = new Float64Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = present(i) && sd > 0 ? (v[i] - mean) / sd : NaN
  return out
}

export interface MetricResult { values: Float64Array; def: MetricDef }

/**
 * Compute a metric for every county for `year`. Counties outside the region filter (or never in the data for the
 * species) get NaN. `attrs` is only needed for turkey public-land / crossbow shares.
 */
export function countyMetric(
  ds: Dataset, counties: County[], f: Filter, regionOf: RegionOf, metric: Metric, year: number, attrs?: Attributes | null,
): MetricResult {
  const def = metricDef(metric)
  const inRegion = (i: number) => !f.region || regionOf(ds.dict.county[i]) === f.region
  const area = new Float64Array(counties.map((c) => c.land_area_sq_mi))
  const base = countsFor(ds, f, regionOf, year)
  const nan = (i: number) => !inRegion(i)
  let values: Float64Array
  switch (metric) {
    case 'count': values = base; break
    case 'per_sqmi': values = div(base, area); break
    case 'change_yoy': {
      const prev = countsFor(ds, f, regionOf, year - 1)
      values = new Float64Array(base.length)
      for (let i = 0; i < base.length; i++) values[i] = prev[i] > 0 ? base[i] / prev[i] - 1 : NaN
      break
    }
    case 'vs_5yr': {
      const series = countySeries(ds, f, regionOf)
      const yi = ds.years.indexOf(year)
      values = new Float64Array(base.length)
      for (let i = 0; i < base.length; i++) {
        const prev = series[i].slice(Math.max(0, yi - 5), yi)
        const avg = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : 0
        values[i] = avg > 0 ? base[i] / avg - 1 : NaN
      }
      break
    }
    case 'zscore': values = zscores(div(base, area), (i) => inRegion(i) && base[i] > 0); break
    case 'buck_doe': values = div(countsFor(ds, f, regionOf, year, { classes: ['antlered_buck'] }), countsFor(ds, f, regionOf, year, { classes: ['doe'] })); break
    case 'button_share': values = div(countsFor(ds, f, regionOf, year, { classes: ['button_buck'] }), countsFor(ds, f, regionOf, year, { classes: [] })); break
    case 'archery_share': values = div(countsFor(ds, f, regionOf, year, { portions: ['archery'] }), countsFor(ds, f, regionOf, year, { portions: [], method: '' })); break
    case 'youth_share': values = div(countsFor(ds, f, regionOf, year, { portions: [], youth: 'y', method: '' }), countsFor(ds, f, regionOf, year, { portions: [], method: 'firearm', youth: '' })); break
    case 'opening_share': values = div(countsFor(ds, f, regionOf, year, { portions: ['opening_weekend'] }), countsFor(ds, f, regionOf, year, { portions: ['november'] })); break
    case 'public_land_share':
    case 'crossbow_share': {
      const key = metric === 'public_land_share' ? 'public_land' : 'crossbow'
      const portions = metric === 'crossbow_share' ? ['fall_archery'] : (f.portions.length ? f.portions : ds.dict.portion.filter((p) => !['spring_opening_day', 'spring_first_week'].includes(p)))
      const denom = countsFor(ds, f, regionOf, year, { portions, classes: [] })
      const num = new Float64Array(base.length)
      for (let i = 0; i < base.length; i++) {
        for (const p of portions) {
          const a = attrs?.byKey.get(`${year}:${p}:${ds.dict.county[i]}`)
          if (a) num[i] += a[key]
        }
      }
      values = div(num, denom)
      if (!attrs) values.fill(NaN)
      break
    }
    default: values = base
  }
  for (let i = 0; i < values.length; i++) if (nan(i)) values[i] = NaN
  return { values, def }
}

/** Ranks (1 = highest) over finite values; NaN gets 0. */
export function rankValues(values: Float64Array): Int32Array {
  const idx: number[] = []
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) idx.push(i)
  idx.sort((a, b) => values[b] - values[a])
  const r = new Int32Array(values.length)
  idx.forEach((i, pos) => { r[i] = pos + 1 })
  return r
}

/** Years in a row (ending at the last year of `series`) the county ranked within `top` statewide. */
export function streak(series: Float64Array[], countyIdx: number, top = 10): number {
  const years = series[0]?.length ?? 0
  let n = 0
  for (let y = years - 1; y >= 0; y--) {
    const col = series.map((s) => s[y])
    const r = rankValues(new Float64Array(col))[countyIdx]
    if (r >= 1 && r <= top) n++
    else break
  }
  return n
}

export interface Record_ { label: string; county: number; year: number; value: number; detail?: string }

/** Record book over the county × year series. */
export function records(series: Float64Array[], years: number[]): { highest: Record_[]; jumps: Record_[]; drops: Record_[] } {
  const highest: Record_[] = [], jumps: Record_[] = [], drops: Record_[] = []
  series.forEach((s, c) => {
    for (let y = 0; y < years.length; y++) {
      if (s[y] > 0) highest.push({ label: 'Highest county-season', county: c, year: years[y], value: s[y] })
      if (y > 0 && s[y - 1] > 0 && s[y] > 0) {
        const d = s[y] / s[y - 1] - 1
        jumps.push({ label: 'Biggest jump', county: c, year: years[y], value: d, detail: `${s[y - 1]} → ${s[y]}` })
        drops.push({ label: 'Biggest drop', county: c, year: years[y], value: d, detail: `${s[y - 1]} → ${s[y]}` })
      }
    }
  })
  highest.sort((a, b) => b.value - a.value)
  jumps.sort((a, b) => b.value - a.value)
  drops.sort((a, b) => a.value - b.value)
  return { highest: highest.slice(0, 10), jumps: jumps.slice(0, 10), drops: drops.slice(0, 10) }
}
