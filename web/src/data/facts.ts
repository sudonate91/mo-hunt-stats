/**
 * Auto-generated fact sentences for the current year and filter slice. Everything is computed from metrics.ts /
 * query.ts; nothing is hard-coded except sentence templates. Facts that don't apply (no data, 0/0) are skipped.
 */
import { fmt, pct, seasonLabel } from '../components/charts/format'
import { countyMetric, countySeries, rankValues, streak } from './metrics'
import { CLASS_LABEL, PORTION_LABEL, mask, maskYear, total, type Filter } from './query'
import type { Attributes, County, Dataset } from './types'

export interface Fact {
  id: string
  text: string
  value: string // the "tiny number"
  caption: string // what the number is
  fips?: string // county the fact is about (tap to select)
}

export interface FactInput {
  ds: Dataset
  counties: County[]
  filter: Filter
  year: number
  regionOf: (fips: string) => string
  attrs?: Attributes | null
  home?: string
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${s}`
}

const argmax = (v: ArrayLike<number>) => {
  let best = -1
  for (let i = 0; i < v.length; i++) if (Number.isFinite(v[i]) && (best < 0 || v[i] > v[best])) best = i
  return best
}

export function makeFacts(inp: FactInput): Fact[] {
  const { ds, counties, regionOf, attrs, home } = inp
  const byFips = new Map(counties.map((c) => [c.fips, c]))
  const name = (i: number) => byFips.get(ds.dict.county[i])?.name ?? ds.dict.county[i]
  const year = ds.years.includes(inp.year) ? inp.year : ds.years[ds.years.length - 1]
  const yi = ds.years.indexOf(year)
  const allYears = { yearFrom: ds.years[0], yearTo: ds.years[ds.years.length - 1] }
  const stateTotal = (f: Filter, y: number, patch: Partial<Filter> = {}) =>
    total(ds, maskYear(ds, mask(ds, { ...f, ...patch, ...allYears }, regionOf), y))

  let f = inp.filter
  // Turkey year with spring results only (fall not yet reported): compare spring with spring; `where` then says so.
  if (ds.species === 'turkey' && !f.season && stateTotal(f, year, { season: 'fall' }) === 0 && stateTotal(f, year, { season: 'spring' }) > 0) {
    f = { ...f, season: 'spring' }
  }

  const sp = ds.species
  const animals = f.classes.length === 1 ? (CLASS_LABEL[f.classes[0]] ?? f.classes[0]).toLowerCase() : sp === 'deer' ? 'deer' : 'turkeys'
  const where = f.portions.length === 1 ? ` in the ${PORTION_LABEL[f.portions[0]] ?? f.portions[0]} portion`
    : f.season ? ` in the ${f.season} season` : ''
  const scope = f.region ? `in the ${f.region} region` : 'in the state'
  const Scope = f.region ? `${f.region} region` : 'Statewide'
  const season = (y: number) => seasonLabel(sp, y)

  const series = countySeries(ds, f, regionOf)
  const col = (y: number) => new Float64Array(series.map((s) => s[y]))
  const sum = (v: Float64Array) => v.reduce((a, b) => a + b, 0)
  const cur = col(yi)
  const T = sum(cur)
  if (T === 0) return []
  const prev = yi > 0 ? col(yi - 1) : null
  const ranks = rankValues(cur)
  const facts: Fact[] = []

  // Home county rank (pinned first)
  const hi = home ? ds.dict.county.indexOf(home) : -1
  if (hi >= 0 && cur[hi] > 0) {
    const r = ranks[hi]
    const pr = prev ? rankValues(prev)[hi] : 0
    const d = pr > 0 ? pr - r : 0
    const move = d > 0 ? ` (↑${d})` : d < 0 ? ` (↓${-d})` : pr > 0 ? ' (no change)' : ''
    facts.push({ id: 'home', fips: home, value: `#${r}`, caption: `${fmt(cur[hi])} ${animals}`,
      text: `Home county ${name(hi)} ranks ${ordinal(r)} ${scope}${where} in ${season(year)}${move}.` })
  }

  // Leader and how long it has led
  const lead = argmax(cur)
  let led = 1
  for (let y = yi - 1; y >= 0; y--) { if (argmax(col(y)) === lead && series[lead][y] > 0) led++; else break }
  facts.push({ id: 'leader', fips: ds.dict.county[lead], value: fmt(cur[lead]), caption: animals,
    text: led >= 2
      ? `${name(lead)} has led ${scope.replace('in the ', 'the ')}${where} ${led} seasons running.`
      : `${name(lead)} led ${scope.replace('in the ', 'the ')}${where} in ${season(year)} with ${fmt(cur[lead])} ${animals}.` })

  // Change vs last season
  if (prev && sum(prev) > 0) {
    const P = sum(prev), d = T / P - 1
    facts.push({ id: 'yoy', value: `${d > 0 ? '+' : ''}${pct(d)}`, caption: `${fmt(P)} → ${fmt(T)}`,
      text: `${Scope} harvest${where} is ${d >= 0 ? 'up' : 'down'} ${pct(Math.abs(d))} vs last season.` })
  }

  // Harvest per square mile
  const dens = countyMetric(ds, counties, f, regionOf, 'per_sqmi', year).values
  const di = argmax(dens)
  if (di >= 0 && dens[di] > 0) {
    const second = argmax(dens.map((v, i) => (i === di ? NaN : v)))
    facts.push({ id: 'density', fips: ds.dict.county[di], value: dens[di].toFixed(2), caption: `${animals} / sq mi`,
      text: `${name(di)} took ${dens[di].toFixed(1)} ${animals} per square mile, the most ${scope}${second >= 0 ? `; ${name(second)} was 2nd at ${dens[second].toFixed(1)}` : ''}.` })
  }

  // Longest current top-10 streak (only counties in this year's top 10 can have one)
  const upTo = series.map((s) => s.slice(0, yi + 1))
  let sBest = -1, sLen = 0
  for (let i = 0; i < cur.length; i++) {
    if (ranks[i] < 1 || ranks[i] > 10) continue
    const n = streak(upTo, i, 10)
    if (n > sLen) { sLen = n; sBest = i }
  }
  if (sBest >= 0 && sLen >= 3) {
    facts.push({ id: 'streak', fips: ds.dict.county[sBest], value: `${sLen}`, caption: 'seasons in top 10',
      text: sLen === yi + 1
        ? `${name(sBest)} has finished top 10 ${scope}${where} every season since ${season(ds.years[0])}.`
        : `${name(sBest)} has finished top 10 ${scope}${where} ${sLen} seasons in a row.` })
  }

  // Species-specific ratios
  const ratio = (num: Partial<Filter>, den: Partial<Filter>) => {
    const d = stateTotal(f, year, den)
    return d > 0 ? stateTotal(f, year, num) / d : NaN
  }
  if (sp === 'deer') {
    const open = ratio({ portions: ['opening_weekend'], method: '', youth: '' }, { portions: ['november'], method: '', youth: '' })
    if (Number.isFinite(open) && open > 0) facts.push({ id: 'opening', value: pct(open, 0), caption: 'of November',
      text: `Opening weekend was ${pct(open, 0)} of the November portion in ${season(year)}.` })
    const bd = ratio({ classes: ['antlered_buck'] }, { classes: ['doe'] })
    if (Number.isFinite(bd) && bd > 0) facts.push({ id: 'buckdoe', value: bd.toFixed(2), caption: 'bucks per doe',
      text: `${f.region ? `In the ${f.region} region` : 'Statewide'}, hunters${where} took ${bd.toFixed(2)} antlered bucks for every doe.` })
    const arch = ratio({ portions: ['archery'], method: '' }, { portions: [], method: '' })
    if (Number.isFinite(arch) && arch > 0) facts.push({ id: 'archery', value: pct(arch, 0), caption: 'archery share',
      text: `Archery hunters took ${pct(arch)} of the ${season(year)} deer harvest ${scope}.` })
  } else {
    const spring = stateTotal(f, year, { season: 'spring', portions: [] }), fall = stateTotal(f, year, { season: 'fall', portions: [] })
    if (spring > 0 && fall > 0) facts.push({ id: 'springfall', value: `${(spring / fall).toFixed(1)}:1`, caption: 'spring : fall',
      text: `Spring outdrew fall ${(spring / fall).toFixed(1)} to 1 in ${year} (${fmt(spring)} vs ${fmt(fall)} birds).` })
    if (attrs) {
      const pl = countyMetric(ds, counties, f, regionOf, 'public_land_share', year, attrs).values
      const minBirds = 50
      const pi = argmax(pl.map((v, i) => (cur[i] >= minBirds ? v : NaN)))
      if (pi >= 0 && pl[pi] > 0) facts.push({ id: 'public', fips: ds.dict.county[pi], value: pct(pl[pi], 0), caption: 'on public land',
        text: `${name(pi)} led public-land share: ${pct(pl[pi], 0)} of its turkeys came off public land (counties with ${minBirds}+ birds).` })
    }
  }

  // Biggest gain and loss in raw numbers
  if (prev) {
    const delta = cur.map((v, i) => (prev[i] > 0 || v > 0 ? v - prev[i] : NaN))
    const g = argmax(delta), l = argmax(delta.map((v) => -v))
    if (g >= 0 && delta[g] > 0) facts.push({ id: 'gain', fips: ds.dict.county[g], value: `+${fmt(delta[g])}`, caption: `vs ${season(year - 1)}`,
      text: `${name(g)} gained ${fmt(delta[g])} ${animals} over last season, the biggest jump ${scope}.` })
    if (l >= 0 && delta[l] < 0) facts.push({ id: 'loss', fips: ds.dict.county[l], value: `−${fmt(-delta[l])}`, caption: `vs ${season(year - 1)}`,
      text: `${name(l)} fell by ${fmt(-delta[l])} ${animals}, the biggest drop ${scope}.` })
  }

  // vs 5-season average
  const back = series.length ? Math.min(5, yi) : 0
  if (back >= 3) {
    let s = 0
    for (let y = yi - back; y < yi; y++) s += sum(col(y))
    const avg = s / back, d = T / avg - 1
    if (avg > 0) facts.push({ id: 'avg5', value: `${d > 0 ? '+' : ''}${pct(d)}`, caption: `vs ${back}-season avg`,
      text: `${season(year)} came in ${pct(Math.abs(d))} ${d >= 0 ? 'above' : 'below'} the ${back}-season average${where}.` })
  }

  // Region share (statewide view only)
  if (!f.region) {
    const byRegion = new Map<string, number>()
    cur.forEach((v, i) => { const r = regionOf(ds.dict.county[i]); if (r && v) byRegion.set(r, (byRegion.get(r) ?? 0) + v) })
    const top = [...byRegion].sort((a, b) => b[1] - a[1])[0]
    if (top) facts.push({ id: 'region', value: pct(top[1] / T, 0), caption: 'of the state',
      text: `The ${top[0]} region accounted for ${pct(top[1] / T)} of Missouri's ${animals}${where}.` })
  }

  return facts
}
