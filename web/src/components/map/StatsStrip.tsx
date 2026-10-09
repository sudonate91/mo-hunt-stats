/** Compact one-line summary above the map: total harvest, counties reporting, top county for the metric. */
import { formatMetric, type MetricDef } from '../../data/metrics'

export interface StripData { total: number; reporting: number; of: number; topName: string; topValue: number; season: string; scope: string }

export function StatsStrip({ s, def, onTop }: { s: StripData; def: MetricDef; onTop?: () => void }) {
  const cell = 'min-w-0 rounded-lg bg-bg-2 border border-line px-2 py-1.5 h-[60px] flex flex-col justify-center'
  return (
    <div class="grid grid-cols-3 gap-2 mb-2 text-left">
      <div class={cell}>
        <div class="text-[11px] text-fg-3 truncate">{s.scope}</div>
        <div class="font-semibold tabular-nums leading-tight">{s.total.toLocaleString('en-US')}</div>
        <div class="text-[11px] text-fg-3 truncate">animals checked</div>
      </div>
      <div class={cell}>
        <div class="text-[11px] text-fg-3 truncate">Counties</div>
        <div class="font-semibold tabular-nums leading-tight">{s.reporting}</div>
        <div class="text-[11px] text-fg-3 truncate">of {s.of} reporting</div>
      </div>
      <button type="button" class={`${cell} text-left hover:border-fg-3`} onClick={onTop} disabled={!s.topName}
        aria-label={s.topName ? `Top county ${s.topName}, ${formatMetric(s.topValue, def)}. Select it.` : 'No top county'}>
        <span class="block text-[11px] text-fg-3 truncate">Top county</span>
        <span class="block font-semibold leading-tight truncate">{s.topName || '–'}</span>
        <span class="block text-[11px] text-fg-3 truncate tabular-nums">{formatMetric(s.topValue, def)} {def.id === 'count' ? 'checked' : ''}</span>
      </button>
    </div>
  )
}
