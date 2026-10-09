/** Type-ahead picker for the home county (saved on this device via the homeCounty signal). */
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import { counties, countyByFips } from '../state/data'
import { homeCounty } from '../state/filters'
import { Icon } from './Icon'

const norm = (s: string) => s.toLowerCase().replace(/\bst\.?\s/g, 'saint ').replace(/[^a-z ]/g, '')

export function HomeCountyPicker({ compact = false }: { compact?: boolean }) {
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (editing) input.current?.focus() }, [editing])
  const id = useId() // FilterControls renders twice (hidden sidebar + sheet), so ids must be unique
  const all = counties.value ?? []
  const home = countyByFips.value.get(homeCounty.value)

  if (home && !editing) {
    return (
      <div class={`flex items-center gap-2 ${compact ? 'mb-3' : ''}`}>
        <Icon name="home" size={18} />
        <span class="text-sm">Home county: <strong class="text-blaze-2">{home.name}</strong></span>
        <button type="button" class="tap text-xs text-fg-3 underline ml-auto" onClick={() => setEditing(true)}>change</button>
        <button type="button" class="tap text-xs text-fg-3 underline" onClick={() => { homeCounty.value = ''; setQ('') }}>clear</button>
      </div>
    )
  }

  const nq = norm(q.trim())
  const matches = nq
    ? all.filter((c) => norm(c.name).startsWith(nq)).concat(all.filter((c) => !norm(c.name).startsWith(nq) && norm(c.name).includes(nq))).slice(0, 6)
    : []
  const pick = (fips: string) => { homeCounty.value = fips; setQ(''); setEditing(false) }

  return (
    <div class={compact ? 'mb-3' : ''}>
      <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1" for={id}>Home county</label>
      <div class="relative">
        <input ref={input} id={id} type="search" autocomplete="off" placeholder="Type a county, e.g. Franklin"
          class="w-full min-h-[44px] rounded-lg border border-line bg-bg-3 px-3 text-sm text-fg placeholder:text-fg-3 focus:outline-none focus:border-blaze"
          value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) pick(matches[0].fips); if (e.key === 'Escape') setEditing(false) }}
          role="combobox" aria-expanded={matches.length > 0} aria-controls={`${id}-list`} aria-autocomplete="list" />
        {matches.length > 0 && (
          <ul id={`${id}-list`} role="listbox" class="absolute z-30 left-0 right-0 mt-1 rounded-lg border border-line bg-bg-3 shadow-xl overflow-hidden">
            {matches.map((c) => (
              <li key={c.fips} role="option" aria-selected={false}>
                <button type="button" class="w-full min-h-[44px] px-3 text-left text-sm hover:bg-bg-2 flex justify-between" onClick={() => pick(c.fips)}>
                  <span>{c.name}</span><span class="text-fg-3 text-xs">{c.mdc_region}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!compact && <p class="text-[11px] text-fg-3 mt-1">Saved on this device only. Your county is highlighted on the map and pinned in fact cards.</p>}
    </div>
  )
}
