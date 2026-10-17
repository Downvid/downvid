<script lang="ts">
  import Icon from './Icon.svelte'
  import CaptureBar from './CaptureBar.svelte'
  import ParsePanel from './ParsePanel.svelte'
  import ParseResult from './ParseResult.svelte'
  import ActivityPanel from './ActivityPanel.svelte'
  import EffortSlider from './EffortSlider.svelte'
  import { app } from '../lib/store.svelte'
  import { t } from '../lib/i18n.svelte'
  import { SAMPLE_URL } from '../lib/mock'
  import { formatClock } from '../lib/format'

  const recent = $derived(app.history.slice(0, 4))

  let dragging = $state(false)
  let dragDepth = 0

  function isLinkDrag(event: DragEvent): boolean {
    const types = event.dataTransfer?.types
    if (!types) return false
    return Array.from(types).some((type) => type === 'text/uri-list' || type === 'text/plain')
  }

  function onDragEnter(event: DragEvent): void {
    if (!isLinkDrag(event)) return
    event.preventDefault()
    dragDepth += 1
    dragging = true
  }

  function onDragOver(event: DragEvent): void {
    if (!isLinkDrag(event)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  function onDragLeave(event: DragEvent): void {
    if (!isLinkDrag(event)) return
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) dragging = false
  }

  function onDrop(event: DragEvent): void {
    event.preventDefault()
    dragDepth = 0
    dragging = false
    const text =
      event.dataTransfer?.getData('text/uri-list') || event.dataTransfer?.getData('text/plain') || ''
    if (!text.trim()) return
    app.url = text.trim()
    app.parse()
  }

  function onWindowDragOver(event: DragEvent): void {
    if (isLinkDrag(event)) event.preventDefault()
  }

  function onWindowDrop(event: DragEvent): void {
    if (isLinkDrag(event)) event.preventDefault()
  }

  function endDrag(): void {
    dragging = false
    dragDepth = 0
  }

  function useSample(): void {
    app.url = SAMPLE_URL
    app.parse()
  }

  function openRecent(): void {
    app.setTab('history')
  }

  function openCookieSettings(): void {
    app.setTab('settings')
    app.settingsSection = 'network'
  }

</script>

<svelte:window
  ondragover={onWindowDragOver}
  ondrop={onWindowDrop}
  ondragend={endDrag}
/>

<div
  class="download-view"
  ondragenter={onDragEnter}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
>
  {#if dragging}
    <div class="drop-overlay" aria-hidden="true">
      <div class="drop-frame">
        <Icon name="move_to_inbox" size={26} />
        <strong>{t('drop.title')}</strong>
        <span>{t('drop.hint')}</span>
      </div>
    </div>
  {/if}

  {#if app.parseState === 'idle'}
    <section class="home">
      <h1 class="sr-only">{t('hero.eyebrow')}</h1>

      <header class="home-head">
        <span class="eyebrow">{t('hero.eyebrow')}</span>
        <button class="link-btn" onclick={useSample}>
          {t('hero.sample')}
          <Icon name="arrow_forward" size={13} />
        </button>
      </header>

      <div class="capture-block">
        <CaptureBar />
        <EffortSlider
          compact
          label={t('settings.accel')}
          value={app.settings.maxConnections}
          onchange={(value) => app.updateSetting('maxConnections', value)}
        />
      </div>

      <ActivityPanel />

      <section class="recent">
        <div class="section-head">
          <div class="section-title">
            <span class="section-label">{t('hero.recent')}</span>
            <span class="section-count num">{String(recent.length).padStart(2, '0')}</span>
          </div>
          <button class="link-btn" onclick={() => app.setTab('history')}>
            {t('hero.recentAll')}
            <Icon name="arrow_forward" size={13} />
          </button>
        </div>

        <div class="recent-bento">
          {#if recent[0]}
            <button
              class="feature"
              title={t('history.view')}
              onclick={openRecent}
            >
              <span class="feature-frame">
                <span
                  class="feature-thumb"
                  style="background-image:url({recent[0].thumbnail})"
                ></span>
                <span class="feature-shade"></span>
                <span class="feature-index num">01</span>
                <span class="feature-quality num">{recent[0].quality}</span>
                <span class="feature-copy">
                  <span class="feature-title">{recent[0].title}</span>
                  <span class="feature-meta num">
                    {recent[0].ext} · {app.formatBytes(recent[0].sizeBytes)} · {formatClock(recent[0].createdAt)}
                  </span>
                </span>
                <span class="feature-action"><Icon name="history" size={16} /></span>
              </span>
            </button>
          {/if}

          <div class="recent-list">
            {#each recent.slice(1) as item, index (item.id)}
              <button class="recent-row" onclick={openRecent}>
                <span class="row-index num">{String(index + 2).padStart(2, '0')}</span>
                <span class="row-thumb" style="background-image:url({item.thumbnail})"></span>
                <span class="row-main">
                  <span class="row-title">{item.title}</span>
                  <span class="row-meta num">
                    {item.quality} · {item.ext} · {app.formatBytes(item.sizeBytes)}
                  </span>
                </span>
                <span class="row-time num">{formatClock(item.createdAt)}</span>
                <span class="row-arrow"><Icon name="north_east" size={13} /></span>
              </button>
            {/each}
          </div>
        </div>
      </section>
    </section>
  {:else if app.parseState === 'parsing'}
    <section class="working">
      <div class="working-head">
        <span class="eyebrow">{t('parsing.eyebrow')}</span>
      </div>
      <CaptureBar compact />
      <ParsePanel />
    </section>
  {:else if app.parseState === 'error'}
    <section class="working">
      <div class="working-head">
        <span class="eyebrow">{t('error.eyebrow')}</span>
      </div>
      <CaptureBar compact />

      <div class="parse-error view-enter">
        <div class="error-icon">
          <Icon name="error" size={22} />
        </div>
        <div class="error-body">
          <h2>{t('error.title')}</h2>
          <p class="error-message">{app.parseError}</p>
          <p class="error-hint">{t('error.hint')}</p>

          {#if app.parseErrorDetail}
            <details class="error-details">
              <summary>
                <Icon name="code" size={13} />
                <span>Extractor output</span>
              </summary>
              <pre class="scroll">{app.parseErrorDetail}</pre>
            </details>
          {/if}

          <div class="error-actions">
            <button class="btn btn-primary" onclick={() => app.parse()}>
              <Icon name="refresh" size={16} />
              <span>{t('error.retry')}</span>
            </button>
            <button class="btn btn-ghost" onclick={openCookieSettings}>
              <Icon name="cookie" size={16} />
              <span>{t('error.settings')}</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  {:else if app.parseState === 'done' && app.video}
    <section class="working working--result">
      <div class="working-head">
        <div class="result-nav">
          <button class="btn btn-ghost btn-sm back-btn" onclick={() => app.clearResult()}>
            <Icon name="arrow_back" size={15} />
            <span>{t('result.back')}</span>
          </button>
          <span class="eyebrow">{t('result.eyebrow')}</span>
        </div>
      </div>
      <CaptureBar compact />
      <ParseResult />
    </section>
  {/if}
</div>

<style>
  .download-view {
    position: relative;
    min-height: 100%;
    max-width: 900px;
    margin: 0 auto;
  }
  .working {
    max-width: 760px;
    margin: 0 auto;
    padding-top: 14px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .working--result {
    max-width: 900px;
  }
  .working-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 22px;
  }
  .result-nav {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .back-btn {
    padding: 0 9px;
  }

  /* ---------- 首屏 ---------- */
  .home {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding-top: 0;
  }
  .home-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    min-height: 18px;
  }

  .capture-block {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .link-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-deep);
    font-family: var(--font-ui);
    font-size: 11px;
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 2px;
    text-decoration-color: color-mix(in oklab, var(--accent-deep) 30%, transparent);
  }
  .link-btn:hover {
    text-decoration-color: currentColor;
  }

  /* ---------- 区块标题 ---------- */
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 9px;
    border-bottom: 1px solid var(--rule);
    margin-bottom: 10px;
  }
  .section-title {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .section-label {
    font-family: var(--font-code);
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-on-surface-variant);
  }
  .section-count {
    font-size: 9.5px;
    color: var(--color-on-surface-variant);
    opacity: 0.65;
  }

  /* ---------- 最近下载：主卡 + 列表 ---------- */
  .recent-bento {
    display: grid;
    grid-template-columns: minmax(0, 1.22fr) minmax(0, 1fr);
    gap: 14px;
    align-items: stretch;
  }

  .feature {
    display: block;
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
  }
  .feature-frame {
    position: relative;
    display: block;
    aspect-ratio: 21 / 9;
    border-radius: var(--radius-card);
    border: 1px solid var(--rule);
    background: var(--paper-sunk);
    overflow: hidden;
  }
  .feature-shade {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(
      to top,
      color-mix(in oklab, var(--panel-dark) 88%, transparent) 0%,
      color-mix(in oklab, var(--panel-dark) 34%, transparent) 46%,
      transparent 72%
    );
  }
  .feature-thumb {
    position: absolute;
    inset: 0;
    background-size: cover;
    background-position: center;
    transition: transform 420ms var(--ease-out);
  }
  .feature:hover .feature-thumb {
    transform: scale(1.035);
  }
  .feature-index {
    position: absolute;
    top: 8px;
    left: 9px;
    padding: 2px 6px;
    border-radius: 4px;
    background: color-mix(in oklab, var(--panel-dark) 70%, transparent);
    color: var(--panel-dark-fg);
    font-size: 10px;
    font-weight: 600;
  }
  .feature-quality {
    position: absolute;
    top: 8px;
    right: 9px;
    padding: 1px 5px;
    border-radius: 3px;
    background: color-mix(in oklab, var(--panel-dark) 62%, transparent);
    color: var(--panel-dark-fg);
    font-size: 9px;
  }
  .feature-action {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    opacity: 0;
    transition: opacity var(--dur-base) var(--ease-out);
  }
  .feature-action :global(.msi) {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: color-mix(in oklab, var(--panel-dark) 74%, transparent);
    color: var(--panel-dark-fg);
    font-size: 16px !important;
  }
  .feature:hover .feature-action {
    opacity: 1;
  }
  .feature-copy {
    position: absolute;
    left: 12px;
    right: 44px;
    bottom: 10px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    color: var(--panel-dark-fg);
  }
  .feature-title {
    font-family: var(--font-display);
    font-size: 17px;
    font-weight: 600;
    line-height: 1.3;
    letter-spacing: -0.02em;
    color: var(--panel-dark-fg);
    text-shadow: 0 1px 8px rgba(0, 0, 0, 0.25);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .feature-meta {
    font-size: 9.5px;
    color: color-mix(in oklab, var(--panel-dark-fg) 72%, transparent);
  }

  .recent-list {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--rule);
  }
  .recent-row {
    flex: 1;
    display: grid;
    grid-template-columns: 22px 58px minmax(0, 1fr) auto 16px;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 8px 6px;
    border: 0;
    border-bottom: 1px solid var(--rule);
    background: none;
    text-align: left;
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .recent-row:last-child {
    border-bottom: 0;
  }
  .recent-row:hover {
    background: color-mix(in oklab, var(--accent-wash) 40%, transparent);
  }
  .row-index {
    font-size: 10px;
    color: var(--accent-deep);
  }
  .row-thumb {
    display: block;
    width: 58px;
    height: 33px;
    border-radius: var(--radius-small);
    border: 1px solid var(--rule);
    background-color: var(--paper-sunk);
    background-size: cover;
    background-position: center;
  }
  .row-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .row-title {
    font-size: 11.5px;
    font-weight: 600;
    line-height: 1.35;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row-meta {
    font-size: 9px;
    color: var(--color-on-surface-variant);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row-time {
    font-size: 9px;
    color: var(--color-on-surface-variant);
  }
  .row-arrow {
    display: grid;
    place-items: center;
    color: var(--color-on-surface-variant);
    opacity: 0;
    transition: opacity var(--dur-base) var(--ease-out);
  }
  .recent-row:hover .row-arrow {
    opacity: 1;
    color: var(--accent-deep);
  }

  /* ---------- 拖放区 ---------- */
  .drop-overlay {
    position: absolute;
    inset: 0;
    z-index: 20;
    display: grid;
    place-items: center;
    border: 1px dashed color-mix(in oklab, var(--accent-deep) 48%, transparent);
    border-radius: 12px;
    background: color-mix(in oklab, var(--paper) 88%, transparent);
  }
  .drop-frame {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 7px;
    padding: 26px 42px;
    border: 1px dashed color-mix(in oklab, var(--accent-deep) 35%, transparent);
    border-radius: 10px;
    background: var(--paper-raised);
    box-shadow: var(--shadow-sheet);
  }
  .drop-frame :global(.msi) {
    color: var(--accent-deep);
  }
  .drop-frame strong {
    font-family: var(--font-display);
    font-size: 15px;
    letter-spacing: -0.02em;
    color: var(--ink-strong);
  }
  .drop-frame span {
    font-size: 11.5px;
    color: var(--color-on-surface-variant);
  }

  /* ---------- 解析失败 ---------- */
  .parse-error {
    display: flex;
    gap: 14px;
    padding: 20px;
    border: 1px solid color-mix(in oklab, var(--danger) 26%, transparent);
    border-radius: 10px;
    background: color-mix(in oklab, var(--danger) 4%, var(--paper-raised));
  }
  .error-icon {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    flex: none;
    border-radius: 8px;
    background: color-mix(in oklab, var(--danger) 10%, transparent);
    color: var(--danger);
  }
  .error-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .error-body h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 17px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--ink-strong);
  }
  .error-message {
    margin: 0;
    font-size: 12px;
    color: var(--danger);
  }
  .error-hint {
    margin: 0;
    font-size: 11.5px;
    line-height: 1.65;
    color: var(--color-on-surface-variant);
  }
  .error-details {
    font-size: 11px;
    color: var(--color-on-surface-variant);
  }
  .error-details summary {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
    color: var(--color-on-surface-variant);
  }
  .error-details pre {
    margin: 8px 0 0;
    padding: 10px 12px;
    max-height: 120px;
    overflow: auto;
    border-radius: 6px;
    border: 1px solid var(--rule);
    background: var(--paper-deep);
    font-family: var(--font-code);
    font-size: 10px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .error-actions {
    display: flex;
    gap: 8px;
    margin-top: 4px;
  }

  /* 桌面最小窗口 1000×700：首页必须一屏看完 */
  @media (max-height: 820px) and (min-width: 821px) {
    .home {
      gap: 7px;
    }
    .capture-block {
      gap: 6px;
    }
    .section-head {
      padding-bottom: 6px;
      margin-bottom: 8px;
    }
    .feature-frame {
      aspect-ratio: 3.15 / 1;
    }
    .feature-title {
      font-size: 14px;
    }
    .feature-meta {
      font-size: 9px;
    }
    .recent-row {
      padding: 4px 6px;
    }
    .recent-row .row-thumb {
      width: 48px;
      height: 27px;
    }
    .row-title {
      font-size: 11px;
    }
  }

  @media (max-width: 760px) {
    .recent-bento {
      grid-template-columns: minmax(0, 1fr);
    }
    .recent-list {
      border-top: 0;
    }
    .recent-row {
      min-height: 62px;
      border-top: 1px solid var(--rule);
    }
  }
</style>
