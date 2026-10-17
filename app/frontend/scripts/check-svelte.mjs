/**
 * 组件编译检查（本地开发用）。
 *
 * 用 svelte 编译器单独编译一个组件，比等 `vite build` 快，也能提前看到
 * 警告（未使用的 CSS 选择器、无障碍问题、自闭合标签等）。
 *
 * 用法：node scripts/check-svelte.mjs src/components/Foo.svelte [...]
 */
import { compile } from 'svelte/compiler'
import fs from 'node:fs'

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('用法：node scripts/check-svelte.mjs <组件.svelte> [...]')
  process.exit(1)
}

// 只关心「会产生渲染差异或无障碍问题」的警告。
// `css_unused_selector` 在重构期间噪音太大（保留的样式可能后面才用上）。
const IGNORE = new Set(['css_unused_selector'])

let failed = 0
for (const f of files) {
  try {
    const source = fs.readFileSync(f, 'utf8')
    const result = compile(source, { filename: f, generate: 'client' })
    const warnings = result.warnings.filter((w) => !IGNORE.has(w.code))
    console.log(`✓ ${f}${warnings.length ? `（${warnings.length} 警告）` : ''}`)
    for (const w of warnings.slice(0, 5)) {
      console.log(`    ${w.code}: ${w.message.slice(0, 100)}`)
      if (w.start) console.log(`      第 ${w.start.line} 行`)
    }
  } catch (e) {
    console.error(`✗ ${f}\n    ${e.message}`)
    failed += 1
  }
}

process.exit(failed > 0 ? 1 : 0)
