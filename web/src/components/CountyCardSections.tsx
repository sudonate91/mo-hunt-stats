/** Building blocks of the county card. Each takes plain data so the card stays a thin composition. */
import type { ComponentChildren } from 'preact'
import { formatMetric, type MetricDef } from '../data/metrics'
import { pct } from './charts/format'
import { ordinal, type CwdStat, type Share } from './map/derive'

export function Section({ title, children, note, first = false }: { title: string; children: ComponentChildren; note?: string; first?: boolean }) {
  return (
    <section class={first ? '' : 'border-t border-line pt-3 mt-3'}>
      <h3 class="text-xs uppercase tracking-wide text-fg-3 mb-1.5">{title}</h3>
      {children}
      {note && <p class="text-[11px] text-fg-3 mt-1 flex justify-between"><span>{note}</span><span>Source: MDC</span></p>}
    </section>
  )
}

export function Stat({ label, value, units }: { label: string; value: string; units: string }) {
  return (
    <div class="min-w-0">
      <div class="text-[11px] text-fg-3 truncate">{label}</div>
      <div class="text-lg font-semibold tabular-nums leading-tight">{value}</div>
      <div class="text-[11px] text-fg-3 leading-tight">{units}</div>
    </div>
  )
}

export function RankBlock({ value, def, state, region, regionName, season }:
  { value: number; def: MetricDef; state: [number, number]; region: [number, number]; regionName: string; season: string }) {
  return (
    <Section first title={`${def.label} · ${season}`} note={def.units}>
      <div class="grid grid-cols-3 gap-2">
        <Stat label={def.label} value={formatMetric(value, def)} units={def.units} />
        <Stat label="Rank statewide" value={state[0] > 0 ? ordinal(state[0]) : 'not ranked'} units={`of ${state[1]} counties`} />
        <Stat label={`Rank in ${regionName}`} value={region[0] > 0 ? ordinal(region[0]) : 'not ranked'} units={`of ${region[1]} counties`} />
      </div>
    </Section>
  )
}

const share = (s: Share | null) => (s && s.den > 0 ? pct(s.num / s.den) : '–')
const of = (s: Share | null, what: string) => (s && s.den > 0 ? `${s.num.toLocaleString('en-US')} of ${s.den.toLocaleString('en-US')} ${what}` : 'not reported')

export function DeerShares({ bucks, does, buttons, total, season }: { bucks: number; does: number; buttons: number; total: number; season: string }) {
  return (
    <Section title={`Herd mix · ${season}`} note="Ratio of antlered bucks to does; share of all deer checked">
      <div class="grid grid-cols-2 gap-2">
        <Stat label="Buck : doe ratio" value={does > 0 ? (bucks / does).toFixed(2) : '–'} units={`${bucks.toLocaleString('en-US')} bucks : ${does.toLocaleString('en-US')} does`} />
        <Stat label="Button-buck share" value={total > 0 ? pct(buttons / total) : '–'} units={`${buttons.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} deer`} />
      </div>
    </Section>
  )
}

export function TurkeyShares({ publicLand, crossbow, season }: { publicLand: Share | null; crossbow: Share | null; season: string }) {
  return (
    <Section title={`Where and how · ${season}`} note="% of birds checked (MDC reports these from 2018 archery, all portions 2023+)">
      <div class="grid grid-cols-2 gap-2">
        <Stat label="Public-land share" value={share(publicLand)} units={of(publicLand, 'birds')} />
        <Stat label="Crossbow share (fall archery)" value={share(crossbow)} units={of(crossbow, 'birds')} />
      </div>
    </Section>
  )
}

export function CwdBlock({ stat, season }: { stat: CwdStat | null; season: string }) {
  return (
    <Section title="CWD sampling" note="Deer tested / CWD-positive deer">
      {stat ? (
        <div class="grid grid-cols-2 gap-2">
          <Stat label={`Season ${season}`} value={`${stat.positives.toLocaleString('en-US')} / ${stat.samples.toLocaleString('en-US')}`} units="positives / samples" />
          <Stat label={`Since ${stat.since}`} value={`${stat.cumPositives.toLocaleString('en-US')} / ${stat.cumSamples.toLocaleString('en-US')}`} units="positives / samples (cumulative)" />
        </div>
      ) : <p class="text-sm text-fg-3">No CWD samples reported for this county.</p>}
    </Section>
  )
}

export interface NeighborRow { fips: string; name: string; value: number; rank: number; self: boolean }

