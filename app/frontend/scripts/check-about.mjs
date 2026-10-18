/**
 * 「关于」页的可见性与内容验证。
 *
 * ## 为什么需要这个脚本
 *
 * 浏览器预览没有 `window.go`，走不到真机那条路径。这里注入一个与真机
 * 同形状的 `window.go.main.App`，让 `hasBackend()` 为 true，从而走完整的
 * init → 绑定调用 → 组件渲染链路。
 *
 * ## 它拦的是什么
 *
 * 真机上曾出现过「关于页打不开」——实际是**内容被右侧「传输」浮层盖住**：
 * 窄窗口下 `.rail` 是 `position: fixed` 且默认展开，占掉半屏，
 * 用户看到一片空白。截图能看出来，DOM 断言也能（内容存在但不可见）。
 *
 * 所以这里同时断言两件事：
 *   1. 内容**存在**（版本下拉有选项、更新日志有条目）
 *   2. 内容**可见**（没有被浮层覆盖）
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const real = JSON.parse(fs.readFileSync('/tmp/changelog-real.json', 'utf8'))
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--no-sandbox'],
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

// 在页面脚本运行**之前**注入后端
await page.evaluateOnNewDocument((changelog) => {
  window.go = {
    main: {
      App: {
        GetVersion: async () => '1.4.0',
        GetPlatform: async () => 'darwin',
        GetSettings: async () => ({}),
        UpdateSettings: async () => ({ ok: true }),
        ResetSettings: async () => ({ ok: true }),
        GetDefaultDownloadDir: async () => '/tmp/downloads',
        GetDataDir: async () => '/tmp/datadir',
        GetDiskSpace: async () => ({ free: 1e10, total: 1e11 }),
        DetectDependencies: async () => [
          { kind: 'yt-dlp', found: true, path: '/x/yt-dlp', version: '2026.10.10' },
          { kind: 'ffmpeg', found: true, path: '/x/ffmpeg', version: '9.0' },
          { kind: 'ffprobe', found: true, path: '/x/ffprobe', version: '9.0' },
          { kind: 'aria2', found: true, path: '/x/aria2c', version: '1.37.0' },
        ],
        HistoryGet: async () => [],
        ChangelogList: async () => changelog,
        ChangelogCurrent: async () => changelog[0],
        ChangelogHistory: async () => changelog,
        CheckUpdate: async () => ({ hasUpdate: false, version: '1.4.0' }),
        IsInstallingDeps: async () => false,
        DepsSummary: async () => ({}),
        OpenManagedDir: async () => '/tmp/runtime',
      },
    },
    // 事件订阅走 runtime 包
  }
  window.runtime = {}
}, real)

await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' }).catch(() => {})
await new Promise((r) => setTimeout(r, 1500))

await page.evaluate(() => {
  const nav = [...document.querySelectorAll('.nav-item')]
  nav.find((e) => /关于|About/.test(e.textContent))?.click()
})
await new Promise((r) => setTimeout(r, 1000))

const state = await page.evaluate(() => {
  const main = document.querySelector('.main')
  return {
    hasAbout: !!document.querySelector('.about-view'),
    hasEmptyState: !!document.querySelector('.notes-empty'),
    optionCount: document.querySelector('.version-select')?.options?.length ?? -1,
    noteCount: document.querySelectorAll('.note').length,
    firstNote: document.querySelector('.note')?.textContent?.trim().slice(0, 60) ?? '',
    hasStrong: !!document.querySelector('.note-text strong'),
    mainLen: main?.innerHTML.length ?? 0,
  }
})
console.log('真机链路结果:', JSON.stringify(state, null, 1))

// 可见性断言必须在**打开任何对话框之前**做：
// 公告弹层的 overlay 是全屏的，它一出现，下面所有元素都会被判为「被遮挡」。
const visibility = await page.evaluate(() => {
  const select = document.querySelector('.version-select')
  const note = document.querySelector('.note')
  const hit = (el) => {
    if (!el) return 'missing'
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return 'zero-size'
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    const covered = !top || !el.contains(top)
    return covered ? 'covered-by:' + (top?.className || top?.tagName || '?') : 'visible'
  }
  return { select: hit(select), note: hit(note) }
})
console.log('可见性:', JSON.stringify(visibility))

// 先截图（此时公告还没打开，看到的是关于页本身）
await page.screenshot({ path: '/tmp/about-real.png' })

// 再测「作者的话」：点开公告，看它有没有真的去拉远端
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /作者的话|announce/.test(b.className) || /作者的话/.test(b.textContent))
  btn?.click()
})
await new Promise((r) => setTimeout(r, 2500))
const ann = await page.evaluate(() => {
  const dlg = document.querySelector('.dialog')
  const badge = document.querySelector('.source-badge')
  return {
    opened: !!dlg,
    title: dlg?.querySelector('h2')?.textContent?.trim() ?? '',
    blocks: dlg?.querySelectorAll('.dialog-body p, .dialog-body h2, .dialog-body li').length ?? 0,
    bodyText: dlg?.querySelector('.dialog-body')?.textContent?.trim().slice(0, 80) ?? '',
    sourceBadge: badge?.textContent?.trim() ?? '(无)',
    storeState: (() => {
      try { return window.__probeSource ?? 'n/a' } catch { return 'n/a' }
    })(),
  }
})
console.log('作者的话:', JSON.stringify(ann, null, 1))
if (errors.length) {
  console.log('--- 页面错误 ---')
  for (const e of errors.slice(0, 5)) console.log(e.slice(0, 300))
}

// ===== 折叠与版本切换 =====
const collapse = await page.evaluate(() => {
  const notes = document.querySelectorAll('.note').length
  const more = document.querySelector('.notes-more')
  return { visibleNotes: notes, hasMoreButton: !!more, moreText: more?.textContent?.trim() ?? '' }
})
console.log('折叠:', JSON.stringify(collapse))

// 展开全部
await page.evaluate(() => document.querySelector('.notes-more')?.click())
await new Promise((r) => setTimeout(r, 300))
const expandedCount = await page.evaluate(() => document.querySelectorAll('.note').length)
console.log(`展开后条目数: ${expandedCount}`)

// 切到历史版本 —— 这是之前**完全失效**的操作
const switched = await page.evaluate(() => {
  const sel = document.querySelector('.version-select')
  if (!sel || sel.options.length < 2) return { ok: false, reason: '选项不足' }
  const before = sel.value
  const target = sel.options[1].value
  sel.value = target
  sel.dispatchEvent(new Event('change', { bubbles: true }))
  return { ok: true, before, target }
})
await new Promise((r) => setTimeout(r, 400))
const afterSwitch = await page.evaluate(() => {
  const sel = document.querySelector('.version-select')
  return { value: sel?.value ?? '', notes: document.querySelectorAll('.note').length }
})
console.log('切换版本:', JSON.stringify({ ...switched, ...afterSwitch }))

const fails = []
if (!switched.ok) fails.push('无法切换版本：' + switched.reason)
if (switched.ok && afterSwitch.value !== switched.target) {
  fails.push(`切到 ${switched.target} 又被弹回 ${afterSwitch.value}（$effect 覆盖了用户选择）`)
}
if (!collapse.hasMoreButton) fails.push('没有折叠按钮（条目会拉长整页）')
if (collapse.visibleNotes > 4) fails.push(`默认显示了 ${collapse.visibleNotes} 条，应折叠到 4 条`)
if (expandedCount <= collapse.visibleNotes) fails.push('展开没有生效')
if (!state.hasAbout) fails.push('关于页没渲染')
if (state.optionCount < 1) fails.push('版本下拉是空的')
if (state.noteCount < 1) fails.push('更新日志没有条目')
if (visibility.note !== 'visible') fails.push('更新日志被遮挡：' + visibility.note)
if (errors.filter((e) => !e.includes('ERR_CONNECTION')).length > 0) fails.push('页面报错')

console.log('截图: /tmp/about-real.png')
if (fails.length) {
  console.error('✗ ' + fails.join('；'))
  await browser.close()
  process.exit(1)
}
console.log('✓ 关于页正常：内容存在且可见')
await browser.close()
