/**
 * SVG county choropleth from build-time projected paths (src/generated/map.json).
 * Quantile classes; sequential palette or diverging centered on 0. Tap/Enter selects, mouse hover shows a tooltip.
 * Keyboard: the map is one tab stop (roving focus); arrow keys move to the nearest county in that direction,
 * Home/End jump to the first/last county, Enter/Space selects.
 */
import { useSignal } from '@preact/signals'
import { useId, useMemo, useRef, useState } from 'preact/hooks'
import { formatMetric, type MetricDef } from '../data/metrics'
import map from '../generated/map.json'
import { ds, regionOf } from '../state/data'
import { Bubbles, type BubbleLayer } from './map/Bubbles'
import { MapLegend } from './map/Legend'
import { MapOverlays, type OverlayLayers } from './map/Overlays'
import { makeScale, type ColorScale } from './map/scale'
import { MapTooltip, type HoverState } from './map/Tooltip'

const PATHS = Object.entries(map.paths as Record<string, string>)
const NAMES = map.names as Record<string, string>
const LABELS = map.labels as unknown as Record<string, [number, number]>
export const MAP_ASPECT = `${map.width} / ${map.height}`

/** Label point of each county (falls back to the map center) for directional arrow-key moves. */
const CENTER: [number, number] = [map.width / 2, map.height / 2]
const POS = PATHS.map(([f]) => LABELS[f] ?? CENTER)

/** Index of the nearest county from `from` in an arrow direction; favours counties close to the axis. */
function neighbor(from: number, key: string): number {
  const [x0, y0] = POS[from]
  const [ux, uy] = key === 'ArrowLeft' ? [-1, 0] : key === 'ArrowRight' ? [1, 0] : key === 'ArrowUp' ? [0, -1] : [0, 1]
  let best = from, bestScore = Infinity
  for (let i = 0; i < POS.length; i++) {
    if (i === from) continue
    const dx = POS[i][0] - x0, dy = POS[i][1] - y0
    const along = dx * ux + dy * uy
    if (along <= 0) continue
    const across = Math.abs(dx * uy - dy * ux)
    const score = along + 2 * across
    if (score < bestScore) { bestScore = score; best = i }
  }
  return best
}

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
  overlays?: OverlayLayers | null // active geographic overlays, drawn above counties and below outlines
  bubbles?: BubbleLayer | null // second metric as proportional bubbles (pointer-events none)
}

export function Choropleth({ values, def, onSelect, selected = '', homeCounty = '', dimOutsideRegion = '', scale, mini = false, legend = true, label, overlays, bubbles }: ChoroplethProps) {
  const hover = useSignal<HoverState | null>(null)
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const hatch = `nodata-${uid}`
  const order = ds.value?.dict.county
  const idx = useMemo(() => new Map((order ?? []).map((f, i) => [f, i])), [order])
  const sc = useMemo(() => scale ?? makeScale([values], def), [scale, values, def])
  const inRegion = regionOf.value
  const svgRef = useRef<SVGSVGElement>(null)
  const [active, setActive] = useState(-1) // roving-focus index into PATHS
  const [focusFips, setFocusFips] = useState('') // county with keyboard focus (drawn as an outline)

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
        tabindex={mini ? undefined : -1} role={mini ? undefined : 'button'} aria-label={mini ? undefined : describe(fips)} aria-pressed={mini ? undefined : fips === selected} />
    )
  }), [values, sc, selected, homeCounty, dimOutsideRegion, inRegion, idx, mini, hatch, def])

  // Same vnode between renders => Preact skips re-diffing the (large) overlay group on filter changes.
  const overlayNode = useMemo(() => overlays && <MapOverlays layers={overlays} id={uid} mini={mini} />, [overlays, uid, mini])
  const bubbleNode = useMemo(() => bubbles && order && <Bubbles layer={bubbles} order={order} labels={LABELS} mini={mini} />, [bubbles, order, mini])

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

  const onKey = (e: KeyboardEvent) => {
    const here = PATHS.findIndex(([f]) => f === fipsOf(e))
    const cur = here >= 0 ? here : active
    if (e.key === 'Enter' || e.key === ' ') {
      if (cur < 0) return
      e.preventDefault()
      onSelect(PATHS[cur][0])
      return
    }
    let next = -1
    if (e.key.startsWith('Arrow')) {
      if (cur < 0) {
        const start = selected || homeCounty
        next = Math.max(0, PATHS.findIndex(([f]) => f === start))
      } else next = neighbor(cur, e.key)
    } else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = PATHS.length - 1
    if (next < 0) return
    e.preventDefault()
    setActive(next)
    const f = PATHS[next][0]
    setFocusFips(f)
    svgRef.current?.querySelector<SVGPathElement>(`path[data-fips="${f}"]`)?.focus()
  }

  return (
    <div>
      <div data-map class="relative w-full select-none" style={{ aspectRatio: MAP_ASPECT, touchAction: 'pan-y pinch-zoom' }}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") hover.value = null }}>
        <svg ref={svgRef} viewBox={map.viewBox} class="block w-full h-full" data-share-svg={mini ? undefined : ''}
          role={mini ? 'group' : 'application'} tabIndex={mini ? undefined : 0}
          aria-label={`${label ?? `${def.label} by county`}${mini ? '' : ' Use arrow keys to move between counties, Enter to select.'}`}
          onKeyDown={mini ? undefined : onKey}
          onFocusOut={mini ? undefined : (e) => { if (!svgRef.current?.contains(e.relatedTarget as Node | null)) setFocusFips('') }}>
          <defs>
            <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#2a2a2c" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#4a4a4e" stroke-width="2" />
            </pattern>
          </defs>
          <g
            onClick={(e) => { const f = fipsOf(e); if (f) onSelect(f) }}
            onPointerMove={mini ? undefined : (e) => { if (e.pointerType === 'mouse') showTip(e) }}
            onPointerDown={mini ? undefined : (e) => { if (e.pointerType !== 'mouse') showTip(e) }}>
            {paths}
          </g>
          {overlayNode}
          {homeCounty && homeCounty !== selected && outline(homeCounty, 'home')}
          {selected && outline(selected, 'selected')}
          {focusFips && outline(focusFips, 'focus')}
          {bubbleNode}
          {selLabel && (
            <text x={selLabel[0]} y={selLabel[1]} text-anchor="middle" dominant-baseline="middle" font-size={26} font-weight="700"
              fill="#fff" stroke="#000" stroke-width="5" paint-order="stroke" pointer-events="none">{NAMES[selected]}</text>
          )}
        </svg>
        {!mini && <MapTooltip hover={hover} />}
      </div>
      {legend && <MapLegend scale={sc} def={def} bubbles={bubbles} />}
    </div>
  )
}
