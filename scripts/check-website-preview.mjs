// 用真实产物列表验证：「预览版」入口出现且指向 Wails 包
import puppeteer from 'puppeteer-core'
import path from 'node:path'

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--no-sandbox'],
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

// 拦截 GitHub API，返回同时含 Electron 与 Wails 产物的 Release
await page.setRequestInterception(true)
page.on('request', (req) => {
  if (req.url().includes('api.github.com') && req.url().includes('releases/latest')) {
    req.respond({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        tag_name: 'v1.5.0',
        name: 'v1.5.0',
        body: 'test',
        published_at: '2026-10-18T00:00:00Z',
        assets: [
          { name: 'DownVid-arm64-Mac-1.5.0.dmg', size: 1000, browser_download_url: 'https://x/a.dmg' },
          { name: 'DownVid-Wails-mac-universal-1.5.0.zip', size: 18000000, browser_download_url: 'https://x/w.zip' },
        ],
      }),
    })
    return
  }
  req.continue()
})

await page.goto('file://' + path.resolve('website/index.html'), { waitUntil: 'networkidle0' }).catch(() => {})
await new Promise((r) => setTimeout(r, 1500))

const state = await page.evaluate(() => {
  const p = document.getElementById('dlPreview')
  const link = document.getElementById('dlPreviewLink')
  const main = document.getElementById('dlPrimary')
  return {
    previewHidden: p ? p.hidden : 'missing',
    previewHref: link ? link.getAttribute('href') : '',
    previewText: p ? p.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) : '',
    mainHref: main ? main.getAttribute('href') : '',
  }
})
console.log('状态:', JSON.stringify(state, null, 1))
if (errors.length) console.log('错误:', errors.slice(0, 3))

const fails = []
if (state.previewHidden === 'missing') fails.push('找不到预览入口元素')
else if (state.previewHidden) fails.push('预览入口应显示（这一版有 Wails 包）')
if (!state.previewHref.includes('w.zip')) fails.push('预览链接没指向 Wails 包：' + state.previewHref)
if (!state.mainHref.includes('.dmg')) fails.push('主按钮应仍指向 Electron 包：' + state.mainHref)

await page.screenshot({ path: '/tmp/website-preview.png' })
await browser.close()
if (fails.length) {
  console.error('✗ ' + fails.join('；'))
  process.exit(1)
}
console.log('✓ 主按钮指向 Electron 版，预览入口指向 Wails 包')
