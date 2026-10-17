<script lang="ts">
  import { buildActivity, type ActivityDay } from '../lib/activity'
  import { app } from '../lib/store.svelte'
  import { formatDate } from '../lib/format'
  import { getLocale, t } from '../lib/i18n.svelte'

  // 从真实历史聚合；没有历史时整张图是空的，不显示假数据
  const activity = $derived(buildActivity(app.history))
  let active = $state<ActivityDay>(activity.today)
  let panelEl = $state<HTMLElement | null>(null)
  let tip = $state<{ text: string; x: number; y: number } | null>(null)

  const countLabel = $derived(
    active.count === 0 ? t('activity.none') : t('activity.count', { count: active.count }),
  )

  const monthFormat = $derived(new Intl.DateTimeFormat(getLocale(), { month: 'short' }))
  // 展示最近 44 周（约 10 个月）：格子可以从 9px 放大到 12px，热力图成为页面主体。
  const visibleWeeks = $derived(activity.weeks.slice(-44))
  const monthLabels = $derived.by(() => {
    const map: Record<number, string> = {}
    let lastMonth = -1
    visibleWeeks.forEach((week, index) => {
      const first = week.find((day): day is ActivityDay => day !== null)
      if (!first) return
      const month = first.date.getMonth()
      if (month !== lastMonth) {
        map[index] = monthFormat.format(first.date)
        lastMonth = month
      }
    })
    return map
  })

  function levelOf(count: number): number {
    if (count <= 0) return 0
    if (count <= 2) return 1
    if (count <= 4) return 2
    if (count <= 6) return 3
    return 4
  }

  function dayLabel(day: ActivityDay): string {
    return formatDate(day.date.getTime()) + ' · ' + t('activity.count', { count: day.count })
  }

  function enterCell(day: ActivityDay, event: MouseEvent): void {
    active = day
    const panel = panelEl?.getBoundingClientRect()
    if (!panel) return
    tip = {
      text: dayLabel(day),
      x: Math.max(38, Math.min(panel.width - 38, event.clientX - panel.left)),
      y: event.clientY - panel.top,
    }
  }

  function leaveCell(): void {
    tip = null
  }
</script>

