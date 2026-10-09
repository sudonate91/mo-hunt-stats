/**
 * Geographic overlays drawn over the county choropleth (rivers, lakes, ecoregions, interstates, public land).
 * Paths are pre-projected into the county map's frame by scripts/build-map.mjs (public/data/overlays.json) and only
 * fetched the first time a layer is switched on. Overlays never take pointer events, so county taps still work.
 */
import { signal } from '@preact/signals'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import map from '../../generated/map.json'
import { overlays, type OverlayId } from '../../state/filters'

export interface OverlayShape { name: string; d: string; label?: [number, number] }
export type OverlayLayers = Partial<Record<OverlayId, OverlayShape[]>>

/** Layers present in the data file (known at build time, so chips render before anything is fetched). */
export const AVAILABLE = (map as { overlayLayers?: string[] }).overlayLayers as OverlayId[] | undefined ?? []

export const OVERLAY_META: Record<OverlayId, { label: string; source: string }> = {
  rivers: { label: 'Rivers', source: 'Natural Earth' },
  lakes: { label: 'Lakes', source: 'Natural Earth' },
  ecoregions: { label: 'Ecoregions', source: 'US EPA' },
  interstates: { label: 'Interstates', source: 'Census TIGER' },
  public_land: { label: 'Public land', source: 'MDC, USFS' },
}