/** Nearest counties by centroid, tappable to move the selection. */
export function Neighbors({ rows, def, onSelect, season }: { rows: NeighborRow[]; def: MetricDef; onSelect: (fips: string) => void; season: string }) {
  const max = Math.max(...rows.map((r) => (Number.isFinite(r.value) ? Math.abs(r.value) : 0)), 1e-9)
  return (
    <Section title={`Neighbors compared · ${season}`} note={def.units}>
      <ul class="flex flex-col">
        {rows.map((r) => (
          <li key={r.fips}>
            <button type="button" onClick={() => onSelect(r.fips)} aria-current={r.self ? 'true' : undefined}
              class={`tap w-full grid grid-cols-[1fr_auto_3rem] items-center gap-2 text-left text-sm rounded px-1 ${r.self ? 'text-sel font-semibold' : 'text-fg-2 hover:bg-bg-3'}`}>
              <span class="min-w-0">
                <span class="block truncate">{r.name}</span>
                <span class="block h-1 rounded bg-bg-3 mt-0.5">
                  <span class={`block h-1 rounded ${r.self ? 'bg-sel' : 'bg-blaze'}`} style={{ width: `${Number.isFinite(r.value) ? (Math.abs(r.value) / max) * 100 : 0}%` }} />
                </span>
              </span>
              <span class="tabular-nums">{formatMetric(r.value, def)}</span>
              <span class="tabular-nums text-fg-3 text-right">{r.rank ? `#${r.rank}` : '–'}</span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  )
}

export interface Pressure {
  published: boolean // false = MDC did not publish effort for this season (2015-17, 2025+)
  firearms: number | null
  archery: number | null
  hunters: number // estimated hunters who hunted the county (density x land area), NaN when unknown
  deerPerHunter: number
  rankDph: [number, number]
  rankDensity: [number, number]
  tripsFirearms: number | null
  tripsArchery: number | null
}

const dec = (v: number | null | undefined, d = 1) => (v != null && Number.isFinite(v) ? v.toFixed(d) : 'not published')
const rankText = (r: [number, number]) => (r[0] > 0 ? ordinal(r[0]) : 'not ranked')

/** Hunter density and effort from MDC's Deer Season Summary & Population Status Reports (deer only). */
export function PressureBlock({ p, season, chart }: { p: Pressure; season: string; chart: ComponentChildren }) {
  const note = 'Hunters who hunted this county per MDC permit/Telecheck records, whole season. Source: MDC Deer Season Summary & Population Status Reports.'
  const hasDensity = p.firearms != null || p.archery != null
  return (
    <section class="border-t border-line pt-3 mt-3">
      <h3 class="text-xs uppercase tracking-wide text-fg-3 mb-1.5">Hunting pressure · {season}</h3>
      {!p.published ? (
        <p class="text-sm text-fg-3 mb-2">Hunter density and effort: not published for this season.</p>
      ) : (
        <>
          {!hasDensity && <p class="text-sm text-fg-3 mb-2">Hunter density: not published for this season.</p>}
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {hasDensity && <Stat label="Firearms hunters / sq mi" value={dec(p.firearms)} units="hunters per square mile" />}
            {hasDensity && <Stat label="Archery hunters / sq mi" value={dec(p.archery)} units="hunters per square mile" />}
            {hasDensity && <Stat label="Estimated hunters" value={Number.isFinite(p.hunters) ? `≈${p.hunters.toLocaleString('en-US')}` : '–'} units="density × land area" />}
            {hasDensity && <Stat label="Deer per hunter-season" value={Number.isFinite(p.deerPerHunter) ? p.deerPerHunter.toFixed(2) : '–'} units={p.rankDph[0] > 0 ? `${rankText(p.rankDph)} of ${p.rankDph[1]} statewide` : 'deer checked per hunter'} />}
            {hasDensity && <Stat label="Hunters / sq mi rank" value={rankText(p.rankDensity)} units={`of ${p.rankDensity[1]} counties statewide`} />}
            {p.tripsFirearms != null && <Stat label="Trips per kill, firearms" value={dec(p.tripsFirearms)} units="hunting trips per deer" />}
            {p.tripsArchery != null && <Stat label="Trips per kill, archery" value={dec(p.tripsArchery)} units="hunting trips per deer" />}
          </div>
        </>
      )}
      <div class="mt-2">{chart}</div>
      <p class="text-[11px] text-fg-3 mt-1">{note}</p>
    </section>
  )
}
