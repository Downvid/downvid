#!/usr/bin/env node
/**
 * 界面词表的静态校验。
 *
 * ## 为什么需要
 *
 * 词表里的问题**不会报错，只会在某个语言下显示错的东西**：
 *
 *   1. 只加了中文词条 → 英文界面显示中文（或反过来）
 *   2. 开发期留下的「（演示）」「demo」→ 用户在产品里看到「已打开文件夹（演示）」
 *   3. 模板里用了 `t('x.y')` 但词表里没有 → 界面直接把 key 显示出来
 *
 * 这三类都只能靠人肉切语言才能发现，而切语言这件事在开发时几乎不会做。
 * 静态查一遍只要几十毫秒。
 *
 * 用法：node scripts/lint-i18n.mjs
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const FRONTEND = path.join(ROOT, 'app/frontend')
const I18N = path.join(FRONTEND, 'src/lib/i18n.svelte.ts')

const problems = []
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

if (!fs.existsSync(I18N)) {
  console.error(`找不到词表：${I18N}`)
  process.exit(1)
}

const source = read(I18N)

/**
 * 抽出两个语言的词条。不引 YAML/TS 解析器：
 * 词表是「一层对象 + 一行一个 'key': 'value',」，用正则足够稳，
 * 而引一个 AST 解析器会让这个校验本身变得需要维护。
 */
function entriesOf(locale) {
  const start = source.indexOf(`'${locale}': {`)
  if (start === -1) throw new Error(`词表里找不到语言 ${locale}`)
  // 取到下一个顶层语言块或文件末尾
  const rest = source.slice(start)
  const nextLocale = rest.slice(1).search(/\n  '[a-z]{2}-[A-Z]{2}': \{/)
  const block = nextLocale === -1 ? rest : rest.slice(0, nextLocale + 1)

  const map = new Map()
  for (const m of block.matchAll(/^\s*'([\w.]+)':\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"),?\s*$/gm)) {
    map.set(m[1], m[2] ?? m[3] ?? '')
  }
  return map
}

const zh = entriesOf('zh-CN')
const en = entriesOf('en-US')

// ===== 1. 两语言必须成对 =====
for (const key of zh.keys()) {
  if (!en.has(key)) problems.push(`词条 '${key}' 只有中文，英文缺（英文界面会显示中文）`)
}
for (const key of en.keys()) {
  if (!zh.has(key)) problems.push(`词条 '${key}' 只有英文，中文缺（中文界面会显示英文或 key）`)
}

// ===== 2. 不许留演示/占位文案 =====
//
// 判据是「出现在**值**里」，不是 key 里：`about.demoVersion` 这种 key
// 名本身无害，真正会渲染出去的是值。
const DEMO_WORDS = [/（演示）/, /\(demo\)/i, /演示：/, /模拟数据/, /UI demo/i, /simulated/i]
for (const [locale, map] of [
  ['zh-CN', zh],
  ['en-US', en],
]) {
  for (const [key, value] of map) {
    for (const re of DEMO_WORDS) {
      if (re.test(value)) {
        problems.push(`${locale} 的 '${key}' 里还有演示/占位文案：${value}`)
      }
    }
  }
}

// ===== 3. 代码里用到的 key 必须存在 =====
//
// 只查 `t('literal')` 形式。动态 key（`t(option.key)`）查不出来，
// 那类靠组件自己的数组定义保证。
const used = new Set()
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full)
      continue
    }
    if (!/\.(ts|svelte)$/.test(entry.name) || entry.name === 'i18n.svelte.ts') continue
    // 逐行过滤掉注释：注释里举例写 `t('key')` 不该被当成真实用法
    const text = read(full)
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n')
    for (const m of text.matchAll(/\bt\(\s*'([\w.]+)'/g)) used.add(m[1])
  }
}
walk(path.join(FRONTEND, 'src'))

for (const key of used) {
  if (!zh.has(key) && !en.has(key)) {
    problems.push(`代码里用了 t('${key}')，但词表里没有这个 key（界面会直接显示 key）`)
  }
}

// ===== 4. 语言标签页不能引用不存在的语言 =====
for (const key of ['zh-CN', 'en-US']) {
  if (!source.includes(`'${key}': {`)) problems.push(`词表缺少语言块 '${key}'`)
}

if (problems.length) {
  console.error('\n界面词表校验未通过：')
  for (const p of problems) console.error(`  ✗ ${p}`)
  process.exit(1)
}

console.log(
  `界面词表校验通过：${zh.size} 条词条中英成对，无演示文案，代码引用的 key 全部存在。`,
)
