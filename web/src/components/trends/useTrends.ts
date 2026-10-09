/** Trend series for the current slice (state / region total) plus county overlays or a species comparison. */
import { useEffect, useMemo, useState } from 'preact/hooks'
import { loadDataset } from '../../data/load'
import { countySeries } from '../../data/metrics'
import { filterKey, mask, sumByYear, type Filter } from '../../data/query'
import type { Dataset, Species } from '../../data/types'
import type { LineSeries } from '../charts/LineChart'
import { counties, currentMask, ds, regionOf } from '../../state/data'
import { filter } from '../../state/filters'

export type TrendMode = 'count' | 'per_sqmi' | 'index'

export const OVERLAY_COLORS = ['#4cc9f0', '#ffd166', '#06d6a0', '#ef476f', '#b388ff']
const TOTAL_COLOR = '#ff6a13'

export const MODE_UNITS: Record<TrendMode, string> = {
  count: 'Animals checked',
  per_sqmi: 'Animals checked per square mile of land',
  index: 'Index: first season in range = 100',
}

const SPECIES_NAME: Record<Species, string> = { deer: 'Deer', turkey: 'Turkey' }

function transform(v: (number | null)[], mode: TrendMode, area: number): (number | null)[] {
  if (mode === 'count') return v
  if (mode === 'per_sqmi') return v.map((x) => (x == null || !area ? null : x / area))
  const base = v.find((x) => x != null && x > 0)
  return v.map((x) => (x == null || !base ? null : (x / base) * 100))
}

/** Pick values for the x years out of a series indexed by ds.years; years the dataset lacks become null. */
function pick(d: Dataset, s: ArrayLike<number>, x: number[]): (number | null)[] {
  return x.map((y) => { const i = d.years.indexOf(y); return i < 0 ? null : s[i] })
}

export interface Trends { x: number[]; series: LineSeries[]; units: string; title: string; note: string }

export function useTrends(mode: TrendMode, compareSpecies: boolean): Trends | null {
  const d = ds.value, cs = counties.value, f = filter.value, m = currentMask.value, ro = regionOf.value
  const fk = filterKey(f)
  const other: Species = f.species === 'deer' ? 'turkey' : 'deer'
  const [otherDs, setOtherDs] = useState<Dataset | null>(null)

  useEffect(() => {
    if (!compareSpecies || otherDs?.species === other) return
    let live = true
    loadDataset(other).then((o) => { if (live) setOtherDs(o) }).catch(() => { /* comparison just stays hidden */ })
    return () => { live = false }
  }, [compareSpecies, other])

  const pickedKey = f.counties.join(',')
  return useMemo(() => {
    if (!d || !cs || !m) return null
    const scope = f.region ? `${f.region} region` : 'Statewide'
    const area = cs.reduce((s, c) => s + (!f.region || c.mdc_region === f.region ? c.land_area_sq_mi : 0), 0)

    if (compareSpecies) {
      const od = otherDs?.species === other ? otherDs : null
      const ys = new Set([...d.years, ...(od?.years ?? [])])
      const x = [...ys].filter((y) => y >= f.yearFrom && y <= f.yearTo).sort((a, b) => a - b)
      const series: LineSeries[] = [{ label: `${SPECIES_NAME[f.species]} (${scope})`, values: transform(pick(d, sumByYear(d, m), x), 'index', area), color: TOTAL_COLOR }]
      if (od) {
        const of: Filter = { species: other, yearFrom: f.yearFrom, yearTo: f.yearTo, season: '', portions: [], method: f.method, youth: '', classes: [], region: f.region, counties: [] }
        series.push({ label: `${SPECIES_NAME[other]} (${scope})`, values: transform(pick(od, sumByYear(od, mask(od, of, ro)), x), 'index', area), color: OVERLAY_COLORS[0] })
      }
      return {
        x, series, units: MODE_UNITS.index,
        title: `Deer vs turkey · ${scope} · index (first season = 100)`,
        note: od ? `Both species indexed to their first season so different scales compare. ${SPECIES_NAME[other]} uses the same years, region and method, without species-specific filters.` : `Loading ${other} data…`,
      }
    }

    const x = d.years.filter((y) => y >= f.yearFrom && y <= f.yearTo)
    const series: LineSeries[] = []
    const showTotal = mode !== 'count' || f.counties.length === 0
    if (showTotal) series.push({ label: `${scope} total`, values: transform(pick(d, sumByYear(d, m), x), mode, area), color: TOTAL_COLOR })
    if (f.counties.length) {
      const all = countySeries(d, { ...f, region: '' }, ro)
      f.counties.slice(0, 5).forEach((fips, k) => {
        const i = d.dict.county.indexOf(fips)
        if (i < 0) return
        series.push({ label: cs[i].name, values: transform(pick(d, all[i], x), mode, cs[i].land_area_sq_mi), color: OVERLAY_COLORS[k] })
      })
    }
    const modeLabel = mode === 'count' ? 'harvest' : mode === 'per_sqmi' ? 'harvest per sq mi' : 'index (first season = 100)'
    return {
      x, series, units: MODE_UNITS[mode],
      title: `${SPECIES_NAME[f.species]} ${modeLabel} · ${f.counties.length && !showTotal ? 'selected counties' : scope}`,
      note: showTotal ? '' : `${scope} total hidden in Harvest mode (different scale). Switch to Per sq mi or Index to compare counties with it.`,
    }
  }, [d, cs, fk, m, ro, mode, compareSpecies, otherDs, other, pickedKey])
}
