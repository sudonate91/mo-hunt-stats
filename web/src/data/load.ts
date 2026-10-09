import type { Attributes, CompactJson, County, CwdJson, Dataset, EffortJson, HarvestJson, Species } from './types'

const base = import.meta.env.BASE_URL.replace(/\/$/, '')

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${base}/data/${path}`)
  if (!r.ok) throw new Error(`failed to load ${path}: ${r.status}`)
  return r.json() as Promise<T>
}

export function toDataset(j: HarvestJson, species: Species, countyOrder: string[]): Dataset {
  const countyIdx = new Map(countyOrder.map((f, i) => [f, i]))
  const jc = j.counties.map((f) => {
    const i = countyIdx.get(f)
    if (i === undefined) throw new Error(`unknown county ${f}`)
    return i
  })
  // Count non-zero cells first so the typed arrays are allocated once.
  let n = 0
  for (const s of j.series) for (const v of s[3]) if (v) n++
  const year = new Int16Array(n), youth = new Uint8Array(n), isSubtotal = new Uint8Array(n)
  const derived = new Uint8Array(n), count = new Int32Array(n), county = new Uint8Array(n)
  const season = new Uint8Array(n), portion = new Uint8Array(n), method = new Uint8Array(n), cls = new Uint8Array(n)
  const dict = { season: [] as string[], portion: [] as string[], method: [] as string[], cls: j.classes.slice(), county: countyOrder }
  const code = (list: string[], v: string) => { let i = list.indexOf(v); if (i < 0) { i = list.length; list.push(v) } return i }
  const yearSet = new Set<number>()
  let k = 0
  for (const [y, p, c, counts] of j.series) {
    const meta = j.portions[p]
    const pc = code(dict.portion, p), sc = code(dict.season, meta.season), mc = code(dict.method, meta.method)
    const cc = dict.cls.indexOf(c)
    const der = j.labels[`${species}:${y}:${p}`]?.derived ? 1 : 0
    yearSet.add(y)
    for (let i = 0; i < counts.length; i++) {
      const v = counts[i]
      if (!v) continue
      year[k] = y; portion[k] = pc; season[k] = sc; method[k] = mc; cls[k] = cc
      youth[k] = meta.youth ? 1 : 0; isSubtotal[k] = meta.is_subtotal ? 1 : 0; derived[k] = der
      county[k] = jc[i]; count[k] = v
      k++
    }
  }
  return {
    species, n, year, youth, isSubtotal, derived, count, county, season, portion, method, cls, dict,
    years: [...yearSet].sort((a, b) => a - b),
    labels: j.labels ?? {},
    portionMeta: j.portions,
  }
}

const cache = new Map<string, Promise<unknown>>()
function once<T>(key: string, f: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined
  if (!p) { p = f(); cache.set(key, p) }
  return p
}

export const loadCounties = () => once('counties', () => getJson<County[]>('county.json'))

export const loadDataset = (species: Species) =>
  once(`ds:${species}`, async () => {
    const [j, counties] = await Promise.all([getJson<HarvestJson>(`harvest_${species}.json`), loadCounties()])
    return toDataset(j, species, counties.map((c) => c.fips))
  })

export const loadAttributes = () =>
  once('attrs', async (): Promise<Attributes> => {
    const j = await getJson<CompactJson>('turkey_attributes.json')
    const c = (name: string) => j.columns.indexOf(name)
    const iY = c('season_year'), iP = c('portion'), iF = c('county_fips'), iPL = c('public_land'), iX = c('crossbow')
    const byKey = new Map<string, { public_land: number; crossbow: number }>()
    for (const r of j.rows) byKey.set(`${r[iY]}:${r[iP]}:${r[iF]}`, { public_land: r[iPL] as number, crossbow: r[iX] as number })
    return { byKey }
  })

export const loadCwd = () => once('cwd', () => getJson<CwdJson>('cwd.json'))

export const loadEffort = () => once('effort', () => getJson<EffortJson>('effort.json'))
