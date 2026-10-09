/** Global filter bar. Phone: bottom sheet within thumb reach. Desktop: rendered inline in the sidebar. */
import { useSignal } from '@preact/signals'
import { CLASS_LABEL, CLASS_ORDER, PORTION_LABEL, PORTION_ORDER, SUBTOTAL_PORTIONS } from '../data/query'
import type { Species } from '../data/types'
import { ds, regions } from '../state/data'
import { MAX_YEAR, MIN_YEAR, activeFilterCount, filter, setFilter, sheetOpen } from '../state/filters'
import { HomeCountyPicker } from './HomeCountyPicker'

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: preact.ComponentChildren; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      onClick={onClick}
      class={`tap rounded-full px-3 text-sm border transition-colors ${on ? 'bg-blaze text-black border-blaze font-semibold' : 'bg-bg-3 text-fg-2 border-line hover:border-fg-3'}`}
    >
      {children}
    </button>
  )
}

function Section({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <fieldset class="mb-3">
      <legend class="text-xs uppercase tracking-wide text-fg-3 mb-1">{label}</legend>
      <div class="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  )
}

function toggle(list: string[], v: string) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
}

export function FilterControls() {
  const f = filter.value
  const sp = f.species
  const available = new Set(ds.value?.dict.portion ?? [])
  const availableClasses = new Set(ds.value?.dict.cls ?? [])
  const showSub = useSignal(false)
  const portions = PORTION_ORDER[sp].filter((p) => available.has(p) && (showSub.value || !SUBTOTAL_PORTIONS.has(p) || f.portions.includes(p)))
  return (
    <div class="text-fg">
      <HomeCountyPicker compact />
      <Section label="Species">
        {(['deer', 'turkey'] as Species[]).map((s) => (
          <Chip key={s} on={sp === s} onClick={() => setFilter({ species: s })}>{s === 'deer' ? 'Deer' : 'Turkey'}</Chip>
        ))}
      </Section>

      <Section label={`Seasons ${f.yearFrom}–${f.yearTo}`}>
        <div class="w-full flex items-center gap-2">
          <label class="text-xs text-fg-3 w-8">From</label>
          <input type="range" class="flex-1 accent-blaze" min={MIN_YEAR[sp]} max={MAX_YEAR[sp]} value={f.yearFrom}
            aria-label="First season" onInput={(e) => { const v = +(e.currentTarget as HTMLInputElement).value; setFilter({ yearFrom: Math.min(v, f.yearTo) }) }} />
        </div>
        <div class="w-full flex items-center gap-2">
          <label class="text-xs text-fg-3 w-8">To</label>
          <input type="range" class="flex-1 accent-blaze" min={MIN_YEAR[sp]} max={MAX_YEAR[sp]} value={f.yearTo}
            aria-label="Last season" onInput={(e) => { const v = +(e.currentTarget as HTMLInputElement).value; setFilter({ yearTo: Math.max(v, f.yearFrom) }) }} />
        </div>
      </Section>

      {sp === 'turkey' && (
        <Section label="Season">
          <Chip on={f.season === ''} onClick={() => setFilter({ season: '' })}>Both</Chip>
          <Chip on={f.season === 'spring'} onClick={() => setFilter({ season: 'spring' })}>Spring</Chip>
          <Chip on={f.season === 'fall'} onClick={() => setFilter({ season: 'fall' })}>Fall</Chip>
        </Section>
      )}

      <Section label="Portion">
        <Chip on={f.portions.length === 0} onClick={() => setFilter({ portions: [] })}>All (no double counting)</Chip>
        {portions.map((p) => (
          <Chip key={p} on={f.portions.includes(p)} onClick={() => setFilter({ portions: toggle(f.portions, p) })}
            title={SUBTOTAL_PORTIONS.has(p) ? 'Subtotal: overlaps other portions' : undefined}>
            {PORTION_LABEL[p] ?? p}{SUBTOTAL_PORTIONS.has(p) ? ' ⊂' : ''}
          </Chip>
        ))}
        <button type="button" class="text-xs text-fg-3 underline min-h-0" onClick={() => (showSub.value = !showSub.value)}>
          {showSub.value ? 'hide subtotals' : 'show subtotals'}
        </button>
      </Section>

      <Section label="Method">
        <Chip on={f.method === ''} onClick={() => setFilter({ method: '' })}>Any</Chip>
        <Chip on={f.method === 'firearm'} onClick={() => setFilter({ method: 'firearm' })}>Firearms</Chip>
        <Chip on={f.method === 'archery'} onClick={() => setFilter({ method: 'archery' })}>Archery</Chip>
      </Section>

      {sp === 'deer' && (
        <Section label="Youth">
          <Chip on={f.youth === ''} onClick={() => setFilter({ youth: '' })}>Any</Chip>
          <Chip on={f.youth === 'y'} onClick={() => setFilter({ youth: 'y' })}>Youth only</Chip>
          <Chip on={f.youth === 'n'} onClick={() => setFilter({ youth: 'n' })}>Exclude youth</Chip>
        </Section>
      )}

      <Section label="Class">
        <Chip on={f.classes.length === 0} onClick={() => setFilter({ classes: [] })}>All</Chip>
        {CLASS_ORDER[sp].filter((c) => availableClasses.has(c)).map((c) => (
          <Chip key={c} on={f.classes.includes(c)} onClick={() => setFilter({ classes: toggle(f.classes, c) })}>{CLASS_LABEL[c] ?? c}</Chip>
        ))}
      </Section>

      <Section label="Region">
        <Chip on={f.region === ''} onClick={() => setFilter({ region: '' })}>Statewide</Chip>
        {regions.value.map((r) => (
          <Chip key={r} on={f.region === r} onClick={() => setFilter({ region: f.region === r ? '' : r })}>{r}</Chip>
        ))}
      </Section>

      {activeFilterCount.value > 0 && (
        <button type="button" class="tap text-sm text-blaze-2 underline"
          onClick={() => setFilter({ yearFrom: MIN_YEAR[sp], yearTo: MAX_YEAR[sp], season: '', portions: [], method: '', youth: '', classes: [], region: '' })}>
          Reset filters
        </button>
      )}
    </div>
  )
}

/** Bottom sheet wrapper (phone / tablet). */
export function FilterSheet() {
  if (!sheetOpen.value) return null
  return (
    <div class="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Filters">
      <div class="absolute inset-0 bg-black/60" onClick={() => (sheetOpen.value = false)} />
      <div class="absolute left-0 right-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-bg-2 border-t border-line p-4 pb-[calc(1rem+var(--safe-bottom))] shadow-2xl">
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-lg font-semibold">Filters</h2>
          <button type="button" class="tap px-3 rounded-lg bg-blaze text-black font-semibold" onClick={() => (sheetOpen.value = false)}>Done</button>
        </div>
        <FilterControls />
      </div>
    </div>
  )
}
