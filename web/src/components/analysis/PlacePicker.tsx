/** Type-ahead over county names (and optionally MDC regions). Emits a fips or `region:<name>` key. */
import { useMemo, useRef, useState } from 'preact/hooks'
import { counties, regions } from '../../state/data'

interface Option { key: string; label: string; sub: string }

export function PlacePicker({ onPick, placeholder = 'Add a county…', withRegions = false, exclude = [], label, disabled }:
  { onPick: (key: string) => void; placeholder?: string; withRegions?: boolean; exclude?: string[]; label: string; disabled?: boolean }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const all = useMemo<Option[]>(() => {
    const cs = (counties.value ?? []).map((c) => ({ key: c.fips, label: c.name, sub: c.mdc_region }))
    const rs = withRegions ? regions.value.map((r) => ({ key: `region:${r}`, label: r, sub: 'Region' })) : []
    return [...rs, ...cs]
  }, [counties.value, regions.value, withRegions])

  const ql = q.trim().toLowerCase()
  const matches = all
    .filter((o) => !exclude.includes(o.key) && (!ql || o.label.toLowerCase().includes(ql)))
    .sort((a, b) => Number(!a.label.toLowerCase().startsWith(ql)) - Number(!b.label.toLowerCase().startsWith(ql)))
    .slice(0, 8)

  const pick = (o: Option) => {
    onPick(o.key)
    setQ('')
    setOpen(false)
    input.current?.blur()
  }

  return (
    <div class="relative w-full">
      <input ref={input} type="search" value={q} placeholder={placeholder} aria-label={label} disabled={disabled}
        role="combobox" aria-expanded={open} aria-autocomplete="list" autocomplete="off"
        class="w-full h-11 bg-bg-3 border border-line rounded-lg px-3 text-sm text-fg placeholder:text-fg-3 disabled:opacity-50"
        onInput={(e) => { setQ((e.currentTarget as HTMLInputElement).value); setOpen(true); setHi(0) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi(Math.min(hi + 1, matches.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(Math.max(hi - 1, 0)) }
          else if (e.key === 'Enter' && matches[hi]) { e.preventDefault(); pick(matches[hi]) }
          else if (e.key === 'Escape') setOpen(false)
        }} />
      {open && matches.length > 0 && (
        <ul role="listbox" class="absolute z-20 left-0 right-0 mt-1 bg-bg-2 border border-line rounded-lg shadow-xl max-h-80 overflow-y-auto">
          {matches.map((o, i) => (
            <li key={o.key} role="option" aria-selected={i === hi}>
              <button type="button" class={`tap w-full text-left px-3 flex items-center justify-between text-sm ${i === hi ? 'bg-bg-3' : ''}`}
                onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)}>
                <span>{o.label}</span><span class="text-xs text-fg-3">{o.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Chip({ label, onRemove, color }: { label: string; onRemove: () => void; color?: string }) {
  return (
    <button type="button" onClick={onRemove} aria-label={`Remove ${label}`}
      class="tap inline-flex items-center gap-2 rounded-full px-3 text-sm bg-bg-3 border border-line text-fg hover:border-fg-3">
      {color && <span class="inline-block w-3 h-3 rounded-full" style={{ background: color }} />}
      {label}<span aria-hidden="true" class="text-fg-3">×</span>
    </button>
  )
}
