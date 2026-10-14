#!/usr/bin/env node
/**
 * 界面国际化（i18n）词条校验。
 *
 * 界面文案是**最容易静默失效**的一类改动：词条漏了英文，中文用户看不出问题，
 * 海外用户看到的是永远的中文；占位符漏了一个，参数就永远显示成 `{count}`。
 * 两者都不会报错。这个脚本把它们变成 CI 里的一次红叉。
 *
 * 校验项：
 *   1. **两份词条键完全一致**：多一个 / 少一个都要报。少一个 → 该处永远回退中文；
 *      多一个 → 没人用的垃圾词条（多半是键名打错）
 *   2. **占位符集合一致**：`{count}` 在中文有、英文没有，英文界面就会显示字面量
 *   3. **代码里用的键真实存在**：`t('foo.bar')` 写错键名时不会报错，
 *      界面上直接显示 `foo.bar`
 *   4. **不存在未被使用的词条**（提示级）：死词条让词条表越滚越大
 *   5. **`src/` 下不再有硬编码的界面中文**：迁到 i18n 后，新写的字面量会漏翻译。
 *      只统计「看起来是界面文案」的行，注释与模板注释不算。
 *
 * 用法：node scripts/lint-i18n.mjs
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const I18N = path.join(ROOT, 'src/i18n/index.ts')

const problems = []
const notes = []

if (!fs.existsSync(I18N)) {
  console.error('缺少 src/i18n/index.ts')
  process.exit(1)
}

const source = fs.readFileSync(I18N, 'utf8')

// ===== 解析词条表 =====
//
// 不 import（那是 TS 源码，Node 直接跑不了），改为按 locale 分块解析。
// 块边界用 `'zh-CN': {` / `'en-US': {`，词条行是 `'key': 'value',`。
function parseBlock(locale) {
  const start = source.indexOf(`'${locale}': {`)
  if (start === -1) return null
  // 从该 locale 的起始花括号开始做括号配对，取到它自己的闭合处
  const open = source.indexOf('{', start)
  let depth = 0
  let end = -1
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end === -1) return null
  const body = source.slice(open + 1, end)

  const entries = new Map()
  // 逐行取 'key': 'value'。值里可能有转义引号，故只按行首的 key 定位。
  for (const m of body.matchAll(/^\s*'([^']+)':\s*(.+?),?$/gm)) {
    const key = m[1]
    const rawValue = m[2].trim()
    // 去掉外层引号，取出真正的文案（可能是单引号或双引号）
    const value = rawValue.replace(/^['"]/, '').replace(/['"],?$/, '')
    entries.set(key, value)
  }
  return entries
}

const zh = parseBlock('zh-CN')
const en = parseBlock('en-US')

if (!zh || !en) {
  console.error('未能解析出 zh-CN / en-US 词条块，请检查 src/i18n/index.ts 的结构')
  process.exit(1)
}

// ===== 1. 两份词条键完全一致 =====
for (const key of zh.keys()) {
  if (!en.has(key)) problems.push(`en-US 缺少词条：${key}（该处英文界面会回退成中文）`)
}
for (const key of en.keys()) {
  if (!zh.has(key)) problems.push(`zh-CN 缺少词条：${key}`)
}

// ===== 2. 占位符集合一致 =====
const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))
for (const key of zh.keys()) {
  if (!en.has(key)) continue
  const pz = placeholders(zh.get(key))
  const pe = placeholders(en.get(key))
  for (const p of pz) {
    if (!pe.has(p)) problems.push(`${key}：中文有占位符 {${p}}，英文没有（英文会显示字面量）`)
  }
  for (const p of pe) {
    if (!pz.has(p)) problems.push(`${key}：英文有占位符 {${p}}，中文没有`)
  }
}

// ===== 3. 代码里用的键真实存在 =====
function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', 'dist-electron'].includes(entry.name)) walk(full, acc)
    } else if (/\.(ts|vue)$/.test(entry.name)) {
      acc.push(full)
    }
  }
  return acc
}

const usedKeys = new Set()
for (const file of walk(path.join(ROOT, 'src'))) {
  // i18n/index.ts 自己是词条表，不算「使用方」
  if (file === I18N) continue
  const text = fs.readFileSync(file, 'utf8')
  for (const m of text.matchAll(/\bt\(\s*'([^']+)'/g)) {
    const key = m[1]
    usedKeys.add(key)
    if (!zh.has(key)) {
      problems.push(`${path.relative(ROOT, file)} 用了不存在的词条键：${key}（界面会直接显示这个键名）`)
    }
  }
}

// ===== 4. 未被使用的词条（提示级） =====
//
// err.* 由 friendlyDownloadError 使用、common.* 会被多处复用，
// 这些都算「在用」。真正没被引用的只提示，不阻断——留着备用是合理的。
const unused = [...zh.keys()].filter((k) => !usedKeys.has(k))
if (unused.length) {
  notes.push(`以下 ${unused.length} 个词条没有被 t() 直接引用（可能是动态拼接或备用）：${unused.slice(0, 12).join(', ')}${unused.length > 12 ? ' …' : ''}`)
}

// ===== 5. src/ 下不再有硬编码界面中文 =====
//
// 允许存在的例外：
//   - i18n 目录自身（词条表就是中文）
//   - 代码注释、模板注释（<!-- -->）
//   - 平台名 / 文件名等专有名词（用白名单词表）
const ALLOWED_LITERALS = [
  'yt-dlp', 'ffmpeg', 'ffprobe', 'DownVid', 'aria2c', 'Chrome', 'Edge', 'Firefox', 'Safari',
  'Brave', 'Windows', 'macOS', 'Linux', 'YouTube', 'B站', '抖音', '快手', '小红书', '微信',
  'Cookies', 'Cookie', 'MP4', 'ID', 'GitHub', '简体中文', 'English',
  // 下列不是界面文案，而是**协议/契约标记**：不能翻译，翻译了匹配就会失效
  '未找到可用的', // 主进程错误文案的匹配串（readMissingKinds 依赖它）
  '需要登录',     // friendlyDownloadError 的匹配关键词
  '提示',         // 主进程附带的提示标记 `\n\n提示：`
  '锟斤拷',       // 编码损坏字符的清洗正则
  '更新内容',     // Release 正文的小节标题，extractChangelog 的正则依赖它
]
const i18nDir = path.join(ROOT, 'src/i18n')
const offenders = []
for (const file of walk(path.join(ROOT, 'src'))) {
  if (file.startsWith(i18nDir)) continue
  const rel = path.relative(ROOT, file)
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  let inBlockComment = false
  let inHtmlComment = false
  lines.forEach((line, i) => {
    const trimmed = line.trim()

    // 块注释 /* … */（含 /** 文档注释）与 HTML 注释 <!-- … --> 都可能跨行，
    // 必须逐行跟踪状态，否则注释的第二行会被当成界面文案（实测误报过十几处）。
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false
      return
    }
    if (inHtmlComment) {
      if (trimmed.includes('-->')) inHtmlComment = false
      return
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlockComment = true
      return
    }
    if (trimmed.startsWith('<!--')) {
      if (!trimmed.includes('-->')) inHtmlComment = true
      return
    }
    // 单行注释与 JSDoc 续行（`* ...`）
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return

    // 行内注释：去掉 <!-- ... --> 与尾部 // 注释后再找中文
    const withoutComments = line
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\/.*$/, '')
    const hits = (withoutComments.match(/[\u4e00-\u9fa5]{2,}/g) || [])
      .filter((h) => !ALLOWED_LITERALS.some((w) => h.includes(w)))
    if (hits.length) offenders.push(`${rel}:${i + 1}  ${hits.join(' / ')}`)
  })
}
if (offenders.length) {
  problems.push(
    `src/ 下仍有 ${offenders.length} 处硬编码界面中文（应改为 t('...') 词条）：\n` +
      offenders.slice(0, 40).map((o) => `      ${o}`).join('\n') +
      (offenders.length > 40 ? `\n      …另有 ${offenders.length - 40} 处` : ''),
  )
}

// ===== 输出 =====
if (notes.length) {
  console.log('提示：')
  for (const note of notes) console.log(`  - ${note}`)
}

if (problems.length) {
  console.error('\ni18n 词条校验未通过：')
  for (const problem of problems) console.error(`  ✗ ${problem}`)
  process.exit(1)
}

console.log(
  `i18n 词条校验通过：zh-CN / en-US 各 ${zh.size} 条，键与占位符双向一致，` +
    `${usedKeys.size} 处 t() 调用全部命中词条，src/ 下无硬编码界面中文。`,
)
