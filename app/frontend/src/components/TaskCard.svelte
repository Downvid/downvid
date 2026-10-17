<script lang="ts">
  import Icon from './Icon.svelte'
  import { app } from '../lib/store.svelte'
  import { t } from '../lib/i18n.svelte'
  import { formatEta, formatSpeed } from '../lib/format'
  import type { TaskItem } from '../lib/types'

  let { task }: { task: TaskItem } = $props()

  const percent = $derived(Math.round(task.progress * 100))
  const sparkPoints = $derived(buildSparkline(task.speedHistory))

  function buildSparkline(values: number[]): string {
    if (values.length < 2) return ''
    const max = Math.max(...values, 1)
    const width = 56
    const height = 16
    return values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * width
        const y = height - (value / max) * (height - 2) - 1
        return x.toFixed(1) + ',' + y.toFixed(1)
      })
      .join(' ')
  }
</script>

<article
  class="task"
  class:is-paused={task.status === 'paused'}
  class:is-merging={task.status === 'merging'}
>
  <div class="task-top">
    <div class="task-thumb" style="background-image:url({task.thumbnail})">
      <span class="task-mode">
        <Icon
          name={task.mode === 'audio' ? 'music_note' : task.mode === 'subtitle' ? 'subtitles' : 'movie'}
          size={11}
        />
      </span>
    </div>

    <div class="task-info">
      <div class="task-title-row">
        <span class="task-title">{task.title}</span>
        <span class="task-pct num">{percent}<small>%</small></span>
      </div>
      <div class="task-track">
        <div class="task-fill" style="transform:scaleX({task.progress})"></div>
      </div>
      <div class="task-stats">
        <span class="task-stat-text num">
          {#if task.status === 'paused'}
            {t('queue.paused')}
          {:else if task.status === 'merging'}
            <span class="merging-text pulse-soft">{t('queue.merging')}</span>
          {:else}
            {formatSpeed(task.speedBps)}
            <span class="stat-sep">·</span>
            {t('queue.eta')} {formatEta(task.etaSec)}
          {/if}
        </span>
        {#if task.status === 'downloading' && task.speedHistory.length > 2}
          <svg class="spark" viewBox="0 0 56 16" preserveAspectRatio="none" aria-hidden="true">
            <polyline points={sparkPoints} fill="none" stroke="currentColor" stroke-width="1.2" />
          </svg>
        {/if}
      </div>
    </div>
  </div>

  <div class="task-actions">
    {#if task.status === 'downloading' || task.status === 'merging'}
      <button class="icon-btn task-btn" title={t('queue.pause')} aria-label={t('queue.pause')} onclick={() => app.togglePause(task.id)}>
        <Icon name="pause" size={16} />
      </button>
    {:else if task.status === 'paused'}
      <button class="icon-btn task-btn" title={t('queue.resume')} aria-label={t('queue.resume')} onclick={() => app.togglePause(task.id)}>
        <Icon name="play_arrow" size={16} />
      </button>
    {/if}
    <button class="icon-btn task-btn" title={t('queue.cancel')} aria-label={t('queue.cancel')} onclick={() => app.cancelTask(task.id)}>
      <Icon name="close" size={16} />
    </button>
  </div>
</article>

<style>
  .task {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 11px 10px 11px 11px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-panel);
    background: var(--paper-raised);
  }
  .task.is-paused {
    border-color: color-mix(in oklab, var(--accent-deep) 26%, transparent);
    background: color-mix(in oklab, var(--accent-wash) 55%, var(--paper-raised));
  }

  .task-top {
    display: flex;
    gap: 10px;
    min-width: 0;
    flex: 1;
  }

  .task-thumb {
    width: 40px;
    height: 40px;
    flex: none;
    border-radius: var(--radius-control);
    border: 1px solid var(--rule);
    background-color: var(--paper-sunk);
    background-size: cover;
    background-position: center;
    position: relative;
    overflow: hidden;
  }
  .task-mode {
    position: absolute;
    right: 2px;
    bottom: 2px;
    display: grid;
    place-items: center;
    width: 15px;
    height: 15px;
    border-radius: 3px;
    background: color-mix(in oklab, var(--panel-dark) 78%, transparent);
    color: var(--panel-dark-fg);
  }

  .task-info {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    flex: 1;
  }
  .task-title-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .task-title {
    flex: 1;
    min-width: 0;
    font-size: 11.5px;
    font-weight: 600;
    line-height: 1.4;
    color: var(--ink-strong);
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .task-pct {
    flex: none;
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-strong);
  }
  .task-pct small {
    font-size: 8.5px;
    opacity: 0.6;
    margin-left: 1px;
  }

  .task-track {
    height: 3px;
    border-radius: 999px;
    background: color-mix(in oklab, var(--color-outline-variant) 34%, transparent);
    overflow: hidden;
  }
  .task-fill {
    height: 100%;
    border-radius: 999px;
    background: var(--accent);
    transform-origin: left center;
    transition: transform 320ms linear;
  }
  .task.is-merging .task-fill {
    background: var(--accent-deep);
    animation: pulse-soft 1.4s var(--ease-in-out) infinite;
  }
  .task.is-paused .task-fill {
    background: var(--rule-strong);
  }

  .task-stats {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .task-stat-text {
    flex: 1;
    min-width: 0;
    font-size: 9px;
    color: var(--color-on-surface-variant);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .stat-sep {
    opacity: 0.5;
    margin: 0 1px;
  }
  .merging-text {
    color: var(--accent-deep);
    font-weight: 600;
  }
  .spark {
    width: 56px;
    height: 16px;
    flex: none;
    color: color-mix(in oklab, var(--accent-deep) 62%, transparent);
    opacity: 0.85;
  }

  .task-actions {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: none;
    margin-top: -2px;
  }
  .task-btn {
    width: 24px;
    height: 24px;
    border-radius: 5px;
  }
  .task-btn :global(.msi) {
    font-size: 16px !important;
  }
</style>