/** Loaded overlay file (null until the first layer is switched on). */
export const overlayData = signal<OverlayLayers | null>(null)
let pending: Promise<void> | null = null
export function loadOverlays(): Promise<void> {
  pending ??= fetch(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/data/overlays.json`)
    .then((r) => { if (!r.ok) throw new Error(`overlays.json: ${r.status}`); return r.json() as Promise<{ layers: OverlayLayers }> })
    .then((j) => { overlayData.value = j.layers })
    .catch((e: unknown) => { pending = null; console.warn(e) })
  return pending
}

/** The active layers' shapes, or null while nothing is active or the file is still loading. */
export function useActiveOverlays(): OverlayLayers | null {
  const on = overlays.value
  const data = overlayData.value
  useEffect(() => { if (on.length && !data) void loadOverlays() }, [on.length, data])
  // Stable object between renders so the overlay group is not rebuilt on every filter change.
  return useMemo(() => {
    const active = on.filter((id) => AVAILABLE.includes(id))
    if (!active.length || !data) return null
    const out: OverlayLayers = {}
    for (const id of active) out[id] = data[id]
    return out
  }, [on, data])
}

/** Union of every county path: overlays are clipped to the state outline. */
let stateClip = ''
const clipPathD = () => (stateClip ||= Object.values(map.paths as Record<string, string>).join(''))

const RIVER = '#4cc9f0', ECO = '#ffd166', ROAD = '#c0c0c0', LAND = '#06d6a0'

/** Two-line split for long ecoregion names. */
function splitName(s: string): string[] {
  const u = s.toUpperCase()
  if (u.length <= 16) return [u]
  const words = u.split(' ')
  let best = 1, bestDiff = Infinity
  for (let i = 1; i < words.length; i++) {
    const diff = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length)
    if (diff < bestDiff) { bestDiff = diff; best = i }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')]
}

/** Ecoregion label positions: kept inside the map and nudged vertically so neighbouring labels never overlap. */
function placeLabels(shapes: OverlayShape[], fs: number, k: number) {
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = []
  const out: { name: string; lines: string[]; x: number; y: number }[] = []
  for (const s of shapes) {
    if (!s.label) continue
    const lines = splitName(s.name)
    const half = (Math.max(...lines.map((l) => l.length)) * fs * 0.68) / 2 + 4 * k
    const h = lines.length * fs * 1.15
    const x = Math.min(map.width - half, Math.max(half, s.label[0]))
    let y = s.label[1] - h / 2
    for (const step of [0, 1, -1, 2, -2, 3, -3]) {
      const yy = Math.min(map.height - h - 2 * k, Math.max(2 * k, s.label[1] - h / 2 + step * (h + 2 * k)))
      const box = { x0: x - half, x1: x + half, y0: yy, y1: yy + h }
      if (!placed.some((b) => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1)) { y = yy; placed.push(box); break }
    }
    out.push({ name: s.name, lines, x, y: y + fs * 0.575 })
  }
  return out
}

/** SVG group rendered inside the choropleth's <svg>, above the counties and below the selection outlines. */
export function MapOverlays({ layers, id, mini = false }: { layers: OverlayLayers; id: string; mini?: boolean }) {
  const ref = useRef<SVGGElement>(null)
  // Map units per screen pixel, so strokes and labels keep a constant on-screen size.
  const [k, setK] = useState(1000 / 700)
  const labels = !mini && !!layers.ecoregions
  useEffect(() => {
    const svg = ref.current?.ownerSVGElement
    if (!svg || !labels) return
    const ro = new ResizeObserver(() => { const w = svg.getBoundingClientRect().width; if (w) setK(map.width / w) })
    ro.observe(svg)
    return () => ro.disconnect()
  }, [labels])
  const clip = `ov-clip-${id}`
  const sw = mini ? 0.6 : 1
  const fs = 10 * k
  return (
    <g ref={ref} aria-hidden="true" pointer-events="none" class="overlays">
      <defs>
        <clipPath id={clip}><path d={clipPathD()} /></clipPath>
      </defs>
      <g clip-path={`url(#${clip})`}>
        {layers.public_land?.map((s, i) => <path key={i} d={s.d} fill={LAND} fill-opacity={0.3} fill-rule="evenodd" />)}
        {layers.lakes?.map((s, i) => <path key={i} d={s.d} fill={RIVER} fill-opacity={0.35} fill-rule="evenodd" />)}
        {layers.ecoregions?.map((s) => (
          <path key={s.name} d={s.d} fill="none" stroke={ECO} stroke-width={sw} stroke-dasharray="5 3"
            vector-effect="non-scaling-stroke" stroke-linejoin="round" />
        ))}
        {layers.interstates?.map((s) => (
          <path key={s.name} d={s.d} fill="none" stroke={ROAD} stroke-width={sw} vector-effect="non-scaling-stroke"
            stroke-linejoin="round" stroke-linecap="round" />
        ))}
        {layers.rivers && (
          <g fill="none" stroke={RIVER} stroke-linejoin="round" stroke-linecap="round">
            {/* Glow: a wide translucent underlay instead of a blur filter (cheap to repaint). */}
            {!mini && layers.rivers.map((s, i) => <path key={`g${i}`} d={s.d} stroke-width={4 * sw} stroke-opacity={0.22} vector-effect="non-scaling-stroke" />)}
            {layers.rivers.map((s, i) => <path key={i} d={s.d} stroke-width={1.2 * sw} vector-effect="non-scaling-stroke" />)}
          </g>
        )}
      </g>
      {labels && layers.ecoregions && placeLabels(layers.ecoregions, fs, k).map(({ name, lines, x, y }) => (
        <text key={name} x={x} y={y} text-anchor="middle" dominant-baseline="middle" font-size={fs} font-weight="600"
          letter-spacing={0.08 * fs} fill={ECO} stroke="#000" stroke-width={3 * k} stroke-opacity={0.75} paint-order="stroke">
          {lines.map((l, i) => <tspan key={i} x={x} dy={i ? fs * 1.15 : 0}>{l}</tspan>)}
        </text>
      ))}
    </g>
  )
}

/** Toggle chips for the layers present in the data file. */
export function OverlayChips() {
  if (!AVAILABLE.length) return null
  const on = overlays.value
  const toggle = (id: OverlayId) => {
    overlays.value = on.includes(id) ? on.filter((x) => x !== id) : AVAILABLE.filter((x) => x === id || on.includes(x))
    if (!overlayData.value) void loadOverlays()
  }
  return (
    <div class="flex items-center gap-1.5 mb-2 overflow-x-auto [scrollbar-width:none] -mx-3 px-3 md:mx-0 md:px-0" role="group" aria-label="Map overlays">
      <span class="text-[11px] uppercase tracking-wide text-fg-3 shrink-0 mr-0.5">Overlays</span>
      {AVAILABLE.map((id) => {
        const pressed = on.includes(id)
        return (
          <button key={id} type="button" aria-pressed={pressed} onClick={() => toggle(id)}
            class={`shrink-0 rounded-full px-3 h-8 text-xs border inline-flex items-center gap-1.5 whitespace-nowrap ${pressed ? 'border-fg-2 bg-bg-3 text-fg' : 'border-line text-fg-2 hover:border-fg-3'}`}>
            <Swatch id={id} />{OVERLAY_META[id].label}
          </button>
        )
      })}
    </div>
  )
}

function Swatch({ id }: { id: OverlayId }) {
  const style = id === 'rivers' ? { height: 2, background: RIVER, boxShadow: `0 0 3px ${RIVER}` }
    : id === 'lakes' ? { height: 8, background: `${RIVER}59`, border: `1px solid ${RIVER}` }
    : id === 'ecoregions' ? { height: 0, borderTop: `1.5px dashed ${ECO}` }
    : id === 'interstates' ? { height: 1.5, background: ROAD }
    : { height: 8, background: `${LAND}4d`, border: `1px solid ${LAND}` }
  return <span aria-hidden="true" class="inline-block w-3.5 rounded-sm" style={style} />
}

/** One legend line for the active overlays, with their sources. */
export function OverlayLegend() {
  const active = overlays.value.filter((id) => AVAILABLE.includes(id))
  if (!active.length) return null
  const sources = [...new Set(active.map((id) => OVERLAY_META[id].source))].join(', ')
  return (
    <p class="mt-1 text-[11px] text-fg-3 flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Overlay legend">
      {active.map((id) => (
        <span key={id} class="inline-flex items-center gap-1.5"><Swatch id={id} />{OVERLAY_META[id].label}</span>
      ))}
      <span class="ml-auto">Overlays: {sources}{overlayData.value ? '' : ' · loading…'}</span>
    </p>
  )
}
