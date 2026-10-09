/** Hunter-effort metrics only exist for the MDC status-report seasons; nudge the season onto one when needed. */
import { useEffect, useState } from 'preact/hooks'
import { EFFORT_METRICS, effortYearRange } from '../data/metrics'
import { year, type Metric } from '../state/filters'

/**
 * When any of `metrics` is an effort metric and the current season has no effort data, move `year` to the latest
 * effort season inside `years` (the filter range). Returns a short note to show inline ('' when nothing to say).
 */
export function useEffortYear(metrics: (Metric | '')[], years: number[]): string {
  const [note, setNote] = useState('')
  const eff = metrics.some((m) => m && EFFORT_METRICS.has(m))
  const ey = effortYearRange()
  const y = year.value
  useEffect(() => {
    if (!eff || !ey.length) { setNote(''); return }
    if (ey.includes(y)) return
    const lo = years[0] ?? -Infinity, hi = years[years.length - 1] ?? Infinity
    const t = ey.filter((e) => e >= lo && e <= hi).pop()
    const span = `Hunter data runs ${ey[0]}–${ey[ey.length - 1]}`
    if (t === undefined) { setNote(`${span}; none in the selected years`); return }
    year.value = t
    setNote(`${span}; showing ${t}`)
  }, [eff, ey, y, years])
  return eff ? note : ''
}
