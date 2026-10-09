/** Leaderboard: sortable county ranks for the current metric + season, with a top-15 bar chart. */
import { useMemo } from 'preact/hooks'
import { formatMetric } from '../data/metrics'
import { HBarChart } from '../components/charts/BarChart'
import { seasonLabel } from '../components/charts/format'
import { LabeledSelect, MetricSelect, YearSelect } from '../components/analysis/controls'
import { BoardTable } from '../components/board/BoardTable'
import { useBoard } from '../components/board/useBoard'
import { METRICS } from '../data/metrics'
import { useEffortYear } from '../lib/yearNudge'
import { applicableMetric, filter, homeCounty, metric, metric2, selected, type Metric } from '../state/filters'
import { ds } from '../state/data'
import { yearsInRange } from '../components/map/derive'

export default function BoardView() {
  const board = useBoard()
  const sp = filter.value.species
  const region = filter.value.region
  const d = ds.value, f = filter.value
  const years = useMemo(() => (d ? yearsInRange(d, f) : []), [d, f])
  const mId = applicableMetric(metric.value, sp)
  const nudge = useEffortYear([mId, board?.def2?.id ?? ''], years)
  const bars = useMemo(() => {
    if (!board) return []
    return board.rows.slice(0, 15).map((r) => ({
      label: r.name, value: r.value, id: r.fips, highlight: r.fips === selected.value || r.fips === homeCounty.value,
    }))
  }, [board, selected.value, homeCounty.value])
  if (!board) return null
  const { def, def2, rows } = board
  const fmtV = (v: number) => formatMetric(v, def)
  const yr = board.sparkYears[board.sparkYears.length - 1]
  const scope = region ? `${region} region` : 'Missouri'

  return (
    <div class="p-3 sm:p-4 max-w-5xl mx-auto flex flex-col gap-3">
      <div class="flex flex-wrap items-end gap-3">
        <h1 class="text-lg font-semibold mr-auto">{scope} county ranks</h1>
        <MetricSelect />
        <LabeledSelect label="Compare with">
          <select class="bg-bg-3 border border-line rounded-lg px-2 text-sm text-fg min-w-0" value={def2?.id ?? ''}
            onChange={(e) => (metric2.value = (e.currentTarget as HTMLSelectElement).value as Metric | '')}>
            <option value="">None</option>
            {METRICS.filter((m) => m.species.includes(sp) && m.id !== mId).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </LabeledSelect>
        <YearSelect />
      </div>
      {nudge && <p class="text-xs text-fg-3 -mt-1" role="status">{nudge}</p>}
      <div class="flex flex-col gap-3">
        <div class="order-first lg:order-last bg-bg-2 border border-line rounded-xl p-3 min-h-[460px]">
          <HBarChart id="board-top15" bars={bars} maxBars={15} format={fmtV} units={def.units} onSelect={(id) => (selected.value = id)}
            title={`Top 15 · ${def.label} · ${yr ? seasonLabel(sp, yr) : ''}`} />
        </div>
        {rows.length
          ? <BoardTable rows={rows} def={def} def2={def2} species={sp} sparkYears={board.sparkYears} />
          : <p class="text-fg-3 text-sm p-4">No data for this metric and season under the current filters.</p>}
      </div>
    </div>
  )
}
