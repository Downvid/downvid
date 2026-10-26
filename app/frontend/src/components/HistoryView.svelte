<script lang="ts">
  import Icon from './Icon.svelte'
  import { app } from '../lib/store.svelte'
  import { t } from '../lib/i18n.svelte'
  import { formatClock } from '../lib/format'

  type FilterId = 'all' | 'done' | 'missing'

  /**
   * 危险操作一律两段式：第一下只亮出「确认」，第二下才真的动手。
   *
   * 两段确认还必须**会自动收回**：亮着不放的红色确认按钮，下一次误点就直接
   * 生效了，等于回到一段确认。
   */
  let confirmingClear = $state(false)
  let deletingId = $state('')
  let confirmTimer: ReturnType<typeof setTimeout> | undefined

  const CONFIRM_TTL = 6000

  function armConfirm(arm: () => void): void {
    clearTimeout(confirmTimer)
    arm()
    confirmTimer = setTimeout(() => {
      confirmingClear = false
      deletingId = ''
    }, CONFIRM_TTL)
  }

  function disarmConfirm(): void {
    clearTimeout(confirmTimer)
    confirmingClear = false
    deletingId = ''
  }

  const filters = $derived([
    { id: 'all', label: t('history.filterAll'), icon: 'history' },
    { id: 'done', label: t('history.filterDone'), icon: 'check_circle' },
    { id: 'missing', label: t('history.filterMissing'), icon: 'error' },
  ] as { id: FilterId; label: string; icon: string }[])

  const groupLabels = $derived({
    today: t('history.today'),
    yesterday: t('history.yesterday'),
    earlier: t('history.earlier'),
  })

  function pickFilter(id: FilterId): void {
    app.historyFilter = id
    disarmConfirm()
  }

  function confirmClear(): void {
    app.clearHistory()
    disarmConfirm()
  }

  function requestDelete(id: string): void {
    if (deletingId === id) {
      app.removeHistory(id)
      disarmConfirm()
      return
    }
    armConfirm(() => (deletingId = id))
  }
</script>

