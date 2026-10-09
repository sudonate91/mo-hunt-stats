/** Hand-built SVG bars: horizontal ranked bars or stacked bars by category. Tap/hover tooltip, table toggle. */
import { useState } from 'preact/hooks'
import { Credit } from '../Shell'
import { ShareButton } from '../ShareButton'
import { DataTable } from './DataTable'
import { fmt } from './format'
import { SERIES_COLORS } from './LineChart'

export interface Bar { label: string; value: number; id?: string; highlight?: boolean; sub?: string }

/** Horizontal ranked bars, e.g. leaderboard or portion mix. */
export function HBarChart({ bars, units, title, onSelect, maxBars = 15, id, format = fmt }:
  { bars: Bar[]; units?: string; title?: string; onSelect?: (id: string) => void; maxBars?: number; id?: string; format?: (v: number) => string }) {
  const [table, setTable] = useState(false)
  const shown = bars.slice(0, maxBars)
  const max = Math.max(1, ...shown.map((b) => b.value))
  const rowH = 26, labelW = 110
  const h = shown.length * rowH + 4
  return (
    <figure class="m-0" id={id} data-share-title={title}>
      <div class="flex items-center justify-between">
        {title && <figcaption class="text-sm font-semibold text-fg-2">{title}</figcaption>}
        <button type="button" class="text-xs text-fg-3 underline min-h-[32px] ml-auto" onClick={() => setTable(!table)} aria-pressed={table}>
          {table ? 'show chart' : 'show as table'}
        </button>
        {id && <ShareButton target={id} />}
      </div>
      {table ? (
        <DataTable columns={['#', 'Name', units ?? 'Value']} rows={shown.map((b, i) => [i + 1, b.label, format(b.value)])} />
      ) : (
        <svg viewBox={`0 0 400 ${h}`} class="w-full" style={{ height: `${h}px` }} role="img" aria-label={title}>
          {shown.map((b, i) => {
            const w = ((400 - labelW - 60) * b.value) / max
            return (
              <g key={b.id ?? b.label} transform={`translate(0,${i * rowH + 2})`} class={onSelect ? 'cursor-pointer' : ''}
                onClick={() => b.id && onSelect?.(b.id)}>
                <title>{`${b.label}: ${format(b.value)}${b.sub ? ` (${b.sub})` : ''}`}</title>
                <rect x="0" y="0" width="400" height={rowH - 2} fill="transparent" />
                <text x={labelW - 6} y={rowH / 2 + 3} text-anchor="end" font-size="12" fill={b.highlight ? '#ffd166' : '#b5b5b8'}>{b.label}</text>
                <rect x={labelW} y="4" width={Math.max(1, w)} height={rowH - 10} rx="3" fill={b.highlight ? '#ffd166' : '#ff6a13'} />
                <text x={labelW + w + 6} y={rowH / 2 + 3} font-size="12" fill="#f2f2f2">{format(b.value)}{b.sub ? <tspan fill="#7d7d82"> {b.sub}</tspan> : null}</text>
              </g>
            )
          })}
        </svg>
      )}
      <Credit units={units} />
    </figure>
  )
}

export interface StackedGroup { label: string; parts: Record<string, number> }

/** Vertical stacked bars, one bar per group (e.g. per season), stacked by category (e.g. portion). */
export function StackedBarChart({ groups, categories, units, title, colors, id, height = 220 }:
  { groups: StackedGroup[]; categories: { key: string; label: string }[]; units?: string; title?: string; colors?: string[]; id?: string; height?: number }) {
  const [table, setTable] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const totals = groups.map((g) => categories.reduce((s, c) => s + (g.parts[c.key] ?? 0), 0))
  const max = Math.max(1, ...totals)
  const W = 400, H = height, padL = 44, padB = 22, padT = 8
  const bw = (W - padL - 8) / groups.length
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max)
  const pal = colors ?? SERIES_COLORS
  const col = (i: number) => pal[i % pal.length]
  return (
    <figure class="m-0" id={id} data-share-title={title}>
      <div class="flex items-center justify-between">
        {title && <figcaption class="text-sm font-semibold text-fg-2">{title}</figcaption>}
        <button type="button" class="text-xs text-fg-3 underline min-h-[32px] ml-auto" onClick={() => setTable(!table)} aria-pressed={table}>
          {table ? 'show chart' : 'show as table'}
        </button>
        {id && <ShareButton target={id} />}
      </div>
      {table ? (
        <DataTable columns={['Group', ...categories.map((c) => c.label), 'Total']}
          rows={groups.map((g, i) => [g.label, ...categories.map((c) => fmt(g.parts[c.key] ?? 0)), fmt(totals[i])])} />
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} class="w-full" style={{ height: `${H}px` }} role="img" aria-label={title}>
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - 8} y1={y(max * t)} y2={y(max * t)} stroke="#2a2a2c" />
                <text x={padL - 4} y={y(max * t) + 4} text-anchor="end" font-size="10" fill="#7d7d82">{fmt(max * t)}</text>
              </g>
            ))}
            {groups.map((g, gi) => {
              let acc = 0
              return (
                <g key={g.label}>
                  {categories.map((c, ci) => {
                    const v = g.parts[c.key] ?? 0
                    if (!v) return null
                    const y1 = y(acc + v), y0 = y(acc)
                    acc += v
                    return (
                      <rect key={c.key} x={padL + gi * bw + bw * 0.15} y={y1} width={bw * 0.7} height={Math.max(0.5, y0 - y1)}
                        fill={col(ci)} opacity={active && active !== c.key ? 0.3 : 1}
                        onClick={() => setActive(active === c.key ? null : c.key)}>
                        <title>{`${g.label} · ${c.label}: ${fmt(v)}`}</title>
                      </rect>
                    )
                  })}
                  <text x={padL + gi * bw + bw / 2} y={H - 6} text-anchor="middle" font-size="10" fill="#b5b5b8">{g.label}</text>
                </g>
              )
            })}
          </svg>
          <ul class="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-fg-2">
            {categories.map((c, ci) => (
              <li key={c.key} class="flex items-center gap-1 cursor-pointer" onClick={() => setActive(active === c.key ? null : c.key)}>
                <span class="inline-block w-3 h-3 rounded-sm" style={{ background: col(ci), opacity: active && active !== c.key ? 0.3 : 1 }} />{c.label}
              </li>
            ))}
          </ul>
        </>
      )}
      <Credit units={units} />
    </figure>
  )
}
