/** Season breakdown: portion mix and class split by season, plus ranked portions and share stats for one season. */
import { useState } from 'preact/hooks'
import { HBarChart, StackedBarChart } from '../components/charts/BarChart'
import { seasonLabel } from '../components/charts/format'
import { Panel, Segmented, YearSelect } from '../components/analysis/controls'
import { useSeasons } from '../components/seasons/useSeasons'
import { countyByFips } from '../state/data'
import { filter, selected, year } from '../state/filters'

type Scope = 'area' | 'county'

export default function SeasonsView() {
  const f = filter.value
  const sel = selected.value
  const selName = sel ? countyByFips.value.get(sel)?.name : undefined
  const [scopePref, setScope] = useState<Scope>('county')
  const scope: Scope = selName ? scopePref : 'area'
  const s = useSeasons(scope === 'county' && sel ? sel : '')
  const areaName = f.region ? `${f.region} region` : 'Statewide'
  const where = scope === 'county' && selName ? `${selName} County` : areaName
  const yLabel = seasonLabel(f.species, year.value)

  return (
    <div class="p-3 sm:p-4 max-w-5xl mx-auto flex flex-col gap-3">
      <div class="flex flex-wrap items-end gap-2">
        <h1 class="text-lg font-semibold mr-auto">Season breakdown · {where}</h1>
        {selName && (
          <Segmented<Scope> label="Scope" value={scope} onChange={setScope}
            options={[{ id: 'area', label: f.region ? 'Region' : 'State' }, { id: 'county', label: selName }]} />
        )}
      </div>
      {!selName && <p class="text-xs text-fg-3 -mt-2">Tip: select a county on the map or leaderboard to break down just that county.</p>}

      <div class="grid gap-3 lg:grid-cols-2">
        <Panel class="lg:col-span-2 min-h-[300px]">
          {s && <StackedBarChart id="seasons-stack" groups={s.portionGroups} categories={s.portionCats} colors={s.portionColors}
            units="Animals checked, by portion (subtotals excluded)" title={`Harvest by portion · ${s.rangeLabel}`} height={220} />}
        </Panel>

        <Panel class="min-h-[300px]">
          <div class="flex items-end justify-between gap-2 mb-2">
            <h2 class="text-sm font-semibold text-fg-2">One season</h2>
            <YearSelect />
          </div>
          {s && s.yearBars.length > 0
            ? <HBarChart id="seasons-year" bars={s.yearBars} units="Animals checked" title={`Portions ranked · ${yLabel}`} maxBars={12} />
            : <p class="text-sm text-fg-3">No harvest for this season under the current filters.</p>}
          <dl class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {s?.stats.map((st) => (
              <div key={st.label} class="bg-bg-3 rounded-lg px-3 py-2" title={st.hint}>
                <dt class="text-[11px] uppercase tracking-wide text-fg-3">{st.label}</dt>
                <dd class="text-lg font-semibold tabular-nums text-blaze">{st.value}</dd>
                <dd class="text-[11px] text-fg-3">{st.hint}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel class="min-h-[300px]">
          {s && <StackedBarChart id="seasons-classes" groups={s.classGroups} categories={s.classCats}
            units="Animals checked, by sex / age class" title={`${f.species === 'deer' ? 'Bucks, button bucks, does' : 'Gobblers and hens'} · ${s.rangeLabel}`} height={220} />}
        </Panel>
      </div>
    </div>
  )
}
