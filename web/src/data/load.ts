import type { Attributes, CompactJson, County, CwdJson, Dataset, Species } from './types'

const base = import.meta.env.BASE_URL.replace(/\/$/, '')

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${base}/data/${path}`)
  if (!r.ok) throw new Error(`failed to load ${path}: ${r.status}`)
  return r.json() as Promise<T>
}

function encode(values: string[]): { codes: Uint8Array; dict: string[] } {
  const dict: string[] = []
  const idx = new Map<string, number>()
  const codes = new Uint8Array(values.length)
  for (let i = 0; i < values.length; i++) {
    let c = idx.get(values[i])
    if (c === undefined) {
      c = dict.length
      dict.push(values[i])
      idx.set(values[i], c)
    }
    codes[i] = c
  }
  return { codes, dict }
}

export function toDataset(j: CompactJson, species: Species, countyOrder: string[]): Dataset {
  const col = (name: string) => j.columns.indexOf(name)
  const iYear = col('season_year'), iSeason = col('season'), iPortion = col('portion'), iMethod = col('method')
  const iYouth = col('youth'), iSub = col('is_subtotal'), iDer = col('derived'), iCounty = col('county_fips')
  const iCls = col('class'), iCount = col('count')
  const n = j.rows.length
  const year = new Int16Array(n), youth = new Uint8Array(n), isSubtotal = new Uint8Array(n)
  const derived = new Uint8Array(n), count = new Int32Array(n), county = new Uint8Array(n)
  const countyIdx = new Map(countyOrder.map((f, i) => [f, i]))
  const seasonS: string[] = [], portionS: string[] = [], methodS: string[] = [], clsS: string[] = []
  const yearSet = new Set<number>()
  for (let i = 0; i < n; i++) {
    const r = j.rows[i]
    year[i] = r[iYear] as number
    yearSet.add(year[i])
    youth[i] = r[iYouth] ? 1 : 0
    isSubtotal[i] = r[iSub] ? 1 : 0
    derived[i] = r[iDer] ? 1 : 0
    count[i] = r[iCount] as number
    const ci = countyIdx.get(r[iCounty] as string)
    if (ci === undefined) throw new Error(`unknown county ${r[iCounty]}`)
    county[i] = ci
    seasonS.push(r[iSeason] as string)
    portionS.push(r[iPortion] as string)
    methodS.push(r[iMethod] as string)
    clsS.push(r[iCls] as string)
  }
  const season = encode(seasonS), portion = encode(portionS), method = encode(methodS), cls = encode(clsS)
  return {
    species, n, year, youth, isSubtotal, derived, count, county,
    season: season.codes, portion: portion.codes, method: method.codes, cls: cls.codes,
    dict: { season: season.dict, portion: portion.dict, method: method.dict, cls: cls.dict, county: countyOrder },
    years: [...yearSet].sort((a, b) => a - b),
    labels: j.labels ?? {},
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
    const [j, counties] = await Promise.all([getJson<CompactJson>(`harvest_${species}.json`), loadCounties()])
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
