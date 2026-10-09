/** Auto-generated fact cards for the current year + filter slice. Each card is a shareable <figure>. */
import { useMemo } from 'preact/hooks'
import { seasonLabel } from './charts/format'
import { makeFacts } from '../data/facts'
import { attrs, counties, ds, regionOf } from '../state/data'
import { filter, homeCounty, selected, year } from '../state/filters'
import { ShareButton } from './ShareButton'

export function FactCards({ limit = 8 }: { limit?: number }) {
  const d = ds.value, c = counties.value, f = filter.value, y = year.value, ro = regionOf.value, a = attrs.value, h = homeCounty.value
  const facts = useMemo(
    () => (d && c ? makeFacts({ ds: d, counties: c, filter: f, year: y, regionOf: ro, attrs: a, home: h }) : []),
    [d, c, f, y, ro, a, h],
  )
  if (!d || !facts.length) return null
  const sel = selected.value
  const yr = d.years.includes(y) ? y : d.years[d.years.length - 1]
  return (
    <section aria-label="Fact cards" class="mb-4">
      <h2 class="text-xs uppercase tracking-wide text-fg-3 mb-2">Did you know · {seasonLabel(d.species, yr)}</h2>
      {/* phone: one-row swipe strip so the chart stays near the top; wider: grid */}
      <ul class="flex gap-2 overflow-x-auto snap-x snap-mandatory -mx-4 px-4 pb-1 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-2 xl:grid-cols-3 sm:overflow-visible">
        {facts.slice(0, limit).map((fa) => (
          <li key={fa.id} class="w-[85%] shrink-0 snap-start sm:w-auto">
            <figure id={`fact-${fa.id}`} data-share-title={`MO Hunt Stats · ${d.species === 'deer' ? 'Deer' : 'Turkey'} ${seasonLabel(d.species, yr)}`}
              data-share-text={fa.text} data-share-value={fa.value}
              class={`m-0 h-full flex gap-3 rounded-xl border bg-bg-2 p-3 ${fa.fips && fa.fips === sel ? 'border-sel' : fa.id === 'home' ? 'border-blaze-dim' : 'border-line'}`}>
              <div class="w-20 shrink-0">
                <div class="text-lg font-bold text-blaze tabular-nums leading-tight break-words">{fa.value}</div>
                <div class="text-[11px] text-fg-3 leading-tight">{fa.caption}</div>
              </div>
              {fa.fips ? (
                <button type="button" class="flex-1 text-left text-sm text-fg leading-snug min-h-[44px]"
                  onClick={() => (selected.value = fa.fips ?? '')}>{fa.text}</button>
              ) : (
                <p class="flex-1 text-sm text-fg leading-snug m-0 self-center">{fa.text}</p>
              )}
              <div class="shrink-0 -mr-1 -mt-1"><ShareButton target={`fact-${fa.id}`} label="Share this fact" /></div>
            </figure>
          </li>
        ))}
      </ul>
      <p class="text-[11px] text-fg-3 mt-1 text-right">Source: MDC</p>
    </section>
  )
}
