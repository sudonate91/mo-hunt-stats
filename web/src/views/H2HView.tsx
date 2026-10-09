/** Head-to-head: two counties or regions side by side for the current season, plus trend and portion mix. */
import { StackedBarChart } from '../components/charts/BarChart'
import { LineChart } from '../components/charts/LineChart'
import { seasonLabel } from '../components/charts/format'
import { Panel, YearSelect } from '../components/analysis/controls'
import { PlacePicker } from '../components/analysis/PlacePicker'
import { StatCards } from '../components/h2h/StatCards'
import { SIDE_COLORS, useH2H } from '../components/h2h/useH2H'
import { compare, filter, year } from '../state/filters'

export default function H2HView() {
  const h = useH2H()
  const sp = filter.value.species
  const season = seasonLabel(sp, year.value)
  const setSide = (k: 0 | 1, key: string) => {
    const next: [string, string] = h ? [...h.keys] : [...compare.value]
    next[k] = key
    compare.value = next
  }

  return (
    <div class="p-3 sm:p-4 max-w-5xl mx-auto flex flex-col gap-3">
      <div class="flex flex-wrap items-end gap-2">
        <h1 class="text-lg font-semibold mr-auto">Head-to-head</h1>
        <YearSelect />
      </div>
      <div class="grid grid-cols-2 gap-2">
        {([0, 1] as const).map((k) => (
          <div key={k} class="min-w-0">
            <p class="text-[11px] uppercase tracking-wide mb-0.5" style={{ color: SIDE_COLORS[k] }}>{k === 0 ? 'Side A' : 'Side B'}</p>
            <PlacePicker withRegions label={`Pick ${k === 0 ? 'first' : 'second'} county or region`}
              placeholder={h ? h.places[k].label : 'County or region…'} exclude={h ? [h.keys[1 - k]] : []}
              onPick={(key) => setSide(k, key)} />
          </div>
        ))}
      </div>
      {h ? (
        <>
          <StatCards places={h.places} rows={h.rows} season={season} />
          <div class="grid gap-3 lg:grid-cols-2">
            <Panel class="min-h-[300px]">
              <LineChart x={h.x} series={h.series} units="Animals checked" title={`${h.places[0].label} vs ${h.places[1].label} by season`} height={220} />
            </Panel>
            <Panel class="min-h-[300px]">
              <StackedBarChart groups={h.mix} categories={h.mixCats} colors={h.mixColors} height={220}
                units="% of the season's harvest, by portion" title={`Portion mix · ${season}`} />
            </Panel>
          </div>
        </>
      ) : <p class="text-sm text-fg-3">Pick two counties or regions to compare.</p>}
    </div>
  )
}
