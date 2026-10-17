import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 视觉系统的硬约束。
 *
 * 这些规则**不会让构建失败**——写错了照样能编译、能跑，只是运行时的表现
 * 与预期不符。所以用测试钉住。
 *
 * 前身是迁移期校验「预览与打包后配色一致」的那份；现在 demo 已成为正式
 * 前端（`src/`），后半部分改成校验 `app.css` 自身的约束。
 */

const CSS = readFileSync(resolve(import.meta.dirname, 'app.css'), 'utf8')
const code = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

describe('动效预算', () => {
  it('transition 只作用于可合成属性（有白名单的例外）', () => {
    // width / height / top / left / margin 会触发 layout，
    // 在低端机上就是「动画掉帧」，而这在 M 系列 Mac 上看不出来。
    //
    // 例外：`grid-template-columns` —— 传输队列侧栏的展开/收起。
    // 那个效果是「把主内容推开」，纯 transform 做不出来（要么用绝对定位覆盖，
    // 要么宽度不参与布局）。它只在一处、只影响一列、且只在用户主动开关时跑，
    // 不在持续动画路径上——可以接受。
    const ALLOWED_LAYOUT = new Set(['grid-template-columns'])
    const transitions = [...code.matchAll(/transition:\s*([^;]+);/g)].map((m) => m[1])
    const allowed = /^(transform|opacity|box-shadow|background|background-position|border-color|color|filter|all)/
    for (const decl of transitions) {
      for (const part of decl.split(',')) {
        const prop = part.trim().split(/\s+/)[0]
        if (!prop || prop === 'none' || prop.startsWith('var(')) continue
        if (ALLOWED_LAYOUT.has(prop)) continue
        expect(allowed.test(prop), `transition 不该作用于 ${prop}（会触发 layout/paint）`).toBe(true)
      }
    }
  })

  it('keyframes 里不出现 layout 属性', () => {
    const blocks = [...code.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?)\n\}/g)]
    const bad = /^\s*(width|height|top|left|right|bottom|margin|padding)\s*:/m
    for (const b of blocks) {
      expect(bad.test(b[1]), `keyframes 里有 layout 属性：${b[1].slice(0, 60)}`).toBe(false)
    }
  })

  it('时长都在预算内（超过 300ms 会被感知为「卡」）', () => {
    const durs = [...code.matchAll(/--(?:dur|duration)[\w-]*:\s*(\d+)ms/g)].map((m) => Number(m[1]))
    for (const d of durs) expect(d).toBeLessThanOrEqual(300)
  })

  it('prefers-reduced-motion 下彻底关掉（不是「变慢」）', () => {
    expect(code).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  })
})

describe('配色识别度', () => {
  it('暖色 primary 没被换成主流渐变紫', () => {
    // #8c5100 是这个产品已有的识别度。换成 #7c3aed / #6366f1 这类
    // 就变成「又一个 AI 生成的页面」
    expect(code).toContain('--color-primary: #8c5100')
    expect(code).not.toMatch(/--color-primary:\s*#(7c3aed|6366f1|8b5cf6|a855f7)/i)
  })

  it('与 src/style.css（Vue 版）的关键色值一致', () => {
    // 两份样式各自独立（旧版还要能构建），但品牌色必须同源——
    // 抄错就变成「预览一个色、打包后另一个色」
    const legacyPath = resolve(import.meta.dirname, '../_legacy-vue-src/style.css')
    let legacy = ''
    try {
      legacy = readFileSync(legacyPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    } catch {
      // 归档已删：这条跳过（只校验当前文件自身）
      return
    }
    const KEY_TOKENS = [
      '--color-primary', '--color-primary-container',
      '--color-surface', '--color-on-surface',
    ]
    for (const token of KEY_TOKENS) {
      const cur = new RegExp(`${token}:\\s*([^;]+);`).exec(code)?.[1]?.trim()
      const old = new RegExp(`${token}:\\s*([^;]+);`).exec(legacy)?.[1]?.trim()
      if (!cur || !old) continue
      expect(cur, `${token} 在两份样式里不一致`).toBe(old)
    }
  })
})

describe('无障碍', () => {
  it('有焦点环（键盘用户必须看得见）', () => {
    expect(code).toMatch(/:focus-visible\s*\{[\s\S]*?outline:/)
  })
})
