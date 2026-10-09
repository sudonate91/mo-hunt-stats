/** Responsive shell. Phone < 640: one column + bottom tabs + filter sheet. Tablet: side by side.
 *  Desktop > 1024: filter sidebar | main (map) | rail (chart + county card). */
import type { ComponentChildren } from 'preact'
import { activeFilterCount, sheetOpen, VIEWS, view, type View } from '../state/filters'
import { FilterControls, FilterSheet } from './FilterSheet'
import { Icon } from './Icon'

export function Credit({ units }: { units?: string }) {
  return (
    <p class="text-[11px] text-fg-3 mt-1 flex justify-between">
      <span>{units ?? 'Animals checked'}</span>
      <span>Source: MDC</span>
    </p>
  )
}

export function BottomTabs() {
  return (
    <nav class="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-bg-2 border-t border-line pb-[var(--safe-bottom)]" aria-label="Views">
      <ul class="flex">
        {VIEWS.map((v) => (
          <li key={v.id} class="flex-1">
            <button type="button" aria-current={view.value === v.id ? 'page' : undefined}
              class={`tap w-full flex flex-col items-center justify-center py-1 text-[11px] ${view.value === v.id ? 'text-blaze' : 'text-fg-2'}`}
              onClick={() => (view.value = v.id)}>
              <Icon name={v.id} />
              {v.label}
            </button>
          </li>
        ))}
        <li class="flex-1">
          <button type="button" class="tap w-full flex flex-col items-center justify-center py-1 text-[11px] text-fg-2 relative"
            onClick={() => (sheetOpen.value = true)} aria-label="Open filters">
            <Icon name="filter" />
            Filters
            {activeFilterCount.value > 0 && <span class="absolute top-0.5 right-1/4 bg-blaze text-black text-[10px] rounded-full px-1.5">{activeFilterCount.value}</span>}
          </button>
        </li>
      </ul>
    </nav>
  )
}

export function Sidebar() {
  return (
    <aside class="hidden lg:block w-72 shrink-0 border-r border-line overflow-y-auto p-4 bg-bg-2">
      <nav aria-label="Views" class="mb-4">
        <ul class="flex flex-col gap-1">
          {VIEWS.map((v) => (
            <li key={v.id}>
              <button type="button" aria-current={view.value === v.id ? 'page' : undefined}
                class={`tap w-full text-left flex items-center gap-2 rounded-lg px-3 ${view.value === v.id ? 'bg-bg-3 text-blaze font-semibold' : 'text-fg-2 hover:bg-bg-3'}`}
                onClick={() => (view.value = v.id)}>
                <Icon name={v.id} />{v.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <h2 class="text-xs uppercase tracking-wide text-fg-3 mb-2">Filters</h2>
      <FilterControls />
    </aside>
  )
}

export function Shell({ children, title }: { children: ComponentChildren; title: string }) {
  return (
    <div class="h-full flex flex-col">
      <header class="flex items-center gap-3 px-4 h-12 border-b border-line bg-bg-2 shrink-0">
        <span class="font-bold text-blaze tracking-tight">MO Hunt Stats</span>
        <span class="text-fg-3 text-sm truncate">{title}</span>
        <span class="ml-auto hidden sm:inline text-xs text-fg-3">Data: Missouri Dept. of Conservation</span>
      </header>
      <div class="flex-1 flex min-h-0">
        <Sidebar />
        <main class="flex-1 min-w-0 overflow-y-auto pb-20 lg:pb-4">{children}</main>
      </div>
      <BottomTabs />
      <FilterSheet />
    </div>
  )
}

export function viewTitle(v: View): string {
  return VIEWS.find((x) => x.id === v)?.label ?? (v === 'county' ? 'County' : v === 'about' ? 'About' : '')
}
