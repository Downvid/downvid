/**
 * 本地视觉验证：按目标页面截图到临时目录。
 *
 * ## 为什么需要一个统一的截图脚本
 *
 * 之前是三个独立脚本（shot-slider / shot-about / shot-settings / shot-sizes），
 * 每个都重复一份 puppeteer 启动样板。四个文件里真正不同的只有
 * 「切到哪个 tab、截什么尺寸」——那用一个参数就够。
 *
 * ## 为什么截图这件事不能省
 *
 * canvas 辐射层、玻璃拟态、响应式断点这些**代码正确不等于视觉正确**。
 * 之前连续三版「代码通过、看着不对」，就是因为没看渲染结果。
 *
 * 用法：
 *   node scripts/shot.mjs                         # 默认：首页 3 种尺寸
 *   node scripts/shot.mjs --tab=about             # 关于页
 *   node scripts/shot.mjs --tab=settings --section=acceleration
 *   node scripts/shot.mjs --size=880x560          # 指定单一尺寸
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)
const BASE = args.url || 'http://localhost:5173'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const tab = args.tab || 'download'
const outDir = path.join(os.tmpdir(), 'downvid-shots')
fs.mkdirSync(outDir, { recursive: true })

const sizes = args.size
  ? [args.size.split('x').map(Number)]
  : [[880, 560], [1024, 700], [1200, 900]]

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=2'],
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message)))

for (const [w, h] of sizes) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 })
  await page.goto(BASE, { waitUntil: 'networkidle0' }).catch(() => {})
  await new Promise((r) => setTimeout(r, 900))

  // 切 tab（首页是默认，不需要点）
  if (tab !== 'download') {
    const label = { about: /关于|About/, settings: /设置|Settings/, history: /历史|History/ }[tab]
    await page.evaluate((src) => {
      const re = new RegExp(src)
      const el = [...document.querySelectorAll('.nav-item')].find((e) => re.test(e.textContent))
      el?.click()
    }, label ? label.source : tab)
    await new Promise((r) => setTimeout(r, 600))
  }

  // 设置页的子分区
  if (tab === 'settings' && args.section) {
    await page.evaluate((name) => {
      const re = new RegExp(name)
      const el = [...document.querySelectorAll('.settings-nav button')].find((e) => re.test(e.textContent))
      el?.click()
    }, args.section)
    await new Promise((r) => setTimeout(r, 500))
  }

  const file = path.join(outDir, `${tab}${args.section ? '-' + args.section : ''}-${w}x${h}.png`)
  await page.screenshot({ path: file })

  // 横向溢出 = 布局破了，顺便报出来
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }))
  const bad = overflow.scrollW > overflow.clientW
  console.log(`${w}x${h} → ${file}${bad ? '  ⚠ 横向溢出' : ''}`)
}

if (errors.length) {
  console.log('页面错误：')
  for (const e of errors.slice(0, 5)) console.log('  ' + e)
}
await browser.close()
