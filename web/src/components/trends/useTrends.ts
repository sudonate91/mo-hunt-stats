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

/** Turkey season years with spring rows but no fall rows (fall not yet reported); empty for deer. */
function springOnlyYears(d: Dataset): Set<number> {
  const out = new Set<number>()
  if (d.species !== 'turkey') return out
  const fall = d.dict.season.indexOf('fall')
  const hasFall = new Set<number>()
  for (let i = 0; i < d.n; i++) if (d.season[i] === fall) hasFall.add(d.year[i])
  for (const y of d.years) if (!hasFall.has(y)) out.add(y)
  return out
}

/** Null out the given years so an index line does not dip on a partial (spring-only) season. */
function dropYears(v: (number | null)[], x: number[], drop: Set<number>): (number | null)[] {
  return drop.size ? v.map((val, i) => (drop.has(x[i]) ? null : val)) : v
}

const partialNote = (ys: number[]) =>
  ys.length ? ` Turkey ${ys.join(', ')} left out: only the spring season is reported so far.` : ''

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
      // Both species use the same reduced filter so the lines are like for like.
      const reduced = (sp: Species): Filter => ({ species: sp, yearFrom: f.yearFrom, yearTo: f.yearTo, season: '', portions: [], method: f.method, youth: '', classes: [], region: f.region, counties: [] })
      // The comparison mask ignores season, so a spring-only turkey year is always partial here.
      const line = (dd: Dataset) => {
        const drop = new Set([...springOnlyYears(dd)].filter((y) => y >= f.yearFrom && y <= f.yearTo))
        return { values: transform(dropYears(pick(dd, sumByYear(dd, mask(dd, reduced(dd.species), ro)), x), x, drop), 'index', area), drop }
      }
      const a = line(d)
      const series: LineSeries[] = [{ label: `${SPECIES_NAME[f.species]} (${scope})`, values: a.values, color: TOTAL_COLOR }]
      let dropped = [...a.drop]
      if (od) {
        const b = line(od)
        dropped = [...dropped, ...b.drop]
        series.push({ label: `${SPECIES_NAME[other]} (${scope})`, values: b.values, color: OVERLAY_COLORS[0] })
      }
      return {
        x, series, units: MODE_UNITS.index,
        title: `Deer vs turkey · ${scope} · index (first season = 100)`,
        note: od
          ? `Both species indexed to their first season so different scales compare. Both lines apply only the year range, region and method filters; season, portion, class and youth filters are ignored for both.${partialNote(dropped.sort((p, q) => p - q))}`
          : `Loading ${other} data…`,
      }
    }

    const x = d.years.filter((y) => y >= f.yearFrom && y <= f.yearTo)
    // Index mode: a spring-only turkey season would read as a crash, so skip it unless only spring is shown.
    const drop = mode === 'index' && f.season !== 'spring' ? new Set([...springOnlyYears(d)].filter((y) => x.includes(y))) : new Set<number>()
    const tf = (v: (number | null)[], area: number) => transform(dropYears(v, x, drop), mode, area)
    const series: LineSeries[] = []
    const showTotal = mode !== 'count' || f.counties.length === 0
    if (showTotal) series.push({ label: `${scope} total`, values: tf(pick(d, sumByYear(d, m), x), area), color: TOTAL_COLOR })
    if (f.counties.length) {
      const all = countySeries(d, { ...f, region: '' }, ro)
      f.counties.slice(0, 5).forEach((fips, k) => {
        const i = d.dict.county.indexOf(fips)
        if (i < 0) return
        series.push({ label: cs[i].name, values: tf(pick(d, all[i], x), cs[i].land_area_sq_mi), color: OVERLAY_COLORS[k] })
      })
    }
    const modeLabel = mode === 'count' ? 'harvest' : mode === 'per_sqmi' ? 'harvest per sq mi' : 'index (first season = 100)'
    return {
      x, series, units: MODE_UNITS[mode],
      title: `${SPECIES_NAME[f.species]} ${modeLabel} · ${f.counties.length && !showTotal ? 'selected counties' : scope}`,
      note: ((showTotal ? '' : `${scope} total hidden in Harvest mode (different scale). Switch to Per sq mi or Index to compare counties with it.`) + partialNote([...drop])).trim(),
    }
  }, [d, cs, fk, m, ro, mode, compareSpecies, otherDs, other, pickedKey])
}
