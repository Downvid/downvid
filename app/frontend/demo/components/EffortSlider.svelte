<script lang="ts">
  /**
   * 最大连接数滑块 —— 对标 Codex 的 thinking effort：
   * 离散四档、档位标签常驻、选中档位只做平滑滑动，不再用 1–16 连续值。
   *
   * 首页和设置页共用同一个组件与 maxConnections 字段，任一端调整另一端同步。
   */
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
  let dragging = $state(false)

  // 能量辐射层（canvas）。移植自 dsh-reasoning-effort 的 drawRadiation，
  // 配色改成 DownVid 的琥珀 → 橙红。
  let canvas = $state<HTMLCanvasElement | null>(null)
  let dark = $state(false)
  const index = $derived(Math.max(0, STOPS.indexOf(nearestConnectionStop(value))))
  const current = $derived(STOPS[index])
  const percent = $derived((index / (STOPS.length - 1)) * 100)
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

  function percentOf(stopIndex: number): number {
    return (stopIndex / (STOPS.length - 1)) * 100
  }

  function select(next: number): void {
    const bounded = Math.max(0, Math.min(STOPS.length - 1, next))
    if (STOPS[bounded] !== value) onchange(STOPS[bounded])
  }

  function onInput(event: Event): void {
    select(Number((event.currentTarget as HTMLInputElement).value))
  }

  /**
   * 跟随系统深浅色。
   *
   * 不用 `matchMedia` 的 change 监听 + 手动卸载：`$effect` 的返回函数就是清理，
   * 只有一个出口（旧版漏过这个，热重载会累积监听）。
   */
  $effect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    dark = mq.matches
    const onChange = (e: MediaQueryListEvent) => { dark = e.matches }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  })

  /**
   * 辐射层动画。
   *
   * 三个关键点：
   *   1. **reduced-motion 下只画一帧**，不起 rAF——「减少动态」不是「慢一点」
   *   2. 尺寸用 ResizeObserver 跟，不读 layout 造成强制回流
   *   3. 卸载时 cancelAnimationFrame 与 disconnect 都要做
   */
  $effect(() => {
    const el = canvas
    if (!el) return
    const ctx = el.getContext('2d')
    if (!ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let size = resizeCanvas(el)
    let frame = 0

    // 状态从 $state 读，但 draw 是 rAF 驱动的（不经过 Svelte 的响应式），
    // 所以每次读最新值
    const stateOf = (): RadiationState => ({
      progress: percent / 100,
      dragging,
      top: index === STOPS.length - 1,
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
      // reduced-motion 下不跑 loop，所以要手动重画一次
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

<div
  class="effort"
  class:is-compact={compact}
  class:is-dragging={dragging}
  class:is-hot={index >= 2}
>
  <div class="effort-head">
    {#if label}<span class="effort-title">{label}</span>{/if}
    <span class="effort-readout">
      <span class="effort-value num">{current}</span>
      <span class="effort-tag">{labels[index]}</span>
    </span>
  </div>

  <div class="effort-track" style="--pct:{percent}%; --scale:{percent / 100}">
    <div class="effort-fill">
      {#each [0, 1, 2, 3, 4] as spark, i (i)}
        <span
          class="spark"
          style="left:{18 + i * 17}%; top:{28 + (i % 3) * 18}%; animation-delay:{i * 0.27}s"
        ></span>
      {/each}
    </div>

    <!-- 能量辐射层：裁剪在拇指左侧。canvas 比 CSS 渐变更能做出
         「逐列波动 + 拖尾衰减」的层次，而重绘成本仍在一帧 1ms 以内 -->
    <canvas class="effort-radiation" bind:this={canvas} aria-hidden="true"></canvas>

    {#if !compact}
      <span
        class="effort-callout"
        class:is-visible={index >= 2}
        style="left:clamp(58px, var(--pct), calc(100% - 58px))"
      >{hints[index]}</span>
    {/if}

    {#each STOPS as stop, i (stop)}
      <button
        type="button"
        class="effort-stop"
        class:is-passed={i <= index}
        class:is-current={i === index}
        style="left:{percentOf(i)}%"
        aria-label={labels[i]}
        onclick={() => select(i)}
      ></button>
    {/each}

    <div class="effort-thumb"></div>

    <input
      class="effort-input"
      type="range"
      min="0"
      max={STOPS.length - 1}
      step="1"
      value={index}
      oninput={onInput}
      onpointerdown={() => (dragging = true)}
      onpointerup={() => (dragging = false)}
      onpointercancel={() => (dragging = false)}
      onblur={() => (dragging = false)}
      aria-label={label || t('settings.maxConnections')}
      aria-valuetext="{current} · {labels[index]}"
    />
  </div>

  <div class="effort-labels">
    {#each STOPS as stop, i (stop)}
      <button
        type="button"
        class="effort-label"
        class:is-current={i === index}
        onclick={() => select(i)}
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
    line-height: 1;
    color: var(--ink-strong);
  }
  .is-compact .effort-value {
    font-size: 12px;
  }
  .effort-tag {
    font-size: 8px;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--accent-wash);
    color: var(--accent-deep);
  }

  .effort-track {
    position: relative;
    height: 24px;
    margin: 0 5px;
  }
  .effort-track::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 6px;
    border-radius: 999px;
    background: var(--rule);
    transform: translateY(-50%);
  }
  /* 辐射层：铺满轨道，不吃事件（thumb 与 input 要能点） */
  .effort-radiation {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border-radius: inherit;
    pointer-events: none;
    mix-blend-mode: screen;
    /* 浅色主题下 screen 会让橙色发白，改用 multiply 更贴合纸感 */
    z-index: 1;
  }
  :global([data-theme='light']) .effort-radiation,
  :global(.theme-light) .effort-radiation {
    mix-blend-mode: multiply;
    opacity: 0.85;
  }

  .effort-fill {
    position: absolute;
    left: 0;
    top: 50%;
    height: 6px;
    width: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--accent-deep), var(--accent));
    transform: translateY(-50%) scaleX(var(--scale));
    transform-origin: left center;
    transition: transform 160ms var(--ease-out);
    box-shadow: 0 0 10px color-mix(in oklab, var(--accent) 28%, transparent);
    overflow: hidden;
  }
  .effort-fill::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent,
      color-mix(in oklab, var(--paper-raised) 55%, transparent),
      transparent
    );
    animation: effort-sheen 2.8s var(--ease-in-out) infinite;
  }

  /* 高档位时轨道升温，并出现像参考图一样的星点 */
  .is-hot .effort-fill {
    background: linear-gradient(90deg, var(--accent-deep), var(--accent) 48%, #ff6338);
    box-shadow: 0 0 16px color-mix(in oklab, #ff6338 38%, transparent);
  }
  .spark {
    position: absolute;
    width: 2px;
    height: 2px;
    border-radius: 50%;
    background: #fff7e8;
    box-shadow: 0 0 4px #fff2da;
    opacity: 0;
    pointer-events: none;
  }
  .is-hot .spark {
    animation: spark-float 2.4s var(--ease-in-out) infinite;
  }

  .effort-callout {
    position: absolute;
    top: -24px;
    z-index: 5;
    transform: translate(-50%, 4px);
    padding: 3px 7px;
    border: 1px solid var(--rule);
    border-radius: 5px;
    background: var(--paper-raised);
    color: var(--accent-deep);
    box-shadow: var(--shadow-lift);
    font-family: var(--font-code);
    font-size: 8.5px;
    line-height: 1.3;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition:
      opacity var(--dur-base) var(--ease-out),
      transform var(--dur-base) var(--ease-out);
  }
  .effort-callout.is-visible {
    opacity: 1;
    transform: translate(-50%, 0);
  }

  .effort-stop {
    position: absolute;
    top: 50%;
    width: 10px;
    height: 10px;
    padding: 0;
    border: 1.5px solid var(--rule);
    border-radius: 50%;
    background: var(--paper-raised);
    transform: translate(-50%, -50%);
    cursor: pointer;
    z-index: 1;
    transition:
      border-color var(--dur-base) var(--ease-out),
      background-color var(--dur-base) var(--ease-out),
      transform var(--dur-base) var(--ease-out);
  }
  .effort-stop.is-passed {
    border-color: var(--accent-deep);
    background: var(--accent);
  }
  .effort-stop.is-current {
    transform: translate(-50%, -50%) scale(1.15);
  }
  .effort-stop:hover {
    transform: translate(-50%, -50%) scale(1.35);
  }

  .effort-thumb {
    position: absolute;
    top: 50%;
    left: var(--pct);
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--paper-raised);
    border: 2px solid var(--accent-deep);
    box-shadow:
      0 0 0 4px var(--accent-wash),
      0 2px 8px color-mix(in oklab, var(--ink-strong) 20%, transparent);
    transform: translate(-50%, -50%);
    transition:
      left 150ms var(--ease-out),
      transform 160ms var(--ease-out),
      box-shadow 160ms var(--ease-out);
    pointer-events: none;
    z-index: 2;
  }
  .is-dragging .effort-thumb,
  .effort:hover .effort-thumb {
    box-shadow:
      0 0 0 6px var(--accent-wash),
      0 0 18px color-mix(in oklab, var(--accent) 38%, transparent);
  }
  .is-dragging .effort-thumb {
    transform: translate(-50%, -50%) scale(1.12);
  }

  .effort-input {
    position: absolute;
    inset: -6px 0;
    width: 100%;
    margin: 0;
    opacity: 0;
    cursor: grab;
    -webkit-appearance: none;
    appearance: none;
    z-index: 3;
  }
  .effort-input:active {
    cursor: grabbing;
  }
  .effort-track:has(.effort-input:focus-visible) {
    outline: 2px solid color-mix(in oklab, var(--accent-deep) 70%, transparent);
    outline-offset: 4px;
    border-radius: 8px;
  }

  .effort-labels {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    margin: 0 2px;
  }
  .effort-label {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-on-surface-variant);
    font-family: var(--font-code);
    font-size: 8px;
    font-weight: 500;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: color var(--dur-base) var(--ease-out);
  }
  .effort-label:hover {
    color: var(--ink);
  }
  .effort-label.is-current {
    color: var(--accent-deep);
    font-weight: 700;
  }
  .effort-hint {
    margin: 0;
    font-size: 9.5px;
    line-height: 1.5;
    color: var(--color-on-surface-variant);
  }
  .is-compact .effort-label {
    font-size: 7.5px;
  }

  @keyframes effort-sheen {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(100%);
    }
  }

  @keyframes spark-float {
    0% {
      opacity: 0;
      transform: translateY(3px) scale(0.6);
    }
    30% {
      opacity: 0.9;
    }
    100% {
      opacity: 0;
      transform: translateY(-9px) scale(1.1);
    }
  }

  @media (max-width: 820px) {
    .effort,
    .is-compact {
      max-width: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .effort-fill::after,
    .is-hot .spark {
      animation: none;
      opacity: 0;
    }
    .effort-thumb,
    .effort-fill,
    .effort-callout {
      transition: none;
    }
  }
</style>
