/** Proportional bubbles for the "Compare with" metric: area ∝ |value| (sqrt scaling), drawn at each county's label point.
 *  Negative values (diverging metrics) are hollow and dashed; NaN draws nothing. Never intercepts pointer events. */
import { formatMetric, type MetricDef } from '../../data/metrics'

export const R_MIN = 2, R_MAX = 22 // radius in map viewBox units (1000 wide)

export interface BubbleScale { max: number; r: (v: number) => number }

export function makeBubbleScale(sets: ArrayLike<number>[]): BubbleScale {
  let max = 0
  for (const s of sets) for (let i = 0; i < s.length; i++) { const a = Math.abs(s[i]); if (a > max && Number.isFinite(a)) max = a }
  return { max, r: (v) => (Number.isFinite(v) && max > 0 ? Math.max(R_MIN, R_MAX * Math.sqrt(Math.abs(v) / max)) : 0) }
}

export interface BubbleLayer { values: Float64Array; def: MetricDef; scale: BubbleScale }

/** One circle per county (values in ds.dict.county order), biggest first so small ones stay visible on top. */
export function Bubbles({ layer, order, labels, mini }: { layer: BubbleLayer; order: string[]; labels: Record<string, [number, number]>; mini?: boolean }) {
  const k = mini ? 0.8 : 1
  const pts: [number, number, number, boolean][] = []
  order.forEach((f, i) => {
    const v = layer.values[i], p = labels[f], r = layer.scale.r(v) * k
    if (p && r > 0) pts.push([p[0], p[1], r, v < 0])
  })
  pts.sort((a, b) => b[2] - a[2])
  return (
    <g aria-hidden="true" pointer-events="none" stroke="#ffffff" stroke-opacity="0.7" stroke-width={mini ? 2 : 1.5}>
      {pts.map(([x, y, r, neg], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill={neg ? 'none' : '#4cc9f0'} fill-opacity="0.35" stroke-dasharray={neg ? '4 3' : undefined} />
      ))}
    </g>
  )
}

/** Bubble size key at true map scale (cqw units follow the legend width, which matches the map width). */
export function BubbleKey({ layer }: { layer: BubbleLayer }) {
  const { max } = layer.scale
  if (!(max > 0)) return null
  const refs = [max, max / 4, max / 25]
  return (
    <div class="mt-1 text-[11px] text-fg-3" style={{ containerType: 'inline-size' }}>
      <div class="flex items-center flex-wrap gap-x-3 gap-y-1">
        <span class="text-fg-2">Bubbles: {layer.def.label}</span>
        {refs.map((v) => {
          const r = layer.scale.r(v), s = 2 * r + 2
          return (
            <span key={v} class="inline-flex items-center gap-1 tabular-nums">
              <svg viewBox={`0 0 ${s} ${s}`} style={{ width: `${s / 10}cqw`, height: `${s / 10}cqw`, minWidth: '4px', minHeight: '4px' }} aria-hidden="true">
                <circle cx={s / 2} cy={s / 2} r={r} fill="#4cc9f0" fill-opacity="0.35" stroke="#fff" stroke-opacity="0.7" stroke-width="1.5" />
              </svg>
              {formatMetric(layer.def.diverging ? Math.abs(v) : v, layer.def)}
            </span>
          )
        })}
        {layer.def.diverging && (
          <span class="inline-flex items-center gap-1">
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="none" stroke="#fff" stroke-opacity="0.7" stroke-dasharray="3 2" /></svg>
            negative
          </span>
        )}
      </div>
      <p class="mt-0.5">Bubble size: {layer.def.units}</p>
    </div>
  )
}
