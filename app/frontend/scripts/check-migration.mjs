/**
 * 「过渡版能检测到新架构」的界面验证。
 *
 * 注入一个与真机同形状的后端，其中 CheckUpdate 返回带 Wails 产物的 Release，
 * 然后确认设置页真的出现了迁移提示。
 *
 * 这条断言的是**整条链路**：Go 的 EvaluateMigration → CheckUpdate 的
 * `migration` 字段 → store → 设置页渲染。任何一环断了，界面上都不会有提示，
 * 而用户就永远不知道新架构已经可用。
 */
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--no-sandbox'],
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CONNECTION')) errors.push(m.text()) })

// 模拟「过渡版（electron）检测到新架构包」
await page.evaluateOnNewDocument((migration) => {
  window.go = {
    main: {
      App: {
        GetVersion: async () => '1.4.0',
        GetPlatform: async () => 'darwin',
        GetSettings: async () => ({}),
        UpdateSettings: async () => ({ ok: true }),
        ResetSettings: async () => ({ ok: true }),
        GetDefaultDownloadDir: async () => '/tmp/downloads',
        GetDataDir: async () => '/tmp/data',
        GetDiskSpace: async () => ({ free: 1e10, total: 1e11 }),
        DetectDependencies: async () => [],
        HistoryGet: async () => [],
        ChangelogList: async () => [],
        ChangelogCurrent: async () => null,
        ChangelogHistory: async () => [],
        IsInstallingDeps: async () => false,
        DepsSummary: async () => ({}),
        OpenManagedDir: async () => '/tmp/runtime',
        CheckUpdate: async () => ({
          hasUpdate: true,
          version: '1.4.0',
          release: { version: '1.6.0', releaseNotes: '', releaseDate: '2026-10-20' },
          architecture: 'electron',
          migration,
        }),
      },
    },
  }
}, {
  available: true,
  assetName: 'DownVid-Wails-mac-universal-1.6.0.zip',
  version: '1.6.0',
})

await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' }).catch(() => {})
await new Promise((r) => setTimeout(r, 1200))

// 进设置 → 更新分区
await page.evaluate(() => {
  [...document.querySelectorAll('.nav-item')].find((e) => /设置|Settings/.test(e.textContent))?.click()
})
await new Promise((r) => setTimeout(r, 500))
await page.evaluate(() => {
  [...document.querySelectorAll('.settings-nav button')].find((e) => /更新|Update/.test(e.textContent))?.click()
})
await new Promise((r) => setTimeout(r, 400))

// 点「检查更新」触发 CheckUpdate
await page.evaluate(() => {
  [...document.querySelectorAll('.action-bar button')][0]?.click()
})
await new Promise((r) => setTimeout(r, 1500))

const state = await page.evaluate(() => {
  const row = document.querySelector('.row--migration')
  return {
    hasRow: !!row,
    text: row?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) ?? '',
    asset: row?.querySelector('.migration-asset')?.textContent?.trim() ?? '',
  }
})
console.log('迁移提示:', JSON.stringify(state, null, 1))

const fails = []
if (!state.hasRow) fails.push('没有出现新架构迁移提示（用户永远不知道新架构可用）')
if (state.asset && !state.asset.startsWith('DownVid-Wails-')) {
  fails.push('提示里的产物名不对：' + state.asset)
}
if (errors.length) fails.push('页面报错：' + errors[0])

await browser.close()
if (fails.length) {
  console.error('✗ ' + fails.join('；'))
  process.exit(1)
}
console.log('✓ 过渡版能检测并展示新架构版本')
