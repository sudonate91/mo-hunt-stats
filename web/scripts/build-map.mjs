// Build-time step: project county GeoJSON to SVG path strings and copy data JSON into public/data.
// Usage: node scripts/build-map.mjs   (run automatically by `npm run build` / `npm run dev` via prebuild)
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync } from 'node:fs'
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

const map = {
  viewBox: `0 0 ${W} ${H}`,
  width: W,
  height: H,
  paths,
  labels,
  names: Object.fromEntries(Object.keys(paths).map((f) => [f, byFips[f]?.name ?? f])),
}
writeFileSync(join(outGenerated, 'map.json'), JSON.stringify(map))
console.log(`map.json: ${Object.keys(paths).length} counties, viewBox ${map.viewBox}, ${(statSync(join(outGenerated, 'map.json')).size / 1024).toFixed(0)} KB`)

for (const f of ['harvest_deer.json', 'harvest_turkey.json', 'turkey_attributes.json', 'cwd.json', 'county.json']) {
  copyFileSync(join(dataDir, f), join(outPublic, f))
}
console.log('copied data JSON to public/data')
