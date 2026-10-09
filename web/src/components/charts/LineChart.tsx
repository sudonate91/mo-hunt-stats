/** uPlot line chart wrapper: dark theme, resizes to container, touch tooltip via legend, "show as table" toggle. */
import { useEffect, useRef, useState } from 'preact/hooks'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { Credit } from '../Shell'
import { ShareButton } from '../ShareButton'
import { DataTable } from './DataTable'
import { fmt } from './format'

export interface LineSeries { label: string; values: (number | null)[]; color?: string; dash?: number[]; axis?: 'right' }

export const SERIES_COLORS = ['#ff6a13', '#4cc9f0', '#ffd166', '#06d6a0', '#ef476f', '#b388ff', '#c0c0c0']

export function LineChart({ x, series, units, title, height = 220, id, yMin = 0, format = fmt }:
  { x: number[]; series: LineSeries[]; units?: string; title?: string; height?: number; id?: string; yMin?: number | null; format?: (n: number) => string }) {
  const box = useRef<HTMLDivElement>(null)
  const plot = useRef<uPlot | null>(null)
  const [table, setTable] = useState(false)

  useEffect(() => {
    if (table || !box.current) return
    const el = box.current
    const right = series.some((s) => s.axis === 'right')
    const range = (_u: uPlot, min: number, max: number): uPlot.Range.MinMax => [yMin ?? min, max === 0 ? 1 : max * 1.05]
    const opts: uPlot.Options = {
      width: el.clientWidth, height,
      scales: { x: { time: false }, y: { range }, ...(right ? { y2: { range } } : {}) },
      axes: [
        { stroke: '#b5b5b8', grid: { stroke: '#2a2a2c' }, ticks: { stroke: '#343436' }, incrs: [1, 2, 5, 10], values: (_u, v) => v.map((n) => String(n)), font: '12px system-ui' },
        { stroke: '#b5b5b8', grid: { stroke: '#2a2a2c' }, ticks: { stroke: '#343436' }, values: (_u, v) => v.map((n) => format(n)), size: 56, font: '12px system-ui' },
        ...(right ? [{ scale: 'y2', side: 1, stroke: '#4cc9f0', grid: { show: false }, ticks: { stroke: '#343436' }, values: (_u: uPlot, v: number[]) => v.map((n) => format(n)), size: 52, font: '12px system-ui' }] : []),
      ],
      legend: { show: true, live: true },
      cursor: { drag: { x: false, y: false }, points: { size: 8 } },
      series: [
        { label: 'Season' },
        ...series.map((s, i) => ({ label: s.label, scale: s.axis === 'right' ? 'y2' : 'y', stroke: s.color ?? SERIES_COLORS[i % SERIES_COLORS.length], width: 2, dash: s.dash, points: { show: x.length <= 15 }, value: (_u: uPlot, v: number | null) => (v == null ? '–' : format(v)) })),
      ],
    }
    plot.current?.destroy()
    plot.current = new uPlot(opts, [x, ...series.map((s) => s.values)], el)
    const ro = new ResizeObserver(() => plot.current?.setSize({ width: el.clientWidth, height }))
    ro.observe(el)
    return () => { ro.disconnect(); plot.current?.destroy(); plot.current = null }
  }, [x, series, height, table, yMin, format])

  return (
    <figure class="m-0" id={id} data-share-title={title}>
      <div class="flex items-center justify-between">
        {title && <figcaption class="text-sm font-semibold text-fg-2">{title}</figcaption>}
        <button type="button" class="text-xs text-fg-3 underline min-h-[32px] ml-auto" onClick={() => setTable(!table)} aria-pressed={table}>
          {table ? 'show chart' : 'show as table'}
        </button>
        {id && <ShareButton target={id} />}
      </div>
      {table
        ? <DataTable columns={['Season', ...series.map((s) => s.label)]} rows={x.map((xv, i) => [xv, ...series.map((s) => (s.values[i] == null ? '–' : format(s.values[i] as number)))])} />
        : <div ref={box} style={{ minHeight: `${height}px` }} class="w-full" />}
      <Credit units={units} />
    </figure>
  )
}
