import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'

/**
 * 组件里不许出现写死的颜色。
 *
 * 为什么值得钉住：样式写在 `app.css` 的 token 里，深色主题只覆盖 token。
 * 一旦某个组件里写死 `#2563eb`，深色主题下它就**不跟着变**——
 * 这不会报错、不会让构建失败，只在用户切到深色时表现为「这一块没变黑」。
 *
 * 真实历史：`EffortSlider.svelte` 里有 23 处硬编码，其中
 * `var(--primary, #2563eb)` 更隐蔽——`--primary` **从未定义过**，
 * 于是 fallback 一直生效，这个「跟随主题」的写法实际从未工作过。
 *
 * 允许的例外只有两种，都要在行内写明理由：
 *   1. `--on-solid`：压在纯色/深色底上的固定白，不随主题反转
 *   2. 注释里说明「故意不跟随主题」
 */

const SRC = resolve(import.meta.dirname)

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      out.push(...walk(full))
    } else if (name.endsWith('.svelte')) {
      out.push(full)
    }
  }
  return out
}

// #rgb / #rrggbb / #rrggbbaa。故意不含 3 位简写之外的命名色。
const HEX = /#[0-9a-fA-F]{3,8}\b/

describe('配色只走 token', () => {
  it('组件样式里没有写死的 hex 色值', () => {
    const offenders: string[] = []

    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf8')
      // 只看 <style> 块：模板里的 color: 属性也可能写死，但 svelte 里很少见
      const styleMatch = text.match(/<style[^>]*>([\s\S]*?)<\/style>/)
      if (!styleMatch) continue
      const css = styleMatch[1]

      css.split('\n').forEach((line) => {
        const code = line.split('//')[0]
        if (!HEX.test(code)) return
        // 注释行里提到色值是允许的（解释历史）
        const trimmed = line.trim()
        if (trimmed.startsWith('*') || trimmed.startsWith('/*')) return
        offenders.push(`${relative(SRC, file)}: ${trimmed}`)
      })
    }

    expect(
      offenders,
      `以下位置写死了颜色，深色主题下不会跟随。请改用 app.css 里的 token：\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('app.css 自己引用的变量也必须定义过', () => {
    // `--warn` 曾经在 app.css 里被用了 3 次、却从未定义，
    // 于是 .chip--warn / .dot--warn 的边框与颜色整条失效（不是变透明，是丢弃）。
    const css = readFileSync(resolve(SRC, 'app.css'), 'utf8')
    const defined = new Set([...css.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]))
    // 去掉注释：注释里提到变量名是在解释历史，不是引用
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const missing = []
    for (const m of bare.matchAll(/var\((--[a-z0-9-]+)/g)) {
      if (!defined.has(m[1])) missing.push(m[1])
    }
    expect([...new Set(missing)], `app.css 里引用了未定义的变量：${[...new Set(missing)].join(', ')}`).toEqual([])
  })

  it('引用的 CSS 变量都在 app.css 里定义过', () => {
    // `var(--primary, #2563eb)` 这类写法的真正问题不是 fallback 难看，
    // 而是 `--primary` 根本不存在——这行字面上「跟随主题」，实际永远走 fallback。
    const css = readFileSync(resolve(SRC, 'app.css'), 'utf8')
    const defined = new Set([...css.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]))

    const missing = []
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf8')
      const styleMatch = text.match(/<style[^>]*>([\s\S]*?)<\/style>/)
      if (!styleMatch) continue
      // 模板里内联定义的变量（style="--i:3"）由元素自己提供，不是全局 token
      const inline = new Set(
        [...text.matchAll(/(?:style="|:style=")[^"]*?(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]),
      )
      for (const m of styleMatch[1].matchAll(/var\((--[a-z0-9-]+)/g)) {
        const name = m[1]
        if (defined.has(name) || inline.has(name)) continue
        missing.push(`${relative(SRC, file)} 用了未定义的 ${name}`)
      }
    }

    expect(missing, `以下 CSS 变量没有在 app.css 定义：\n${missing.join('\n')}`).toEqual([])
  })
})
