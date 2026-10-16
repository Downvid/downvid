#!/usr/bin/env node
/**
 * 产品官网（website/）静态校验。
 *
 * 官网是**单文件**（website/index.html，样式与脚本内联），改完直接推 main 就会
 * 由 Vercel 的 Git 集成发布——中间没有任何构建或校验步骤，写错只会静默地
 * 出现在线上。这个脚本把这些「静默失败」变成 CI 里的一次红叉：
 *
 *   1. 单文件约定：不出现 `<script src>` / 外链样式表（字体 CDN 除外），
 *      否则「无构建、无依赖」的前提就不成立了。注意 img 标签不算依赖：
 *      shields.io 徽章与 raw.githubusercontent 的图片是刻意的例外
 *   2. 引用的仓库资源必须真实存在：og:image、favicon、截图都是 raw.githubusercontent
 *      的绝对地址，文件被改名/删除时线上是裂图，本地毫无提示
 *   3. 中英词条必须**双向**成对：`data-i18n` 占位 ↔ I18N.en 词条。
 *      缺英文 → 该处永远显示中文；多了没人用的词条 → 只是垃圾，一并报出来
 *   4. 配色必须与应用（src/style.css 的 @theme）一致：官网主色是手抄的，
 *      改了应用主题不改官网就会出现「官网和应用不像一家人」
 *   5. 仓库坐标：raw 链接必须指向 shared/app.ts 里的 owner/repo
 *      （换仓库时官网是最后被想起来的那处）
 *   6. 页面脚本里的仓库坐标（下载按钮靠它拼 github.com / api.github.com 地址）
 *      同样必须与 shared/app.ts 一致
 *   7. 下载产物名模板必须与 electron-builder.json5 的 artifactName 对得上：
 *      官网按名字在 Release 产物列表里挑安装包，改了产物名而没改官网不会报错，
 *      只会「所有平台都挑不到」然后静默退回 Releases 页面
 *   8. shields.io 徽章（下载量 / 星标）里的仓库坐标同样必须与 shared/app.ts 一致：
 *      写错了不会报错，徽章只会显示 no data，看起来像项目没人用
 *
 * 用法：node scripts/lint-website.mjs
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SITE_DIR = path.join(ROOT, 'website')
const INDEX = path.join(SITE_DIR, 'index.html')

const problems = []
const notes = []

if (!fs.existsSync(INDEX)) {
  console.error('缺少 website/index.html')
  process.exit(1)
}

const html = fs.readFileSync(INDEX, 'utf8')
const rel = (p) => path.relative(ROOT, p)

// ===== 0. 仓库坐标（先读，后面几项都要用） =====
const sharedApp = fs.readFileSync(path.join(ROOT, 'shared/app.ts'), 'utf8')
const owner = sharedApp.match(/owner:\s*'([^']+)'/)?.[1]
const repo = sharedApp.match(/repo:\s*'([^']+)'/)?.[1]
if (!owner || !repo) problems.push('shared/app.ts 未能解析出 owner/repo')

// ===== 1. 单文件约定 =====
for (const file of fs.readdirSync(SITE_DIR)) {
  if (!['index.html', 'README.md'].includes(file)) {
    notes.push(`website/ 下多了 ${file}——官网约定为单文件，多文件不会被打包/发布`)
  }
}
for (const m of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)) {
  problems.push(`index.html 引用了外部脚本 ${m[1]}；官网约定零依赖，请内联`)
}
// 字体 CDN 是刻意的例外（官网自己声明并预连接）
const ALLOWED_STYLE_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com']
for (const m of html.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["']/g)) {
  const href = m[1]
  if (/^https?:\/\//.test(href) && !ALLOWED_STYLE_HOSTS.some(h => href.includes(h))) {
    problems.push(`index.html 引用了外部样式表 ${href}；除字体外请内联`)
  }
}

// ===== 2. 引用的仓库资源必须存在 =====
const rawPrefix = owner && repo ? `https://raw.githubusercontent.com/${owner}/${repo}/main/` : null
const assetRefs = new Set()
for (const m of html.matchAll(/https:\/\/raw\.githubusercontent\.com\/([^/\s"'<>]+)\/([^/\s"'<>]+)\/([^/\s"'<>]+)\/([^\s"'<>)]+)/g)) {
  const [, refOwner, refRepo, ref, asset] = m
  assetRefs.add(asset)
  if (rawPrefix && `${refOwner}/${refRepo}/${ref}/` !== `${owner}/${repo}/main/`) {
    problems.push(`index.html 引用的 raw 地址指向 ${refOwner}/${refRepo}@${ref}，与仓库坐标 ${owner}/${repo}@main 不一致`)
  }
}
for (const asset of assetRefs) {
  if (!fs.existsSync(path.join(ROOT, asset))) {
    problems.push(`index.html 引用了不存在的文件：${asset}（线上会裂图）`)
  }
}

// ===== 3. 中英词条双向成对 =====
const used = new Set()
const placeholderKeys = new Set()
for (const m of html.matchAll(/data-i18n=["']([^"']+)["']/g)) {
  used.add(m[1])
  placeholderKeys.add(m[1])
}
// 脚本里拼装的文案（t('...') 与产物表里的 key: '...'）也算「用到」
for (const m of html.matchAll(/data-i18n-placeholder=["']([^"']+)["']/g)) {
  used.add(m[1])
  placeholderKeys.add(m[1])
}
for (const m of html.matchAll(/\bt\(\s*'([^']+)'\s*\)/g)) used.add(m[1])
for (const m of html.matchAll(/\bkey:\s*'([^']+)'/g)) used.add(m[1])

const enBlock = html.match(/en:\s*\{(.*?)\n\s*\},/s)?.[1]
if (!enBlock) {
  problems.push('未能从 index.html 解析出 I18N.en 词条表（结构改了？）')
} else {
  const en = new Set()
  for (const m of enBlock.matchAll(/'([a-z0-9.]+)':/g)) {
    if (en.has(m[1])) problems.push(`I18N.en 里重复定义了 '${m[1]}'`)
    en.add(m[1])
  }
  for (const key of used) {
    if (!en.has(key)) problems.push(`'${key}' 没有对应的英文词条，切到英文会显示中文或 key 本身`)
  }
  for (const key of en) {
    if (!used.has(key)) problems.push(`I18N.en 的 '${key}' 在页面里没有被任何地方使用`)
  }
  notes.push(`中英词条 ${used.size} 组，双向一致`)
}

// ===== 3b. I18N.zh：脚本拼装的文案必须写全 =====
//
// 中文默认值可以写在 HTML 的 data-i18n 原文里（占位符那份），但下载区的文案是
// 脚本拼出来的，HTML 里没有落点——只能在 I18N.zh 里写。漏了会显示成 key 本身。
const zhBlock = html.match(/zh:\s*\{(.*?)\n\s*\},/s)?.[1]
if (!zhBlock) {
  problems.push('未能从 index.html 解析出 I18N.zh 词条表（结构改了？）')
} else {
  const zh = new Set()
  for (const m of zhBlock.matchAll(/'([a-z0-9.]+)':/g)) {
    if (zh.has(m[1])) problems.push('I18N.zh 里重复定义了 ' + m[1])
    zh.add(m[1])
  }
  for (const key of used) {
    if (!zh.has(key) && !placeholderKeys.has(key)) {
      problems.push(key + ' 没有中文词条（脚本拼装的文案必须在 I18N.zh 里）')
    }
  }
  for (const key of zh) {
    if (!used.has(key)) problems.push('I18N.zh 的 ' + key + ' 在页面里没有被任何地方使用')
  }
}

// ===== 4. shields.io 徽章（下载量 / 星标） =====
//
// 下载量 / 星标用 README 同款 shields.io 徽章，数字实时、不再维护静态值。
// 徽章 URL 里的仓库坐标写错**不会报错**：它只会静默显示 no data，
// 看起来就像项目没人用。所以这里要求它与 shared/app.ts 一致。
const badgeUrls = [...html.matchAll(/https:\/\/img\.shields\.io\/[^\s"'<>]+/g)].map((m) => m[0])
if (!badgeUrls.some((u) => /\/github\/downloads\//.test(u))) {
  problems.push('index.html 里找不到 shields.io 下载量徽章（img.shields.io/github/downloads/…）')
}
for (const url of badgeUrls) {
  const ref = url.match(/\/github\/(?:downloads|stars|v\/release|issues|forks|watchers|contributors)\/([^/?]+)\/([^/?]+)/)
  if (ref && (ref[1] !== owner || ref[2] !== repo)) {
    problems.push(
      'shields.io 徽章指向 ' + ref[1] + '/' + ref[2] +
        '，与 shared/app.ts 的 ' + owner + '/' + repo + ' 不一致（徽章会静默显示 no data）',
    )
  }
}
if (badgeUrls.length) notes.push('shields.io 徽章 ' + badgeUrls.length + ' 个，仓库坐标与 shared/app.ts 一致')

// ===== 5. 配色与应用主题一致 =====
// 官网把 src/style.css 的 @theme 手抄成 --primary 等变量，抄错不会报错，只会"不像同一个产品"
const THEME_PAIRS = [
  ['--primary', '--color-primary'],
  ['--primary-dim', '--color-primary-dim'],
  ['--accent', '--color-primary-fixed'],
  ['--on-primary', '--color-on-primary'],
  ['--surface', '--color-surface'],
  ['--surface-container', '--color-surface-container'],
  ['--surface-container-high', '--color-surface-container-high'],
  ['--surface-container-highest', '--color-surface-container-highest'],
  ['--on-surface', '--color-on-surface'],
  ['--on-surface-variant', '--color-on-surface-variant'],
  // hero 里的应用界面复刻又抄了一批 token，同样必须与应用一致
  ['--surface-lowest', '--color-surface-container-lowest'],
  ['--surface-low', '--color-surface-container-low'],
  ['--surface-variant', '--color-surface-variant'],
  ['--surface-dim', '--color-surface-dim'],
  ['--primary-fixed', '--color-primary-fixed'],
  ['--on-primary-fixed', '--color-on-primary-fixed'],
  ['--secondary-container', '--color-secondary-container'],
  ['--on-secondary-container', '--color-on-secondary-container'],
  ['--inverse-on-surface', '--color-inverse-on-surface'],
  ['--tertiary', '--color-tertiary'],
  ['--error', '--color-error'],
  ['--outline', '--color-outline'],
]
const styleCss = fs.readFileSync(path.join(ROOT, 'src/style.css'), 'utf8')
const siteRoot = html.match(/:root\s*\{(.*?)\}/s)?.[1] ?? ''
for (const [siteVar, appVar] of THEME_PAIRS) {
  const siteValue = siteRoot.match(new RegExp(`${siteVar}\\s*:\\s*([^;]+);`))?.[1]?.trim().toLowerCase()
  const appValue = styleCss.match(new RegExp(`${appVar}\\s*:\\s*([^;]+);`))?.[1]?.trim().toLowerCase()
  if (!siteValue) {
    problems.push(`index.html 的 :root 缺少 ${siteVar}`)
    continue
  }
  if (!appValue) {
    problems.push(`src/style.css 的 @theme 缺少 ${appVar}（官网在引用它）`)
    continue
  }
  if (siteValue !== appValue) {
    problems.push(`配色不一致：官网 ${siteVar}=${siteValue}，应用 ${appVar}=${appValue}`)
  }
}

// ===== 6. 页面脚本里的仓库坐标 =====
//
// 下载按钮是**运行时**拼 github.com / api.github.com 地址的，第 2 项那种
// raw 链接检查覆盖不到；换仓库时漏改这里 = 按钮指向别人的仓库。
const pageRepo = html.match(/const REPO = \{\s*owner:\s*'([^']+)',\s*repo:\s*'([^']+)'\s*\}/)
if (!pageRepo) {
  problems.push('index.html 里找不到 const REPO = { owner, repo }（下载按钮靠它拼地址）')
} else if (pageRepo[1] !== owner || pageRepo[2] !== repo) {
  problems.push(
    'index.html 的仓库坐标是 ' + pageRepo[1] + '/' + pageRepo[2] +
      '，与 shared/app.ts 的 ' + owner + '/' + repo + ' 不一致',
  )
} else {
  notes.push('下载按钮的仓库坐标 ' + owner + '/' + repo + ' 与 shared/app.ts 一致')
}

// ===== 7. 下载产物名与 electron-builder 的 artifactName 对得上 =====
//
// 官网按名字在 Release 产物列表里挑安装包（如 DownVid-arm64-Mac-{version}.dmg）。
// 改了 electron-builder.json5 的 artifactName 却没改这里，官网不会报错——
// 只是所有平台都挑不到产物，然后静默退回 Releases 页面。
const builderConfig = fs.readFileSync(path.join(ROOT, 'electron-builder.json5'), 'utf8')
const productName = builderConfig.match(/"productName"\s*:\s*"([^"]+)"/)?.[1]
const artifactNames = [...builderConfig.matchAll(/"artifactName"\s*:\s*"([^"]+)"/g)].map((m) => m[1])
const pageTemplates = [...new Set([...html.matchAll(/'([^']*DownVid[^']*\{version\}[^']*)'/g)].map((m) => m[1]))]
if (!productName || artifactNames.length === 0) {
  problems.push('未能从 electron-builder.json5 解析出 productName / artifactName')
} else if (pageTemplates.length === 0) {
  problems.push('index.html 里找不到形如 DownVid-xxx-{version}.yyy 的产物名模板（下载区结构改了？）')
} else {
  // arch 占位符的取值随 target 变化：AppImage / rpm 用 x86_64、deb 用 amd64、tar.gz 用 x64
  const ARCH = '(?:x64|x86_64|amd64|arm64|armv7l|armhf|ia32)'
  const matchers = artifactNames.map((name) => {
    // 先把占位符换成不含正则元字符的记号，再转义字面部分（反了会把字符类也转义掉）
    const pattern = name
      .replace(/\$\{productName\}/g, productName)
      .replace(/\$\{arch\}/g, '@@ARCH@@')
      .replace(/\$\{version\}/g, '@@VERSION@@')
      .replace(/\$\{ext\}/g, '@@EXT@@')
      .replace(/[.*+?^$(){}|[\]\\]/g, '\\$&')
      .split('@@ARCH@@').join(ARCH)
      .split('@@VERSION@@').join('[0-9]+(?:\\.[0-9]+)*')
      .split('@@EXT@@').join('[A-Za-z0-9.]+')
    return new RegExp('^' + pattern + '$')
  })
  for (const template of pageTemplates) {
    const sample = template.split('{version}').join('1.2.3')
    if (!matchers.some((re) => re.test(sample))) {
      problems.push(
        '官网的产物名模板 ' + template +
          ' 与 electron-builder.json5 的 artifactName 对不上（改名后官网会静默挑不到产物）',
      )
    }
  }
  notes.push('下载产物名模板 ' + pageTemplates.length + ' 条与 electron-builder.json5 一致')
}

// ===== 7b. 平台图标 =====
//
// 脚本按 data-os 从 #osIcons 里克隆图标（主按钮与下载菜单共用）。键名写错不会报错，
// 只会静默地没有图标——所以这里让图标表与脚本里的 PLATFORMS 双向对上。
const iconHost = html.match(/<div id="osIcons"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? ''
const iconKeys = [...iconHost.matchAll(/<svg data-os="([a-z]+)"/g)].map((m) => m[1])
const scriptPlatforms = [...html.matchAll(/\{ os: '([a-z]+)', key: 'plat\.[a-z]+' \}/g)].map((m) => m[1])
if (iconKeys.length === 0) {
  problems.push('index.html 的 #osIcons 里找不到平台图标（或容器/属性被改名）')
} else if (scriptPlatforms.length === 0) {
  problems.push('index.html 的脚本里找不到 PLATFORMS 表（下载按钮靠它选平台）')
} else {
  for (const os of scriptPlatforms) {
    if (!iconKeys.includes(os)) problems.push('PLATFORMS 里的 ' + os + ' 在 #osIcons 里没有对应图标（按钮会没有图标且不报错）')
  }
  for (const os of iconKeys) {
    if (!scriptPlatforms.includes(os)) problems.push('#osIcons 里的 ' + os + ' 在脚本的 PLATFORMS 里没有被用到')
  }
  notes.push('平台图标 ' + iconKeys.join(' / ') + ' 与脚本 PLATFORMS 一致')
}

// ===== 8. 输出 =====
if (problems.length) {
  console.error('官网校验未通过：\n')
  for (const p of problems) console.error(`  ✗ ${p}`)
  console.error('')
  process.exit(1)
}

for (const n of notes) console.log(`  · ${n}`)
console.log(`✓ 官网校验通过（${rel(INDEX)}，引用资源 ${assetRefs.size} 个）`)
