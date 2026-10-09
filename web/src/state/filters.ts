/**
 * Global app state as Preact signals, mirrored to URL query params so every view is shareable.
 *
 * URL params: view, sp (species), y (yearFrom-yearTo), yr (single year for map/leaderboard), s (season),
 * p (portions, comma), m (method), yo (youth y/n), c (classes, comma), r (region), co (selected counties, comma),
 * metric, cmp (head-to-head pair "a,b"), ov (map overlays, comma: rivers, lakes, eco, roads, public).
 */
import { computed, effect, signal } from '@preact/signals'
import type { Filter } from '../data/query'
import type { Method, Season, Species } from '../data/types'

export type View = 'map' | 'county' | 'board' | 'trends' | 'seasons' | 'h2h' | 'records' | 'about'
export const VIEWS: { id: View; label: string }[] = [
  { id: 'map', label: 'Map' },
  { id: 'board', label: 'Ranks' },
  { id: 'trends', label: 'Trends' },
  { id: 'seasons', label: 'Seasons' },
  { id: 'h2h', label: 'Compare' },
  { id: 'records', label: 'Records' },
]

export type Metric = 'count' | 'per_sqmi' | 'change_yoy' | 'vs_5yr' | 'buck_doe' | 'button_share' | 'zscore'
  | 'archery_share' | 'youth_share' | 'opening_share' | 'public_land_share' | 'crossbow_share'

export const MIN_YEAR: Record<Species, number> = { deer: 2015, turkey: 2015 }
/** Latest season per species. Seeded with the known values and updated from the loaded data (see state/data.ts). */
export const MAX_YEAR: Record<Species, number> = { deer: 2025, turkey: 2026 }

const SEASONS = new Set(['spring', 'fall'])
const METHODS = new Set(['firearm', 'archery', 'mixed'])
const VIEW_IDS = new Set<string>(['map', 'county', 'board', 'trends', 'seasons', 'h2h', 'records', 'about'])
export const METRIC_IDS: Metric[] = ['count', 'per_sqmi', 'change_yoy', 'vs_5yr', 'buck_doe', 'button_share', 'zscore',
  'archery_share', 'youth_share', 'opening_share', 'public_land_share', 'crossbow_share']
const DEER_ONLY: Metric[] = ['buck_doe', 'button_share', 'archery_share', 'youth_share', 'opening_share']
const TURKEY_ONLY: Metric[] = ['public_land_share', 'crossbow_share']

