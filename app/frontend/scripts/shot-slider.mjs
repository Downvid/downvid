/**
 * 截图并检查滑块实际渲染（本地开发验证用）。
 *
 * ## 为什么需要它
 *
 * 辐射层是 canvas 绘制的，**代码正确不等于视觉正确**：
 * 配色比例、混合模式、叠层顺序都只能看渲染结果。
 * 之前连续三版都「代码通过、看着不对」，就是因为缺少这一步。
 *
 * 用法：
 *   node scripts/shot-slider.mjs                 # 截 4 个档位
 *   node scripts/shot-slider.mjs http://localhost:5173
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BASE = process.argv[2] || 'http://localhost:5174'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

if (!fs.existsSync(CHROME)) {
  console.error('找不到 Chrome：' + CHROME)
  process.exit(1)
}

const outDir = path.join(os.tmpdir(), 'downvid-shots')
fs.mkdirSync(outDir, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=2'],
})

const page = await browser.newPage()
await page.setViewport({ width: 900, height: 400, deviceScaleFactor: 2 })
await page.goto(BASE, { waitUntil: 'networkidle0' }).catch(() => {})
await new Promise((r) => setTimeout(r, 1200))

// 找到滑块，逐个档位截图
const found = await page.evaluate(() => {
  const el = document.querySelector('.effort-slider')
  if (!el) return { ok: false, html: document.body.innerHTML.slice(0, 300) }
  const r = el.getBoundingClientRect()
  return { ok: true, rect: { x: r.x, y: r.y, w: r.width, h: r.height } }
})

if (!found.ok) {
  console.error('页面上找不到 .effort-slider')
  console.error(found.html)
  await browser.close()
  process.exit(1)
}

console.log('滑块位置：', found.rect)

// 键盘 Home/End 切档，逐档截图
const shots = []
for (let i = 0; i < 4; i++) {
  await page.evaluate((idx) => {
    const thumb = document.querySelector('.effort-thumb')
    if (!thumb) return
    thumb.focus()
  }, i)

  // 用 Home 回第一档，再按 Right i 次
  await page.keyboard.press('Home')
  for (let k = 0; k < i; k++) await page.keyboard.press('ArrowRight')
  await new Promise((r) => setTimeout(r, 500))

  const file = path.join(outDir, `effort-${i}.png`)
  const clip = {
    x: Math.max(0, found.rect.x - 20),
    y: Math.max(0, found.rect.y - 28),
    width: found.rect.w + 40,
    height: found.rect.h + 56,
  }
  await page.screenshot({ path: file, clip })
  shots.push(file)
  console.log(`第 ${i} 档 → ${file}`)
}

// 也截一张整页，看上下文
await page.screenshot({ path: path.join(outDir, 'page.png') })
console.log('整页 →', path.join(outDir, 'page.png'))

await browser.close()
console.log('\n截图目录：' + outDir)
