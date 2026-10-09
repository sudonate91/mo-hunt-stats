// Build-time step: project county GeoJSON to SVG path strings and copy data JSON into public/data.
// Usage: node scripts/build-map.mjs   (run automatically by `npm run build` / `npm run dev` via prebuild)
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const dataDir = join(root, 'data')
const outGenerated = join(here, '..', 'src', 'generated')
const outPublic = join(here, '..', 'public', 'data')
mkdirSync(outGenerated, { recursive: true })
mkdirSync(outPublic, { recursive: true })

// --- Projection: Albers equal-area conic tuned for Missouri (standard parallels 36.5 / 40.5) ---
const d2r = Math.PI / 180
const phi1 = 36.5 * d2r, phi2 = 40.5 * d2r, phi0 = 38.5 * d2r, lam0 = -92.5 * d2r
const n = (Math.sin(phi1) + Math.sin(phi2)) / 2
const C = Math.cos(phi1) ** 2 + 2 * n * Math.sin(phi1)
const rho0 = Math.sqrt(C - 2 * n * Math.sin(phi0)) / n
function project([lon, lat]) {
  const lam = lon * d2r, phi = lat * d2r
  const rho = Math.sqrt(C - 2 * n * Math.sin(phi)) / n
  const theta = n * (lam - lam0)
  return [rho * Math.sin(theta), rho0 - rho * Math.cos(theta)]
}

const geo = JSON.parse(readFileSync(join(dataDir, 'counties.geojson'), 'utf8'))
const counties = JSON.parse(readFileSync(join(dataDir, 'county.json'), 'utf8'))
const byFips = Object.fromEntries(counties.map((c) => [c.fips, c]))

// Project everything, then fit to a 1000-wide viewBox.
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
const projected = geo.features.map((f) => {
  const rings = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates)
    .flat(1)
    .map((ring) => ring.map(project))
  for (const ring of rings) for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  return { fips: f.properties.fips, rings }
})
const W = 1000
const scale = W / (maxX - minX)
const H = Math.round((maxY - minY) * scale)
const fx = (x) => ((x - minX) * scale).toFixed(1)
const fy = (y) => (H - (y - minY) * scale).toFixed(1)

const paths = {}
const labels = {}
for (const { fips, rings } of projected) {
  paths[fips] = rings
    .map((ring) => 'M' + ring.map(([x, y]) => `${fx(x)} ${fy(y)}`).join('L') + 'Z')
    .join('')
  // Label point: area-weighted centroid of the largest ring (polygons here are simple).
  const ring = rings.reduce((a, b) => (b.length > a.length ? b : a))
  let a = 0, cx = 0, cy = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i], [x1, y1] = ring[i + 1]
    const cross = x0 * y1 - x1 * y0
    a += cross; cx += (x0 + x1) * cross; cy += (y0 + y1) * cross
  }
  a *= 0.5
  labels[fips] = [Number(fx(cx / (6 * a))), Number(fy(cy / (6 * a)))]
}

