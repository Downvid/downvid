<script lang="ts">
  /**
   * 最大连接数滑块（离散四档）。
   *
   * ## 为什么用 bits-ui 而不是手搓
   *
   * 手搓版本在「拖拽 + 吸附 + 键盘 + 无障碍」上反复出问题：
   * 指针捕获在 WebView 里不稳、键盘方向键没处理、`aria-valuetext` 与
   * 实际值对不上。这些是**别人已经解决过一万遍**的事。
   *
   * `bits-ui` 是 shadcn-svelte 的官方底座（Svelte 5 原生 runes 实现），
   * Slider 提供：
   *   - 指针拖拽 + 捕获 + 触摸
   *   - 键盘（←/→/Home/End/PageUp/PageDown）
   *   - `aria-valuenow` / `aria-valuetext` 完整语义
   *   - 离散 `step` 吸附
   *
   * 我只负责**视觉**：轨道、能量辐射、thumb、档位标签。
   *
   * ## 与旧版的行为差异（都是修正）
   *
   * 旧版用 `<input type=range>` + 手工 `dragging` 状态。那是原生控件，
   * 样式要靠 `appearance:none` 覆盖，而 WebKitGTK 上的伪元素覆盖不完全——
   * 表现是「macOS 上好看、Linux 上露出一截原生轨道」。bits-ui 用 role=slider
   * 的 div，完全不依赖原生控件的样式能力。
   */
  import { untrack } from 'svelte'
  import { Slider } from 'bits-ui'
  import { CONNECTION_STOPS, nearestConnectionStop } from '../lib/mock'
  import { t } from '../lib/i18n.svelte'
  import { drawRadiation, resizeCanvas, type RadiationState } from '../lib/radiation'

  interface Props {
    value: number
    onchange: (value: number) => void
    label?: string
    compact?: boolean
  }

  let { value, onchange, label = '', compact = false }: Props = $props()

  const STOPS = CONNECTION_STOPS
  const MAX_INDEX = STOPS.length - 1

  let dragging = $state(false)
  let canvas = $state<HTMLCanvasElement | null>(null)
  let dark = $state(false)

  /**
   * 滑块值就是**档位下标**（0..MAX_INDEX），不是连接数。
   *
   * ## 这里曾经有一个让「鼠标拖不动」的 bug
   *
   * 第一版写的是：
   *
   *     const index = $derived(Math.max(0, STOPS.indexOf(nearestConnectionStop(value))))
   *     $effect.pre(() => { if (index !== localIndex && !dragging) localIndex = index })
   *
   * 看起来是「外部改了 value 就对齐档位」，实际却把拖动结果吃掉了：
   *
   *   1. 拖动 → bits-ui 写 `value` = 3（下标）
   *   2. `index` 把它当**连接数**去归一化 → `nearestConnectionStop(3)` = 4
   *      → `STOPS.indexOf(4)` = **0**
   *   3. `$effect.pre` 发现 `0 !== 3` 且已松手（dragging=false）→ 把 localIndex 拉回 0
   *
   * 表现就是**鼠标完全拖不动**，而键盘能用（键盘走 `onValueCommit`，
   * 那条路径里 `commit()` 直接改的是 `localIndex`，没经过归一化）。
   *
   * 修法：`index` 直接就是 `localIndex`，不经过 `nearestConnectionStop`。
   * 那个函数只在**外部传入的连接数** → 档位的那一次转换里用（见 `initialIndex`）。
   */
  /**
   * 外部连接数 → 档位下标。
   *
   * `untrack` 是**刻意的**：这里只想读一次初值，不想让 `value` 的变化
   * 重新触发整个派生链（那会与 `lastExternal` 的外部同步逻辑打架）。
   * 不加 `untrack` 时 Svelte 会警告 `state_referenced_locally`——
   * 那个警告正是提醒「你在捕获初始值而不是建立依赖」，与这里的意图一致。
   */
  const initialIndex = untrack(() =>
    Math.max(0, STOPS.indexOf(nearestConnectionStop(value))),
  )

  /** bits-ui 的滑块值（档位下标）。初值来自外部传入的连接数。 */
  let localIndex = $state<number>(initialIndex)

  /** 当前档位下标（就是滑块值本身） */
  const index = $derived(localIndex)
  const current = $derived(STOPS[index] ?? STOPS[0])

  /**
   * 外部改了 `value`（比如设置页同步过来）时对齐。
   *
   * **只在外部值真的变了时对齐**：用 `lastExternal` 记住上次处理过的外部值，
   * 否则拖拽过程中每次 `localIndex` 变化都会触发这里，
   * 而 `value` 是 bind 过去的、此时已等于 `localIndex`，会形成自激。
   */
  let lastExternal = $state(untrack(() => value))
  $effect.pre(() => {
    if (value === lastExternal) return
    lastExternal = value
    const target = Math.max(0, STOPS.indexOf(nearestConnectionStop(value)))
    if (target !== localIndex) localIndex = target
  })

  const percent = $derived((localIndex / MAX_INDEX) * 100)

  const labels = $derived([
    t('settings.effortLight'),
    t('settings.effortBalanced'),
    t('settings.effortFast'),
    t('settings.effortAggressive'),
  ])
  const hints = $derived([
    t('settings.effortLightHint'),
    t('settings.effortBalancedHint'),
    t('settings.effortFastHint'),
    t('settings.effortAggressiveHint'),
  ])

  function commit(next: number | readonly number[]): void {
    const i = Array.isArray(next) ? Number(next[0]) : Number(next)
    localIndex = Math.max(0, Math.min(MAX_INDEX, i))
    if (STOPS[localIndex] !== value) onchange(STOPS[localIndex])
  }

  /** 跟随系统深浅色。`$effect` 的返回函数就是清理，只有一个出口。 */
  $effect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    dark = mq.matches
    const onChange = (e: MediaQueryListEvent) => { dark = e.matches }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  })

  /** 辐射层动画。reduced-motion 下只画一帧，不起 rAF。 */
  $effect(() => {
    const el = canvas
    if (!el) return
    const ctx = el.getContext('2d')
    if (!ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let size = resizeCanvas(el)
    let frame = 0

    const stateOf = (): RadiationState => ({
      progress: percent / 100,
      dragging,
      top: localIndex === MAX_INDEX,
      dark,
    })
    const draw = (time = performance.now()) => {
      drawRadiation(ctx, size.width, size.height, time, stateOf())
    }
    const loop = (time: number) => {
      draw(time)
      frame = requestAnimationFrame(loop)
    }

    const observer = new ResizeObserver(() => {
      size = resizeCanvas(el)
      if (reduced.matches) draw()
    })
    observer.observe(el)

    draw()
    if (!reduced.matches) frame = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  })
</script>

<div class="effort" class:is-compact={compact}>
  <div class="effort-head">
    {#if label}<span class="effort-title">{label}</span>{/if}
    <span class="effort-readout">
      <span class="effort-value num">{current}</span>
      <span class="effort-tag">{labels[index]}</span>
    </span>
  </div>

  <!--
    bits-ui 的 Slider.Root 负责全部交互与无障碍：
      - 指针拖拽（含 setPointerCapture）
      - 键盘：←/→ 一档、Home/End 首末档
      - aria-valuenow / aria-valuetext / role=slider
    视觉完全由下面的元素决定。
  -->
  <!--
    **必须用 `bind:value`，不能用 `value=`。**

    这是能否拖动的**根本原因**，也是我排查最久的一处：
    bits-ui 的 `updateValue()` 内部是

        this.opts.value.current = snapValueToCustomSteps(...)

    也就是说它**直接给 `value` 赋值**。单向 `value={localIndex}` 时，
    `opts.value.current` 拿到的是 `$props()` 解构后的**普通变量快照**，
    改它不会触发 Svelte 的响应式——表现为：

      - 键盘能用（键盘走 `onValueChange` 回调，我手动赋值了）
      - **鼠标拖拽完全不动**（走 `updateValue` 直接改内部引用）

    `value` 在 bits-ui 里声明为 `$bindable()`，用 `bind:` 才能双向同步。
  -->
  <Slider.Root
    type="single"
    min={0}
    max={MAX_INDEX}
    step={1}
    bind:value={localIndex}
    onValueCommit={(v) => commit(v)}
    onPointerDown={() => (dragging = true)}
    onPointerUp={() => (dragging = false)}
    aria-label={label || t('settings.maxConnections')}
    class="effort-slider"
    data-top={localIndex === MAX_INDEX ? '' : undefined}
  >
    {#snippet children({ thumbItems, tickItems })}
      <div class="effort-track" class:is-hot={localIndex >= 2}>
        <!-- 能量辐射层：裁剪在拇指左侧（见 lib/radiation.ts） -->
        <canvas class="effort-radiation" bind:this={canvas} aria-hidden="true"></canvas>

        <!-- 已填充区：从 0 到拇指 -->
        <div class="effort-fill" style="width: {percent}%"></div>

        <!-- 档位刻点 -->
        {#each tickItems as tick (tick.value)}
          <span
            class="effort-stop"
            class:is-passed={tick.value <= localIndex}
            class:is-current={tick.value === localIndex}
            style="left: {(tick.value / MAX_INDEX) * 100}%"
          ></span>
        {/each}

        <!-- 拇指 -->
        {#each thumbItems as thumb (thumb.index)}
          <!-- `class:` 指令不能用在组件上（Svelte 5 限制），用条件字符串 -->
          <Slider.Thumb
            index={thumb.index}
            class="effort-thumb{dragging ? ' is-dragging' : ''}"
            aria-label={labels[localIndex]}
            aria-valuetext="{current} · {labels[localIndex]}"
          ></Slider.Thumb>
        {/each}
      </div>
    {/snippet}
  </Slider.Root>

  <!-- 档位标签：可点（点标签也能选档，比拖更精确） -->
  <div class="effort-labels">
    {#each STOPS as stop, i (stop)}
      <button
        type="button"
        class="effort-label"
        class:is-current={i === index}
        onclick={() => commit(i)}
      >
        {labels[i]}
      </button>
    {/each}
  </div>

  {#if !compact && index < 2}
    <p class="effort-hint">{hints[index]}</p>
  {/if}
</div>

<style>
  .effort {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    max-width: 320px;
    min-width: 0;
  }
  .is-compact {
    max-width: 268px;
    gap: 4px;
  }

  .effort-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    min-height: 16px;
  }
  .effort:not(:has(.effort-title)) .effort-head {
    justify-content: flex-end;
  }
  .effort-title {
    font-family: var(--font-code);
    font-size: 8.5px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-on-surface-variant);
    white-space: nowrap;
  }
  .effort-readout {
    display: flex;
    align-items: baseline;
    gap: 6px;
    flex: none;
  }
  .effort-value {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-on-surface);
    font-variant-numeric: tabular-nums;
  }
  .effort-tag {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--color-primary);
    text-transform: uppercase;
  }

  /* ===== 轨道容器 =====
     
     **必须用 :global()**：这个 class 传给了 `Slider.Root`（一个组件），
     而 Svelte 的 scoped 样式只给**本文件里的原生元素**加作用域 hash。
     组件内部渲染出的元素不带这个 hash，所以 `.effort-slider.s-xxx` 匹配不到
     真实的 `.effort-slider` —— 表现是「高度 0、圆角丢失」，
     而构建完全不报错（第一版就是这样，截图里滑块被压成一条线）。
  */
  :global(.effort-slider) {
    position: relative;
    display: block;
    width: 100%;
    height: 26px;
    border-radius: 999px;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }
  :global(.effort-slider:focus-visible) {
    outline: 2px solid color-mix(in oklab, var(--color-primary) 70%, transparent);
    outline-offset: 3px;
  }

  /*
    轨道**必须是深色**——这是参考实现的关键，我第一版搞反了。

    能量辐射用的是 `mix-blend-mode: screen`（只增亮），它需要深色底才能显出来。
    在浅色底上 screen 会把橙色叠到接近白，整条轨道糊成一片，
    只剩竖条纹隐约可见——截图里的样子。

    参考实现的轨道是 `#03040a → #5d35a0`（近黑 → 蓝紫）。
    这里换成同结构的琥珀色系：近黑棕 → 深琥珀 → 亮琥珀。
  */
  .effort-track {
    position: absolute;
    inset: 0;
    overflow: hidden;
    border-radius: inherit;
    /* 整体压暗：能量层用 screen 叠加，底色越暗对比越强。
       之前的 #7d4a12 太亮，右半段（未到的地方）看着像「已经满了」。 */
    background: linear-gradient(
      100deg,
      #060402 0%,
      #120b03 22%,
      #24160a 45%,
      #38220e 70%,
      #4a2c12 100%
    );
    box-shadow:
      inset 0 1px 0 rgba(255, 220, 180, 0.14),
      inset 0 -1px 0 rgba(0, 0, 0, 0.5),
      0 2px 8px rgba(40, 22, 6, 0.28);
    isolation: isolate;
  }
  /* 轨道上的第二层：给深色底一点暖色不均匀，纯线性渐变太「塑料」 */
  .effort-track::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(circle at 18% 45%, rgba(255, 168, 64, 0.1), transparent 24%),
      linear-gradient(90deg, rgba(0, 0, 0, 0.28), transparent 42%, rgba(255, 152, 0, 0.12));
  }

  .effort-radiation {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border-radius: inherit;
    pointer-events: none;
    z-index: 1;
    mix-blend-mode: screen;
    transition: filter 140ms var(--ease-out);
  }
  .is-dragging .effort-radiation {
    filter: saturate(1.45) brightness(1.28) contrast(1.06);
    transition: none;
  }

  /*
    已填充区。深色轨道上它负责「走到哪了」的直觉，
    但**不能太亮**——否则会盖掉 canvas 的辐射层。
    放在 canvas 之下（z-index 0 vs 1），只做底色渐变。
  */
  .effort-fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: linear-gradient(
      90deg,
      rgba(140, 81, 0, 0.35) 0%,
      rgba(255, 152, 0, 0.28) 100%
    );
    transition: width 190ms var(--ease-out);
    z-index: 0;
  }

  .effort-stop {
    position: absolute;
    top: 50%;
    width: 3px;
    height: 3px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    background: rgba(255, 214, 170, 0.32);
    transition: background 160ms var(--ease-out), transform 160ms var(--ease-out);
    z-index: 2;
    pointer-events: none;
  }
  .effort-stop.is-passed {
    background: rgba(255, 190, 120, 0.75);
  }
  /*
    当前档位的刻点**不该放大**：它就在 thumb 底下，放大后四个角会从
    圆形 thumb 的边上露出来，看起来像「拇指是个圆角方块」——
    截图里就是这样被骗了很久（thumb 的 radius 一直是 50%）。

    参考实现里也没有这个放大的刻点：thumb 本身就是「当前位置」的指示。
  */
  .effort-stop.is-current {
    opacity: 0;
  }

  /* ===== 拇指 ===== */
  /* 拇指是纯白实心圆：深色轨道上唯一的「实」元素，视觉焦点。
     同样必须 :global —— 它是 `Slider.Thumb` 组件渲染的，
     Svelte 不会给它加本文件的作用域 hash（第一版这里高度 0，拇指不可见）。 */
  :global(.effort-thumb) {
    position: absolute;
    top: 50%;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fff;
    border: 1px solid rgba(255, 255, 255, 0.94);
    box-shadow:
      0 0 0 2px rgba(255, 176, 64, 0.25),
      0 0 14px rgba(255, 152, 0, 0.55),
      0 2px 7px rgba(0, 0, 0, 0.32);
    transform: translate(-50%, -50%);
    transition:
      transform 160ms var(--ease-out),
      box-shadow 160ms var(--ease-out);
    z-index: 3;
    cursor: grab;
  }
  :global(.effort-thumb:hover),
  :global(.effort-thumb.is-dragging) {
    box-shadow:
      0 0 0 3px rgba(255, 176, 64, 0.32),
      0 0 22px rgba(255, 152, 0, 0.85),
      0 0 34px rgba(255, 120, 0, 0.45),
      0 3px 8px rgba(0, 0, 0, 0.34);
  }
  :global(.effort-thumb.is-dragging) {
    transform: translate(-50%, -50%) scale(1.07);
    transition: none;
    cursor: grabbing;
  }
  :global(.effort-thumb:focus-visible) {
    outline: 2px solid color-mix(in oklab, var(--color-primary) 70%, transparent);
    outline-offset: 3px;
  }

  /* 最高档：整条轨道极缓呼吸（静置也有「满负荷」暗示） */
  @keyframes effort-breathe {
    0%, 100% { filter: brightness(1); }
    50% { filter: brightness(1.06); }
  }
  .effort-slider[data-top] .effort-track {
    animation: effort-breathe 1.9s ease-in-out infinite;
  }


  /* ===== 档位标签 ===== */
  .effort-labels {
    display: flex;
    justify-content: space-between;
    gap: 2px;
  }
  .effort-label {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 9.5px;
    font-weight: 500;
    letter-spacing: 0.02em;
    padding: 2px 0;
    border: 0;
    background: none;
    color: var(--color-on-surface-variant);
    opacity: 0.62;
    cursor: pointer;
    transition: color 160ms var(--ease-out), opacity 160ms var(--ease-out);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .effort-label:hover {
    opacity: 0.9;
  }
  .effort-label.is-current {
    color: var(--color-primary);
    opacity: 1;
    font-weight: 600;
  }

  .effort-hint {
    margin: 0;
    font-size: 10px;
    line-height: 1.45;
    color: var(--color-on-surface-variant);
    opacity: 0.78;
  }

  @media (prefers-reduced-motion: reduce) {
    .effort-slider[data-top] .effort-track {
      animation: none;
    }
    .effort-fill,
    .effort-thumb,
    .effort-stop,
    .effort-radiation {
      transition: none;
    }
  }
</style>
