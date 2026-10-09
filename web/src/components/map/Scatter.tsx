/** County scatter for the "Compare with" metric: x = second metric, y = map metric, one dot per county, colored by
 *  MDC region, with an OLS trend line and Pearson r. Tap a dot to select the county (44px hit radius, nearest dot). */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { formatMetric, type MetricDef } from '../../data/metrics'
import type { County } from '../../data/types'
import { Credit } from '../Shell'
import { ShareButton } from '../ShareButton'
import { DataTable } from '../charts/DataTable'
import { SERIES_COLORS } from '../charts/LineChart'

interface Pt { i: number; x: number; y: number; px: number; py: number }

/** Region colors: the series palette minus the selection yellow, plus two so all 8 MDC regions differ. */
const PAL = [...SERIES_COLORS.filter((c) => c !== '#ffd166'), '#90be6d', '#5e60ce']
const H = 260, PL = 46, PR = 10, PT = 10, PB = 34, HIT = 22

/** Nice ticks: linear steps of 1/2/5 × 10^k, or powers of ten (plus 2 and 5 when the span is short) on a log axis. */
function ticks(lo: number, hi: number, log: boolean): number[] {
  if (log) {
    const a = Math.floor(Math.log10(lo)), b = Math.ceil(Math.log10(hi))
    const out: number[] = []
    for (let e = a; e <= b; e++) for (const m of b - a <= 2 ? [1, 2, 5] : [1]) { const v = m * 10 ** e; if (v >= lo && v <= hi) out.push(v) }
    return out.length >= 2 ? out : [lo, hi]
  }
  const raw = (hi - lo) / 4 || 1, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p
  const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  return out
}

function stats(xs: number[], ys: number[]) {
  const n = xs.length
  let mx = 0, my = 0
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i] }
  mx /= n; my /= n
  let sxx = 0, syy = 0, sxy = 0
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy }
  const slope = sxx > 0 ? sxy / sxx : NaN
  return { n, r: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN, slope, icpt: my - slope * mx }
}

const sig = (v: number) => (Number.isFinite(v) ? Number(v.toPrecision(3)).toLocaleString('en-US') : '–')

