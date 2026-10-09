/** Tiny inline SVG sparkline for table cells. NaN points are skipped. */
export function Sparkline({ values, width = 56, height = 20, color = '#ff6a13', label }:
  { values: number[]; width?: number; height?: number; color?: string; label?: string }) {
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length < 2) return <svg width={width} height={height} aria-hidden="true" />
  const min = Math.min(...finite), max = Math.max(...finite)
  const span = max - min || 1
  const step = (width - 4) / Math.max(1, values.length - 1)
  const pts: string[] = []
  let last: [number, number] | null = null
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) return
    const x = 2 + i * step, y = 2 + (height - 4) * (1 - (v - min) / span)
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`)
    last = [x, y]
  })
  const end = last as [number, number] | null
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <polyline points={pts.join(' ')} fill="none" stroke={color} stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
      {end && <circle cx={end[0]} cy={end[1]} r="2" fill={color} />}
    </svg>
  )
}
