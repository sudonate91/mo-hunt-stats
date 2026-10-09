/** Full-page county dashboard: sticky type-ahead search, home county shortcut, locator map and the county card. */
import { useMemo, useState } from 'preact/hooks'
import { Choropleth } from '../components/Choropleth'
import { CountyCard } from '../components/CountyCard'
import { Icon } from '../components/Icon'
import { applicableMetric, clampYear, yearsInRange } from '../components/map/derive'
import { countyMetric } from '../data/metrics'
import type { County } from '../data/types'
import { attrs, counties, countyByFips, ds, regionOf } from '../state/data'
import { filter, homeCounty, metric, selected, view, year } from '../state/filters'

function CountySearch({ list, onPick }: { list: County[]; onPick: (fips: string) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/^st\.?\s*/, 'st')
    if (!s) return []
    const norm = (n: string) => n.toLowerCase().replace(/^st\.?\s*/, 'st')
    const starts = list.filter((c) => norm(c.name).startsWith(s))
    const contains = list.filter((c) => !norm(c.name).startsWith(s) && norm(c.name).includes(s))
    return [...starts, ...contains].slice(0, 8)
  }, [q, list])
  const pick = (c: County | undefined) => {
    if (!c) return
    onPick(c.fips)
    setQ(''); setOpen(false); setActive(0)
  }
  const show = open && matches.length > 0
  return (
    <div class="relative flex-1 min-w-0" role="combobox" aria-expanded={show} aria-haspopup="listbox" aria-owns="county-options">
      <label class="flex items-center gap-2 rounded-lg bg-bg-3 border border-line px-3 focus-within:border-blaze">
        <Icon name="search" size={18} />
        <span class="sr-only">Find a county</span>
        <input type="search" value={q} placeholder="Find a county…" autocomplete="off" spellcheck={false}
          class="flex-1 min-w-0 bg-transparent h-11 text-base text-fg outline-none placeholder:text-fg-3"
          aria-autocomplete="list" aria-controls="county-options"
          aria-activedescendant={show ? `county-opt-${matches[active]?.fips}` : undefined}
          onInput={(e) => { setQ((e.currentTarget as HTMLInputElement).value); setOpen(true); setActive(0) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(matches.length - 1, a + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
            else if (e.key === 'Enter') { e.preventDefault(); pick(matches[active]) }
            else if (e.key === 'Escape') setOpen(false)
          }} />
      </label>
      {show && (
        <ul id="county-options" role="listbox" class="absolute z-20 left-0 right-0 mt-1 rounded-lg bg-bg-2 border border-line shadow-xl overflow-hidden">
          {matches.map((c, i) => (
            <li key={c.fips} id={`county-opt-${c.fips}`} role="option" aria-selected={i === active}
              class={`px-3 min-h-[44px] flex items-center justify-between cursor-pointer text-sm ${i === active ? 'bg-bg-3 text-fg' : 'text-fg-2'}`}
              onMouseDown={(e) => { e.preventDefault(); pick(c) }} onMouseEnter={() => setActive(i)}>
              <span>{c.name}</span><span class="text-xs text-fg-3">{c.mdc_region}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Locator({ fips }: { fips: string }) {
  const d = ds.value, cs = counties.value, f = filter.value, rOf = regionOf.value, at = attrs.value
  const mId = d ? applicableMetric(metric.value, f.species) : 'count'
  const y = d ? clampYear(year.value, yearsInRange(d, f)) : year.value
  const res = useMemo(() => (d && cs ? countyMetric(d, cs, f, rOf, mId, y, at) : null), [d, cs, f, rOf, mId, y, at])
  if (!res) return null
  return (
    <div class="rounded-xl bg-bg-2 border border-line p-3">
      <Choropleth values={res.values} def={res.def} selected={fips} homeCounty={homeCounty.value} dimOutsideRegion={f.region}
        onSelect={(x) => (selected.value = x)} label={`${res.def.label} by county, ${y}`} />
      <button type="button" class="tap mt-1 text-sm text-blaze-2 underline" onClick={() => (view.value = 'map')}>Open the full map</button>
    </div>
  )
}

export default function CountyView() {
  const list = useMemo(() => [...(counties.value ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [counties.value])
  const home = homeCounty.value
  const fips = selected.value || home
  const homeName = countyByFips.value.get(home)?.name
  return (
    <div class="p-3 lg:p-4">
      <div class="sticky top-0 z-20 -mx-3 lg:-mx-4 px-3 lg:px-4 py-2 bg-bg/95 backdrop-blur border-b border-line mb-3 flex items-center gap-2">
        <CountySearch list={list} onPick={(f) => (selected.value = f)} />
        {home && home !== fips && (
          <button type="button" class="tap rounded-lg px-3 border border-line text-sm text-fg-2 inline-flex items-center gap-1.5 hover:border-fg-3"
            onClick={() => (selected.value = home)} aria-label={`Go to home county ${homeName ?? ''}`}>
            <Icon name="home" size={18} /><span class="hidden sm:inline">{homeName}</span>
          </button>
        )}
      </div>
      {fips ? (
        <div class="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-4">
          <CountyCard fips={fips} full />
          <div class="mt-4 lg:mt-0"><Locator fips={fips} /></div>
        </div>
      ) : (
        <div class="text-fg-2 text-sm">
          <p class="mb-3">Search for a county above or tap one on the map. Set a home county to land here every time.</p>
          <Locator fips="" />
        </div>
      )}
    </div>
  )
}
