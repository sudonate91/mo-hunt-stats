/** Loaded datasets as signals; views read `ds.value`, `counties.value` and never fetch themselves. */
import { computed, effect, signal } from '@preact/signals'
import { loadAttributes, loadCounties, loadCwd, loadDataset, loadEffort } from '../data/load'
import { setEffort } from '../data/metrics'
import { mask } from '../data/query'
import type { Attributes, County, CwdJson, Dataset, EffortJson } from '../data/types'
import { filter, registerYears } from './filters'

export const counties = signal<County[] | null>(null)
export const ds = signal<Dataset | null>(null)
export const attrs = signal<Attributes | null>(null)
export const cwd = signal<CwdJson | null>(null)
export const loadError = signal<string>('')
export const effort = signal<EffortJson | null>(null)

export const countyByFips = computed(() => new Map((counties.value ?? []).map((c) => [c.fips, c])))
export const regionOf = computed(() => {
  const m = countyByFips.value
  return (fips: string) => m.get(fips)?.mdc_region ?? ''
})
export const regions = computed(() =>
  [...new Set((counties.value ?? []).map((c) => c.mdc_region))].sort(),
)

/** Row mask for the current global filter (memoized inside mask()). */
export const currentMask = computed(() => {
  const d = ds.value
  if (!d || !counties.value) return null
  return mask(d, filter.value, regionOf.value)
})

export function startDataLoading() {
  // Effort (hunter density) is registered before counties resolve so every metric computation can see it.
  Promise.all([loadCounties(), loadEffort().catch(() => null)])
    .then(([c, e]) => { setEffort(e); effort.value = e; counties.value = c })
    .catch((e) => (loadError.value = String(e)))
  loadCwd().then((c) => (cwd.value = c)).catch(() => { /* CWD is optional */ })
  effect(() => {
    const sp = filter.value.species
    ds.value = null
    loadDataset(sp)
      .then((d) => { if (filter.value.species === sp) { registerYears(sp, d.years); ds.value = d } })
      .catch((e) => (loadError.value = String(e)))
    if (sp === 'turkey') loadAttributes().then((a) => (attrs.value = a)).catch(() => { /* optional */ })
  })
}
