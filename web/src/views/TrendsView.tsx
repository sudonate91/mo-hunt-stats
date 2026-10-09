/** Trends: the current slice by season with up to 5 county overlays, or a deer-vs-turkey index comparison. */
import { useState } from 'preact/hooks'
import { LineChart } from '../components/charts/LineChart'
import { fmt } from '../components/charts/format'
import { Segmented } from '../components/analysis/controls'
import { CountyOverlayPicker } from '../components/trends/CountyOverlayPicker'
import { useTrends, type TrendMode } from '../components/trends/useTrends'

const MODES: { id: TrendMode; label: string }[] = [
  { id: 'count', label: 'Harvest' },
  { id: 'per_sqmi', label: 'Per sq mi' },
  { id: 'index', label: 'Index' },
]

const FORMAT: Record<TrendMode, (n: number) => string> = {
  count: (n) => fmt(n),
  per_sqmi: (n) => n.toFixed(2),
  index: (n) => n.toFixed(0),
}

export default function TrendsView() {
  const [mode, setMode] = useState<TrendMode>('count')
  const [cmp, setCmp] = useState(false)
  const t = useTrends(mode, cmp)
  const effMode: TrendMode = cmp ? 'index' : mode

  return (
    <div class="p-3 sm:p-4 max-w-5xl mx-auto flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <h1 class="text-lg font-semibold mr-auto">Trends</h1>
        <Segmented label="Units" value={effMode} options={cmp ? MODES.filter((m) => m.id === 'index') : MODES} onChange={setMode} />
        <button type="button" aria-pressed={cmp} onClick={() => setCmp(!cmp)}
          class={`tap px-3 rounded-lg text-sm border ${cmp ? 'bg-blaze text-black border-blaze font-semibold' : 'bg-bg-3 text-fg-2 border-line'}`}>
          Compare species
        </button>
      </div>
      <section class="bg-bg-2 border border-line rounded-xl p-3">
        <div class="min-h-[320px]">
          {t && <LineChart x={t.x} series={t.series} units={t.units} title={t.title} height={240} format={FORMAT[effMode]} yMin={effMode === 'index' ? null : 0} />}
        </div>
        <p class="text-xs text-fg-3 min-h-[1rem] mt-1">{t?.note}</p>
      </section>
      <section class="bg-bg-2 border border-line rounded-xl p-3">
        <h2 class="text-sm font-semibold text-fg-2 mb-2">County overlays {cmp && <span class="font-normal text-fg-3">(off while comparing species)</span>}</h2>
        <CountyOverlayPicker disabled={cmp} />
      </section>
    </div>
  )
}
