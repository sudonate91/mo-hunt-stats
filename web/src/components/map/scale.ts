/** Choropleth color scales: quantile classes, sequential (5 single-hue steps) or diverging centered on 0. */
import type { MetricDef } from '../../data/metrics'
import { classify, DIV_COLORS, quantileBreaks, SEQ_COLORS } from '../charts/format'

export const NODATA = '#3a3a3d'

export interface ColorClass { color: string; lo: number; hi: number }
export interface ColorScale { breaks: number[]; colors: string[]; classes: ColorClass[]; color: (v: number) => string }

const uniq = (a: number[]) => a.filter((v, i) => i === 0 || v > a[i - 1])

function collect(sets: ArrayLike<number>[]): number[] {
  const out: number[] = []
  for (const s of sets) for (let i = 0; i < s.length; i++) if (Number.isFinite(s[i])) out.push(s[i])
  return out
}

/** Build one scale over one or more value arrays (several arrays = a shared scale for small multiples). */
export function makeScale(sets: ArrayLike<number>[], def: MetricDef): ColorScale {
  const v = collect(sets)
  let breaks: number[] = []
  let colors: string[] = []
  if (!v.length) {
    colors = [NODATA]
  } else if (def.diverging) {
    const neg = v.filter((x) => x < 0), pos = v.filter((x) => x >= 0)
    if (neg.length) {
      const nb = uniq(quantileBreaks(neg, 3).filter((b) => b < 0))
      breaks.push(...nb)
      colors.push(...DIV_COLORS.slice(3 - (nb.length + 1), 3))
    }
    if (pos.length) {
      if (neg.length) breaks.push(0)
      const pb = uniq(quantileBreaks(pos, 3).filter((b) => b > 0))
      breaks.push(...pb)
      colors.push(...DIV_COLORS.slice(4, 4 + pb.length + 1))
    }
  } else {
    breaks = uniq(quantileBreaks(v, 5))
    if (breaks.length && breaks[0] <= Math.min(...v)) breaks.shift()
    const k = breaks.length + 1
    colors = Array.from({ length: k }, (_, i) => SEQ_COLORS[k === 1 ? 2 : Math.round((i * (SEQ_COLORS.length - 1)) / (k - 1))])
  }
  let min = Infinity, max = -Infinity
  for (const x of v) { if (x < min) min = x; if (x > max) max = x }
  const classes = colors.map((color, i) => ({
    color,
    lo: i === 0 ? min : breaks[i - 1],
    hi: i === colors.length - 1 ? max : breaks[i],
  }))
  return {
    breaks, colors, classes,
    color: (x: number) => (Number.isFinite(x) ? colors[Math.min(colors.length - 1, classify(x, breaks))] : NODATA),
  }
}