<section class="activity-panel sheet" bind:this={panelEl}>
  <div class="heatmap-block">
    <div class="activity-head">
      <span class="eyebrow">{t('activity.title')}</span>
      {#key active.date.getTime()}
        <span class="readout num">{formatDate(active.date.getTime())} · {countLabel}</span>
      {/key}
    </div>

    <div class="plot scroll">
      <div class="months" aria-hidden="true">
        {#each visibleWeeks as week, weekIndex (weekIndex)}
          <span class="month-slot">
            {#if monthLabels[weekIndex]}
              <span class="month">{monthLabels[weekIndex]}</span>
            {/if}
          </span>
        {/each}
      </div>

      <div
        class="heatmap"
        role="img"
        aria-label={t('activity.summary', {
          total: activity.total,
          streak: activity.streak,
        })}
      >
        {#each visibleWeeks as week, weekIndex (weekIndex)}
          <div class="week">
            {#each week as day, dayIndex (dayIndex)}
              {#if day}
                <span
                  class="cell level-{levelOf(day.count)}"
                  style="--i:{weekIndex * 7 + dayIndex}"
                  title={dayLabel(day)}
                  onmouseenter={(event) => enterCell(day, event)}
                  onmouseleave={leaveCell}
                  onclick={() => (active = day)}
                ></span>
              {:else}
                <span class="cell is-void"></span>
              {/if}
            {/each}
          </div>
        {/each}
      </div>
    </div>

    <div class="legend">
      <span>{t('activity.less')}</span>
      {#each [0, 1, 2, 3, 4] as level (level)}
        <span class="legend-cell level-{level}"></span>
      {/each}
      <span>{t('activity.more')}</span>
    </div>
  </div>

  {#if tip}
    <div class="tip" style="left:{tip.x}px; top:{tip.y}px" role="status">{tip.text}</div>
  {/if}

  <aside class="stats">
    <div class="stat">
      <span class="stat-value display num">{activity.total.toLocaleString('en-US')}</span>
      <span class="stat-label">{t('activity.total')}</span>
    </div>
    <div class="stat">
      <span class="stat-value display num">{activity.streak}</span>
      <span class="stat-label">{t('activity.streak')}</span>
    </div>
    <div class="stat">
      <span class="stat-value display num">{activity.last30}</span>
      <span class="stat-label">{t('activity.last30')}</span>
    </div>
  </aside>
</section>

<style>
  .activity-panel {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 184px;
    padding: 16px 18px;
    gap: 16px;
    overflow: visible;
  }
  .activity-panel::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: var(--radius-panel);
    pointer-events: none;
    box-shadow: inset 0 1px 0 color-mix(in oklab, white 35%, transparent);
  }

  .heatmap-block {
    display: flex;
    flex-direction: column;
    gap: 7px;
    min-width: 0;
  }
  .activity-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 16px;
  }
  .readout {
    font-size: 9.5px;
    color: var(--color-on-surface-variant);
    white-space: nowrap;
    animation: readout-in 160ms var(--ease-out);
  }
  @keyframes readout-in {
    from {
      opacity: 0;
      transform: translateY(2px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .tip {
    position: absolute;
    z-index: 6;
    transform: translate(-50%, 12px);
    padding: 4px 7px;
    border-radius: var(--radius-small);
    background: var(--panel-dark);
    color: var(--panel-dark-fg);
    font-family: var(--font-code);
    font-size: 9px;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 8px 18px -10px color-mix(in oklab, var(--panel-dark) 80%, transparent);
    animation: readout-in 120ms var(--ease-out);
  }

  .plot {
    overflow-x: auto;
    padding-bottom: 2px;
  }
  .months {
    display: flex;
    gap: 3px;
    width: max-content;
    height: 12px;
  }
  .month-slot {
    position: relative;
    width: 12px;
    flex: none;
  }
  .month {
    position: absolute;
    left: 0;
    top: 0;
    font-family: var(--font-code);
    font-size: 8px;
    line-height: 12px;
    color: var(--color-on-surface-variant);
    white-space: nowrap;
    letter-spacing: 0.02em;
  }

  .heatmap {
    display: flex;
    width: max-content;
    gap: 3px;
  }
  .week {
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: none;
  }
  .cell {
    display: block;
    width: 12px;
    height: 12px;
    border-radius: 2.5px;
    background-color: color-mix(in oklab, var(--color-on-surface) 7%, transparent);
    background-image: linear-gradient(
      145deg,
      color-mix(in oklab, white 16%, transparent),
      transparent 55%
    );
    box-shadow: inset 0 0 0 0.5px color-mix(in oklab, var(--ink) 5%, transparent);
    animation: cell-in 360ms var(--ease-out) both;
    animation-delay: calc(var(--i, 0) * 0.9ms);
    transition:
      transform 120ms var(--ease-out),
      outline-color 120ms var(--ease-out),
      box-shadow 120ms var(--ease-out);
    outline: 1.5px solid transparent;
  }
  .cell.level-1 {
    background-color: color-mix(in oklab, var(--accent) 24%, transparent);
  }
  .cell.level-2 {
    background-color: color-mix(in oklab, var(--accent) 42%, transparent);
  }
  .cell.level-3 {
    background-color: color-mix(in oklab, var(--accent) 64%, transparent);
  }
  .cell.level-4 {
    background-color: color-mix(in oklab, var(--accent) 88%, transparent);
  }
  .cell.is-void {
    background: transparent;
    animation: none;
  }
  .cell:not(.is-void):hover {
    outline-color: var(--accent-deep);
    transform: scale(1.3);
    position: relative;
    z-index: 1;
    box-shadow:
      inset 0 0 0 0.5px color-mix(in oklab, var(--ink) 8%, transparent),
      0 0 10px color-mix(in oklab, var(--accent) 45%, transparent);
  }

  .legend {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 1px;
    font-size: 8.5px;
    color: var(--color-on-surface-variant);
  }
  .legend-cell {
    display: block;
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: color-mix(in oklab, var(--color-on-surface) 7%, transparent);
  }
  .legend-cell.level-1 {
    background: color-mix(in oklab, var(--accent) 24%, transparent);
  }
  .legend-cell.level-2 {
    background: color-mix(in oklab, var(--accent) 42%, transparent);
  }
  .legend-cell.level-3 {
    background: color-mix(in oklab, var(--accent) 64%, transparent);
  }
  .legend-cell.level-4 {
    background: color-mix(in oklab, var(--accent) 88%, transparent);
  }
  .stats {
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--rule);
    padding-left: 18px;
  }
  .stat {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    padding: 7px 0;
  }
  .stat + .stat {
    border-top: 1px solid var(--rule-soft);
  }
  .stat-value {
    font-size: 28px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.035em;
    color: var(--ink-strong);
  }
  .stat-label {
    font-family: var(--font-code);
    font-size: 8.5px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-on-surface-variant);
  }

  @keyframes cell-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @media (max-width: 820px) {
    .activity-panel {
      grid-template-columns: minmax(0, 1fr);
    }
    .heatmap-block {
      overflow-x: auto;
      padding-bottom: 4px;
    }
    .activity-head {
      flex-wrap: wrap;
      gap: 4px 10px;
    }
    .stats {
      flex-direction: row;
      border-left: 0;
      border-top: 1px solid var(--rule);
      padding: 8px 0 0;
    }
    .stat {
      flex: 1;
      padding: 0 12px;
    }
    .stat:first-child {
      padding-left: 0;
    }
    .stat + .stat {
      border-top: 0;
      border-left: 1px solid var(--rule-soft);
    }
    .stat-value {
      font-size: 22px;
    }
  }

  @media (max-height: 820px) and (min-width: 821px) {
    .activity-panel {
      grid-template-columns: minmax(0, 1fr) 184px;
      padding: 12px 14px;
      gap: 14px;
    }
    .heatmap,
    .months,
    .week {
      gap: 3px;
    }
    .cell {
      width: 11px;
      height: 11px;
      border-radius: 2px;
    }
    .month-slot {
      width: 11px;
    }
    .months {
      height: 11px;
    }
    .month {
      font-size: 7.5px;
      line-height: 11px;
    }
    .stat-value {
      font-size: 22px;
    }
    .stat {
      padding: 4px 0;
    }
    .legend {
      font-size: 8px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .cell {
      animation: none;
    }
    .cell:not(.is-void):hover {
      transform: none;
    }
  }
</style>
