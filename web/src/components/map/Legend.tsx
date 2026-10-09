/** Map legend: one swatch per class with its value range, a "No data" swatch, units and the MDC credit.
 *  Always renders 8 slots so the height never changes with the number of classes. */
import { formatMetric, type MetricDef } from '../../data/metrics'
import { Credit } from '../Shell'
import { NODATA, type ColorScale } from './scale'

export function MapLegend({ scale, def }: { scale: ColorScale; def: MetricDef }) {
  const slots = Array.from({ length: 7 }, (_, i) => scale.classes[i] ?? null)
  return (
    <div class="mt-2" aria-label={`Legend: ${def.label}`}>
      <ul class="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-0.5 text-[11px] text-fg-2 tabular-nums">
        {slots.map((c, i) => (
          <li key={i} class={`flex items-center gap-1.5 h-4 ${c ? '' : 'invisible'}`} aria-hidden={c ? undefined : true}>
            <span class="inline-block w-3 h-3 rounded-sm shrink-0" style={{ background: c?.color }} />
            {c ? (c.lo === c.hi ? formatMetric(c.lo, def) : `${formatMetric(c.lo, def)} – ${formatMetric(c.hi, def)}`) : '–'}
          </li>
        ))}
        <li class="flex items-center gap-1.5 h-4">
          <span class="inline-block w-3 h-3 rounded-sm shrink-0 border border-line"
            style={{ background: `repeating-linear-gradient(45deg, ${NODATA} 0 2px, #1c1c1e 2px 4px)` }} />
          No data
        </li>
      </ul>
      <Credit units={def.units} />
    </div>
  )
}
