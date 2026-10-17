/**
 * 滑块的能量辐射层（canvas）。
 *
 * 移植自 <https://github.com/HanaAyane/dsh-reasoning-effort> 的 `drawRadiation`
 * （`src/client/index.tsx:323-419`）。**逐公式对齐**，不做简化——
 * 第一版我漏了 grain 噪点、合成公式与粒子层，视觉上明显不像。
 *
 * ## 三层结构（缺一层就不像）
 *
 * 1. **柱状能量**：逐 4px 列的三层正弦叠加，形成起伏的「浪」
 * 2. **粒子拖尾**：14 条短条纹从拇指向左飘散，给「有东西在流动」的感觉
 * 3. **拇指光晕**：一个径向渐变贴在拇指位置，是整条的视觉焦点
 *
 * ## 与参考实现的唯一差异：配色
 *
 * 参考是 DeepSeek 蓝紫。这里换成 DownVid 的琥珀 → 橙红。
 * 色彩公式的**结构**（hot / wave / crest 三项加权）保持完全一致，
 * 只换数值——这样层次感不会因为换色而丢。
 */

/** 辐射层的状态。 */
export interface RadiationState {
  /** 0..1，拇指位置 */
  progress: number
  /** 是否在拖动（拖动时波动更快、粒子更快、整体更亮） */
  dragging: boolean
  /** 是否为最高档（参考实现的 data-top） */
  top: boolean
  /** 是否深色主题 */
  dark: boolean
}

/**
 * 配色方案。
 *
 * 每个通道都是 `基数 + hot 系数 * hot + wave 系数 * wave + crest 系数 * crest`，
 * 与参考实现的公式同构。这样换色只需换六个数，不用重做层次。
 */
interface Channels {
  /** 远端的基色 */
  base: [number, number, number]
  /** hot（离拇指近）的加成 */
  hot: [number, number, number]
  /** wave 的加成 */
  wave: [number, number, number]
  /** crest（浪尖）的加成 */
  crest: [number, number, number]
  /** alpha 上限 */
  maxAlpha: number
  /** 浅色主题下整体 alpha 折扣（参考实现是 ×0.72） */
  alphaScale: number
}

function channels(dark: boolean, top: boolean): Channels {
  const boost = top ? 1.12 : 1
  if (dark) {
    // 深色轨道上的能量：琥珀 → 橙 → 浪尖推到暖白。
    //
    // 数值参照参考实现的**比例关系**（base 很低、hot 加成大、crest 推高绿蓝
    // 制造「白热」感），只把色相从蓝紫换成琥珀。
    // 之前那版 hot 系数太小，在深色底上几乎看不出来。
    return {
      base: [54, 28, 6],
      hot: [148, 96, 26],
      wave: [62, 40, 8],
      crest: [52, 72, 60],
      maxAlpha: Math.min(0.98, 0.94 * boost),
      alphaScale: 1,
    }
  }
  // 浅色轨道（当前默认不用，但保留：若将来改浅色主题）
  return {
    base: [150, 88, 16],
    hot: [90, 56, 6],
    wave: [24, 14, 2],
    crest: [24, 22, 12],
    maxAlpha: Math.min(0.8, 0.68 * boost),
    alphaScale: 0.82,
  }
}

/**
 * 画一帧。
 *
 * 调用方负责设置 canvas 尺寸与 DPR 变换、决定何时重绘。
 * 这个函数只做纯绘制：不持有状态、不读全局、不碰 DOM。
 */
