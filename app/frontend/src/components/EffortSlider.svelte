<script lang="ts">
  /**
   * 下载加速 / 推理强度滑块（离散四档：4, 8, 16, 32）。
   * 采用 ~/project/gqy 的推理滑块视觉体系与指针动力学交互。
   * 支持 32 之前各档位（4/8/16）的动态主题色彩、能量流动光效与精确几何布局。
   */
  import { untrack } from 'svelte'
  import { CONNECTION_STOPS, nearestConnectionStop } from '../lib/constants'
  import { t } from '../lib/i18n.svelte'

  interface Props {
    value: number
    onchange: (value: number) => void
    label?: string
    compact?: boolean
  }

  let { value, onchange, label = '', compact = false }: Props = $props()

  const STOPS = CONNECTION_STOPS // [4, 8, 16, 32]
  const MAX_INDEX = STOPS.length - 1

  const STOP_NAMES = [
    '轻量 (4)',
    '均衡 (8 · 推荐)',
    '高速 (16)',
    '极速 (32)',
  ]

  const STOP_DESCS = [
    '轻量单线程低开销，对弱网与公共 Wi-Fi 极友好',
    '推荐默认档：多线程并发加速，速度与稳定性达到最佳平衡',
    '高速多分段迸发，充分释放百兆/千兆家庭宽带潜能',
    '满载极致极速下载，最大化榨干服务器带宽（高能量 Apex 模式）',
  ]

  let trackEl = $state<HTMLElement | null>(null)
  let matrixEl = $state<HTMLElement | null>(null)
  let pressed = $state(false)
  let dragging = $state(false)

  const initialIndex = untrack(() => Math.max(0, STOPS.indexOf(nearestConnectionStop(value))))
  let selected = $state(initialIndex)
  let live = $state(initialIndex)

  // 外部 value 响应
  let lastExternal = $state(untrack(() => value))
  $effect.pre(() => {
    if (value !== lastExternal) {
      lastExternal = value
      const target = Math.max(0, STOPS.indexOf(nearestConnectionStop(value)))
      if (target !== selected && !pressed) {
        selected = target
        live = target
      }
    }
  })

  // 文字切换过渡
  let prevValueText = $state('')
  let ghostText = $state('')

  const activeIndex = $derived(pressed ? live : selected)
  const currentName = $derived(STOP_NAMES[activeIndex] ?? STOP_NAMES[0])
  const currentDesc = $derived(STOP_DESCS[activeIndex] ?? STOP_DESCS[0])
  const isApex = $derived(activeIndex === MAX_INDEX)

  $effect(() => {
    const next = currentName
    if (prevValueText && prevValueText !== next) {
      ghostText = prevValueText
    }
    prevValueText = next
  })

  // 极速 Apex 矩阵粒子效果
  let matrixWidth = 0
  function buildMatrix() {
    if (!matrixEl || !trackEl) return
    const w = trackEl.clientWidth
    if (!w || w === matrixWidth) return
    matrixWidth = w
    const block = 4
    const gap = 1
    const cols = Math.max(1, Math.floor((w + gap) / (block + gap)))
    matrixEl.style.gridTemplateColumns = `repeat(${cols}, ${block}px)`
    matrixEl.style.gridAutoRows = `${block}px`
    matrixEl.style.gap = `${gap}px`
    let html = ''
    for (let r = 0; r < 5; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const fx = cols < 2 ? 1 : c / (cols - 1)
        let fade = 1
        if (fx <= 0.05) fade = 0
        else if (fx < 0.78) {
          const t = (fx - 0.05) / 0.73
          fade = t * t * (3 - 2 * t)
        }
        const delay = (-Math.random() * 2.6).toFixed(2)
        html += `<i class="effort-cell" style="opacity:${fade.toFixed(2)};animation-delay:${delay}s"></i>`
      }
    }
    matrixEl.innerHTML = html
  }

  $effect(() => {
    if (isApex) {
      buildMatrix()
    }
  })

  function commit(index: number) {
    selected = Math.max(0, Math.min(MAX_INDEX, index))
    live = selected
    const nextVal = STOPS[selected]
    if (nextVal !== value) {
      lastExternal = nextVal
      onchange(nextVal)
    }
  }

  function travelFor(clientX: number): number {
    if (!trackEl) return 0
    const rect = trackEl.getBoundingClientRect()
    const s = Math.max(0, rect.width - 18)
    const raw = Math.max(0, Math.min(s, clientX - rect.left - 9))
    if (MAX_INDEX < 1 || !s) return raw
    const seg = s / MAX_INDEX
    if (!seg) return raw
    const i = Math.min(MAX_INDEX - 1, Math.floor(raw / seg))
    const t = (raw - i * seg) / seg
    return (i + t - (0.8 * Math.sin(2 * Math.PI * t)) / (2 * Math.PI)) * seg
  }

  function nearest(x: number): number {
    if (!trackEl) return 0
    const s = Math.max(0, trackEl.clientWidth - 18)
    if (MAX_INDEX < 1 || !s) return 0
    return Math.max(0, Math.min(MAX_INDEX, Math.round((x / s) * MAX_INDEX)))
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || !trackEl) return
    pressed = true
    dragging = false
    try {
      trackEl.setPointerCapture(e.pointerId)
    } catch {}
    live = nearest(travelFor(e.clientX))
  }

  function onPointerMove(e: PointerEvent) {
    if (!pressed) return
    dragging = true
    live = nearest(travelFor(e.clientX))
  }

  function onPointerUp(e: PointerEvent) {
    if (!pressed) return
    if (dragging) {
      live = nearest(travelFor(e.clientX))
    }
    commit(live)
    pressed = false
    dragging = false
    try {
      trackEl?.releasePointerCapture(e.pointerId)
    } catch {}
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault()
      commit(selected - 1)
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault()
      commit(selected + 1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      commit(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      commit(MAX_INDEX)
    }
  }
</script>

<div
  class="effort level-{activeIndex}"
  class:is-compact={compact}
  class:is-apex={isApex}
  class:is-hot={activeIndex >= 2}
>
  <div class="effort-head">
    <span class="effort-label">{label || t('settings.accel')}</span>
    <span class="effort-value-wrap">
      {#key currentName}
        <span class="effort-value">{currentName}</span>
      {/key}
      {#if ghostText}
        {#key ghostText}
          <span class="effort-ghost" aria-hidden="true">{ghostText}</span>
        {/key}
      {/if}
    </span>
  </div>

  {#if !compact}
    <div class="effort-ends">
      <span>轻量 (4)</span>
      <span>均衡 (8)</span>
      <span>高速 (16)</span>
      <span>极速 (32)</span>
    </div>
  {/if}

  <div
    bind:this={trackEl}
    class="effort-track"
    role="slider"
    tabindex="0"
    aria-label={label || t('settings.accel')}
    aria-valuemin={0}
    aria-valuemax={MAX_INDEX}
    aria-valuenow={activeIndex}
    aria-valuetext={currentName}
    data-dragging={dragging ? '' : undefined}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onkeydown={onKeyDown}
  >
    <!-- 背景流光与填充条（纯 CSS 计算，零尺寸坍缩） -->
    <div
      class="effort-fill"
      style="width: calc({activeIndex} * (100% - 18px) / {MAX_INDEX} + 18px)"
    >
      <span class="fill-shimmer" aria-hidden="true"></span>
    </div>

    <!-- 刻度点 -->
    <div class="effort-ticks">
      {#each STOPS as _, i}
        <i
          class="effort-tick"
          class:is-active={i === activeIndex}
          class:is-passed={i <= activeIndex}
          style="left: calc({i} * (100% - 18px) / {MAX_INDEX} + 9px)"
        ></i>
      {/each}
    </div>

    <!-- 32 档 Apex 矩阵 -->
    <div bind:this={matrixEl} class="effort-matrix" aria-hidden="true"></div>

    <!-- 滑块旋钮 -->
    <div
      class="effort-knob"
      style="left: calc({activeIndex} * (100% - 18px) / {MAX_INDEX})"
    >
      <span class="knob-core"></span>
    </div>
  </div>

  {#if !compact}
    <p class="effort-desc">{currentDesc}</p>
  {/if}
</div>

<style>
  .effort {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 12px 10px;
    user-select: none;
    border-radius: var(--radius-panel, 12px);
    background: var(--paper-raised, #ffffff);
    border: 1px solid var(--rule, rgba(0, 0, 0, 0.08));
    width: 100%;
    max-width: 520px;
    transition:
      border-color 0.22s ease,
      box-shadow 0.22s ease,
      background 0.22s ease;
  }
  .effort.is-compact {
    padding: 4px 6px 6px;
    background: transparent;
    border: none;
    max-width: 480px;
  }
  .effort-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    position: relative;
    min-width: 0;
  }
  .effort-label {
    flex: none;
    font-size: 12px;
    line-height: 16px;
    font-weight: 500;
    color: var(--color-on-surface-variant, #666);
    letter-spacing: 0.02em;
  }
  .effort-value-wrap {
    position: relative;
    min-width: 0;
    flex: 0 1 auto;
    display: inline-flex;
  }
  .effort-value {
    font-size: 13px;
    line-height: 16px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: color 0.22s ease;
    animation: effortSwapIn 0.22s cubic-bezier(0.2, 0.7, 0.2, 1);
  }
  .effort-ghost {
    position: absolute;
    left: 0;
    top: 0;
    font-size: 13px;
    line-height: 16px;
    font-weight: 600;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    animation: effortSwapOut 0.22s cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
  }

  /* 档位专属色彩体系与文字动效 */
  .effort.level-0 .effort-value {
    color: #059669;
  }
  .effort.level-1 .effort-value {
    color: var(--primary, #2563eb);
  }
  .effort.level-2 .effort-value {
    color: #d97706;
  }
  .effort.level-3 .effort-value {
    color: #7c5ce6;
  }

  @keyframes effortSwapIn {
    from {
      opacity: 0;
      filter: blur(4px);
      transform: translateY(5px);
    }
    to {
      opacity: 1;
      filter: blur(0);
      transform: translateY(0);
    }
  }
  @keyframes effortSwapOut {
    from {
      opacity: 1;
      filter: blur(0);
      transform: translateY(0);
    }
    to {
      opacity: 0;
      filter: blur(4px);
      transform: translateY(-5px);
    }
  }

  .effort-ends {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 10.5px;
    line-height: 14px;
    color: var(--color-on-surface-variant, #888);
    margin-top: 1px;
    padding: 0 2px;
  }

  /* 轨道基础样式 */
  .effort-track {
    position: relative;
    height: 30px;
    margin-top: 2px;
    cursor: pointer;
    touch-action: none;
    outline: none;
  }
  .effort-track::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 24px;
    margin-top: -12px;
    border-radius: 8px;
    background: var(--paper-sunk, rgba(20, 20, 19, 0.07));
    transition: background 0.2s ease;
  }
  .effort-track:focus-visible::before {
    box-shadow: 0 0 0 2px var(--primary, #3b82f6);
  }

  /* 填充条（按档位渲染渐变光效） */
  .effort-fill {
    position: absolute;
    left: 0;
    top: 50%;
    height: 24px;
    margin-top: -12px;
    border-radius: 8px;
    overflow: hidden;
    pointer-events: none;
    transition:
      width 0.24s cubic-bezier(0.2, 0.7, 0.2, 1),
      background 0.24s ease,
      box-shadow 0.24s ease,
      opacity 0.2s ease;
  }

  .effort.level-0 .effort-fill {
    background: linear-gradient(90deg, rgba(16, 185, 129, 0.3), rgba(16, 185, 129, 0.55));
    box-shadow: 0 0 10px rgba(16, 185, 129, 0.2);
  }
  .effort.level-1 .effort-fill {
    background: linear-gradient(90deg, rgba(59, 130, 246, 0.32), rgba(37, 99, 235, 0.6));
    box-shadow: 0 0 12px rgba(37, 99, 235, 0.24);
  }
  .effort.level-2 .effort-fill {
    background: linear-gradient(90deg, rgba(245, 158, 11, 0.35), rgba(234, 88, 12, 0.65));
    box-shadow: 0 0 14px rgba(234, 88, 12, 0.3);
  }
  .effort.level-3 .effort-fill {
    background: linear-gradient(90deg, rgba(139, 122, 208, 0.35), rgba(124, 92, 230, 0.7));
  }

  /* 32 之前的动态光泽微流动 */
  .fill-shimmer {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(255, 255, 255, 0.22) 50%,
      transparent 100%
    );
    background-size: 200% 100%;
    animation: fillShimmer 3s infinite linear;
    pointer-events: none;
  }
  @keyframes fillShimmer {
    0% {
      background-position: -200% 0;
    }
    100% {
      background-position: 200% 0;
    }
  }

  /* 刻度点 */
  .effort-ticks {
    position: absolute;
    inset: 0;
    pointer-events: none;
    transition: opacity 0.2s;
  }
  .effort-tick {
    position: absolute;
    top: 50%;
    width: 4px;
    height: 4px;
    margin-top: -2px;
    transform: translateX(-50%);
    border-radius: 50%;
    background: var(--ink-faint, rgba(20, 20, 19, 0.22));
    transition:
      background 0.2s ease,
      transform 0.2s ease,
      box-shadow 0.2s ease;
  }
  .effort-tick.is-passed {
    background: rgba(255, 255, 255, 0.7);
    box-shadow: 0 0 4px rgba(255, 255, 255, 0.6);
  }
  .effort-tick.is-active {
    background: #ffffff;
    transform: translateX(-50%) scale(1.3);
    box-shadow: 0 0 6px rgba(255, 255, 255, 0.9);
  }

  /* 旋钮 (Knob) */
  .effort-knob {
    position: absolute;
    top: 50%;
    width: 18px;
    height: 28px;
    margin-top: -14px;
    border-radius: 6px;
    background: var(--paper-raised, #ffffff);
    box-shadow:
      0 1px 3px rgba(20, 20, 19, 0.25),
      0 0 0 1px rgba(20, 20, 19, 0.08);
    transition:
      left 0.24s cubic-bezier(0.2, 0.7, 0.2, 1),
      transform 0.15s ease,
      box-shadow 0.22s ease,
      background 0.22s ease;
    pointer-events: none;
    display: grid;
    place-items: center;
  }

  .knob-core {
    width: 4px;
    height: 10px;
    border-radius: 2px;
    background: var(--color-on-surface-variant, #ccc);
    transition: background 0.22s ease;
  }

  .effort.level-0 .effort-knob {
    box-shadow:
      0 1px 4px rgba(0, 0, 0, 0.22),
      0 0 8px rgba(16, 185, 129, 0.4);
  }
  .effort.level-0 .knob-core {
    background: #10b981;
  }

  .effort.level-1 .effort-knob {
    box-shadow:
      0 1px 5px rgba(0, 0, 0, 0.24),
      0 0 10px rgba(37, 99, 235, 0.45);
  }
  .effort.level-1 .knob-core {
    background: #2563eb;
  }

  .effort.level-2 .effort-knob {
    box-shadow:
      0 1px 5px rgba(0, 0, 0, 0.25),
      0 0 12px rgba(234, 88, 12, 0.5);
  }
  .effort.level-2 .knob-core {
    background: #ea580c;
  }

  .effort-track[data-dragging] .effort-knob,
  .effort-track[data-dragging] .effort-fill {
    transition: none;
  }
  .effort-track[data-dragging] .effort-knob {
    transform: scale(1.08, 1.04);
    box-shadow:
      0 3px 12px rgba(20, 20, 19, 0.35),
      0 0 0 1px rgba(20, 20, 19, 0.1);
  }

  /* 32 档 Apex 矩阵特效 */
  .effort-matrix {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 24px;
    margin-top: -12px;
    border-radius: 8px;
    overflow: hidden;
    display: none;
    padding: 1px;
    box-sizing: border-box;
    pointer-events: none;
  }
  .effort.is-apex .effort-matrix {
    display: grid;
  }
  .effort.is-apex .effort-fill,
  .effort.is-apex .effort-ticks {
    opacity: 0;
  }
  :global(.effort-cell) {
    background: #8b7ad0;
    border-radius: 1px;
    animation: effortFlash 2.6s infinite ease-in-out;
  }
  @keyframes effortFlash {
    0%, 14% {
      background: #8b7ad0;
    }
    20%, 34% {
      background: #d9d2f5;
    }
    100% {
      background: #8b7ad0;
    }
  }
  .effort.is-apex .effort-knob {
    background: color-mix(in srgb, #8b7ad0 22%, #ffffff);
    box-shadow:
      0 0 12px color-mix(in srgb, #8b7ad0 80%, transparent),
      0 0 0 1px color-mix(in srgb, #8b7ad0 40%, transparent);
  }
  .effort.is-apex .knob-core {
    background: #7c5ce6;
  }

  .effort-desc {
    margin: 4px 2px 0;
    font-size: 11px;
    line-height: 1.5;
    color: var(--color-on-surface-variant, #777);
    min-height: 1.5em;
  }
</style>
