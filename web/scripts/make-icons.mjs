// Writes public/icons/{icon-192,icon-512,maskable-512,apple-touch-icon}.png and icon.svg with a tiny PNG encoder
// (node:zlib + CRC32, no canvas). Blaze-orange rounded square with a white "MO" pixel glyph. Run: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const CRC = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0 })
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b }
const chunk = (type, data) => { const td = Buffer.concat([Buffer.from(type), data]); return Buffer.concat([u32(data.length), td, u32(crc(td))]) }

// 11 x 5 glyph grid: "M", gap, "O"
const GLYPH = ['10001001110', '11011010001', '10101010001', '10001010001', '10001001110']
const ORANGE = [255, 106, 19], WHITE = [255, 255, 255]

function shape(size, radius, x, y) { // 1 = inside rounded square
  const r = radius * size, cx = Math.min(Math.max(x, r), size - r), cy = Math.min(Math.max(y, r), size - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r ? 1 : 0
}
function glyph(size, scale, x, y) {
  const cell = (size * scale) / 11, ox = (size - cell * 11) / 2, oy = (size - cell * 5) / 2
  const gx = Math.floor((x - ox) / cell), gy = Math.floor((y - oy) / cell)
  return gy >= 0 && gy < 5 && gx >= 0 && gx < 11 && GLYPH[gy][gx] === '1' ? 1 : 0
}

function png(size, { radius, scale }) {
  const SS = 4, row = size * 4 + 1, raw = Buffer.alloc(row * size)
  for (let py = 0; py < size; py++) {
    raw[py * row] = 0 // filter: none
    for (let px = 0; px < size; px++) {
      let bg = 0, fg = 0
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const x = px + (sx + 0.5) / SS, y = py + (sy + 0.5) / SS
        bg += shape(size, radius, x, y); fg += glyph(size, scale, x, y)
      }
      const a = bg / SS / SS, g = fg / SS / SS, o = py * row + 1 + px * 4
      for (let k = 0; k < 3; k++) raw[o + k] = Math.round(ORANGE[k] * (1 - g) + WHITE[k] * g)
      raw[o + 3] = Math.round(255 * Math.max(a, g))
    }
  }
  const ihdr = Buffer.concat([u32(size), u32(size), Buffer.from([8, 6, 0, 0, 0])]) // 8-bit RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

const dir = new URL('../public/icons/', import.meta.url)
mkdirSync(dir, { recursive: true })
writeFileSync(new URL('icon-192.png', dir), png(192, { radius: 0.2, scale: 0.6 }))
writeFileSync(new URL('icon-512.png', dir), png(512, { radius: 0.2, scale: 0.6 }))
writeFileSync(new URL('apple-touch-icon.png', dir), png(180, { radius: 0, scale: 0.6 }))
writeFileSync(new URL('maskable-512.png', dir), png(512, { radius: 0, scale: 0.5 })) // glyph inside the 80% safe zone
const rects = GLYPH.flatMap((r, y) => [...r].map((c, x) => (c === '1' ? `<rect x="${x}" y="${y}" width="1.02" height="1.02"/>` : ''))).join('')
writeFileSync(new URL('icon.svg', dir), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="#ff6a13"/><g fill="#fff" transform="translate(20 36.36) scale(5.4545)">${rects}</g></svg>\n`)
console.log('icons written to public/icons/')
