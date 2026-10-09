export type Species = 'deer' | 'turkey'
export type Season = 'spring' | 'fall'
export type Method = 'firearm' | 'archery' | 'mixed'

/** Row-array JSON (turkey_attributes.json) written by scraper/mohunt/build.py compact_json(labels=False). */
export interface CompactJson {
  state: string
  columns: string[]
  rows: (string | number | boolean)[][]
}

export interface PortionMeta { season: Season; method: Method; youth: boolean; is_subtotal: boolean }

/** Pivoted harvest JSON (harvest_<species>.json): one dense county array per (year, portion, class). */
export interface HarvestJson {
  state: string
  species: Species
  counties: string[] // fips, order of every counts array
  classes: string[]
  portions: Record<string, PortionMeta>
  series: [number, string, string, number[]][] // [season_year, portion, class, counts by county]
  labels: Record<string, { portion_label: string; source_url: string; derived: boolean }>
}

export interface County {
  fips: string
  name: string
  mdc_region: string
  land_area_sq_mi: number
  centroid: [number, number]
  bear_management_zone: string | null
  cwd_zone: string | null
}

export interface CwdRow {
  county_fips: string
  year: number
  samples: number
  positives: number
  splits?: {
    by_sex: Record<string, { samples: number; positives: number }>
    by_age: Record<string, { samples: number; positives: number }>
  } | null
}

export interface CwdJson {
  source: string
  fetched: string
  current_season: number
  rows: CwdRow[]
}

/** Dictionary-encoded columnar store for one species: all filtering happens on Int16/Int32 arrays. */
export interface Dataset {
  species: Species
  n: number
  year: Int16Array
  season: Uint8Array
  portion: Uint8Array
  method: Uint8Array
  youth: Uint8Array
  isSubtotal: Uint8Array
  derived: Uint8Array
  county: Uint8Array // index into counties list (fips order)
  cls: Uint8Array
  count: Int32Array
  dict: {
    season: string[]
    portion: string[]
    method: string[]
    cls: string[]
    county: string[] // fips
  }
  years: number[] // sorted distinct season years
  labels: Record<string, { portion_label: string; source_url: string; derived: boolean }>
  portionMeta: Record<string, PortionMeta>
}

export interface Attributes {
  // turkey public-land / crossbow counts keyed `${year}:${portion}:${fips}`
  byKey: Map<string, { public_land: number; crossbow: number }>
}
