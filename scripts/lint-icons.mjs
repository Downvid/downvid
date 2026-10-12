#!/usr/bin/env node
/**
 * 校验源码里用到的 Material Symbols 图标名是否有效。
 *
 * 为什么需要这个检查：字体遇到无效名**不会报错**，只会渲染成空白或
 * 该名字的文字。界面上出现"方块"或"HIGH_DEFINITION"这样的文字很难被
 * 注意到——历史上 `high_definition` 就是这样漏了很久（它不是有效的
 * Symbols 名，正确名是 `hd`）。
 *
 * 校验来源是 Google 官方元数据里导出的名字清单
 * （scripts/data/material-symbols-names.txt，由 gen-icon-names.mjs 更新），
 * 而不是字体包里的 TS 联合类型——后者的集合与真实可渲染集合并不一致
 * （例如 `error_outline`、`system_update` 在联合类型里没有，但字体能正常渲染）。
 *
 * 用法：node scripts/lint-icons.mjs
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC_DIR = path.join(ROOT, 'src')
const NAMES_FILE = path.join(ROOT, 'scripts/data/material-symbols-names.txt')

if (!fs.existsSync(NAMES_FILE)) {
  console.error(`缺少图标名清单：${path.relative(ROOT, NAMES_FILE)}`)
  console.error('请运行 node scripts/gen-icon-names.mjs 生成。')
  process.exit(1)
}

const valid = new Set(fs.readFileSync(NAMES_FILE, 'utf8').split('\n').map(l => l.trim()).filter(Boolean))

/** 递归收集 .vue 文件 */
function vueFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? vueFiles(full) : (entry.name.endsWith('.vue') ? [full] : [])
  })
}

const problems = []
let checked = 0
// 统计「用了图标但无法静态判断名字」的位置，提示人工核对
let dynamicSites = 0

for (const file of vueFiles(SRC_DIR)) {
  const source = fs.readFileSync(file, 'utf8')
  const rel = path.relative(ROOT, file)

  // 1) 字面量：<MaterialIcon name="xxx" /> 或 name='xxx'
  for (const m of source.matchAll(/<MaterialIcon\b[^>]*?(?<!:)\bname=["']([^"']+)["']/g)) {
    checked++
    if (!valid.has(m[1])) problems.push({ rel, name: m[1], kind: '字面量' })
  }

  // 2) 静态可推断的表达式：:name="cond ? 'a' : 'b'" / :name="x ? 'a' : 'b'"
  for (const m of source.matchAll(/:name=["']([^"']*\?[^"']*)["']/g)) {
    const candidates = [...m[1].matchAll(/'([a-z][a-z0-9_]*)'/g)].map(x => x[1])
    if (candidates.length === 0) { dynamicSites++; continue }
    for (const c of candidates) {
      checked++
      if (!valid.has(c)) problems.push({ rel, name: c, kind: '三元表达式' })
    }
  }

  // 3) 数组里声明的图标：icon: 'xxx'
  for (const m of source.matchAll(/\bicon:\s*'([a-z][a-z0-9_]*)'/g)) {
    checked++
    if (!valid.has(m[1])) problems.push({ rel, name: m[1], kind: '数组字段' })
  }

  // 4) 变量驱动的 :name="xxx"（无法静态判断，仅计数提醒）
  for (const m of source.matchAll(/:name=["']([a-zA-Z_$][\w.$]*)["']/g)) {
    dynamicSites++
  }
}

if (problems.length) {
  console.error('发现无效的 Material Symbols 图标名：\n')
  const seen = new Set()
  for (const p of problems) {
    const key = `${p.rel}:${p.name}`
    if (seen.has(key)) continue
    seen.add(key)
    console.error(`  ✗ ${p.rel}  "${p.name}"（${p.kind}）`)
  }
  console.error('\n这些名字字体会渲染成空白或图标名文字。请到 https://fonts.google.com/icons 核对，')
  console.error('或改用内联 SVG（品牌图标应如此，见 src/components/icons/GitHubIcon.vue）。')
  process.exit(1)
}

console.log(`图标名校验通过：${checked} 处静态引用全部有效${dynamicSites ? `（另有 ${dynamicSites} 处由变量提供，未校验）` : ''}`)
