/** Map view: metric choropleth with season scrubber / small multiples, a linked trend chart and the county card. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { Choropleth } from '../components/Choropleth'
import { CountyCard } from '../components/CountyCard'
import { seasonLabel } from '../components/charts/format'
import { LineChart, type LineSeries } from '../components/charts/LineChart'
import { Icon } from '../components/Icon'
import { ShareButton } from '../components/ShareButton'
import { applicableMetric, clampYear, metricsFor, yearsInRange } from '../components/map/derive'
import { OverlayChips, OverlayLegend, useActiveOverlays } from '../components/map/Overlays'
import { SmallMultiples } from '../components/map/SmallMultiples'
import { StatsStrip, type StripData } from '../components/map/StatsStrip'
import { makeBubbleScale } from '../components/map/Bubbles'
import { Scatter } from '../components/map/Scatter'
import { YearScrubber } from '../components/map/YearScrubber'
import { useEffortYear } from '../lib/yearNudge'
import { countyMetric, metricDef } from '../data/metrics'
import { maskYear, sumByCounty, sumByCountyYear, sumByYear } from '../data/query'
import type { County, Dataset } from '../data/types'
import { attrs, counties, countyByFips, currentMask, ds, regionOf, regions } from '../state/data'
import { applicableMetric2, filter, homeCounty, metric, metric2, selected, year, type Metric } from '../state/filters'

const select = (fips: string) => { selected.value = selected.value === fips ? '' : fips }
const setYear = (y: number) => { year.value = y }

export default function MapView() {
  const d = ds.value, cs = counties.value, m = currentMask.value
  if (!d || !cs || !m) return <div class="p-4 text-fg-3 animate-pulse">Loading…</div>
  return <MapViewInner d={d} cs={cs} m={m} />
}

function MapViewInner({ d, cs, m }: { d: Dataset; cs: County[]; m: Uint8Array }) {
  const f = filter.value, rOf = regionOf.value, sp = f.species, at = attrs.value
  const sel = selected.value, home = homeCounty.value
  const years = useMemo(() => yearsInRange(d, f), [d, f])
  const y = clampYear(year.value, years)
  useEffect(() => { if (year.value !== y) year.value = y }, [y])
  const mId = applicableMetric(metric.value, sp)
  const def = metricDef(mId)
  const m2 = applicableMetric2(metric2.value, sp)
  const m2Id = m2 === mId ? '' : m2
  const def2 = m2Id ? metricDef(m2Id) : null
  const nudge = useEffortYear([mId, m2Id], years)
  const [multiples, setMultiples] = useState(false)
  const [cardOpen, setCardOpen] = useState(true)
  const season = seasonLabel(sp, y)
  const ov = useActiveOverlays()
  const scope = f.region ? `${f.region} region` : 'Statewide'

  const res = useMemo(() => countyMetric(d, cs, f, rOf, mId, y, at), [d, cs, f, rOf, mId, y, at])
  const multi = useMemo(() => (multiples ? years.map((yy) => countyMetric(d, cs, f, rOf, mId, yy, at).values) : null),
    [multiples, years, d, cs, f, rOf, mId, at])
  const res2 = useMemo(() => (m2Id ? countyMetric(d, cs, f, rOf, m2Id, y, at).values : null), [d, cs, f, rOf, m2Id, y, at])
  const bubbles = useMemo(() => (res2 && def2 ? { values: res2, def: def2, scale: makeBubbleScale([res2]) } : null), [res2, def2])
  const multi2 = useMemo(() => (multiples && m2Id ? years.map((yy) => countyMetric(d, cs, f, rOf, m2Id, yy, at).values) : null),
    [multiples, years, d, cs, f, rOf, m2Id, at])

  const [strip, topFips] = useMemo((): [StripData, string] => {
    const counts = sumByCounty(d, maskYear(d, m, y))
    let total = 0, reporting = 0, top = -1
    for (let i = 0; i < counts.length; i++) {
      total += counts[i]
      if (counts[i] > 0) reporting++
      const v = res.values[i]
      if (Number.isFinite(v) && (top < 0 || v > res.values[top])) top = i
    }
    const inScope = f.region ? cs.filter((c) => c.mdc_region === f.region).length : cs.length
    const fips = top >= 0 ? d.dict.county[top] : ''
    return [{
      total, reporting, of: inScope, season, scope,
      topName: countyByFips.value.get(fips)?.name ?? '',
      topValue: top >= 0 ? res.values[top] : NaN,
    }, fips]
  }, [d, m, y, res, f.region, cs, season, scope])

  // Linked chart: statewide/region total by season, selected county overlaid on a right-hand axis.
  const byYear = useMemo(() => sumByYear(d, m), [d, m])
  const byCountyYear = useMemo(() => sumByCountyYear(d, m), [d, m])
  const selIdx = sel ? d.dict.county.indexOf(sel) : -1
  const selName = countyByFips.value.get(sel)?.name ?? ''
  const series = useMemo<LineSeries[]>(() => {
    const yi = years.map((yy) => d.years.indexOf(yy))
    const out: LineSeries[] = [{ label: `${scope} total`, values: yi.map((i) => byYear[i]), color: '#ff6a13' }]
    if (selIdx >= 0) out.push({ label: `${selName} (right axis)`, values: yi.map((i) => byCountyYear[selIdx][i]), color: '#ffd166', axis: 'right' })
    return out
  }, [years, d, byYear, byCountyYear, selIdx, selName, scope])

  // Swipe left/right on the map to change season (touch only; vertical scroll and pinch-zoom stay native).
  const start = useRef<{ x: number; y: number; id: number } | null>(null)
  const onDown = (e: PointerEvent) => { if (e.pointerType !== 'mouse' && e.isPrimary) start.current = { x: e.clientX, y: e.clientY, id: e.pointerId } }
  const onUp = (e: PointerEvent) => {
    const s = start.current
    start.current = null
    if (!s || s.id !== e.pointerId) return
    const dx = e.clientX - s.x, dy = e.clientY - s.y
    if (Math.abs(dx) < 50 || Math.abs(dx) < 1.5 * Math.abs(dy)) return
    const i = years.indexOf(y)
    const next = years[Math.max(0, Math.min(years.length - 1, i + (dx < 0 ? 1 : -1)))]
    if (next !== undefined && next !== y) year.value = next
  }

  // Desktop keyboard shortcuts: [ and ] step seasons.
  const step = useCallback((dir: number) => {
    const i = years.indexOf(y)
    const next = years[i + dir]
    if (next !== undefined) year.value = next
  }, [years, y])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return
      if (e.key === '[') step(-1)
      else if (e.key === ']') step(1)
      else if (e.key === 'Escape') selected.value = ''
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [step])

  return (
    <div class="p-3 md:grid md:grid-cols-[minmax(0,1fr)_300px] lg:grid-cols-[minmax(0,1fr)_360px] md:gap-4 lg:p-4">
      <div class="min-w-0">
        <div class="flex items-center gap-2 mb-2">
          <label class="flex-1 min-w-0">
            <span class="sr-only">Metric</span>
            <select class="w-full rounded-lg bg-bg-3 border border-line px-2 text-sm text-fg" value={mId}
              onChange={(e) => { metric.value = (e.currentTarget as HTMLSelectElement).value as Metric }}>
              {metricsFor(sp).map((md) => <option key={md.id} value={md.id}>{md.label}</option>)}
            </select>
          </label>
          <label class="flex-1 min-w-0">
            <span class="sr-only">Compare with</span>
            <select class={`w-full rounded-lg bg-bg-3 border px-2 text-sm ${m2Id ? 'border-[#4cc9f0] text-fg' : 'border-line text-fg-3'}`} value={m2Id}
              onChange={(e) => { metric2.value = (e.currentTarget as HTMLSelectElement).value as Metric | '' }}>
              <option value="">Compare with…</option>
              {metricsFor(sp).filter((md) => md.id !== mId).map((md) => <option key={md.id} value={md.id}>vs {md.label}</option>)}
            </select>
          </label>
          {!multi && <ShareButton target="map-choropleth" label="Share map" />}
          <button type="button" aria-pressed={multiples} onClick={() => setMultiples(!multiples)}
            class={`tap rounded-lg px-3 text-sm border inline-flex items-center gap-1.5 ${multiples ? 'bg-blaze text-black border-blaze font-semibold' : 'border-line text-fg-2 hover:border-fg-3'}`}>
            <Icon name="seasons" size={18} /><span class="hidden sm:inline">Every season</span><span class="sm:hidden">All</span>
          </button>
        </div>
        <OverlayChips />
        {nudge && <p class="text-xs text-fg-3 mb-1" role="status">{nudge}</p>}
        <StatsStrip s={strip} def={def} onTop={() => topFips && (selected.value = topFips)} />
        <YearScrubber years={years} value={y} onChange={setYear} species={sp} />
        {multi ? (
          <SmallMultiples years={years} values={multi} def={def} species={sp} current={y} onYear={setYear}
            onSelect={select} selected={sel} homeCounty={home} region={f.region} overlays={ov} values2={multi2} def2={def2} />
        ) : (
          <div onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => (start.current = null)} class="max-w-[760px] mx-auto">
            <h2 class="sr-only">{def.label} by county, {season}</h2>
            <figure id="map-choropleth" class="m-0" data-share-title={`${def.label}${def2 ? ` vs ${def2.label}` : ''} by county · ${scope} · ${season}`}>
              <Choropleth values={res.values} def={def} onSelect={select} selected={sel} homeCounty={home} dimOutsideRegion={f.region}
                label={`${def.label} by county, ${season}. ${def.units}.${def2 ? ` Bubbles: ${def2.label}.` : ''}`} overlays={ov} bubbles={bubbles} />
              <OverlayLegend />
            </figure>
          </div>
        )}
        {res2 && def2 && (
          <div class="max-w-[760px] mx-auto">
            <Scatter x={res2} y={res.values} defX={def2} defY={def} counties={cs} regions={regions.value} selected={sel} home={home}
              onSelect={(fips) => (selected.value = fips)} title={`${def.label} vs ${def2.label} · ${season}`} />
          </div>
        )}
      </div>

      <aside class="min-w-0 mt-4 md:mt-0 flex flex-col gap-4" aria-label="Chart and county details">
        <div class="rounded-xl bg-bg-2 border border-line p-3">
          <LineChart id="map-trend" x={years} series={series} height={200} units="Animals checked per season"
            title={selIdx >= 0 ? `${scope} total vs ${selName}` : `${scope} total by season`} />
          {selIdx < 0 && <p class="text-xs text-fg-3 mt-1">Tap a county to compare it here.</p>}
        </div>
        {sel && (
          <div>
            <button type="button" class="tap md:hidden w-full flex items-center justify-between rounded-lg px-3 bg-bg-3 border border-line text-sm mb-2"
              aria-expanded={cardOpen} onClick={() => setCardOpen(!cardOpen)}>
              <span>{selName} County details</span><span aria-hidden="true">{cardOpen ? '▲' : '▼'}</span>
            </button>
            <div class={cardOpen ? '' : 'hidden md:block'}>
              <CountyCard fips={sel} onClose={() => (selected.value = '')} />
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}
