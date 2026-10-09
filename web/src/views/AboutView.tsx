/** About / data page: sources, what the numbers mean, MDC page defects we correct for, home county, install hint. */
import type { ComponentChildren } from 'preact'
import { HomeCountyPicker } from '../components/HomeCountyPicker'

function Card({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="rounded-xl border border-line bg-bg-2 p-4 mb-4">
      <h2 class="text-base font-semibold text-fg mb-2">{title}</h2>
      <div class="text-sm text-fg-2 leading-relaxed space-y-2">{children}</div>
    </section>
  )
}

function A({ href, children }: { href: string; children: ComponentChildren }) {
  return <a href={href} target="_blank" rel="noopener" class="text-blaze-2 underline underline-offset-2 inline-flex items-center">{children}</a>
}

const SOURCES: { href: string; name: string; what: string }[] = [
  { href: 'https://mdc.mo.gov/hunting-trapping/species/deer/deer-harvest-reports/deer-harvest-summaries', name: 'MDC Deer Harvest Summaries',
    what: 'County-by-county deer harvest for every portion (archery, youth, November, antlerless, CWD, alternative methods, managed hunts), 2015-16 onward, by antlered buck, button buck and doe.' },
  { href: 'https://mdc.mo.gov/hunting-trapping/species/turkey/turkey-reports/turkey-harvest-summaries', name: 'MDC Turkey Harvest Summaries',
    what: 'Spring youth, spring, fall firearms and fall archery turkey harvest by county and bird class, 2015 onward, plus public-land and crossbow counts where MDC prints them.' },
  { href: 'https://gisblue.mdc.mo.gov/arcgis/rest/services/Terrestrial', name: 'MDC ArcGIS: CWD Fall Reporting Dashboard',
    what: 'Chronic wasting disease samples and positives by county and season, with sex and age splits.' },
  { href: 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html', name: 'US Census Bureau',
    what: 'County FIPS codes, land area (for per-square-mile numbers) and cartographic boundary shapes for the map.' },
]

export default function AboutView() {
  const standalone = typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches
  return (
    <div class="p-4 max-w-3xl mx-auto">
      <h1 class="text-xl font-bold mb-1">About MO Hunt Stats</h1>
      <p class="text-sm text-fg-2 mb-4">
        A free, unofficial viewer for Missouri deer and turkey harvest numbers. Every number comes from the Missouri
        Department of Conservation (MDC); this site only reshapes it. Not affiliated with or endorsed by MDC.
      </p>

      <Card title="Your home county">
        <HomeCountyPicker />
      </Card>

      <Card title="Data sources">
        <ul class="space-y-3">
          {SOURCES.map((s) => (
            <li key={s.href}>
              <A href={s.href}>{s.name}</A>
              <p class="m-0">{s.what}</p>
            </li>
          ))}
        </ul>
        <p>Data is rebuilt from these pages on a schedule. Each row keeps a link back to the MDC page it came from.</p>
      </Card>

      <Card title="Reading the numbers">
        <p>
          <strong class="text-fg">Animals checked</strong> are the deer or turkeys hunters reported through Telecheck,
          counted in the county where they were taken. A deer season is labeled by the year it opens (2025-26 = the
          fall 2025 season).
        </p>
        <p>
          <strong class="text-fg">Subtotals (<code>is_subtotal</code>).</strong> MDC prints some tables that are slices of
          other tables: opening weekend is part of the November portion, “all firearms” adds up the firearms portions, and
          the grand total adds up everything. Those rows are kept but flagged as subtotals, and they are left out of every
          sum unless you pick them on purpose (marked ⊂ in the portion filter), so nothing is counted twice.
        </p>
        <p>
          <strong class="text-fg">Per square mile</strong> uses Census land area. <strong class="text-fg">Hotspot index</strong> is
          how many standard deviations a county’s harvest per square mile sits above or below the state.
        </p>
      </Card>

      <Card title="Known problems on MDC’s pages (and what we do)">
        <p>Every table is checked: county rows must add up to MDC’s printed total, or the build stops. A few pages have errors, handled like this:</p>
        <ul class="list-disc pl-5 space-y-1">
          <li><strong class="text-fg">Deer 2019 antlerless firearms:</strong> county names are shifted against their numbers. We rebuild each county from its all-firearms total minus the other firearms portions; the result matches MDC’s totals and top-5 list exactly. These rows are marked as derived.</li>
          <li><strong class="text-fg">Deer 2023 and 2024 all firearms:</strong> Platte County shows a stale total. We use MDC’s by-county firearms recap, which is correct.</li>
          <li><strong class="text-fg">Deer 2025 managed hunts recap:</strong> four rows are misaligned, so we use the main managed-hunts table instead.</li>
          <li><strong class="text-fg">Deer 2015 season summary</strong> disagrees with its own tables for November and alternative methods. The county tables win.</li>
          <li><strong class="text-fg">Deer 2016:</strong> MDC published only a statewide managed-hunts figure, so that season has no managed-hunt counties.</li>
          <li><strong class="text-fg">Deer 2015 “antlerless firearms”</strong> is filed under late antlerless so trends line up with today’s season names.</li>
          <li><strong class="text-fg">Turkey 2021 spring:</strong> the bearded hen and juvenile gobbler columns are swapped in the county rows; we swap them back. One youth-season cell (Benton) is corrected to match its row and column totals.</li>
          <li><strong class="text-fg">Turkey 2021 fall:</strong> the adult hen column is mislabeled “bearded hen”; it is read as adult hens.</li>
          <li><strong class="text-fg">Turkey 2020 fall firearms:</strong> the total row sits in the top-5 table; we read it from there.</li>
          <li><strong class="text-fg">Turkey 2022 spring:</strong> a few birds are listed as adult hens or gobblers of unknown age; they are kept as their own classes.</li>
        </ul>
        <p>Each fix is pinned, so if MDC corrects a page the build flags it for review.</p>
      </Card>

      <Card title="Install the app">
        {standalone ? <p>You are using the installed app. It works offline with the data from your last visit.</p> : (
          <>
            <p><strong class="text-fg">Android (Chrome):</strong> tap the ⋮ menu, then <em>Install app</em> or <em>Add to Home screen</em>.</p>
            <p><strong class="text-fg">iPhone (Safari):</strong> tap Share, then <em>Add to Home Screen</em>.</p>
            <p><strong class="text-fg">Desktop:</strong> use the install icon in the address bar.</p>
            <p>Once installed it opens full-screen and works offline with the data from your last visit; new data downloads in the background.</p>
          </>
        )}
      </Card>

      <Card title="Sharing">
        <p>Every filter is saved in the page address, so copying the link shares exactly what you see. The share button on any chart saves it as an image with an MDC credit line.</p>
      </Card>

      <p class="text-[11px] text-fg-3 text-right">Source: MDC · Census</p>
    </div>
  )
}