export function Scatter({ x, y, defX, defY, counties, regions, selected, home, onSelect, title }: {
  x: Float64Array; y: Float64Array; defX: MetricDef; defY: MetricDef; counties: County[]; regions: string[]
  selected: string; home: string; onSelect: (fips: string) => void; title: string
}) {
  const [table, setTable] = useState(false)
  const [logX, setLogX] = useState(false)
  const [logY, setLogY] = useState(false)
  const [hover, setHover] = useState<Pt | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(360)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [table])

  const raw = useMemo(() => {
    const out: number[] = []
    for (let i = 0; i < x.length; i++) if (Number.isFinite(x[i]) && Number.isFinite(y[i])) out.push(i)
    return out
  }, [x, y])
  const canLogX = raw.length > 1 && raw.every((i) => x[i] > 0), canLogY = raw.length > 1 && raw.every((i) => y[i] > 0)
  const lx = logX && canLogX, ly = logY && canLogY
  const tx = (v: number) => (lx ? Math.log10(v) : v), ty = (v: number) => (ly ? Math.log10(v) : v)

  const plot = useMemo(() => {
    if (!raw.length) return null
    const xs = raw.map((i) => x[i]), ys = raw.map((i) => y[i])
    const pad = (lo: number, hi: number) => (hi > lo ? [lo, hi] : [lo - 1, hi + 1])
    const [x0, x1] = pad(Math.min(...xs), Math.max(...xs)), [y0, y1] = pad(Math.min(...ys), Math.max(...ys))
    const [a0, a1] = [tx(x0), tx(x1)], [b0, b1] = [ty(y0), ty(y1)]
    const dx = (a1 - a0) * 0.04, dy = (b1 - b0) * 0.06
    const sx = (v: number) => PL + ((tx(v) - a0 + dx) / (a1 - a0 + 2 * dx)) * (W - PL - PR)
    const sy = (v: number) => PT + (1 - (ty(v) - b0 + dy) / (b1 - b0 + 2 * dy)) * (H - PT - PB)
    const pts: Pt[] = raw.map((i) => ({ i, x: x[i], y: y[i], px: sx(x[i]), py: sy(y[i]) }))
    const st = stats(xs.map(tx), ys.map(ty))
    // Trend line in transformed space, drawn between the x extremes.
    const inv = (t: number, log: boolean) => (log ? 10 ** t : t)
    const line = Number.isFinite(st.slope)
      ? [a0, a1].map((t) => [sx(inv(t, lx)), sy(inv(st.icpt + st.slope * t, ly))] as const)
      : null
    return { pts, st, line, sx, sy, xt: ticks(x0, x1, lx), yt: ticks(y0, y1, ly) }
  }, [raw, x, y, W, lx, ly])

  const colorOf = (i: number) => PAL[Math.max(0, regions.indexOf(counties[i]?.mdc_region ?? '')) % PAL.length]
  const nearest = (e: PointerEvent): Pt | null => {
    const svg = e.currentTarget as SVGSVGElement, r = svg.getBoundingClientRect()
    const mx = ((e.clientX - r.left) / r.width) * W, my = ((e.clientY - r.top) / r.height) * H
    let best: Pt | null = null, bd = HIT * HIT
    for (const p of plot?.pts ?? []) { const d = (p.px - mx) ** 2 + (p.py - my) ** 2; if (d <= bd) { bd = d; best = p } }
    return best
  }
  const name = (i: number) => counties[i]?.name ?? ''
  const st = plot?.st
  const head = st ? `r = ${st.n > 2 ? st.r.toFixed(2) : '–'} · r² = ${st.n > 2 ? (st.r * st.r).toFixed(2) : '–'} · n = ${st.n} · slope = ${sig(st.slope)}${lx || ly ? ' (log)' : ''}` : 'n = 0'
  const sel = plot?.pts.find((p) => counties[p.i]?.fips === selected)
  const btn = (on: boolean, ok: boolean, set: (v: boolean) => void, label: string) => (
    <button type="button" aria-pressed={on && ok} disabled={!ok} onClick={() => set(!on)} title={ok ? '' : 'Log scale needs all values above zero'}
      class={`tap rounded-lg px-2 text-xs border ${on && ok ? 'bg-blaze text-black border-blaze font-semibold' : 'border-line text-fg-2'} disabled:opacity-40`}>{label}</button>
  )

  return (
    <figure id="map-scatter" class="m-0 rounded-xl bg-bg-2 border border-line p-3 mt-3" data-share-title={`${title} · ${head}`}>
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <figcaption class="text-sm font-semibold text-fg-2 mr-auto min-w-0">
          {title}
          <span class="block text-xs font-normal text-fg tabular-nums">{head}</span>
        </figcaption>
        {btn(logX, canLogX, setLogX, 'log x')}
        {btn(logY, canLogY, setLogY, 'log y')}
        <button type="button" class="text-xs text-fg-3 underline min-h-[44px]" onClick={() => setTable(!table)} aria-pressed={table}>
          {table ? 'show chart' : 'show as table'}
        </button>
        <ShareButton target="map-scatter" />
      </div>
      {table ? (
        <DataTable columns={['County', 'Region', defX.label, defY.label]}
          rows={raw.map((i) => [name(i), counties[i]?.mdc_region ?? '', formatMetric(x[i], defX), formatMetric(y[i], defY)])} />
      ) : (
        <div ref={box} class="relative" style={{ height: `${H}px` }}>
          {plot && (
            <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} class="block w-full" role="img" style={{ height: `${H}px`, touchAction: 'pan-y' }}
              aria-label={`${title}. ${head}`}
              onPointerMove={(e) => setHover(nearest(e))} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHover(null) }}
              onClick={(e) => { const p = nearest(e as unknown as PointerEvent); setHover(p); if (p) onSelect(counties[p.i].fips) }}>
              {plot.xt.map((t) => (
                <g key={`x${t}`}>
                  <line x1={plot.sx(t)} x2={plot.sx(t)} y1={PT} y2={H - PB} stroke="#2a2a2c" />
                  <text x={plot.sx(t)} y={H - PB + 13} text-anchor="middle" font-size="10" fill="#939399">{formatMetric(t, defX)}</text>
                </g>
              ))}
              {plot.yt.map((t) => (
                <g key={`y${t}`}>
                  <line x1={PL} x2={W - PR} y1={plot.sy(t)} y2={plot.sy(t)} stroke="#2a2a2c" />
                  <text x={PL - 4} y={plot.sy(t) + 3} text-anchor="end" font-size="10" fill="#939399">{formatMetric(t, defY)}</text>
                </g>
              ))}
              <text x={(PL + W - PR) / 2} y={H - 4} text-anchor="middle" font-size="11" fill="#b5b5b8">{defX.label}{lx ? ' (log)' : ''} →</text>
              <text transform={`translate(11 ${(PT + H - PB) / 2}) rotate(-90)`} text-anchor="middle" font-size="11" fill="#b5b5b8">{defY.label}{ly ? ' (log)' : ''} →</text>
              {plot.line && <line x1={plot.line[0][0]} y1={plot.line[0][1]} x2={plot.line[1][0]} y2={plot.line[1][1]} stroke="#f2f2f2" stroke-opacity="0.6" stroke-width="1.5" stroke-dasharray="5 4" />}
              <g pointer-events="none">
                {plot.pts.map((p) => {
                  const f = counties[p.i]?.fips
                  return <circle key={p.i} cx={p.px} cy={p.py} r={3} fill={colorOf(p.i)} fill-opacity="0.85"
                    stroke={f === home ? '#fff' : 'none'} stroke-width="1.5" />
                })}
                {hover && hover !== sel && <circle cx={hover.px} cy={hover.py} r={6} fill="none" stroke="#fff" />}
                {sel && (
                  <>
                    <circle cx={sel.px} cy={sel.py} r={6} fill="#ffd166" stroke="#000" stroke-width="1.5" />
                    <text x={sel.px + (sel.px > W / 2 ? -9 : 9)} y={sel.py - 8} text-anchor={sel.px > W / 2 ? 'end' : 'start'} font-size="12" font-weight="700"
                      fill="#ffd166" stroke="#000" stroke-width="3" paint-order="stroke">{name(sel.i)}</text>
                  </>
                )}
              </g>
            </svg>
          )}
          {!plot && <p class="text-sm text-fg-3 p-4">No counties have both values for this season and filters.</p>}
          {hover && (
            <div role="status" class="pointer-events-none absolute z-10 rounded-md bg-bg-3 border border-line px-2 py-1 text-xs shadow-lg whitespace-nowrap"
              style={{ left: `${(hover.px / W) * 100}%`, top: `${hover.py}px`, transform: `translate(${hover.px > W / 2 ? 'calc(-100% - 10px)' : '10px'}, -110%)` }}>
              <div class="font-semibold">{name(hover.i)}</div>
              <div class="tabular-nums text-fg-2">x: {formatMetric(hover.x, defX)} · y: {formatMetric(hover.y, defY)}</div>
            </div>
          )}
        </div>
      )}
      <ul class="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[11px] text-fg-2" aria-label="MDC region colors">
        {regions.map((r, k) => (
          <li key={r} class="flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded-full" style={{ background: PAL[k % PAL.length] }} />{r}</li>
        ))}
      </ul>
      <Credit units={`x: ${defX.units} · y: ${defY.units}`} />
      <p class="text-[11px] text-fg-3 mt-1">Each dot is a county for the selected season and filters. Correlation is not causation; hunter density and harvest both follow land area and habitat.</p>
    </figure>
  )
}
