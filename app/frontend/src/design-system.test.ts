import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 视觉系统的硬约束。
 *
 * 这些规则**不会让构建失败**——`backdrop-filter` 用多了照样能编译、能跑，
 * 只是 Linux 用户滚动掉帧；动效写错属性照样能跑，只是低端机卡。
 * 所以用测试把它们变成「违反就红」。
 *
 * 三条预算都来自真实代价：
 *   1. `backdrop-filter` 是每元素一次的采样+模糊+合成，WebKitGTK 上尤其重
 *   2. 动效只能在 transform / opacity 上做——其它属性会触发 layout/paint
 *   3. 暖色 token 是产品的识别度，不能被「主流渐变紫」覆盖
 */

const CSS = readFileSync(resolve(import.meta.dirname, 'style.css'), 'utf8')

/** 去掉注释，避免注释里提到的词被当成代码命中 */
const code = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

describe('玻璃拟态的性能预算', () => {
  it('backdrop-filter 只出现在 .glass / .glass-thin 两个类里', () => {
    // 每多一个类，就多一批元素在滚动时被反复采样
    // 只从 **@supports 块内部**提取选择器。
    //
    // 直接正则全文匹配会把 `@supports ((backdrop-filter: blur(1px)) ...)` 的条件
    // 也当成选择器——那是在问「支持吗」，不是使用。
    const supportsBlocks = [...code.matchAll(/@supports[^{]*\{([\s\S]*?)\n\}/g)].map((m) => m[1])
    const selectors: string[] = []
    for (const block of supportsBlocks) {
      for (const m of block.matchAll(/([^{}]+)\{[^}]*\bbackdrop-filter:\s*blur/g)) {
        for (const sel of m[1].split(',')) {
          const t = sel.trim().split('\n').pop()!.trim()
          if (t) selectors.push(t)
        }
      }
    }

    expect(selectors.length, '应找到玻璃类的 backdrop-filter 声明').toBeGreaterThan(0)
    for (const sel of selectors) {
      expect(sel, `backdrop-filter 只该用于玻璃类，出现在：${sel}`).toMatch(/^\.glass(-thin)?$/)
    }
  })

  it('backdrop-filter 必须包在 @supports 里（不支持时退化为纯色）', () => {
    // 直接写会让不支持的引擎静默忽略，但**基础形态**（.glass 的第一段）
    // 必须有好看的纯色底，否则 Linux 老版本上是一片透明
    expect(code).toContain('@supports')
    const supportsIdx = code.indexOf('@supports')
    const blurIdx = code.indexOf('backdrop-filter')
    expect(blurIdx).toBeGreaterThan(supportsIdx)
  })

  it('模糊半径不超过 20px（再大采样成本线性上升，视觉收益很小）', () => {
    for (const m of code.matchAll(/backdrop-filter:\s*blur\((\d+)px\)/g)) {
      expect(Number(m[1])).toBeLessThanOrEqual(20)
    }
  })

  it('同时给出 -webkit- 前缀（WebKitGTK 需要）', () => {
    // Linux 目标是 webkit2gtk，不写前缀在部分版本上直接不生效，
    // 而「不生效」在 macOS 上测不出来
    const prefixed = (code.match(/-webkit-backdrop-filter/g) || []).length
    const plain = (code.match(/(?<!-webkit-)backdrop-filter/g) || []).length
    expect(prefixed).toBe(plain)
  })
})

describe('动效的性能预算', () => {
  it('transition 只允许 transform / opacity / box-shadow / color 类属性', () => {
    // width / height / top / left / margin 会触发 layout，
    // 在低端机上就是「动画掉帧」，而这在 M 系列 Mac 上看不出来
    const transitions = [...code.matchAll(/transition:\s*([^;]+);/g)].map((m) => m[1])
    const allowed = /^(transform|opacity|box-shadow|background|background-position|border-color|color|all)/

    for (const decl of transitions) {
      for (const part of decl.split(',')) {
        const prop = part.trim().split(/\s+/)[0]
        // `none` 是「关掉过渡」，不是属性名——它在 reduced-motion 块里是正确写法
        if (!prop || prop === 'none' || prop.startsWith('var(')) continue
        expect(
          allowed.test(prop),
          `transition 不该作用于 ${prop}（会触发 layout/paint）`,
        ).toBe(true)
      }
    }
  })

  it('keyframes 里不出现会触发 layout 的属性', () => {
    const blocks = [...code.matchAll(/@keyframes\s+\w+\s*\{([\s\S]*?)\n\}/g)]
    const bad = /^\s*(width|height|top|left|right|bottom|margin|padding|font-size)\s*:/m
    for (const b of blocks) {
      expect(bad.test(b[1]), `keyframes 里有 layout 属性：${b[1].slice(0, 80)}`).toBe(false)
    }
  })

  it('时长都在预算内（超过 300ms 会被感知为"卡"）', () => {
    const durs = [...code.matchAll(/--dur-\w+:\s*(\d+)ms/g)].map((m) => Number(m[1]))
    expect(durs.length).toBeGreaterThan(0)
    for (const d of durs) expect(d).toBeLessThanOrEqual(300)
  })

  it('prefers-reduced-motion 下把动画全部关掉，而不是"变慢"', () => {
    expect(code).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/)
    // 从 @media 开始一直取到文件末尾的最后一个 `}`——顺序敏感但足够稳，
    // 而且这个块本来就该在文件最后（「关掉一切」放在最后保证优先级）
    const start = code.indexOf('@media (prefers-reduced-motion: reduce)')
    expect(start).toBeGreaterThan(-1)
    const block = [null, code.slice(start)] as const
    // 关键：必须用 0.01ms + animation-iteration-count: 1 这种"彻底关掉"的写法，
    // 而不是把时长调成 1s（那等于让用户看一个慢动作）
    expect(block![1]).toContain('animation-duration: 0.01ms')
    expect(block![1]).toContain('animation-iteration-count: 1')
  })
})