// --- Overlays (rivers, lakes, ecoregions, interstates, public land) in the same projected frame ---
// public/data/overlays.json: {layers: {<layer>: [{name, d, label?}]}}; lazy-loaded by the map when a layer is toggled.
const OVERLAY_ORDER = ['rivers', 'lakes', 'ecoregions', 'interstates', 'public_land']
const overlaySrc = join(dataDir, 'overlays.geojson')
const overlayLayers = {}
if (existsSync(overlaySrc)) {
  const og = JSON.parse(readFileSync(overlaySrc, 'utf8'))
  // Projected points rounded to the 0.1-unit output grid; consecutive duplicates dropped.
  const pts = (line) => {
    const out = []
    for (const p of line) {
      const [x, y] = project(p)
      const q = [fx(x), fy(y)]
      const last = out[out.length - 1]
      if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q)
    }
    return out
  }
  const lineD = (line) => { const p = pts(line); return p.length < 2 ? '' : 'M' + p.map((q) => q.join(' ')).join('L') }
  const ringD = (ring) => { const p = pts(ring.slice(0, -1)); return p.length < 3 ? '' : 'M' + p.map((q) => q.join(' ')).join('L') + 'Z' }
  /** Coarse pole of inaccessibility: the grid point inside the polygon farthest from any edge. */
  const labelPoint = (rings) => {
    const ring = rings.map((r) => r.map(([x, y]) => [Number(x), Number(y)]))
    const outer = ring.reduce((a, b) => (b.length > a.length ? b : a))
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const [x, y] of outer) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
    const inside = (x, y) => {
      let c = false
      for (const r of ring) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i], [xj, yj] = r[j]
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
      }
      return c
    }
    const edgeDist = (x, y) => {
      let best = Infinity
      for (const r of ring) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [ax, ay] = r[j], [bx, by] = r[i]
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy
        const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0
        best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy))
      }
      return best
    }
    let best = [(x0 + x1) / 2, (y0 + y1) / 2], bestD = -1
    const N = 40
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const x = x0 + ((x1 - x0) * i) / N, y = y0 + ((y1 - y0) * j) / N
      if (!inside(x, y)) continue
      // Prefer roomy points, nudged toward the state's middle so labels avoid the map edge.
      const d = Math.min(edgeDist(x, y), x, W - x, y, H - y)
      if (d > bestD) { bestD = d; best = [x, y] }
    }
    return [Math.round(best[0]), Math.round(best[1])]
  }
  for (const f of og.features) {
    const { layer, name } = f.properties
    const g = f.geometry
    let entry
    if (g.type === 'LineString' || g.type === 'MultiLineString') {
      const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates
      const d = lines.map(lineD).join('')
      if (d) entry = { name, d }
    } else if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
      const d = polys.flat(1).map(ringD).join('')
      if (d) {
        entry = { name, d }
        if (layer === 'ecoregions') {
          // Label the largest part of the region.
          const big = polys.reduce((a, b) => (b[0].length > a[0].length ? b : a))
          entry.label = labelPoint(big.map((r) => pts(r.slice(0, -1))))
        }
      }
    }
    if (entry) (overlayLayers[layer] ??= []).push(entry)
  }
  const ordered = Object.fromEntries(OVERLAY_ORDER.filter((l) => overlayLayers[l]).map((l) => [l, overlayLayers[l]]))
  writeFileSync(join(outPublic, 'overlays.json'), JSON.stringify({ layers: ordered }))
  console.log(`overlays.json: ${Object.entries(ordered).map(([k, v]) => `${k} ${v.length}`).join(', ')}, ${(statSync(join(outPublic, 'overlays.json')).size / 1024).toFixed(0)} KB`)
} else {
  writeFileSync(join(outPublic, 'overlays.json'), JSON.stringify({ layers: {} }))
  console.warn('overlays: data/overlays.geojson not found; run `python -m mohunt.overlays` (map overlays disabled)')
}

const map = {
  viewBox: `0 0 ${W} ${H}`,
  width: W,
  height: H,
  paths,
  labels,
  names: Object.fromEntries(Object.keys(paths).map((f) => [f, byFips[f]?.name ?? f])),
  overlayLayers: OVERLAY_ORDER.filter((l) => overlayLayers[l]), // which overlay chips to offer (data is lazy-loaded)
}
writeFileSync(join(outGenerated, 'map.json'), JSON.stringify(map))
console.log(`map.json: ${Object.keys(paths).length} counties, viewBox ${map.viewBox}, ${(statSync(join(outGenerated, 'map.json')).size / 1024).toFixed(0)} KB`)

for (const f of ['harvest_deer.json', 'harvest_turkey.json', 'turkey_attributes.json', 'cwd.json', 'county.json']) {
  copyFileSync(join(dataDir, f), join(outPublic, f))
}
console.log('copied data JSON to public/data')
