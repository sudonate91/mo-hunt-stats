/** Up to 5 county overlays stored in filter.counties: type-ahead, removable chips, one-tap "add selected". */
import { PlacePicker, Chip } from '../analysis/PlacePicker'
import { countyByFips } from '../../state/data'
import { filter, selected, setFilter } from '../../state/filters'
import { OVERLAY_COLORS } from './useTrends'

export const MAX_OVERLAYS = 5

export function CountyOverlayPicker({ disabled }: { disabled?: boolean }) {
  const picked = filter.value.counties
  const sel = selected.value
  const full = picked.length >= MAX_OVERLAYS
  const add = (fips: string) => { if (!picked.includes(fips) && !full) setFilter({ counties: [...picked, fips] }) }
  const selName = sel ? countyByFips.value.get(sel)?.name : undefined
  return (
    <div class={`flex flex-col gap-2 ${disabled ? 'opacity-50 pointer-events-none' : ''}`} aria-disabled={disabled}>
      <div class="flex gap-2 items-center">
        <div class="flex-1 min-w-0">
          <PlacePicker label="Add county overlay" onPick={add} exclude={picked} disabled={full || disabled}
            placeholder={full ? `Max ${MAX_OVERLAYS} counties` : 'Overlay a county…'} />
        </div>
        {selName && !picked.includes(sel) && !full && (
          <button type="button" class="tap shrink-0 px-3 rounded-lg border border-sel text-sel text-sm" onClick={() => add(sel)}>
            + {selName}
          </button>
        )}
      </div>
      {picked.length > 0 && (
        <div class="flex flex-wrap gap-2">
          {picked.map((f, k) => (
            <Chip key={f} label={countyByFips.value.get(f)?.name ?? f} color={OVERLAY_COLORS[k]}
              onRemove={() => setFilter({ counties: picked.filter((x) => x !== f) })} />
          ))}
          <button type="button" class="tap px-2 text-xs text-fg-3 underline" onClick={() => setFilter({ counties: [] })}>clear</button>
        </div>
      )}
    </div>
  )
}