<div class="history-view">
  <header class="head">
    <div class="head-copy">
      <span class="eyebrow">{t('history.eyebrow')}</span>
      <h1 class="display head-title">{t('history.title')}</h1>
      <p class="head-sub">{t('history.subtitle')}</p>
    </div>

    <div class="head-tools">
      <div class="search">
        <Icon name="search" size={16} />
        <input
          class="field search-input"
          type="search"
          bind:value={app.historySearch}
          placeholder={t('history.search')}
          aria-label={t('history.search')}
          spellcheck="false"
          autocomplete="off"
        />
      </div>

      <div class="clear-group">
        {#if confirmingClear}
          <button type="button" class="btn btn-sm btn-danger" onclick={confirmClear}>
            <Icon name="delete_sweep" size={15} />
            <span>{t('history.confirmClear')}</span>
          </button>
          <button
            type="button"
            class="btn btn-quiet btn-sm"
            onclick={disarmConfirm}
          >
            {t('history.cancelClear')}
          </button>
        {:else}
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            disabled={app.history.length === 0}
            onclick={() => armConfirm(() => (confirmingClear = true))}
          >
            <Icon name="delete_sweep" size={15} />
            <span>{t('history.clear')}</span>
          </button>
        {/if}
      </div>
    </div>
  </header>

  <div class="toolbar">
    <div class="filter-chips">
      {#each filters as filter (filter.id)}
        <button
          type="button"
          class="chip"
          class:chip--active={app.historyFilter === filter.id}
          aria-pressed={app.historyFilter === filter.id}
          onclick={() => pickFilter(filter.id)}
        >
          <Icon name={filter.icon} size={13} />
          <span>{filter.label}</span>
        </button>
      {/each}
    </div>
    <span class="filter-count num">
      {t('history.count', { count: app.filteredHistory.length })}
    </span>
  </div>

  {#if app.history.length === 0}
    <div class="empty">
      <span class="empty-icon"><Icon name="history" size={38} /></span>
      <p class="empty-title">{t('history.empty')}</p>
      <p class="empty-hint">{t('history.emptyHint')}</p>
      <button type="button" class="btn btn-primary empty-cta" onclick={() => app.setTab('download')}>
        <Icon name="arrow_forward" size={16} />
        <span>{t('nav.download')}</span>
      </button>
    </div>
  {:else if app.filteredHistory.length === 0}
    <div class="empty">
      <span class="empty-icon"><Icon name="filter_list" size={34} /></span>
      <p class="empty-title">{t('history.emptyFilter')}</p>
      <p class="empty-hint">{t('history.emptyFilterHint')}</p>
    </div>
  {:else}
    <div class="groups">
      {#each app.groupedHistory as group (group.key)}
        <section class="group" aria-labelledby={'group-' + group.key}>
          <div class="group-head">
            <span class="group-label" id={'group-' + group.key}>{groupLabels[group.key]}</span>
            <span class="group-rule"></span>
            <span class="group-count num">{String(group.items.length).padStart(2, '0')}</span>
          </div>

          <ul class="rows sheet">
            {#each group.items as item (item.id)}
              <li class="row" class:is-missing={!item.fileExists}>
                <span
                  class="thumb"
                  style="background-image:url({item.thumbnail})"
                  aria-hidden="true"
                ></span>

                <div class="row-main">
                  <span class="row-title" title={item.title}>{item.title}</span>
                  <span class="row-path num" title={item.filePath}>{item.filePath}</span>
                  {#if !item.fileExists}
                    <span class="row-missing">
                      <Icon name="error" size={12} />
                      <span>{t('history.missing')}</span>
                    </span>
                  {/if}
                </div>

                <div class="row-meta">
                  <span class="chip quality num">{item.quality}</span>
                  <span class="row-size num col-size">{app.formatBytes(item.sizeBytes)}</span>
                  <span class="row-time num col-time">{formatClock(item.createdAt)}</span>
                </div>

                <div class="row-actions">
                  <button
                    type="button"
                    class="icon-btn act"
                    title={t('history.openFolder')}
                    aria-label={t('history.openFolder')}
                    onclick={() => app.openHistoryFolder(item)}
                  >
                    <Icon name="folder_open" size={17} />
                  </button>
                  <button
                    type="button"
                    class="icon-btn act"
                    title={t('history.redownload')}
                    aria-label={t('history.redownload')}
                    onclick={() => app.reparse(item)}
                  >
                    <Icon name="replay" size={17} />
                  </button>
                  {#if deletingId === item.id}
                    <button
                      type="button"
                      class="btn btn-sm btn-danger act-confirm"
                      title={t('history.confirmDelete')}
                      onclick={() => requestDelete(item.id)}
                    >
                      <Icon name="delete_forever" size={15} />
                      <span>{t('history.confirmDelete')}</span>
                    </button>
                  {:else}
                    <button
                      type="button"
                      class="icon-btn act act-delete"
                      title={t('history.delete')}
                      aria-label={t('history.delete')}
                      onclick={() => requestDelete(item.id)}
                    >
                      <Icon name="delete" size={17} />
                    </button>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  .history-view {
    max-width: 1040px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* ---------- 顶部 ---------- */
  .head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 24px;
  }
  .head-copy {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .head-title {
    margin: 0;
    font-size: clamp(28px, 3.4vw, 38px);
  }
  .head-sub {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.6;
    color: var(--color-on-surface-variant);
  }

  .head-tools {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }
  .search {
    position: relative;
    width: 250px;
  }
  .search :global(.msi) {
    position: absolute;
    left: 11px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--color-on-surface-variant);
    pointer-events: none;
  }
  .search .search-input {
    padding-left: 34px;
    height: 34px;
    font-size: 12px;
  }
  .search-input::-webkit-search-cancel-button {
    -webkit-appearance: none;
    appearance: none;
  }

  .clear-group {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .btn-danger {
    background: color-mix(in oklab, var(--danger) 8%, var(--paper-raised));
    border-color: color-mix(in oklab, var(--danger) 40%, transparent);
    color: var(--danger);
  }
  .btn-danger:hover:not(:disabled) {
    background: color-mix(in oklab, var(--danger) 14%, var(--paper-raised));
    border-color: color-mix(in oklab, var(--danger) 62%, transparent);
  }

  /* ---------- 筛选 ---------- */
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding-bottom: 13px;
    border-bottom: 1px solid var(--rule);
  }
  .filter-chips {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .filter-chips :global(.chip) {
    height: 27px;
  }
  .filter-count {
    font-size: 10px;
    color: var(--color-on-surface-variant);
    white-space: nowrap;
  }

  /* ---------- 分组 ---------- */
  .groups {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .group-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .group-label {
    font-family: var(--font-code);
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-on-surface-variant);
  }
  .group-rule {
    flex: 1;
    height: 1px;
    background: var(--rule-soft);
  }
  .group-count {
    font-size: 9.5px;
    color: color-mix(in oklab, var(--color-on-surface-variant) 76%, transparent);
  }

  /* ---------- 行 ---------- */
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow: hidden;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 14px;
    position: relative;
    transition: background-color var(--dur-base) var(--ease-out);
  }
  .row + .row {
    border-top: 1px solid var(--rule-soft);
  }
  .row:hover {
    background: color-mix(in oklab, var(--accent-wash) 55%, transparent);
  }

  .thumb {
    width: 96px;
    height: 54px;
    flex: none;
    border-radius: 4px;
    border: 1px solid var(--rule-soft);
    background-color: var(--paper-deep);
    background-size: cover;
    background-position: center;
  }
  .row.is-missing .thumb,
  .row.is-missing .row-main {
    opacity: 0.55;
  }

  .row-main {
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1;
    min-width: 0;
  }
  .row-title {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.4;
    color: var(--ink);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .row-path {
    font-size: 9.5px;
    color: var(--color-on-surface-variant);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row-missing {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 9.5px;
    color: var(--danger);
  }

  .row-meta {
    display: flex;
    align-items: center;
    gap: 14px;
    flex: none;
    padding-left: 6px;
  }
  .row-meta .chip.quality {
    height: 21px;
    padding: 0 7px;
    font-size: 9.5px;
    font-weight: 600;
    color: var(--color-on-surface-variant);
    border-color: var(--rule);
  }
  .row-size {
    min-width: 70px;
    text-align: right;
    font-size: 10px;
    color: var(--ink);
  }
  .row-time {
    min-width: 34px;
    text-align: right;
    font-size: 10px;
    color: var(--color-on-surface-variant);
  }

  .row-actions {
    display: flex;
    align-items: center;
    gap: 1px;
    flex: none;
    opacity: 0;
    transform: translateX(3px);
    transition:
      opacity var(--dur-base) var(--ease-out),
      transform var(--dur-base) var(--ease-out);
  }
  .row:hover .row-actions,
  .row:focus-within .row-actions,
  .row:has(.act-confirm) .row-actions {
    opacity: 1;
    transform: none;
  }
  .row-actions .act {
    width: 28px;
    height: 28px;
  }
  .row-actions .act-delete:hover {
    color: var(--danger);
    background: color-mix(in oklab, var(--danger) 9%, transparent);
  }
  /* 确认态在行内常显（不靠 hover），否则鼠标一移开就点不到 */
  .row-actions .act-confirm {
    white-space: nowrap;
    height: 26px;
    padding: 0 9px;
    /* 二次确认态用实心红：空心红在 hover 高亮里几乎看不出来 */
    background: var(--danger);
    border-color: var(--danger);
    color: #fff;
    animation: confirm-in 140ms var(--ease-out);
  }
  @keyframes confirm-in {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
  }

  /* ---------- 空态 ---------- */
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 9px;
    padding: 72px 20px 64px;
    text-align: center;
  }
  .empty-icon {
    display: grid;
    place-items: center;
    color: var(--color-on-surface-variant);
    opacity: 0.4;
    margin-bottom: 2px;
  }
  .empty-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 16px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--ink-strong);
  }
  .empty-hint {
    margin: 0;
    max-width: 42ch;
    font-size: 11.5px;
    line-height: 1.65;
    color: var(--color-on-surface-variant);
  }
  .empty-cta {
    margin-top: 10px;
  }

  /* ---------- 窄屏 ---------- */
  @media (max-width: 860px) {
    .col-size,
    .col-time {
      display: none;
    }
    .head {
      flex-direction: column;
      align-items: stretch;
      gap: 16px;
    }
    .head-tools {
      justify-content: space-between;
    }
    .search {
      width: auto;
      flex: 1;
      min-width: 0;
    }
    .clear-group {
      flex: none;
    }
  }
  @media (max-width: 620px) {
    .row-meta {
      display: none;
    }
    .row-actions {
      opacity: 1;
      transform: none;
    }
  }
</style>
