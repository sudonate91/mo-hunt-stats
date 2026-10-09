/** Map legend: one swatch per class with its value range, a "No data" swatch, units and the MDC credit.
 *  Classes run in order along one row (a continuous color bar, low → high) so neighbours are never read out of order;
 *  always renders 7 slots so the height never changes with the number of classes. */
import { formatMetric, type MetricDef } from '../../data/metrics'
import { Credit } from '../Shell'
import { NODATA, type ColorScale } from './scale'

export function MapLegend({ scale, def }: { scale: ColorScale; def: MetricDef }) {
  const slots = Array.from({ length: 7 }, (_, i) => scale.classes[i] ?? null)
  return (
    <div class="mt-2" aria-label={`Legend: ${def.label}`}>
      <div class="flex items-end gap-3 text-[11px] text-fg-2 tabular-nums">
        <ol class="flex flex-1 min-w-0" aria-label="Classes, low to high">
          {slots.map((c, i) => (
            <li key={i} class={`flex-1 min-w-0 ${c ? '' : 'hidden'}`}>
              <div class="h-3 first:rounded-l-sm last:rounded-r-sm" style={{ background: c?.color }} />
              <div class="h-8 pt-0.5 pr-1 leading-tight text-[10px] sm:text-[11px] text-fg-3">
                {c ? (c.lo === c.hi ? formatMetric(c.lo, def) : `${formatMetric(c.lo, def)} – ${formatMetric(c.hi, def)}`) : ''}
              </div>
            </li>
          ))}
        </ol>
        <div class="shrink-0">
          <div class="h-3 w-6 rounded-sm border border-line"
            style={{ background: `repeating-linear-gradient(45deg, ${NODATA} 0 2px, #1c1c1e 2px 4px)` }} />
          <div class="h-8 pt-0.5 text-[10px] sm:text-[11px] text-fg-3">No data</div>
        </div>
      </div>
      <Credit units={def.units} />
    </div>
  )
}
