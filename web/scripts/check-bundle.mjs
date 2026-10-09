// CI bundle budget: initial JS (scripts referenced by dist/index.html, incl. modulepreloads) must be ≤ 150 KB gzipped
// and must not regress more than 5% over the committed baseline in web/bundle-baseline.json.
// Usage: node scripts/check-bundle.mjs [--update]  (run after `npm run build`)
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dist = join(here, '..', 'dist')
const baselinePath = join(here, '..', 'bundle-baseline.json')
const BUDGET_INITIAL_GZ = 150 * 1024
const REGRESSION_TOLERANCE = 0.05

const html = readFileSync(join(dist, 'index.html'), 'utf8')
const refs = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1].replace(/^\.?\//, ''))
const gz = (p) => gzipSync(readFileSync(join(dist, p))).length

const initial = {}
for (const r of refs) initial[r.replace(/-[\w-]+(?=\.(js|css)$)/, '-*')] = gz(r)
const initialJs = Object.entries(initial).filter(([k]) => k.endsWith('.js')).reduce((s, [, v]) => s + v, 0)
const initialCss = Object.entries(initial).filter(([k]) => k.endsWith('.css')).reduce((s, [, v]) => s + v, 0)

const lazy = {}
for (const f of readdirSync(join(dist, 'assets'))) {
  if (!f.endsWith('.js')) continue
  const key = f.replace(/-[\w-]+\.js$/, '-*.js')
  if (!(key in initial)) lazy[key] = gz(join('assets', f))
}
const totalJs = initialJs + Object.values(lazy).reduce((s, v) => s + v, 0)

const report = { initialJsGz: initialJs, initialCssGz: initialCss, totalJsGz: totalJs, initial, lazy }
console.log(`initial JS ${(initialJs / 1024).toFixed(1)} KB gz, CSS ${(initialCss / 1024).toFixed(1)} KB gz, all JS ${(totalJs / 1024).toFixed(1)} KB gz`)
for (const [k, v] of Object.entries({ ...initial, ...lazy })) console.log(`  ${k.padEnd(32)} ${(v / 1024).toFixed(1)} KB`)

let failed = false
if (initialJs > BUDGET_INITIAL_GZ) { console.error(`FAIL: initial JS ${initialJs} B > budget ${BUDGET_INITIAL_GZ} B`); failed = true }

if (process.argv.includes('--update')) {
  writeFileSync(baselinePath, JSON.stringify({ initialJsGz: initialJs, totalJsGz: totalJs }, null, 2) + '\n')
  console.log('baseline updated')
} else if (existsSync(baselinePath)) {
  const base = JSON.parse(readFileSync(baselinePath, 'utf8'))
  for (const k of ['initialJsGz', 'totalJsGz']) {
    if (report[k] > base[k] * (1 + REGRESSION_TOLERANCE)) {
      console.error(`FAIL: ${k} ${report[k]} B regressed > ${REGRESSION_TOLERANCE * 100}% over baseline ${base[k]} B (run with --update to accept)`)
      failed = true
    }
  }
} else {
  console.warn('no bundle-baseline.json; run with --update to create one')
}
process.exit(failed ? 1 : 0)
