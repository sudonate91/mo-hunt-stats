/** Small form controls shared by the analysis views. All targets are ≥ 44px. */
import type { ComponentChildren } from 'preact'
import { METRICS } from '../../data/metrics'
import { seasonLabel } from '../charts/format'
import { ds } from '../../state/data'
import { filter, metric, year, type Metric } from '../../state/filters'
import { yearsIn } from './agg'

export function Segmented<T extends string>({ value, options, onChange, label }:
  { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} class="inline-flex rounded-lg border border-line overflow-hidden">
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}
          class={`tap px-3 text-sm ${value === o.id ? 'bg-blaze text-black font-semibold' : 'bg-bg-3 text-fg-2 hover:text-fg'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

const selectCls = 'bg-bg-3 border border-line rounded-lg px-2 text-sm text-fg min-w-0'

export function LabeledSelect({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <label class="flex flex-col text-[11px] uppercase tracking-wide text-fg-3 gap-0.5 min-w-0">
      {label}
      {children}
    </label>
  )
}

export function MetricSelect() {
  const sp = filter.value.species
  return (
    <LabeledSelect label="Metric">
      <select class={selectCls} value={metric.value} onChange={(e) => (metric.value = (e.currentTarget as HTMLSelectElement).value as Metric)}>
        {METRICS.filter((m) => m.species.includes(sp)).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
    </LabeledSelect>
  )
}

export function YearSelect() {
  const d = ds.value
  const f = filter.value
  const ys = d ? yearsIn(d, f.yearFrom, f.yearTo) : []
  return (
    <LabeledSelect label="Season">
      <select class={selectCls} value={String(year.value)} onChange={(e) => (year.value = Number((e.currentTarget as HTMLSelectElement).value))}>
        {[...ys].reverse().map((y) => <option key={y} value={String(y)}>{seasonLabel(f.species, y)}</option>)}
      </select>
    </LabeledSelect>
  )
}

/** Card wrapper used by the analysis views. */
export function Panel({ children, class: cls = '' }: { children: ComponentChildren; class?: string }) {
  return <section class={`bg-bg-2 border border-line rounded-xl p-3 ${cls}`}>{children}</section>
}
