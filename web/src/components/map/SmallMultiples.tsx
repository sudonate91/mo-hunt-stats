/** One mini choropleth per season on a shared color scale. Tap a season label to jump the scrubber to it. */
import { useMemo } from 'preact/hooks'
import type { MetricDef } from '../../data/metrics'
import { Choropleth } from '../Choropleth'
import { seasonLabel } from '../charts/format'
import { makeBubbleScale } from './Bubbles'
import { MapLegend } from './Legend'
import { OverlayLegend, type OverlayLayers } from './Overlays'
import { makeScale } from './scale'

export function SmallMultiples({ years, values, def, species, current, onYear, onSelect, selected, homeCounty, region, overlays, values2, def2 }: {
  years: number[]; values: Float64Array[]; def: MetricDef; species: string; current: number
  onYear: (y: number) => void; onSelect: (fips: string) => void; selected: string; homeCounty: string; region: string
  overlays?: OverlayLayers | null; values2?: Float64Array[] | null; def2?: MetricDef | null
}) {
  const scale = useMemo(() => makeScale(values, def), [values, def])
  // One bubble scale shared by every season so sizes compare across the grid.
  const layers = useMemo(() => {
    if (!values2 || !def2) return null
    const bs = makeBubbleScale(values2)
    return values2.map((v) => ({ values: v, def: def2, scale: bs }))
  }, [values2, def2])
  return (
    <div>
      <ul class="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
        {years.map((y, i) => (
          <li key={y} class={`rounded-lg border p-1 ${y === current ? 'border-blaze' : 'border-line'}`}>
            <button type="button" class={`w-full text-left text-xs font-semibold px-1 ${y === current ? 'text-blaze' : 'text-fg-2'}`}
              aria-pressed={y === current} onClick={() => onYear(y)}>
              {seasonLabel(species, y)}
            </button>
            <Choropleth mini legend={false} values={values[i]} def={def} scale={scale} onSelect={onSelect} selected={selected}
              homeCounty={homeCounty} dimOutsideRegion={region} label={`${def.label}, ${seasonLabel(species, y)}`} overlays={overlays} bubbles={layers?.[i]} />
          </li>
        ))}
      </ul>
      <MapLegend scale={scale} def={def} bubbles={layers?.[0]} />
      <OverlayLegend />
    </div>
  )
}
