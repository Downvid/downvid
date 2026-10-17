/**
 * 滑块可拖动的**真实验证**。
 *
 * 之前「拖不动」排查了五轮都没修好，根因是数据流而不是视觉，
 * 而当时唯一的验证手段是看截图——截图看不出「拖了值有没有变」。
 *
 * 这里用真实鼠标事件驱动（不是直接改 state），然后断言设置值确实变了。
 * 浏览器里没有 Wails 后端时设置项不会落盘，但 store 的内存值仍然会变，
 * 所以这条能覆盖「拖动 → 组件 commit → store.updateSetting」整条链路。
 */
import puppeteer from 'puppeteer-core'

const BASE = process.argv[2] || 'http://localhost:5173'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1100, height: 800 })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(BASE, { waitUntil: 'networkidle0' }).catch(() => {})
await new Promise((r) => setTimeout(r, 1200))

// 用**轨道**做坐标基准，不是 `[role="slider"]`。
//
// bits-ui 把 role=slider 放在 **Thumb** 上（那个 18×18 的圆点），
// 拿它当基准算出来的坐标全在轨道外——鼠标按下根本没落在滑块上，
// 于是「拖动无效」的结论是测试自己造成的假象。
const slider = await page.$('.effort-slider')
if (!slider) {
  console.error('✗ 页面上找不到 role=slider 的元素')
  await browser.close()
  process.exit(1)
}
const box = await slider.boundingBox()
if (!box) {
  console.error('✗ 滑块没有布局盒（高度 0？）')
  await browser.close()
  process.exit(1)
}

const readout = async () => page.$eval('.effort-value', (el) => el.textContent.trim())
const before = await readout()

// 真实鼠标拖拽：按下 → 移动 → 抬起（分步移动，模拟人手）
const startX = box.x + box.width * 0.25
const targetX = box.x + box.width * 0.95
await page.mouse.move(startX, box.y + box.height / 2)
await page.mouse.down()
for (let i = 1; i <= 8; i++) {
  await page.mouse.move(startX + ((targetX - startX) * i) / 8, box.y + box.height / 2)
  await new Promise((r) => setTimeout(r, 20))
}
await page.mouse.up()
await new Promise((r) => setTimeout(r, 300))

const after = await readout()
const ok = Number(after) > Number(before)
console.log(`滑块轨道盒：${Math.round(box.width)}×${Math.round(box.height)}`)
console.log(`拖动前 ${before} → 拖动后 ${after}`)
console.log(ok ? '✓ 拖动生效（数值变大了）' : '✗ 拖动无效（数值没变）')

// 再拖回最左端，验证也能往小拖
await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2)
await page.mouse.down()
await page.mouse.move(box.x + 2, box.y + box.height / 2, { steps: 10 })
await page.mouse.up()
await new Promise((r) => setTimeout(r, 300))
const back = await readout()
const okBack = Number(back) < Number(after)
console.log(`拖回左侧 ${after} → ${back}`)
console.log(okBack ? '✓ 反向拖动也生效' : '✗ 反向拖动无效')

if (errors.length) console.log('页面错误：', errors.slice(0, 5))
await browser.close()
process.exit(ok && okBack ? 0 : 1)
