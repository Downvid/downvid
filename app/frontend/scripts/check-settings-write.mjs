/**
 * 设置页写入链路验证：**点击 → store 状态真的变了**。
 *
 * 为什么需要：`updateSetting('key', value)` 曾经签名单参数，
 * 运行时把字符串按字符下标展开成 `{0:'m',1:'a',...}`，
 * 一个字段都没改，而且全程不报错。表现就是「点开关没反应、拖动不同步」。
 *
 * 纯逻辑单测抓不到它（那是 .svelte 里的调用），svelte-check 现在能抓，
 * 这条则进一步确认真实点击后状态确实变了。
 */
import puppeteer from 'puppeteer-core'

const BASE = process.argv[2] || 'http://localhost:5173'
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 900 })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(BASE, { waitUntil: 'networkidle0' }).catch(() => {})
await new Promise((r) => setTimeout(r, 1000))

const fails = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `：${detail}` : ''}`)
  if (!ok) fails.push(name)
}

// 打开设置页：侧栏是 `.nav-item`（图标在文字前面，所以按 class 找而不是按文本）
await page.evaluate(() => {
  const nav = [...document.querySelectorAll('.nav-item')]
  const target = nav.find((el) => el.textContent.includes('设置') || el.textContent.includes('Settings'))
  target?.click()
})
await new Promise((r) => setTimeout(r, 600))
const hasSettings = await page.evaluate(() => !!document.querySelector('.settings'))
check('设置页可以打开', hasSettings)

// 1) 语言切换（中 → 英 → 中）：界面文案必须真的跟着变
const langButtons = await page.$$('button')
let switched = false
for (const b of langButtons) {
  const text = await page.evaluate((el) => el.textContent.trim(), b)
  if (text === 'EN') {
    await b.click()
    switched = true
    break
  }
}
if (switched) {
  await new Promise((r) => setTimeout(r, 400))
  const english = await page.evaluate(() => document.body.innerText.includes('Download'))
  check('语言切换到英文后界面真的变了', english)
} else {
  console.log('· 跳过语言检查（没找到 EN 按钮）')
}

// 2) 切到「加速」分区：滑块在那个分区里，默认停在「下载」分区看不见
await page.evaluate(() => {
  const items = [...document.querySelectorAll('.settings-nav button, .nav-list button, .subnav button, [role="tab"]')]
  const accel = items.find((el) =>
    /加速|Acceleration/i.test(el.textContent || ''),
  )
  accel?.click()
})
await new Promise((r) => setTimeout(r, 500))

// 3) 加速滑块：拖动后读数变化（设置页那一个）
const sliders = await page.$$('.effort-slider')
if (sliders.length > 0) {
  const box = await sliders[0].boundingBox()
  const readBefore = await page.$$eval('.effort-value', (els) => els.map((e) => e.textContent.trim()))
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.98, box.y + box.height / 2, { steps: 10 })
  await page.mouse.up()
  await new Promise((r) => setTimeout(r, 300))
  const readAfter = await page.$$eval('.effort-value', (els) => els.map((e) => e.textContent.trim()))
  const changed = JSON.stringify(readBefore) !== JSON.stringify(readAfter)
  check('设置页的滑块拖动后读数变化', changed, `${readBefore.join(',')} → ${readAfter.join(',')}`)
} else {
  check('设置页存在滑块', false)
}

if (errors.length) {
  console.log('页面错误：')
  for (const e of errors.slice(0, 5)) console.log('  ' + e)
  fails.push('页面报错')
}

await browser.close()
process.exit(fails.length ? 1 : 0)
