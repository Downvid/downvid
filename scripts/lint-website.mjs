#!/usr/bin/env node
/**
 * 产品官网（website/）静态校验。
 *
 * 官网是**单文件**（website/index.html，样式与脚本内联），改完直接推 main 就会
 * 由 Vercel 的 Git 集成发布——中间没有任何构建或校验步骤，写错只会静默地
 * 出现在线上。这个脚本把这些「静默失败」变成 CI 里的一次红叉：
 *
 *   1. 单文件约定：不出现 `<script src>` / 外链样式表（字体 CDN 除外），
 *      否则「无构建、无依赖」的前提就不成立了
 *   2. 引用的仓库资源必须真实存在：og:image、favicon、截图都是 raw.githubusercontent
 *      的绝对地址，文件被改名/删除时线上是裂图，本地毫无提示
 *   3. 中英词条必须**双向**成对：`data-i18n` 占位 ↔ I18N.en 词条。
 *      缺英文 → 该处永远显示中文；多了没人用的词条 → 只是垃圾，一并报出来
 *   4. 配色必须与应用（src/style.css 的 @theme）一致：官网主色是手抄的，
 *      改了应用主题不改官网就会出现「官网和应用不像一家人」
 *   5. 仓库坐标：raw 链接必须指向 shared/app.ts 里的 owner/repo
 *      （换仓库时官网是最后被想起来的那处）
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
for (const m of html.matchAll(/data-i18n=["']([^"']+)["']/g)) used.add(m[1])

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
    if (!en.has(key)) problems.push(`data-i18n="${key}" 没有对应的英文词条，切到英文会显示中文`)
  }
  for (const key of en) {
    if (!used.has(key)) problems.push(`I18N.en 的 '${key}' 在页面里没有任何 data-i18n 使用它`)
  }
  notes.push(`中英词条 ${used.size} 组，双向一致`)
}

// ===== 4. 下载量标记 =====
// 数字本身由 `pnpm website:stats` 刷新，**不放进 CI 比对**：它每分钟都在动，
// 比对必然随机红（本地实测几分钟内就从 4,646 涨到 4,650）。这里只保证标记没被写坏。
const countMatch = html.match(/<b data-download-count>([\d,]+)<\/b>/)
if (!countMatch) {
  problems.push('index.html 缺少 <b data-download-count>N</b> 下载量标记（或格式被改坏）')
} else if (!/^\d{1,3}(,\d{3})*$/.test(countMatch[1])) {
  problems.push(`下载量格式不对：${countMatch[1]}（应为千分位分隔的整数，如 4,650）`)
} else {
  notes.push(`下载量标记 ${countMatch[1]}（刷新：pnpm website:stats）`)
}

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

// ===== 6. 输出 =====
if (problems.length) {
  console.error('官网校验未通过：\n')
  for (const p of problems) console.error(`  ✗ ${p}`)
  console.error('')
  process.exit(1)
}

for (const n of notes) console.log(`  · ${n}`)
console.log(`✓ 官网校验通过（${rel(INDEX)}，引用资源 ${assetRefs.size} 个）`)
