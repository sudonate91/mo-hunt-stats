/**
 * Global app state as Preact signals, mirrored to URL query params so every view is shareable.
 *
 * URL params: view, sp (species), y (yearFrom-yearTo), yr (single year for map/leaderboard), s (season),
 * p (portions, comma), m (method), yo (youth y/n), c (classes, comma), r (region), co (selected counties, comma),
 * metric, cmp (head-to-head pair "a,b").
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
export const MAX_YEAR: Record<Species, number> = { deer: 2025, turkey: 2026 }

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

/** Default home county: Perry County (29157). Overridden per device via localStorage. */
export const DEFAULT_HOME = '29157'
export const homeCounty = signal<string>((() => { try { return localStorage.getItem('homeCounty') || DEFAULT_HOME } catch { return DEFAULT_HOME } })())
effect(() => { try { localStorage.setItem('homeCounty', homeCounty.value) } catch { /* private mode */ } })

export const species = computed(() => filter.value.species)

export function setFilter(patch: Partial<Filter>) {
  const next = { ...filter.value, ...patch }
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
  const f: Filter = {
    species: sp,
    yearFrom: a || MIN_YEAR[sp],
    yearTo: b || MAX_YEAR[sp],
    season: (q.get('s') as Season) || '',
    portions: list(q.get('p')),
    method: (q.get('m') as Method) || '',
    youth: (q.get('yo') as '' | 'y' | 'n') || '',
    classes: list(q.get('c')),
    region: q.get('r') ?? '',
    counties: list(q.get('co')),
  }
  filter.value = f
  year.value = Number(q.get('yr')) || f.yearTo
  view.value = (q.get('view') as View) || 'map'
  metric.value = (q.get('metric') as Metric) || 'count'
  selected.value = q.get('sel') ?? ''
  const cmp = list(q.get('cmp'))
  compare.value = [cmp[0] ?? '', cmp[1] ?? '']
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
