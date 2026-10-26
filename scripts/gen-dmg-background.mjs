#!/usr/bin/env node
/**
 * 生成 DMG 的背景图（660×480，与 Finder 窗口尺寸一致），只依赖 Node 标准库。
 *
 * 为什么用脚本而不是提交一张 PNG：
 *  - 背景要跟品牌色一起改，脚本里改一个色值就能重出，不必找设计稿；
 *  - 仓库里少一个二进制，`pnpm audit:provenance` 也不用给它登记来源。
 *
 * 设计：深色渐变底 + 从应用图标位指向 Applications 的柔和箭头。
 * 图片让位给两个图标，所以左右两端留白，箭头落在中间偏上。
 *
 * 用法：node scripts/gen-dmg-background.mjs <输出路径>
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const WIDTH = 660
const HEIGHT = 480

/** 品牌深色（与 app/frontend 的 --panel-dark 同一族，避免 DMG 与界面割裂） */
const TOP = [26, 32, 44]
const BOTTOM = [16, 20, 28]
const ACCENT = [247, 183, 49]

const px = (x, y) => {
  // 纵向渐变
  const t = y / (HEIGHT - 1)
  const base = TOP.map((c, i) => Math.round(c + (BOTTOM[i] - c) * t))

  // 箭头：水平中线略上，用平滑的「带子 + 三角」形状
  const cy = HEIGHT * 0.5
  const bandFrom = WIDTH * 0.30
  const bandTo = WIDTH * 0.58
  const halfBand = HEIGHT * 0.011
  const headFrom = bandTo
  const headTo = WIDTH * 0.66
  const dy = Math.abs(y - cy)

  let alpha = 0
  if (x >= bandFrom && x <= bandTo && dy <= halfBand) {
    alpha = 0.82
  } else if (x > headFrom && x <= headTo) {
    // 三角：越靠右越窄
    const k = (x - headFrom) / (headTo - headFrom)
    const half = halfBand * 4.5 * (1 - k)
    if (dy <= half) alpha = 0.82 * (1 - k * 0.25)
  }
  if (alpha > 0) {
    return base.map((c, i) => Math.round(c + (ACCENT[i] - c) * alpha))
  }
  return base
}

const crcTable = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

const crc32 = (buf) => {
  let c = 0xffffffff
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

// 每行前面加 filter byte 0（None），再整体 deflate
const raw = Buffer.alloc(HEIGHT * (1 + WIDTH * 3))
let at = 0
for (let y = 0; y < HEIGHT; y++) {
  raw[at++] = 0
  for (let x = 0; x < WIDTH; x++) {
    const [r, g, b] = px(x, y)
    raw[at++] = r
    raw[at++] = g
    raw[at++] = b
  }
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(WIDTH, 0)
ihdr.writeUInt32BE(HEIGHT, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 2 // truecolour

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const out = process.argv[2]
if (!out) {
  console.error('用法：node scripts/gen-dmg-background.mjs <输出路径>')
  process.exit(1)
}
writeFileSync(out, png)
console.log(`已生成 DMG 背景图：${out}（${WIDTH}×${HEIGHT}，${png.length} 字节）`)
