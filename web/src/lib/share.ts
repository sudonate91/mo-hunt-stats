/**
 * Share a chart <figure> as a PNG (lazy-imported on click; no dependencies).
 *
 * The figure is rasterized at 2x onto an offscreen canvas with the dark background, its title (data-share-title),
 * units, legend, the chart itself (an SVG with role="img", or a uPlot canvas) and a credit line. Figures with
 * data-share-text / data-share-value (fact cards) render as a text card instead. Phones get the native share sheet
 * (navigator.share with files); everything else downloads the file.
 */

const BG = '#121212', FG = '#f2f2f2', FG2 = '#b5b5b8', FG3 = '#939399', BLAZE = '#ff6a13'
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
const CREDIT = 'Source: Missouri Department of Conservation · mo-hunt-stats'
const SCALE = 2, PAD = 20

/** SVG presentation properties copied from computed style so CSS-class styling (e.g. map counties) survives. */
const STYLE_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'opacity',
  'font-size', 'font-weight', 'font-family', 'text-anchor', 'dominant-baseline', 'visibility', 'display']

function inlineStyles(src: Element, dst: Element) {
  const cs = getComputedStyle(src)
  let s = ''
  for (const p of STYLE_PROPS) {
    const v = cs.getPropertyValue(p)
    if (v) s += `${p}:${v};`
  }
  dst.setAttribute('style', s)
  for (let i = 0; i < src.children.length && i < dst.children.length; i++) inlineStyles(src.children[i], dst.children[i])
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not render the chart image'))
    img.src = src
  })
}

interface Drawable { draw: (ctx: CanvasRenderingContext2D, x: number, y: number) => void; w: number; h: number }

