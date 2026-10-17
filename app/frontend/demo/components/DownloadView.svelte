<script lang="ts">
  import Icon from './Icon.svelte'
  import CaptureBar from './CaptureBar.svelte'
  import ParsePanel from './ParsePanel.svelte'
  import ParseResult from './ParseResult.svelte'
  import { app } from '../lib/store.svelte'
  import { t } from '../lib/i18n.svelte'
  import { SAMPLE_URL, type HistoryItem } from '../lib/mock'
  import { formatClock } from '../lib/format'

  const recent = $derived(app.history.slice(0, 3))

  function useSample(): void {
    app.url = SAMPLE_URL
    app.parse()
  }

  function openRecent(item: HistoryItem): void {
    app.reparse(item)
  }

  function openCookieSettings(): void {
    app.setTab('settings')
    app.settingsSection = 'network'
  }
</script>

<div class="download-view">
  {#if app.parseState === 'idle'}
    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow">{t('hero.eyebrow')}</span>
        <h1 class="display hero-title">
          {t('hero.title1')}<br />
          <span class="hero-accent">{t('hero.title2')}</span>
        </h1>
        <p class="hero-lede">{t('hero.lede')}</p>
      </div>

      <div class="capture-wrap">
        <CaptureBar />
      </div>

      <div class="hero-meta">
        <div class="keys">
          <span class="kbd">⌘V</span>
          <span class="key-hint">{t('capture.paste')}</span>
          <span class="kbd">↵</span>
          <span class="key-hint">{t('capture.parse')}</span>
        </div>
        <button class="link-btn" onclick={useSample}>
          {t('hero.sample')}
          <Icon name="arrow_forward" size={13} />
        </button>
      </div>

      {#if recent.length > 0}
        <section class="recent">
          <div class="section-head">
            <span class="section-label">{t('hero.recent')}</span>
            <button class="link-btn section-more" onclick={() => app.setTab('history')}>
              {t('hero.recentAll')}
              <Icon name="arrow_forward" size={13} />
            </button>
          </div>
          <div class="recent-grid">
            {#each recent as item (item.id)}
              <button class="recent-card" onclick={() => openRecent(item)}>
                <span class="recent-thumb" style="background-image:url({item.thumbnail})">
                  <span class="recent-quality num">{item.quality}</span>
                </span>
                <span class="recent-title">{item.title}</span>
                <span class="recent-meta num">
                  {item.ext} · {app.formatBytes(item.sizeBytes)}
                  <span class="recent-time">{formatClock(item.createdAt)}</span>
                </span>
              </button>
            {/each}
          </div>
        </section>
      {/if}

      <p class="trust">
        <Icon name="lock" size={13} />
        <span>{t('hero.trust')}</span>
      </p>
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
        <span class="eyebrow">{t('result.eyebrow')}</span>
        <button class="link-btn back-link" onclick={() => app.clearResult()}>
          {t('result.change')}
          <Icon name="close" size={13} />
        </button>
      </div>
      <CaptureBar compact />
      <ParseResult />
    </section>
  {/if}
</div>

<style>
  .download-view {
    max-width: 860px;
    margin: 0 auto;
  }
  .working--result {
    max-width: 900px;
  }

  /* ---------- 空态 ---------- */
  .hero {
    padding-top: 20px;
  }
  .hero-copy {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .hero-title {
    margin: 0;
    font-size: clamp(34px, 4.4vw, 46px);
  }
  .hero-accent {
    color: var(--accent-deep);
  }
  .hero-lede {
    margin: 0;
    max-width: 52ch;
    font-size: 13.5px;
    line-height: 1.7;
    color: var(--color-on-surface-variant);
  }

  .capture-wrap {
    margin: 30px 0 14px;
  }

  .hero-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    flex-wrap: wrap;
  }
  .keys {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10.5px;
    color: var(--color-on-surface-variant);
  }
  .key-hint {
    margin-right: 4px;
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

  .recent {
    margin-top: 40px;
  }
  .section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--rule);
    margin-bottom: 14px;
  }
  .section-label {
    font-family: var(--font-code);
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-on-surface-variant);
  }
  .section-more {
    font-size: 10.5px;
  }

  .recent-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }
  .recent-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
  }
  .recent-thumb {
    position: relative;
    aspect-ratio: 16 / 9;
    width: 100%;
    border-radius: 8px;
    border: 1px solid var(--rule);
    background-color: var(--paper-sunk);
    background-size: cover;
    background-position: center;
    overflow: hidden;
    transition:
      border-color var(--dur-base) var(--ease-out),
      transform var(--dur-base) var(--ease-out);
  }
  .recent-card:hover .recent-thumb {
    border-color: color-mix(in oklab, var(--accent-deep) 45%, transparent);
    transform: translateY(-1px);
  }
  .recent-quality {
    position: absolute;
    left: 6px;
    bottom: 6px;
    padding: 1px 5px;
    border-radius: 3px;
    background: color-mix(in oklab, var(--ink-strong) 80%, transparent);
    color: var(--paper);
    font-size: 9px;
  }
  .recent-title {
    font-size: 12px;
    font-weight: 600;
    line-height: 1.45;
    color: var(--ink);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .recent-meta {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 9.5px;
    color: var(--color-on-surface-variant);
  }
  .recent-time {
    margin-left: auto;
  }

  .trust {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 40px 0 0;
    padding-top: 14px;
    border-top: 1px solid var(--rule-soft);
    font-size: 10.5px;
    color: var(--color-on-surface-variant);
  }

  /* ---------- 解析中 / 结果 ---------- */
  .working {
    max-width: 760px;
    margin: 0 auto;
    padding-top: 14px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .working-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 22px;
  }
  .back-link {
    font-size: 10.5px;
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

  @media (max-width: 760px) {
    .recent-grid {
      grid-template-columns: 1fr;
    }
    .recent-card {
      flex-direction: row;
      align-items: center;
      gap: 12px;
    }
    .recent-thumb {
      width: 120px;
      flex: none;
    }
    .recent-title {
      flex: 1;
    }
    .recent-meta {
      flex-direction: column;
      align-items: flex-end;
    }
    .recent-time {
      margin: 0;
    }
    .hero-meta {
      align-items: flex-start;
      flex-direction: column;
      gap: 10px;
    }
  }
</style>
