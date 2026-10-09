export function fmt(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return '–'
  if (Math.abs(n) >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return n.toLocaleString('en-US', { maximumFractionDigits: digits })
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '–'
  return `${(n * 100).toFixed(digits)}%`
}

export function signed(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return '–'
  return (n > 0 ? '+' : '') + fmt(n, digits)
}

export function seasonLabel(species: string, year: number): string {
  return species === 'deer' ? `${year}-${String(year + 1).slice(2)}` : String(year)
}

/** Colorblind-safe sequential scale (viridis-like, 7 stops) for choropleths. */
export const SEQ_COLORS = ['#440154', '#443983', '#31688e', '#21918c', '#35b779', '#90d743', '#fde725']
/** Diverging scale for change metrics (blue → grey → orange). */
export const DIV_COLORS = ['#2166ac', '#67a9cf', '#d1e5f0', '#5a5a5e', '#fddbc7', '#ef8a62', '#ff6a13']

export function quantize(value: number, min: number, max: number, colors: string[] = SEQ_COLORS): string {
  if (!Number.isFinite(value) || max <= min) return colors[0]
  const t = (value - min) / (max - min)
  return colors[Math.min(colors.length - 1, Math.max(0, Math.floor(t * colors.length)))]
}

/** Equal-count (quantile) breaks for n classes over sorted values. */
export function quantileBreaks(values: number[], n: number): number[] {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return []
  return Array.from({ length: n - 1 }, (_, i) => v[Math.floor(((i + 1) * v.length) / n)])
}

export function classify(value: number, breaks: number[]): number {
  let i = 0
  while (i < breaks.length && value >= breaks[i]) i++
  return i
}