async function svgDrawable(svg: SVGSVGElement): Promise<Drawable> {
  const { width: w, height: h } = svg.getBoundingClientRect()
  const clone = svg.cloneNode(true) as SVGSVGElement
  inlineStyles(svg, clone)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  clone.querySelectorAll('title').forEach((t) => t.remove())
  const xml = new XMLSerializer().serializeToString(clone)
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`)
  return { w, h, draw: (ctx, x, y) => ctx.drawImage(img, x, y, w, h) }
}

function canvasDrawable(root: HTMLElement): Drawable | null {
  const canvases = [...root.querySelectorAll('canvas')]
  if (!canvases.length) return null
  const box = root.getBoundingClientRect()
  const w = box.width, h = box.height
  return {
    w, h,
    draw: (ctx, x, y) => {
      for (const c of canvases) {
        const r = c.getBoundingClientRect()
        ctx.drawImage(c, x + r.left - box.left, y + r.top - box.top, r.width, r.height)
      }
    },
  }
}

interface LegendItem { label: string; color: string }

function legendItems(fig: HTMLElement): LegendItem[] {
  const out: LegendItem[] = []
  // uPlot legend rows (first row is the x series)
  fig.querySelectorAll<HTMLElement>('.u-legend .u-series').forEach((row, i) => {
    if (i === 0 || row.classList.contains('u-off')) return
    const label = row.querySelector('.u-label')?.textContent?.trim()
    const marker = row.querySelector<HTMLElement>('.u-marker')
    if (label && marker) out.push({ label, color: getComputedStyle(marker).borderTopColor })
  })
  // hand-built legends: <ul><li><span style="background:…"/>Label</li></ul>
  fig.querySelectorAll<HTMLElement>('ul > li').forEach((li) => {
    const sw = li.querySelector<HTMLElement>('span')
    const label = li.textContent?.trim()
    if (sw && label) out.push({ label, color: getComputedStyle(sw).backgroundColor })
  })
  return out
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (line && ctx.measureText(next).width > maxW) { lines.push(line); line = word } else line = next
  }
  if (line) lines.push(line)
  return lines
}

function layoutLegend(ctx: CanvasRenderingContext2D, items: LegendItem[], maxW: number) {
  ctx.font = `12px ${FONT}`
  const rows: { item: LegendItem; x: number }[][] = [[]]
  let x = 0
  for (const item of items) {
    const w = 16 + ctx.measureText(item.label).width + 14
    if (x > 0 && x + w > maxW) { rows.push([]); x = 0 }
    rows[rows.length - 1].push({ item, x })
    x += w
  }
  return items.length ? rows : []
}

export interface ShareImage { blob: Blob; name: string; title: string }

/** Rasterize figure `id` to a PNG blob. */
export async function figureToPng(id: string): Promise<ShareImage> {
  const fig = document.getElementById(id)
  if (!fig) throw new Error('Nothing to share')
  const title = fig.dataset.shareTitle || document.title
  const text = fig.dataset.shareText
  const measure = document.createElement('canvas').getContext('2d')!

  let body: Drawable
  if (text) {
    // Fact card: big number + wrapped sentence
    const value = fig.dataset.shareValue ?? ''
    const w = 520
    measure.font = `20px ${FONT}`
    const lines = wrap(measure, text, w)
    const h = (value ? 56 : 0) + lines.length * 28
    body = {
      w, h,
      draw: (ctx, x, y) => {
        if (value) { ctx.fillStyle = BLAZE; ctx.font = `bold 44px ${FONT}`; ctx.fillText(value, x, y + 44) }
        ctx.fillStyle = FG; ctx.font = `20px ${FONT}`
        lines.forEach((l, i) => ctx.fillText(l, x, y + (value ? 56 : 0) + 22 + i * 28))
      },
    }
  } else {
    const svg = fig.querySelector<SVGSVGElement>('svg[role="img"]')
    const plot = fig.querySelector<HTMLElement>('.uplot .u-wrap')
    const d = svg ? await svgDrawable(svg) : plot ? canvasDrawable(plot) : null
    if (!d) throw new Error('Switch to the chart view to share an image')
    body = d
  }

  const units = text ? '' : fig.querySelector('p > span')?.textContent?.trim() ?? ''
  const W = Math.max(360, Math.ceil(body.w)) + PAD * 2
  const legend = text ? [] : layoutLegend(measure, legendItems(fig), W - PAD * 2)
  measure.font = `600 17px ${FONT}`
  const titleLines = wrap(measure, title, W - PAD * 2)
  const titleH = titleLines.length * 22 + (units ? 20 : 0) + 10
  const legendH = legend.length * 20 + (legend.length ? 8 : 0)
  const H = PAD + titleH + Math.ceil(body.h) + legendH + 16 + 20 + PAD

  const canvas = document.createElement('canvas')
  canvas.width = W * SCALE
  canvas.height = H * SCALE
  const ctx = canvas.getContext('2d')!
  ctx.scale(SCALE, SCALE)
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)
  ctx.textBaseline = 'alphabetic'

  let y = PAD
  ctx.fillStyle = FG; ctx.font = `600 17px ${FONT}`
  titleLines.forEach((l) => { y += 22; ctx.fillText(l, PAD, y - 5) })
  if (units) { ctx.fillStyle = FG3; ctx.font = `12px ${FONT}`; y += 20; ctx.fillText(units, PAD, y - 5) }
  y += 10
  body.draw(ctx, PAD, y)
  y += Math.ceil(body.h) + (legend.length ? 8 : 0)
  ctx.font = `12px ${FONT}`
  for (const row of legend) {
    for (const { item, x } of row) {
      ctx.fillStyle = item.color; ctx.fillRect(PAD + x, y + 4, 10, 10)
      ctx.fillStyle = FG2; ctx.fillText(item.label, PAD + x + 16, y + 13)
    }
    y += 20
  }
  ctx.strokeStyle = '#343436'; ctx.beginPath(); ctx.moveTo(PAD, H - PAD - 24); ctx.lineTo(W - PAD, H - PAD - 24); ctx.stroke()
  ctx.fillStyle = FG3; ctx.font = `12px ${FONT}`
  ctx.fillText(CREDIT, PAD, H - PAD - 4)

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'))
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'chart'
  return { blob, name: `mo-hunt-stats-${slug}.png`, title }
}

/** Native share sheet only on touch devices; desktops get a download. */
export function canShareFiles(): boolean {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false
  if (!matchMedia('(pointer: coarse)').matches) return false
  return navigator.canShare({ files: [new File([], 'x.png', { type: 'image/png' })] })
}

export type ShareResult = 'shared' | 'downloaded' | 'cancelled'

export async function shareFigure(id: string): Promise<ShareResult> {
  const { blob, name, title } = await figureToPng(id)
  const file = new File([blob], name, { type: 'image/png' })
  if (canShareFiles() && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text: `${title} · ${location.href}` })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      // fall through to download
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'downloaded'
}

/** Copy the current (filter-encoded) URL. Returns false when the clipboard is unavailable. */
export async function copyLink(url = location.href): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = url
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch { ok = false }
    ta.remove()
    return ok
  }
}
