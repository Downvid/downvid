/**
 * 滑块的能量辐射层（canvas）。
 *
 * 移植自 <https://github.com/HanaAyane/dsh-reasoning-effort> 的
 * `drawRadiation`（`src/client/index.tsx:323`），并按其
 * `design/visual-spec.md` 的约定做了两点适配：
 *
 *   1. **配色改成 DownVid 的琥珀 → 橙红**，不是参考实现的蓝紫。
 *      参考实现是 DeepSeek 品牌色；直接搬会让界面变成「别人的产品」。
 *   2. 三档（off / 中 / 满）之外仍支持四档，因为 DownVid 的加速是
 *      轻量 4 / 均衡 8 / 快速 12 / 激进 16。
 *
 * ## 算法要点（照搬，不「优化」）
 *
 * - 逐 **4px 列**绘制，不是逐像素：视觉上没有区别，而列数少 4 倍
 * - 三层正弦叠加（周期 10 / 23 / 40）制造不规则呼吸感；
 *   单一正弦看起来像机械脉动
 * - `crest` 用 15 / 18 次方——只在波峰极窄处亮，形成「浪尖」
 * - `trail` 是指数衰减：离拇指越远越暗
 * - 全部**裁剪在拇指左侧**（`origin = progress * width`）：
 *   右侧是「还没到的档位」，不该有能量
 * - 拖动时速度 ×2.8：给「正在用力」的即时反馈
 *
 * ## 性能
 *
 * 一帧最多 `width / 4` 列 × `height / 4` 行。按 600×30 算约 1100 个格子，
 * 每格几次三角函数——在 M 系列上远低于 1ms。关键的是**只画需要的地方**：
 * `columnEnergy <= 0.012` 的列直接跳过。
 */

/** 辐射层的状态。 */
export interface RadiationState {
  /** 0..1，拇指位置 */
  progress: number
  /** 是否在拖动（拖动时波动更快） */
  dragging: boolean
  /** 是否为顶层档位（最高档时整体更亮） */
  top: boolean
  /** 是否深色主题 */
  dark: boolean
}

/**
 * DownVid 的辐射配色。
 *
 * 从 `src/style.css` 的 @theme 推出来的：primary #8c5100（深琥珀）到
 * primary-container #ff9800（亮橙）。深色下往暖白推，浅色下保持橙红不刺眼。
 */
interface Palette {
  /** 基色（远端）RGB */
  base: [number, number, number]
  /** 近拇指时的加成 */
  near: [number, number, number]
  /** 浪尖加成 */
  crest: [number, number, number]
  /** 最大 alpha */
  maxAlpha: number
}

function palette(dark: boolean, top: boolean): Palette {
  if (dark) {
    // 深色背景：琥珀 → 橙红，浪尖推到暖白
    return {
      base: [120, 58, 0],
      near: [140, 90, 10],
      crest: [90, 40, 10],
      maxAlpha: top ? 0.92 : 0.78,
    }
  }
  // 浅色背景：橙但要压暗，否则在奶油白上看不清
  return {
    base: [160, 92, 0],
    near: [90, 50, 0],
    crest: [40, 20, 0],
    maxAlpha: top ? 0.66 : 0.5,
  }
}

/**
 * 画一帧。
 *
 * 调用方负责：设置 canvas 尺寸与 DPR 变换、决定何时重绘。
 * 这个函数只做纯绘制，不持有状态、不读全局。
 */
