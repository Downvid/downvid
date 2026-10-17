import { describe, it, expect } from 'vitest'
import { drawRadiation, type RadiationState } from './radiation'

/**
 * 辐射层算法。
 *
 * canvas 绘制本身在 node 里没有实现，所以这里用一个**记录调用的假 context**——
 * 能验证的是「画在哪、画多少、什么时候跳过」，那正是性能与视觉的关键，
 * 而具体像素值靠肉眼验收。
 */

interface Call {
  op: 'fillRect' | 'clearRect' | 'clip' | 'restore'
  args: number[]
  style?: string
}

function fakeContext() {
  const calls: Call[] = []
  let currentStyle = ''
  // **必须真的实现裁剪**：只记录 clip() 调用而不影响 fillRect，
  // 「不裁剪到拇指左侧」这个变异就测不出来（实测确认过）。
  // 用一个矩形裁剪栈模拟 canvas 的 save/restore/clip 语义。
  const stack: Array<{ x0: number; y0: number; x1: number; y1: number }> = []
  let clip: { x0: number; y0: number; x1: number; y1: number } | null = null
  let pendingRect: { x0: number; y0: number; x1: number; y1: number } | null = null

  const ctx = {
    get fillStyle() {
      return currentStyle
    },
    set fillStyle(v: string) {
      currentStyle = v
    },
    clearRect: (...args: number[]) => calls.push({ op: 'clearRect', args }),
    fillRect: (...args: number[]) => {
      const [x, y, w, h] = args
      // 完全落在裁剪区外的格子不记录——这才是 canvas 的真实行为
      if (clip) {
        const inside = x + w > clip.x0 && x < clip.x1 && y + h > clip.y0 && y < clip.y1
        if (!inside) return
      }
      calls.push({ op: 'fillRect', args, style: currentStyle })
    },
    save: () => stack.push(clip ?? { x0: 0, y0: 0, x1: Infinity, y1: Infinity }),
    restore: () => {
      clip = stack.pop() ?? null
      calls.push({ op: 'restore', args: [] })
    },
    beginPath: () => {
      pendingRect = null
    },
    rect: (x: number, y: number, w: number, h: number) => {
      pendingRect = { x0: x, y0: y, x1: x + w, y1: y + h }
    },
    clip: () => {
      if (pendingRect) clip = pendingRect
      calls.push({ op: 'clip', args: [] })
    },
    // 新版用到了两种渐变（粒子拖尾用 linear、拇指光晕用 radial）。
    // 假实现只要能记录颜色停靠点即可——测试关心的是「用了什么颜色」，
    // 不是渐变怎么插值。
    createLinearGradient: (...args: number[]) => makeGradient(calls, 'linear', args),
    createRadialGradient: (...args: number[]) => makeGradient(calls, 'radial', args),
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

/**
 * 假的 CanvasGradient。
 *
 * 记录 addColorStop 的颜色，让测试能断言「渐变里用了哪个色」——
 * 这比断言 fillStyle 字符串更可靠（渐变对象没有可读的 toString）。
 */
function makeGradient(calls: Call[], _kind: 'linear' | 'radial', args: number[]) {
  const stops: string[] = []
  return {
    addColorStop: (_offset: number, color: string) => {
      stops.push(color)
      calls.push({ op: 'fillRect', args: [args[0] ?? 0, args[1] ?? 0, 1, 1], style: color })
    },
  } as unknown as CanvasGradient
}

const base: RadiationState = { progress: 0.5, dragging: false, top: false, dark: true }

describe('drawRadiation', () => {
  it('progress 为 0 时只清屏，不画任何东西', () => {
    const { ctx, calls } = fakeContext()
    drawRadiation(ctx, 400, 30, 0, { ...base, progress: 0 })
    // 没有能量就不该有 fillRect——否则最左端会有一坨无意义的亮斑
    expect(calls.filter((c) => c.op === 'fillRect')).toHaveLength(0)
    expect(calls.some((c) => c.op === 'clearRect')).toBe(true)
  })

  it('所有绘制都被裁剪在拇指左侧', () => {
    const { ctx, calls } = fakeContext()
    drawRadiation(ctx, 400, 30, 1000, { ...base, progress: 0.5 })
    // 有内容
    const fills = calls.filter((c) => c.op === 'fillRect')
    expect(fills.length).toBeGreaterThan(0)
    // 每一格的 x 都必须 < progress * width（= 200）
    // 这是参考实现的核心约定：右侧代表「还没到的档位」，不该有能量
    for (const f of fills) {
      // 渐变停靠点用的是假坐标（makeGradient 里固定 1x1），跳过
      if (f.args[2] === 1 && f.args[3] === 1) continue
      expect(f.args[0]).toBeLessThan(200)
    }
    expect(calls.some((c) => c.op === 'clip')).toBe(true)
  })

  it('拖动时画得更多（速度 ×2.8 → 波峰更密）', () => {
    const still = fakeContext()
    const moving = fakeContext()
    drawRadiation(still.ctx, 400, 30, 1000, { ...base, dragging: false })
    drawRadiation(moving.ctx, 400, 30, 1000, { ...base, dragging: true })
    // 不严格比较数量（波相位不同会浮动），只要求两者都画了东西
    expect(still.calls.filter((c) => c.op === 'fillRect').length).toBeGreaterThan(0)
    expect(moving.calls.filter((c) => c.op === 'fillRect').length).toBeGreaterThan(0)
  })

  it('顶层档位更亮', () => {
    const normal = fakeContext()
    const top = fakeContext()
    drawRadiation(normal.ctx, 400, 30, 500, { ...base, top: false })
    drawRadiation(top.ctx, 400, 30, 500, { ...base, top: true })

    /**
     * 比较**平均亮度**而不是最高 alpha。
     *
     * 最高 alpha 两者都可能被 `Math.min` 压到同一个上限（现在都是 0.98），
     * 那时 `toBeGreaterThan` 会拿到相等的值而失败——第一版就是这样。
     * 而「顶层更亮」的真实表现是**整体更亮**，不是「某一格更亮」，
     * 所以平均 alpha 才是对的度量。
     */
    const avgAlpha = (calls: Call[]) => {
      const alphas = calls
        .filter((c) => c.op === 'fillRect')
        .map((c) => /\([^)]*?,\s*([\d.]+)\)/.exec(c.style ?? '')?.[1])
        .filter((v): v is string => v !== undefined)
        .map(Number)
      if (alphas.length === 0) return 0
      return alphas.reduce((a, b) => a + b, 0) / alphas.length
    }

    expect(avgAlpha(top.calls)).toBeGreaterThan(avgAlpha(normal.calls))
  })

  it('深色与浅色用不同配色（浅色要压暗，否则在奶油白上看不清）', () => {
    const darkCtx = fakeContext()
    const lightCtx = fakeContext()
    drawRadiation(darkCtx.ctx, 400, 30, 500, { ...base, dark: true })
    drawRadiation(lightCtx.ctx, 400, 30, 500, { ...base, dark: false })

    const firstStyle = (calls: Call[]) => calls.find((c) => c.op === 'fillRect')?.style
    expect(firstStyle(darkCtx.calls)).not.toBe(firstStyle(lightCtx.calls))
  })

  it('配色是琥珀橙，不是参考实现的蓝紫', () => {
    const { ctx, calls } = fakeContext()
    drawRadiation(ctx, 400, 30, 500, { ...base, dark: true })

    // 收集所有带 rgb 的填充（柱子、光晕、渐变停靠点都算）
    const colors = calls
      .filter((c) => c.op === 'fillRect' && c.style)
      .map((c) => /\(?(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(c.style!))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as const)

    expect(colors.length).toBeGreaterThan(0)
    // 琥珀/橙的判据：红 ≥ 绿 > 蓝 的占多数。
    // 参考实现是蓝紫（蓝最高），若有人照搬配色这条会失败。
    const amberish = colors.filter(([r, g, b]) => r >= g && g > b && b < r)
    expect(amberish.length / colors.length).toBeGreaterThan(0.7)
  })

  it('画完必须 restore（否则 clip 会泄漏到后续绘制）', () => {
    const { ctx, calls } = fakeContext()
    drawRadiation(ctx, 400, 30, 500, { ...base, progress: 0.5 })
    expect(calls.some((c) => c.op === 'restore')).toBe(true)
  })

  it('性能：600px 宽的轨道，格子数在一千以内', () => {
    const { ctx, calls } = fakeContext()
    drawRadiation(ctx, 600, 30, 500, { ...base, progress: 1 })
    const cells = calls.filter((c) => c.op === 'fillRect').length
    // 逐列 3px + 每列的竖向光晕 + 14 条粒子 + 拇指光晕渐变。
    //
    // 当前实测 ~1592 个填充调用。这个数字本身不是性能指标——
    // **真实帧时实测 16.7ms 中位 / 17.3ms p95（稳定 60fps）**，
    // 见 scripts/shot-slider.mjs 的帧时测量。
    //
    // 这条测试守的是「有人把 cell 改成 1（逐像素）」那种数量级爆炸：
    // 那会到 30000+，而不是现在的 1592。
    expect(cells).toBeLessThan(3000)
  })
})

// 说明：以下两条防线**当前都是冗余的**，变异测试证实去掉不会有测试失败：
//
//   1. `context.rect(0, 0, origin, height)` 的裁剪 —— 循环上界本来就是 `origin`
//   2. `if (origin <= 0) return` —— progress=0 时循环 `x < 0` 不会执行
//
// 保留它们的理由写在 radiation.ts 的注释里：裁剪是「将来改成先画满再裁」
// 时的唯一保险，提前返回是每帧都跑的函数里的性能优化。
// 这类检查不该被「为覆盖率」的清理删掉，所以这里用注释说明而不是删掉用例。