/** The metric if it applies to the species, else 'count'. */
export function applicableMetric(m: Metric, sp: Species): Metric {
  if (sp === 'deer' && TURKEY_ONLY.includes(m)) return 'count'
  if (sp === 'turkey' && DEER_ONLY.includes(m)) return 'count'
  return METRIC_IDS.includes(m) ? m : 'count'
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Called by the data layer once a dataset is loaded, so the slider range and defaults follow the data. */
export function registerYears(sp: Species, years: number[]) {
  if (!years.length) return
  MIN_YEAR[sp] = years[0]
  MAX_YEAR[sp] = years[years.length - 1]
  const f = filter.value
  if (f.species === sp) {
    const yearTo = clamp(f.yearTo, MIN_YEAR[sp], MAX_YEAR[sp]), yearFrom = clamp(f.yearFrom, MIN_YEAR[sp], yearTo)
    if (yearTo !== f.yearTo || yearFrom !== f.yearFrom) filter.value = { ...f, yearFrom, yearTo }
    year.value = clamp(year.value, yearFrom, yearTo)
  }
}

const DEFAULT: Filter = {
  species: 'deer', yearFrom: 2015, yearTo: 2025, season: '', portions: [], method: '', youth: '', classes: [], region: '', counties: [],
}

export const view = signal<View>('map')
export const filter = signal<Filter>({ ...DEFAULT })
export const year = signal<number>(2025) // map scrubber / leaderboard year
export const metric = signal<Metric>('count')
export const selected = signal<string>('') // selected county fips (linked selection)
export const compare = signal<[string, string]>(['', ''])
export const sheetOpen = signal(false)

/** Map overlay layers (ids match public/data/overlays.json) and their short URL tokens. */
export type OverlayId = 'rivers' | 'lakes' | 'ecoregions' | 'interstates' | 'public_land'
export const OVERLAY_TOKENS: Record<OverlayId, string> = {
  rivers: 'rivers', lakes: 'lakes', ecoregions: 'eco', interstates: 'roads', public_land: 'public',
}
export const overlays = signal<OverlayId[]>([])

/** No default home county: each visitor picks their own, stored per device in localStorage. */
export const DEFAULT_HOME = ''
export const homeCounty = signal<string>((() => { try { return localStorage.getItem('homeCounty') || DEFAULT_HOME } catch { return DEFAULT_HOME } })())
effect(() => { try { localStorage.setItem('homeCounty', homeCounty.value) } catch { /* private mode */ } })

export const species = computed(() => filter.value.species)

export function setFilter(patch: Partial<Filter>) {
  const next = { ...filter.value, ...patch }
  if (patch.yearFrom !== undefined || patch.yearTo !== undefined) {
    next.yearTo = clamp(next.yearTo, MIN_YEAR[next.species], MAX_YEAR[next.species])
    next.yearFrom = clamp(next.yearFrom, MIN_YEAR[next.species], next.yearTo)
    year.value = clamp(year.value, next.yearFrom, next.yearTo)
  }
  if (patch.species && patch.species !== filter.value.species) {
    // species switch resets species-specific selections
    next.portions = []; next.classes = []; next.season = ''; next.method = ''; next.youth = ''
    next.yearFrom = MIN_YEAR[patch.species]; next.yearTo = MAX_YEAR[patch.species]
    year.value = MAX_YEAR[patch.species]
    metric.value = 'count'
  }
  filter.value = next
}

// ---------- URL sync ----------
const list = (s: string | null) => (s ? s.split(',').filter(Boolean) : [])

export function readUrl() {
  const q = new URLSearchParams(location.search)
  const sp = (q.get('sp') === 'turkey' ? 'turkey' : 'deer') as Species
  const [a, b] = (q.get('y') ?? '').split('-').map(Number)
  const yearTo = clamp(b || MAX_YEAR[sp], MIN_YEAR[sp], MAX_YEAR[sp])
  const yearFrom = clamp(a || MIN_YEAR[sp], MIN_YEAR[sp], yearTo)
  const s = q.get('s') ?? '', m = q.get('m') ?? '', yo = q.get('yo') ?? ''
  const fips = (v: string) => /^\d{5}$/.test(v)
  const f: Filter = {
    species: sp,
    yearFrom,
    yearTo,
    season: SEASONS.has(s) ? (s as Season) : '',
    portions: list(q.get('p')).filter((p) => /^[a-z_]+$/.test(p)),
    method: METHODS.has(m) ? (m as Method) : '',
    youth: yo === 'y' || yo === 'n' ? yo : '',
    classes: list(q.get('c')).filter((c) => /^[a-z_]+$/.test(c)),
    region: (q.get('r') ?? '').slice(0, 40),
    counties: list(q.get('co')).filter(fips).slice(0, 5),
  }
  filter.value = f
  const yr = Number(q.get('yr'))
  year.value = Number.isInteger(yr) && yr >= yearFrom && yr <= yearTo ? yr : yearTo
  const v = q.get('view') ?? 'map'
  view.value = VIEW_IDS.has(v) ? (v as View) : 'map'
  metric.value = applicableMetric((q.get('metric') ?? 'count') as Metric, sp)
  const sel = q.get('sel') ?? ''
  selected.value = fips(sel) ? sel : ''
  const cmp = list(q.get('cmp'))
  const okCmp = (v: string | undefined) => (v && (fips(v) || /^region:[A-Za-z. ]{1,30}$/.test(v)) ? v : '')
  compare.value = [okCmp(cmp[0]), okCmp(cmp[1])]
  const ov = new Set(list(q.get('ov')))
  overlays.value = (Object.keys(OVERLAY_TOKENS) as OverlayId[]).filter((id) => ov.has(OVERLAY_TOKENS[id]))
}

export function toUrl(): string {
  const f = filter.value
  const q = new URLSearchParams()
  if (view.value !== 'map') q.set('view', view.value)
  if (f.species !== 'deer') q.set('sp', f.species)
  if (f.yearFrom !== MIN_YEAR[f.species] || f.yearTo !== MAX_YEAR[f.species]) q.set('y', `${f.yearFrom}-${f.yearTo}`)
  if (year.value !== f.yearTo) q.set('yr', String(year.value))
  if (f.season) q.set('s', f.season)
  if (f.portions.length) q.set('p', f.portions.join(','))
  if (f.method) q.set('m', f.method)
  if (f.youth) q.set('yo', f.youth)
  if (f.classes.length) q.set('c', f.classes.join(','))
  if (f.region) q.set('r', f.region)
  if (f.counties.length) q.set('co', f.counties.join(','))
  if (metric.value !== 'count') q.set('metric', metric.value)
  if (selected.value) q.set('sel', selected.value)
  if (compare.value[0] || compare.value[1]) q.set('cmp', compare.value.join(','))
  if (overlays.value.length) q.set('ov', overlays.value.map((id) => OVERLAY_TOKENS[id]).join(','))
  const s = q.toString()
  return location.pathname + (s ? `?${s}` : '')
}

let syncing = false
export function startUrlSync() {
  readUrl()
  effect(() => {
    const url = toUrl()
    if (syncing) return
    if (url !== location.pathname + location.search) history.replaceState(null, '', url)
  })
  addEventListener('popstate', () => { syncing = true; readUrl(); syncing = false })
}

/** Number of active non-default filters, for the filter button badge. */
export const activeFilterCount = computed(() => {
  const f = filter.value
  let n = 0
  if (f.yearFrom !== MIN_YEAR[f.species] || f.yearTo !== MAX_YEAR[f.species]) n++
  if (f.season) n++
  if (f.portions.length) n++
  if (f.method) n++
  if (f.youth) n++
  if (f.classes.length) n++
  if (f.region) n++
  return n
})
