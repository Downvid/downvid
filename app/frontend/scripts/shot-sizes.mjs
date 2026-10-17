import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BASE = process.argv[2] || 'http://localhost:5174'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const outDir = path.join(os.tmpdir(), 'downvid-shots')
fs.mkdirSync(outDir, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=2'],
})
const sizes = [[880, 560], [1024, 700], [1200, 900]]
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
for (const [w, h] of sizes) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 })
  await page.goto(BASE, { waitUntil: 'networkidle0' }).catch(() => {})
  await new Promise((r) => setTimeout(r, 900))
  const file = path.join(outDir, `size-${w}x${h}.png`)
  await page.screenshot({ path: file })
  // 溢出检测：横向滚动条 = 布局破了
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }))
  console.log(`${w}x${h} -> ${file} scrollW=${overflow.scrollW} clientW=${overflow.clientW}${overflow.scrollW > overflow.clientW ? '  ⚠ 横向溢出' : ''}`)
}
if (errors.length) console.log('页面错误：', errors.slice(0, 5))
await browser.close()
