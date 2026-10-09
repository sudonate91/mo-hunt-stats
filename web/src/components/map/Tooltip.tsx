/** Floating map tooltip. Lives in its own component so hover updates do not re-render the county paths. */
import type { Signal } from '@preact/signals'

export interface HoverState { fips: string; x: number; y: number; flip: boolean; text: string; sub: string }

export function MapTooltip({ hover }: { hover: Signal<HoverState | null> }) {
  const h = hover.value
  if (!h) return null
  return (
    <div role="status" class="pointer-events-none absolute z-10 rounded-md bg-bg-2/95 border border-line px-2 py-1 text-xs shadow-lg whitespace-nowrap"
      style={{ left: `${h.x}px`, top: `${h.y}px`, transform: `translate(${h.flip ? '-100%' : '0'}, -120%)` }}>
      <div class="font-semibold text-fg">{h.text}</div>
      <div class="text-fg-2 tabular-nums">{h.sub}</div>
    </div>
  )
}
