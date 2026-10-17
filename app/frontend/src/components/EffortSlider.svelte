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

  /** bits-ui 用「索引」作为滑块值（0..MAX_INDEX），与 STOPS 下标一一对应 */
  const index = $derived(Math.max(0, STOPS.indexOf(nearestConnectionStop(value))))
  const current = $derived(STOPS[index])
  // bits-ui 在拖动中会连续上抛值；用本地值保证 thumb 跟手，
  // 而 onchange 只在松手/键盘确认时写回（避免每移动一像素就写一次设置）
  // 用 $derived 的���源值做初值；后续由 bits-ui 的 onValueChange 驱动。
  // 不用 `$effect(() => { localIndex = index })`——那在 `value` 未变时会
  // 反复覆写用户正在拖的位置（且触发 state_referenced_locally 警告）。
  let localIndex = $state(0)
  // 外部改了 value（比如设置页同步过来）时，对齐到对应档位
  $effect.pre(() => {
    const target = index
    if (Math.abs(target - localIndex) > 0.001 && !dragging) localIndex = target
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
  <Slider.Root
    type="single"
    min={0}
    max={MAX_INDEX}
    step={1}
    value={localIndex}
    onValueChange={(v) => { localIndex = Number(v) }}
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

        {#if !compact}
          <span
            class="effort-callout"
            class:is-visible={localIndex >= 2}
            style="left: clamp(58px, {percent}%, calc(100% - 58px))"
          >{hints[localIndex]}</span>
        {/if}

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

  /* ===== 轨道 ===== */
  .effort-slider {
    position: relative;
    display: block;
    width: 100%;
    height: 26px;
    border-radius: 999px;
    touch-action: none;
    user-select: none;
  }
  .effort-slider:focus-visible {
    outline: 2px solid color-mix(in oklab, var(--color-primary) 70%, transparent);
    outline-offset: 3px;
  }

  .effort-track {
    position: absolute;
    inset: 0;
    overflow: hidden;
    border-radius: inherit;
    background: color-mix(in oklab, var(--color-surface-container-highest) 88%, var(--color-outline-variant));
    box-shadow:
      inset 0 1px 0 color-mix(in oklab, white 40%, transparent),
      inset 0 -1px 0 color-mix(in oklab, var(--color-outline-variant) 45%, transparent);
    isolation: isolate;
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

  .effort-fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: linear-gradient(
      90deg,
      color-mix(in oklab, var(--color-primary) 22%, transparent),
      color-mix(in oklab, var(--color-primary-container) 55%, transparent)
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
    background: color-mix(in oklab, var(--color-outline) 55%, transparent);
    transition: background 160ms var(--ease-out), transform 160ms var(--ease-out);
    z-index: 2;
    pointer-events: none;
  }
  .effort-stop.is-passed {
    background: color-mix(in oklab, var(--color-primary) 70%, transparent);
  }
  .effort-stop.is-current {
    transform: translate(-50%, -50%) scale(1.6);
    background: var(--color-primary);
  }

  /* ===== 拇指 ===== */
  .effort-thumb {
    position: absolute;
    top: 50%;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--color-surface-container-lowest);
    border: 2px solid var(--color-primary);
    box-shadow:
      0 0 0 4px color-mix(in oklab, var(--color-primary-container) 22%, transparent),
      0 2px 8px color-mix(in oklab, var(--color-on-surface) 20%, transparent);
    transform: translate(-50%, -50%);
    transition:
      transform 160ms var(--ease-out),
      box-shadow 160ms var(--ease-out);
    z-index: 3;
    cursor: grab;
  }
  .effort-thumb:hover,
  .effort-thumb.is-dragging {
    box-shadow:
      0 0 0 6px color-mix(in oklab, var(--color-primary-container) 26%, transparent),
      0 0 18px color-mix(in oklab, var(--color-primary-container) 38%, transparent);
  }
  .effort-thumb.is-dragging {
    transform: translate(-50%, -50%) scale(1.07);
    transition: none;
    cursor: grabbing;
  }
  .effort-thumb:focus-visible {
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

  .effort-callout {
    position: absolute;
    bottom: calc(100% + 6px);
    transform: translateX(-50%);
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 10px;
    white-space: nowrap;
    background: color-mix(in oklab, var(--color-inverse-surface) 92%, transparent);
    color: var(--color-inverse-on-surface);
    opacity: 0;
    transition: opacity 160ms var(--ease-out);
    pointer-events: none;
    z-index: 4;
  }
  .effort-callout.is-visible {
    opacity: 1;
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
    .effort-callout,
    .effort-radiation {
      transition: none;
    }
  }
</style>