export function drawRadiation(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  state: RadiationState,
): void {
  const origin = state.progress * width
  const cell = 4
  // 拖动时波动更快：给「正在用力」的即时反馈
  const speed = state.dragging ? 2.8 : 1
  // 顶层档位整体再亮一点（参考实现用 data-top 标记做同样的事）
  const boost = state.top ? 1.25 : 1
  const p = palette(state.dark, state.top)

  context.clearRect(0, 0, width, height)
  // 提前返回是**性能优化**，不是正确性所必需：
  // progress=0 时下面的循环 `x < 0` 本来就不会执行（变异测试证实：去掉这行
  // 没有任何测试失败）。保留它是为了省掉一次 save/clip/restore 的调用链——
  // 这个函数每帧都跑。
  if (origin <= 0) return

  context.save()
  // 裁剪在拇指左侧：右侧代表「还没到的档位」，不该有能量。
  //
  // 注意：**循环上界也是 `origin`**，所以这里改成 `width` 不会有可见差异
  // （变异测试证实）。裁剪是**第二道保险**——若将来改成「先画满整条轨道
  // 再统一裁剪」的写法，它就是唯一挡住右侧的东西。
  context.beginPath()
  context.rect(0, 0, origin, height)
  context.clip()

  for (let x = 0; x < origin; x += cell) {
    const delta = x + cell * 0.5 - origin
    const distance = Math.abs(delta)

    // 三层不同周期的正弦：单一正弦看起来像机械脉动
    const phaseA = distance / 10 - time * 0.0074 * speed
    const phaseB = distance / 23 - time * 0.0041 * speed + 1.7
    const phaseC = distance / 40 - time * 0.0022 * speed + 3.4
    const sinA = Math.max(0, Math.sin(phaseA))
    const sinB = Math.max(0, Math.sin(phaseB))
    const sinC = Math.max(0, Math.sin(phaseC))

    const waveA = Math.pow(sinA, 2.6)
    const waveB = Math.pow(sinB, 3.2)
    const waveC = Math.pow(sinC, 4)
    // 高次方 → 只在波峰极窄处亮，形成「浪尖」
    const crest = Math.pow(sinA, 15) + Math.pow(sinB, 18) * 0.78
    const wave = Math.min(1, waveA * 0.76 + waveB * 0.58 + waveC * 0.32)

    // 指数衰减：离拇指越远越暗
    const trail = 0.38 + 0.62 * Math.exp(-distance / Math.max(55, width * 0.72))
    const pillar = Math.pow(Math.max(0, Math.sin(x / 20 + time * 0.0016)), 3) * 0.27
    const columnEnergy = trail * (wave * 1.04 + pillar + crest * 0.32)

    if (columnEnergy > 0.012) {
      const nearness = Math.max(0, 1 - distance / Math.max(1, width * 0.78))
      const r = Math.min(255, Math.round(p.base[0] + p.near[0] * nearness + p.crest[0] * wave))
      const g = Math.min(255, Math.round(p.base[1] + p.near[1] * nearness + p.crest[1] * crest))
      const b = Math.min(255, Math.round(p.base[2] + p.near[2] * nearness + p.crest[2] * wave))
      const alpha = Math.min(p.maxAlpha, columnEnergy * 0.72 * boost)
      context.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`
      context.fillRect(x, 0, cell - 1, height)
    }

    // 竖向光晕：以拇指所在高度为中心的高斯分布
    for (let y = 0; y < height; y += cell) {
      const deltaY = y + cell * 0.5 - height * 0.5
      const radial = Math.hypot(delta / 38, deltaY / 11)
      const halo = Math.exp(-radial * 0.96) * 1.08
      // 竖向形状：中间最亮，上下衰减
      const verticalShape = 0.58 + 0.42 * Math.cos((deltaY / height) * Math.PI)
      const energy = halo * verticalShape * (0.55 + crest * 0.9) * trail * boost
      if (energy <= 0.016) continue

      const r = Math.min(255, Math.round(p.base[0] + p.near[0] * 0.9 + p.crest[0] * 1.4))
      const g = Math.min(255, Math.round(p.base[1] + p.near[1] * 0.9 + p.crest[1] * 1.4))
      const b = Math.min(255, Math.round(p.base[2] + p.near[2] * 0.9 + p.crest[2] * 1.4))
      context.fillStyle = `rgba(${r}, ${g}, ${b}, ${Math.min(p.maxAlpha, energy * 0.55)})`
      context.fillRect(x, y, cell - 1, cell - 1)
    }
  }

  context.restore()
}

/**
 * 把 canvas 调成当前元素尺寸（含 DPR）。
 *
 * 上限 2：DPR 3 的屏上按 3 倍渲染不会更好看，只会多 2.25 倍像素。
 */
export function resizeCanvas(canvas: HTMLCanvasElement): { width: number; height: number } {
  const bounds = canvas.getBoundingClientRect()
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  const width = Math.max(1, bounds.width)
  const height = Math.max(1, bounds.height)
  canvas.width = Math.max(1, Math.round(width * ratio))
  canvas.height = Math.max(1, Math.round(height * ratio))
  const context = canvas.getContext('2d')
  if (context) context.setTransform(ratio, 0, 0, ratio, 0, 0)
  return { width, height }
}
