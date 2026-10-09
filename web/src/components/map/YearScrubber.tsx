/** Season scrubber: range input over the filtered seasons plus play/pause (disabled under prefers-reduced-motion). */
import { useEffect, useState } from 'preact/hooks'
import { seasonLabel } from '../charts/format'
import { Icon } from '../Icon'

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function YearScrubber({ years, value, onChange, species }:
  { years: number[]; value: number; onChange: (y: number) => void; species: string }) {
  const [playing, setPlaying] = useState(false)
  const [still] = useState(reducedMotion)
  const lo = years[0], hi = years[years.length - 1]

  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => {
      const i = years.indexOf(value)
      if (i < 0 || i >= years.length - 1) { setPlaying(false); return }
      onChange(years[i + 1])
    }, 900)
    return () => clearInterval(t)
  }, [playing, value, years, onChange])

  const toggle = () => {
    if (playing) { setPlaying(false); return }
    if (value >= hi) onChange(lo) // restart from the first season
    setPlaying(true)
  }

  return (
    <div class="flex items-center gap-2 mb-1">
      <button type="button" onClick={toggle} disabled={still || years.length < 2}
        title={still ? 'Autoplay is off because your device asks for reduced motion' : playing ? 'Pause' : 'Play through the seasons'}
        aria-label={playing ? 'Pause season animation' : 'Play season animation'} aria-pressed={playing}
        class="tap rounded-full bg-bg-3 border border-line text-fg inline-flex items-center justify-center disabled:opacity-40">
        <Icon name={playing ? 'pause' : 'play'} size={18} />
      </button>
      <input type="range" class="flex-1 accent-blaze" min={lo} max={hi} step={1} value={value} disabled={years.length < 2}
        aria-label="Season" aria-valuetext={seasonLabel(species, value)}
        onInput={(e) => { setPlaying(false); onChange(+(e.currentTarget as HTMLInputElement).value) }} />
      <output class="w-16 text-right tabular-nums font-semibold text-fg">{seasonLabel(species, value)}</output>
    </div>
  )
}
