/** Sortable leaderboard table. Rows are 44px; home county pinned on top; tap a row to select the county. */
import { useMemo, useState } from 'preact/hooks'
import { formatMetric, type MetricDef } from '../../data/metrics'
import { pct, seasonLabel } from '../charts/format'
import { homeCounty, selected } from '../../state/filters'
import type { BoardRow } from './useBoard'
import { Sparkline } from './Sparkline'

type SortKey = 'rank' | 'name' | 'value' | 'value2' | 'delta'

function Delta({ d }: { d: number | null }) {
  if (d == null || d === 0) return <span class="text-fg-3">–</span>
  return d > 0
    ? <span class="text-emerald-400" title={`Up ${d} places vs last season`}>↑{d}</span>
    : <span class="text-red-400" title={`Down ${-d} places vs last season`}>↓{-d}</span>
}

function Row({ r, def, def2, showShare, pinned }: { r: BoardRow; def: MetricDef; def2: MetricDef | null; showShare: boolean; pinned?: boolean }) {
  const isSel = selected.value === r.fips
  const isHome = homeCounty.value === r.fips
  const bg = pinned ? 'bg-blaze-dim/40' : isSel ? 'bg-sel/15' : 'odd:bg-bg-2'
  return (
    <tr class={`h-11 cursor-pointer border-b border-line/50 ${bg} ${isSel ? 'outline outline-1 outline-sel -outline-offset-1' : ''}`}
      onClick={() => (selected.value = r.fips)}>
      <td class="pl-2 pr-1 tabular-nums text-fg-2 text-right w-8">{r.rank}</td>
      <td class="px-1 min-w-0">
        <button type="button" class="text-left w-full min-h-[44px] flex flex-col justify-center leading-tight"
          aria-pressed={isSel} onClick={(e) => { e.stopPropagation(); selected.value = r.fips }}>
          <span class={`truncate ${isSel ? 'text-sel font-semibold' : ''}`}>
            {r.name}{isHome && <span class="ml-1 text-[10px] uppercase text-blaze-2">{pinned ? 'Home' : '· home'}</span>}
          </span>
          <span class="text-[11px] text-fg-3 truncate">{r.region}</span>
        </button>
      </td>
      <td class="px-1 text-right tabular-nums">
        <div>{formatMetric(r.value, def)}</div>
        {showShare && <div class="sm:hidden text-[11px] text-fg-3">{pct(r.share)}</div>}
      </td>
      {def2 && <td class="px-1 text-right tabular-nums text-[#4cc9f0]">{formatMetric(r.value2, def2)}</td>}
      <td class="px-1 text-center tabular-nums text-sm w-10"><Delta d={r.delta} /></td>
      <td class={`px-1 w-[60px] ${def2 ? 'hidden sm:table-cell' : ''}`}><Sparkline values={r.spark} label={`${r.name} harvest, last ${r.spark.length} seasons`} /></td>
      {showShare && <td class="hidden sm:table-cell px-2 text-right tabular-nums text-fg-2">{pct(r.share)}</td>}
    </tr>
  )
}

export function BoardTable({ rows, def, def2 = null, species, sparkYears }: { rows: BoardRow[]; def: MetricDef; def2?: MetricDef | null; species: string; sparkYears: number[] }) {
  const [key, setKey] = useState<SortKey>('rank')
  const [asc, setAsc] = useState(true)
  const sorted = useMemo(() => {
    const s = [...rows]
    const dir = asc ? 1 : -1
    s.sort((a, b) => {
      switch (key) {
        case 'name': return dir * a.name.localeCompare(b.name)
        case 'value': return dir * (a.value - b.value)
        case 'value2': return Number.isFinite(a.value2) ? (Number.isFinite(b.value2) ? dir * (a.value2 - b.value2) : -1) : (Number.isFinite(b.value2) ? 1 : 0)
        case 'delta': return dir * ((a.delta ?? -1e9) - (b.delta ?? -1e9))
        default: return dir * ((a.rank || 1e9) - (b.rank || 1e9)) // unranked (0) always last
      }
    })
    return s
  }, [rows, key, asc])
  const home = rows.find((r) => r.fips === homeCounty.value)
  const showShare = def.id === 'count'

  const sortBy = (k: SortKey) => {
    if (k === key) setAsc(!asc)
    else { setKey(k); setAsc(k === 'rank' || k === 'name') }
  }
  const th = (k: SortKey, label: string, cls: string) => (
    <th key={k} class={`px-1 font-semibold ${cls}`} aria-sort={key === k ? (asc ? 'ascending' : 'descending') : 'none'}>
      <button type="button" class={`tap w-full ${def2 && k.startsWith('value') ? 'text-[10px] leading-tight break-words' : ''} ${key === k ? 'text-blaze' : ''}`} title={label} onClick={() => sortBy(k)}>
        {label}{key === k ? (asc ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  )
  const span = sparkYears.length ? `${seasonLabel(species, sparkYears[0])}–${seasonLabel(species, sparkYears[sparkYears.length - 1])}` : ''

  return (
    <div class="border border-line rounded-xl overflow-clip">
      <table class="w-full text-sm table-fixed">
        <thead class="sticky top-0 z-10 bg-bg-3 text-xs text-fg-2">
          <tr>
            {th('rank', '#', 'text-right w-9')}
            {th('name', 'County', 'text-left')}
            {th('value', def2 ? def.label : def.id === 'count' ? 'Harvest' : 'Value', 'text-right w-[88px]')}
            {def2 && th('value2', def2.label, 'text-right w-[80px] text-[#4cc9f0]')}
            {th('delta', 'Δ', 'text-center w-11')}
            <th class={`px-1 font-normal text-[10px] text-fg-3 w-[62px] ${def2 ? 'hidden sm:table-cell' : ''}`} title={`Harvest, last ${sparkYears.length} seasons`}>trend</th>
            {showShare && <th class="hidden sm:table-cell px-2 text-right font-semibold w-16">Share</th>}
          </tr>
        </thead>
        <tbody>
          {home && <Row r={home} def={def} def2={def2} showShare={showShare} pinned />}
          {sorted.map((r) => <Row key={r.fips} r={r} def={def} def2={def2} showShare={showShare} />)}
        </tbody>
      </table>
      <p class="text-[11px] text-fg-3 px-2 py-1 flex justify-between gap-2 bg-bg-2">
        <span>{def.units}.{def2 ? ` ${def2.label}: ${def2.units}.` : ''} Δ = rank change vs last season. Trend = harvest {span}.{showShare ? ' Share = % of statewide harvest.' : ''}</span>
        <span class="shrink-0">Source: MDC</span>
      </p>
    </div>
  )
}