describe('配色识别度', () => {
  it('暖色 primary 不能被换成主流渐变紫', () => {
    // #8c5100 是这个产品已有的识别度。换成 #7c3aed / #6366f1 这类
    // 就变成「又一个 AI 生成的页面」——这是设计决策，不是审美偏好
    expect(code).toContain('--color-primary: #8c5100')
    expect(code).not.toMatch(/--color-primary:\s*#(7c3aed|6366f1|8b5cf6|a855f7)/i)
  })

  it('没有引入彩虹式多色渐变（光晕必须同色系）', () => {
    // 超过 3 个不同色相的 radial-gradient 会让背景变成"彩色光斑"，
    // 那是典型的 AI 模板感
    const hues = new Set(
      [...code.matchAll(/radial-gradient\([^)]*?(#|var\(--color-)(\w+)/g)].map((m) => m[2]),
    )
    expect(hues.size, `光晕用了 ${hues.size} 种颜色：${[...hues].join(',')}`).toBeLessThanOrEqual(3)
  })

  it('焦点环必须存在（键盘可达性）', () => {
    expect(code).toMatch(/:focus-visible\s*\{/)
    expect(code).toMatch(/outline:\s*2px solid/)
  })
})

describe('玻璃类的命名白名单', () => {
  it('CSS 里所有以 glass 命名的类只有 .glass 与 .glass-thin', () => {
    // 上一条只检查「带 backdrop-filter 的类」，所以 `新增一个 .card-glass
    // 但不给它加模糊` 这种退化它看不出来——而实际使用中，多一个 glass 类
    // 早晚会有人给它加模糊。这条从**命名**层面堵住。
    const names = new Set(
      [...code.matchAll(/\.([a-z-]*glass[a-z-]*)/g)].map((m) => m[1]),
    )
    expect([...names].sort()).toEqual(['glass', 'glass-thin'])
  })
})

describe('两套样式的配色必须同源', () => {
  it('src/style.css 与 demo/app.css 的 @theme 关键色值一致', () => {
    // demo 是独立入口，但它「复用 src/style.css 的 @theme 色值」（demo README 里写的）。
    // 两边各抄一份色值是必要的（demo 要在浏览器里独立跑），但抄错就变成
    // 「预览是这个颜色、打包后是另一个颜色」——而这种差异在单独看任何一边时
    // 都发现不了。
    const demoCss = readFileSync(resolve(import.meta.dirname, '../demo/app.css'), 'utf8')
    const demoCode = demoCss.replace(/\/\*[\s\S]*?\*\//g, '')

    // 只比对「品牌识别度高」的几个：全部 51 个 token 逐字比对会让
    // demo 想微调某个灰阶时被迫同步，反而没人愿意动
    const KEY_TOKENS = [
      '--color-primary',
      '--color-primary-container',
      '--color-surface',
      '--color-on-surface',
      '--color-tertiary',
      '--color-secondary',
    ]

    for (const token of KEY_TOKENS) {
      const inSrc = new RegExp(`${token}:\\s*([^;]+);`).exec(code)?.[1]?.trim()
      const inDemo = new RegExp(`${token}:\\s*([^;]+);`).exec(demoCode)?.[1]?.trim()
      expect(inSrc, `src/style.css 缺 ${token}`).toBeTruthy()
      expect(inDemo, `demo/app.css 缺 ${token}`).toBeTruthy()
      expect(inDemo, `${token} 在两套样式里不一致（预览与打包后会不是同一个颜色）`).toBe(inSrc)
    }
  })
})
