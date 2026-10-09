/** Two side-by-side stat cards; the winner of each stat gets a blaze highlight. */
import type { Place } from '../analysis/agg'
import { SIDE_COLORS, type StatRow } from './useH2H'

function winner(r: StatRow): -1 | 0 | 1 {
  const [a, b] = r.values
  if (!r.better || !Number.isFinite(a) || !Number.isFinite(b) || a === b) return -1
  return (r.better === 'high' ? a > b : a < b) ? 0 : 1
}

export function StatCards({ places, rows, season }: { places: [Place, Place]; rows: StatRow[]; season: string }) {
  const wins = rows.map(winner)
  const score = [0, 1].map((k) => wins.filter((w) => w === k).length)
  return (
    <div class="grid grid-cols-2 gap-2">
      {places.map((p, k) => (
        <section key={p.key} class="bg-bg-2 border border-line rounded-xl p-2 sm:p-3 min-w-0" style={{ borderTopColor: SIDE_COLORS[k], borderTopWidth: '3px' }}>
          <header class="mb-2">
            <h2 class="font-semibold truncate" style={{ color: SIDE_COLORS[k] }}>{p.label}</h2>
            <p class="text-[11px] text-fg-3">{season} · wins {score[k]} of {wins.filter((w) => w >= 0).length}</p>
          </header>
          <dl class="flex flex-col gap-1">
            {rows.map((r, i) => {
              const win = wins[i] === k
              return (
                <div key={r.label} class={`rounded-lg px-2 py-1 min-h-[44px] ${win ? 'bg-blaze/20 ring-1 ring-blaze' : 'bg-bg-3'}`}>
                  <dt class={`text-[11px] uppercase tracking-wide truncate ${r.highlight ? 'text-sel' : 'text-fg-3'}`}>{r.label}</dt>
                  <dd class={`tabular-nums text-sm sm:text-base truncate ${win ? 'text-blaze font-semibold' : 'text-fg'}`}>
                    {r.text[k]}{win && <span class="sr-only"> (winner)</span>}
                  </dd>
                </div>
              )
            })}
          </dl>
        </section>
      ))}
    </div>
  )
}
