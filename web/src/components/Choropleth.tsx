/**
 * SVG county choropleth from build-time projected paths (src/generated/map.json).
 * Quantile classes; sequential palette or diverging centered on 0. Tap/Enter selects, mouse hover shows a tooltip.
 */
import { useSignal } from '@preact/signals'
import { useId, useMemo } from 'preact/hooks'
import { formatMetric, type MetricDef } from '../data/metrics'
import map from '../generated/map.json'
import { ds, regionOf } from '../state/data'
import { MapLegend } from './map/Legend'
import { makeScale, type ColorScale } from './map/scale'
import { MapTooltip, type HoverState } from './map/Tooltip'

const PATHS = Object.entries(map.paths as Record<string, string>)
const NAMES = map.names as Record<string, string>
const LABELS = map.labels as unknown as Record<string, [number, number]>
export const MAP_ASPECT = `${map.width} / ${map.height}`

export interface ChoroplethProps {
  values: Float64Array // per county index, ds.dict.county order
  def: MetricDef
  onSelect: (fips: string) => void
  selected?: string
  homeCounty?: string
  dimOutsideRegion?: string // region name; counties outside it are dimmed
  scale?: ColorScale // shared scale (small multiples); computed from `values` if omitted
  mini?: boolean // small multiple: no legend, tooltip, labels or tab stops
  legend?: boolean
  label?: string
}

export function Choropleth({ values, def, onSelect, selected = '', homeCounty = '', dimOutsideRegion = '', scale, mini = false, legend = true, label }: ChoroplethProps) {
  const hover = useSignal<HoverState | null>(null)
  const hatch = `nodata-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const order = ds.value?.dict.county
  const idx = useMemo(() => new Map((order ?? []).map((f, i) => [f, i])), [order])
  const sc = useMemo(() => scale ?? makeScale([values], def), [scale, values, def])
  const inRegion = regionOf.value

  const valueOf = (fips: string) => { const i = idx.get(fips); return i === undefined ? NaN : values[i] }
  const describe = (fips: string) => {
    const v = valueOf(fips)
    return `${NAMES[fips] ?? fips}: ${Number.isFinite(v) ? `${formatMetric(v, def)} (${def.units})` : 'no data'}`
  }

  const paths = useMemo(() => PATHS.map(([fips, d]) => {
    const v = valueOf(fips)
    const fill = Number.isFinite(v) ? sc.color(v) : `url(#${hatch})`
    const cls = `county${fips === selected ? ' selected' : ''}${fips === homeCounty ? ' home' : ''}${dimOutsideRegion && inRegion(fips) !== dimOutsideRegion ? ' dim' : ''}`
    return (
      <path key={fips} d={d} data-fips={fips} class={cls} style={{ fill }}
        tabIndex={mini ? -1 : 0} role={mini ? undefined : 'button'} aria-label={mini ? undefined : describe(fips)} aria-pressed={mini ? undefined : fips === selected} />
    )
  }), [values, sc, selected, homeCounty, dimOutsideRegion, inRegion, idx, mini, hatch, def])

  const fipsOf = (e: Event) => (e.target as Element | null)?.getAttribute?.('data-fips') ?? ''

  const showTip = (e: PointerEvent) => {
    const f = fipsOf(e)
    const box = (e.currentTarget as SVGElement).closest('[data-map]')?.getBoundingClientRect()
    if (!f || !box) { hover.value = null; return }
    const v = valueOf(f)
    const x = e.clientX - box.left, y = e.clientY - box.top
    hover.value = { fips: f, x, y, flip: x > box.width / 2, text: NAMES[f] ?? f, sub: Number.isFinite(v) ? `${formatMetric(v, def)} · ${def.units}` : 'No data' }
  }

  const outline = (fips: string, cls: string) => {
    const d = (map.paths as Record<string, string>)[fips]
    if (!d) return null
    const w = cls === 'selected' ? 6 : 4
    return (
      <g aria-hidden="true" pointer-events="none">
        <path d={d} fill="none" stroke="#000" stroke-width={w + 4} stroke-linejoin="round" />
        <path d={d} class={`county ${cls}`} style={{ fill: 'none', pointerEvents: 'none', strokeWidth: w }} stroke-linejoin="round" />
      </g>
    )
  }
  const selLabel = !mini && selected ? LABELS[selected] : null

  return (
    <div>
      <div data-map class="relative w-full select-none" style={{ aspectRatio: MAP_ASPECT, touchAction: 'pan-y pinch-zoom' }}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") hover.value = null }}>
        <svg viewBox={map.viewBox} class="block w-full h-full" role="group" aria-label={label ?? `${def.label} by county`}>
          <defs>
            <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#2a2a2c" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#4a4a4e" stroke-width="2" />
            </pattern>
          </defs>
          <g
            onClick={(e) => { const f = fipsOf(e); if (f) onSelect(f) }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { const f = fipsOf(e); if (f) { e.preventDefault(); onSelect(f) } } }}
            onPointerMove={mini ? undefined : (e) => { if (e.pointerType === 'mouse') showTip(e) }}
            onPointerDown={mini ? undefined : (e) => { if (e.pointerType !== 'mouse') showTip(e) }}>
            {paths}
          </g>
          {homeCounty && homeCounty !== selected && outline(homeCounty, 'home')}
          {selected && outline(selected, 'selected')}
          {selLabel && (
            <text x={selLabel[0]} y={selLabel[1]} text-anchor="middle" dominant-baseline="middle" font-size={26} font-weight="700"
              fill="#fff" stroke="#000" stroke-width="5" paint-order="stroke" pointer-events="none">{NAMES[selected]}</text>
          )}
        </svg>
        {!mini && <MapTooltip hover={hover} />}
      </div>
      {legend && <MapLegend scale={sc} def={def} />}
    </div>
  )
}
