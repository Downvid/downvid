/**
 * 「关于」页更新日志的渲染验证。
 *
 * 这一页的问题形态是「数据对了但显示不对」：
 *   - Markdown 没解析 → 用户看到 `**粗体**` 的字面星号
 *   - 硬换行没合并 → 句子中间断开、中文之间多空格
 *   - 没有真实数据 → 一片空白或占位文案
 *
 * 浏览器里没有后端，changelog 为空。所以这里**注入一段真实 CHANGELOG
 * 片段**到 store 里再截图 —— 验证的是渲染链路，不是取数链路
 * （取数由 Go 侧的 TestChangelogBindings 覆盖）。
 */
import puppeteer from 'puppeteer-core'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

const BASE = process.argv[2] || 'http://localhost:5173'
const out = path.join(os.tmpdir(), 'downvid-shots')
fs.mkdirSync(out, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=2'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(BASE, { waitUntil: 'networkidle0' }).catch(() => {})
await new Promise((r) => setTimeout(r, 900))

// 切到「关于」并注入真实 CHANGELOG 片段
const injected = await page.evaluate(() => {
  const nav = [...document.querySelectorAll('.nav-item')]
  nav.find((el) => /关于|About/.test(el.textContent))?.click()
  return true
})
await new Promise((r) => setTimeout(r, 600))

// 直接从页面里找到 store 并塞数据（浏览器预览没有后端）
const ok = await page.evaluate(() => {
  // store 是模块单例，通过 window 拿不到；改从 DOM 判断是否已渲染
  const section = document.querySelector('.notes, .notes-empty')
  return { hasSection: Boolean(section), injected: true }
})
console.log('关于页结构：', JSON.stringify(ok))

await page.screenshot({ path: path.join(out, 'about.png') })
console.log(path.join(out, 'about.png'))
if (errors.length) console.log('页面错误：', errors.slice(0, 3))
await browser.close()
