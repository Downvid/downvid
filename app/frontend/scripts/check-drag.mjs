/**
 * 验证顶栏的拖拽区与 macOS 红绿灯让位。
 *
 * 这两条只能靠**计算后的样式**确认：
 *   - `-webkit-app-region: drag` 没生效 → 整个窗口拖不动（没有任何报错）
 *   - 按钮没有 `no-drag` → 点不动（同样没有报错）
 *   - macOS 没给 84px 左内边距 → 品牌标识被红绿灯压住
 */
import puppeteer from 'puppeteer-core'

const BASE = process.argv[2] || 'http://localhost:5173'
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1200, height: 860 })
await page.goto(BASE, { waitUntil: 'networkidle0' }).catch(() => {})
await new Promise((r) => setTimeout(r, 900))

const result = await page.evaluate(() => {
  const bar = document.querySelector('.topbar')
  if (!bar) return { error: '找不到 .topbar' }
  const cs = getComputedStyle(bar)
  const brand = document.querySelector('.brand')
  const brandRect = brand?.getBoundingClientRect()
  const navBtn = document.querySelector('.nav-item')
  const navCs = navBtn ? getComputedStyle(navBtn) : null
  return {
    appRegion: cs.getPropertyValue('-webkit-app-region') || cs.getPropertyValue('app-region'),
    paddingLeft: cs.paddingLeft,
    isMac: bar.classList.contains('is-mac'),
    brandLeft: brandRect ? Math.round(brandRect.left) : null,
    navRegion: navCs ? navCs.getPropertyValue('-webkit-app-region') || navCs.getPropertyValue('app-region') : null,
    // 拖拽区不能吞掉选择：标题被选中会让拖动变成"选文字"
    userSelect: cs.userSelect,
  }
})

const fails = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `：${detail}` : ''}`)
  if (!ok) fails.push(name)
}

if (result.error) {
  console.error('✗ ' + result.error)
  process.exit(1)
}

check('顶栏是拖拽区', /drag/.test(result.appRegion || ''), result.appRegion)
check('顶栏不可选中文本', result.userSelect === 'none', result.userSelect)
check('导航按钮退出了拖拽区', /no-drag/.test(result.navRegion || ''), result.navRegion)
// macOS 形态：手动给顶栏加 is-mac，验证红绿灯让位是否生效。
// 浏览器里拿不到 Wails 的 GetPlatform，只能这样模拟。
const macResult = await page.evaluate(() => {
  const bar = document.querySelector('.topbar')
  bar.classList.add('is-mac')
  const cs = getComputedStyle(bar)
  const brand = document.querySelector('.brand')?.getBoundingClientRect()
  return { paddingLeft: cs.paddingLeft, brandLeft: brand ? Math.round(brand.left) : null }
})
const pad = parseInt(macResult.paddingLeft, 10)
check(
  'macOS 形态为红绿灯让出空间（>=78px）',
  pad >= 78 && macResult.brandLeft >= 78,
  `左内边距 ${macResult.paddingLeft}，品牌左边缘 ${macResult.brandLeft}px`,
)

console.log(`· 非 mac 形态：左内边距 ${result.paddingLeft}，品牌左边缘 ${result.brandLeft}px`)

await browser.close()
process.exit(fails.length ? 1 : 0)
