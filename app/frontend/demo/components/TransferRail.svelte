<script lang="ts">
  import Icon from './Icon.svelte'
  import TaskCard from './TaskCard.svelte'
  import { app } from '../lib/store.svelte'
  import { t } from '../lib/i18n.svelte'
  import { formatBytes, formatSpeed } from '../lib/format'
</script>

<aside class="rail">
  <header class="rail-head">
    <div class="rail-title">
      <span class="eyebrow">{t('queue.rail')}</span>
      <span class="rail-count num">{app.activeTasks.length}</span>
    </div>
    <button class="icon-btn" title={t('queue.collapse')} aria-label={t('queue.collapse')} onclick={() => (app.railOpen = false)}>
      <Icon name="chevron_right" size={18} />
    </button>
  </header>

  <div class="rail-scroll scroll">
    {#each app.activeTasks as task (task.id)}
      <TaskCard {task} />
    {/each}

    {#if app.queuedTasks.length > 0}
      <div class="rail-label">
        <span>{t('queue.queued')}</span>
        <span class="num">{String(app.queuedTasks.length).padStart(2, '0')}</span>
      </div>
      {#each app.queuedTasks as task, index (task.id)}
        <div class="queued">
          <span class="queued-index num">{String(index + 1).padStart(2, '0')}</span>
          <div class="queued-body">
            <span class="queued-title">{task.title}</span>
            <span class="queued-meta num">{task.quality} · {formatBytes(task.totalBytes)}</span>
          </div>
          <button class="icon-btn queued-cancel" title={t('queue.cancel')} aria-label={t('queue.cancel')} onclick={() => app.cancelTask(task.id)}>
            <Icon name="close" size={15} />
          </button>
        </div>
      {/each}
    {/if}

    {#if app.finishedTasks.length > 0}
      <div class="rail-label">
        <span>{t('queue.done')}</span>
        <span class="num">{String(app.finishedTasks.length).padStart(2, '0')}</span>
      </div>
      {#each app.finishedTasks as task (task.id)}
        <div class="done-row" class:is-error={task.status === 'error'}>
          <span class="done-icon">
            <Icon name={task.status === 'completed' ? 'check' : 'error'} size={13} />
          </span>
          <span class="done-title">{task.title}</span>
          {#if task.status === 'completed'}
            <button class="icon-btn done-btn" title={t('queue.openFolder')} aria-label={t('queue.openFolder')} onclick={() => app.openTaskFolder()}>
              <Icon name="folder_open" size={15} />
            </button>
          {:else}
            <button class="icon-btn done-btn" title={t('queue.retry')} aria-label={t('queue.retry')} onclick={() => app.retryTask(task.id)}>
              <Icon name="refresh" size={15} />
            </button>
          {/if}
        </div>
      {/each}
    {/if}

    {#if app.tasks.length === 0}
      <div class="rail-empty">
        <Icon name="download_for_offline" size={26} />
        <span>{t('queue.empty')}</span>
      </div>
    {/if}
  </div>

  <footer class="rail-foot">
    <div class="foot-row">
      <span class="foot-label">{t('queue.totalSpeed')}</span>
      <span class="foot-value num" class:is-live={app.totalSpeed > 0}>{formatSpeed(app.totalSpeed)}</span>
    </div>
    <div class="foot-row">
      <span class="foot-label">{t('queue.storage')}</span>
      <span class="foot-value num">{t('queue.free', { size: app.freeStorageLabel })}</span>
    </div>
    <div class="storage-track">
      <div class="storage-fill" style="transform:scaleX({app.storageUsedPercent / 100})"></div>
    </div>
  </footer>
</aside>

<style>
  .rail {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-left: 1px solid var(--rule);
    background: color-mix(in oklab, var(--paper-deep) 55%, var(--paper));
  }

  .rail-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 48px;
    padding: 0 14px 0 16px;
    border-bottom: 1px solid var(--rule);
    flex: none;
  }
  .rail-title {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .rail-count {
    display: inline-grid;
    place-items: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--accent-wash);
    color: var(--accent-deep);
    font-size: 9.5px;
    font-weight: 700;
  }

  .rail-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .rail-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 2px 2px;
    font-family: var(--font-code);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-on-surface-variant);
  }

  .queued {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 9px;
    border: 1px dashed var(--rule);
    border-radius: 8px;
    background: color-mix(in oklab, var(--paper-raised) 55%, transparent);
  }
  .queued-index {
    font-size: 9px;
    color: var(--color-on-surface-variant);
    flex: none;
  }
  .queued-body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1;
  }
  .queued-title {
    font-size: 11px;
    font-weight: 500;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .queued-meta {
    font-size: 9px;
    color: var(--color-on-surface-variant);
  }
  .queued-cancel {
    width: 22px;
    height: 22px;
    flex: none;
  }
  .queued-cancel :global(.msi) {
    font-size: 14px !important;
  }

  .done-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 8px;
    border-radius: 7px;
    background: color-mix(in oklab, var(--paper-raised) 45%, transparent);
  }
  .done-icon {
    display: grid;
    place-items: center;
    width: 17px;
    height: 17px;
    border-radius: 50%;
    background: color-mix(in oklab, var(--success) 14%, transparent);
    color: var(--success);
    flex: none;
  }
  .done-row.is-error .done-icon {
    background: color-mix(in oklab, var(--danger) 12%, transparent);
    color: var(--danger);
  }
  .done-title {
    flex: 1;
    min-width: 0;
    font-size: 10px;
    color: var(--color-on-surface-variant);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .done-btn {
    width: 22px;
    height: 22px;
    flex: none;
  }
  .done-btn :global(.msi) {
    font-size: 15px !important;
  }

  .rail-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 40px 12px;
    color: var(--color-on-surface-variant);
    font-size: 11px;
  }
  .rail-empty :global(.msi) {
    opacity: 0.35;
  }

  .rail-foot {
    flex: none;
    padding: 12px 14px 14px;
    border-top: 1px solid var(--rule);
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .foot-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }
  .foot-label {
    font-size: 9.5px;
    color: var(--color-on-surface-variant);
  }
  .foot-value {
    font-size: 10px;
    color: var(--ink);
  }
  .foot-value.is-live {
    color: var(--accent-deep);
    font-weight: 600;
  }
  .storage-track {
    height: 2px;
    margin-top: 4px;
    border-radius: 999px;
    background: var(--rule);
    overflow: hidden;
  }
  .storage-fill {
    height: 100%;
    background: var(--rule-strong);
    transform-origin: left center;
  }
</style>