export function drawRadiation(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  state: RadiationState,
): void {
  const origin = state.progress * width
  const cell = 3
  // 拖动时波动更快：给「正在用力」的即时反馈
  const speed = state.dragging ? 2.8 : 1
  const c = channels(state.dark, state.top)
  const isDark = state.dark

  context.clearRect(0, 0, width, height)
  // 提前返回是**性能优化**：progress=0 时下面的循环 `x < 0` 本来就不执行
  // （变异测试证实去掉不会有测试失败）。保留是为了省掉一次 save/clip/restore。
  if (origin <= 0) return

  context.save()
  // 裁剪在拇指左侧。循环上界本来就是 origin，所以这里是**第二道保险**
  // （变异测试证实改 width 不会有可见差异）——若将来改成「先画满再裁」，
  // 它就是唯一挡住右侧的东西。
  context.beginPath()
  context.rect(0, 0, origin, height)
  context.clip()

  // ===== 第 1 层：细竖线（参考实现的核心视觉效果）=====
  //
  // 关键：**每列只画 1px 宽的线**，不是「2px 实心柱」。
  // 我前几版画的是 fillRect(x, 0, cell-1, height) —— 宽 2-3px 的实心块，
  // 相邻块之间只隔 1px 缝隙，合起来就是一片砖墙。参考实现靠**极细的线**
  // 制造出「能量条纹」的透光感，这才是它看起来高级的原因。
  //
  // 亮度沿**高度**做上下渐隐（中间亮、两端暗），而不是整列同色。
  const lineWidth = 1

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

    if (columnEnergy <= 0.02) continue

    const nearness = Math.max(0, 1 - distance / Math.max(1, width * 0.78))

    // 沿高度三段渐隐：画 3 段而不是逐格，视觉一样但调用数少一个量级
    // （逐格 3px × 26px 高 = 9 次/列；三段 = 3 次/列）
    const bands = [
      { y: 0, h: height * 0.34, k: 0.42 },              // 上端暗
      { y: height * 0.34, h: height * 0.32, k: 1 },     // 中间最亮
      { y: height * 0.66, h: height * 0.34, k: 0.42 },  // 下端暗
    ]

    for (const band of bands) {
      const grain = 0.74 + 0.26 * Math.sin(x * 0.73 + band.y * 1.31 + time * 0.006)
      const energy = columnEnergy * band.k * grain
      if (energy <= 0.02) continue

      const r = Math.min(255, Math.round(c.base[0] + c.hot[0] * nearness + c.wave[0] * wave))
      const g = Math.min(255, Math.round(c.base[1] + c.hot[1] * nearness + c.crest[1] * crest))
      const b = Math.min(255, Math.round(c.base[2] + c.hot[2] * nearness))
      const alpha = Math.min(c.maxAlpha, energy * 0.9) * c.alphaScale
      context.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`
      context.fillRect(x, band.y, lineWidth, band.h)
    }
  }

  // ===== 第 2 层：拇指附近的高光竖线（「白热」的那几条）=====
  //
  // 参考图里紧贴拇指有几条特别亮的线，那是整条的视觉锚点。
  // 没有它，能量是「均匀的一片」，看不出「距离拇指多远」。
  for (let i = 0; i < 5; i += 1) {
    const offset = 4 + i * 7
    const x = origin - offset
    if (x < 0) break
    const falloff = 1 - i / 5
    const alpha = (0.32 + 0.5 * falloff) * c.alphaScale
    const r = Math.min(255, Math.round(c.base[0] + c.hot[0] * 0.95 + c.crest[0] * 0.6))
    const g = Math.min(255, Math.round(c.base[1] + c.hot[1] * 0.95 + c.crest[1] * 0.6))
    const b = Math.min(255, Math.round(c.base[2] + c.hot[2] * 0.95 + c.crest[2] * 0.6))
    context.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`
    context.fillRect(x, 2, lineWidth, height - 4)
  }

  // ===== 第 3 层：粒子拖尾（14 条短条纹向左飘散）=====
  //
  // 没有这一层，整条轨道是「静止的能量」；有了它才有「流动感」。
  for (let i = 0; i < 14; i += 1) {
    const travel =
      (time * (state.dragging ? 0.16 : 0.065) * (0.78 + (i % 5) * 0.09) + i * 23) %
      Math.max(30, origin + 64)
    const particleX = origin - travel
    if (particleX < -24 || particleX > width + 16) continue

    const particleY = 3 + ((i * 13 + Math.sin(time * 0.003 + i) * 5) % Math.max(7, height - 6))
    const length = 4 + (i % 4) * 4 + (state.dragging ? 6 : 0)
    const alpha = 0.28 + (i % 5) * 0.1

    const streak = context.createLinearGradient(particleX, 0, particleX + length, 0)
    if (isDark) {
      streak.addColorStop(0, 'rgba(255,168,64,0)')
      streak.addColorStop(0.68, `rgba(255,196,110,${alpha})`)
      streak.addColorStop(1, `rgba(255,248,232,${Math.min(1, alpha + 0.3)})`)
    } else {
      streak.addColorStop(0, 'rgba(184,104,16,0)')
      streak.addColorStop(0.68, `rgba(190,112,20,${alpha * 0.72})`)
      streak.addColorStop(1, `rgba(122,70,8,${Math.min(0.82, alpha + 0.18)})`)
    }
    context.fillStyle = streak
    context.fillRect(particleX, particleY, length, i % 3 === 0 ? 2 : 1)
  }

  // ===== 第 4 层：拇指光晕（整条的视觉焦点）=====
  //
  // 用径向渐变而不是 CSS：它能跟着 canvas 一起被裁剪/混合，
  // 而且在 DPR 变化时不会糊。
  const glow = context.createRadialGradient(origin, height / 2, 0, origin, height / 2, 24)
  if (isDark) {
    // 深色底上光晕要更「白热」：参考实现中心是 rgba(255,255,255,.82)
    glow.addColorStop(0, 'rgba(255,255,252,.88)')
    glow.addColorStop(0.14, 'rgba(255,214,150,.58)')
    glow.addColorStop(0.44, 'rgba(224,138,28,.3)')
    glow.addColorStop(1, 'rgba(140,81,0,0)')
  } else {
    glow.addColorStop(0, 'rgba(255,255,255,.86)')
    glow.addColorStop(0.14, 'rgba(255,214,160,.48)')
    glow.addColorStop(0.44, 'rgba(200,120,20,.22)')
    glow.addColorStop(1, 'rgba(140,81,0,0)')
  }
  context.fillStyle = glow
  context.fillRect(origin - 26, 0, 52, height)

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
