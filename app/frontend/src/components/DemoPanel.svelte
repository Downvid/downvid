<script lang="ts">
  import Icon from './Icon.svelte'
  import { app, type Tab } from '../lib/store.svelte'
  import { t, getLocale } from '../lib/i18n.svelte'

  const pages: { id: Tab; key: string; icon: string }[] = [
    { id: 'download', key: 'nav.download', icon: 'download' },
    { id: 'history', key: 'nav.history', icon: 'history' },
    { id: 'settings', key: 'nav.settings', icon: 'settings' },
    { id: 'about', key: 'nav.about', icon: 'info' },
  ]

  type DemoState = 'idle' | 'parsing' | 'done' | 'error' | 'busy'
  const states: { id: DemoState; key: string }[] = [
    { id: 'idle', key: 'demo.idle' },
    { id: 'parsing', key: 'demo.parsing' },
    { id: 'done', key: 'demo.parsed' },
    { id: 'error', key: 'demo.error' },
    { id: 'busy', key: 'demo.busy' },
  ]

  function applyState(state: DemoState): void {
    if (state === 'idle') app.demoIdle()
    else if (state === 'parsing') app.demoParsing()
    else if (state === 'done') app.demoParsed()
    else if (state === 'error') app.demoError()
    else app.demoBusy()
  }

  const currentState = $derived(
    app.tasks.some((task) => task.status === 'downloading' || task.status === 'merging')
      ? 'busy'
      : app.parseState === 'done'
        ? 'done'
        : app.parseState,
  )
</script>

{#if app.demoOpen}
  <section class="panel" id="demo-panel" aria-label={t('demo.title')}>
      <header class="panel-head">
        <div class="panel-title">
          <span class="demo-dot"></span>
          <span>{t('demo.title')}</span>
          <span class="panel-sub">{t('demo.subtitle')}</span>
        </div>
        <button class="panel-close" title={t('demo.close')} aria-label={t('demo.close')} onclick={() => (app.demoOpen = false)}>
          <Icon name="close" size={15} />
        </button>
      </header>

      <div class="panel-scroll scroll">
        <section class="group">
          <span class="group-label">{t('demo.state')}</span>
          <div class="grid">
            {#each states as state (state.id)}
              <button
                class="demo-btn"
                class:is-active={currentState === state.id}
                onclick={() => applyState(state.id)}
              >{t(state.key)}</button>
            {/each}
          </div>
          <button class="demo-btn demo-btn--wide" onclick={() => app.demoAddTask()}>
            <Icon name="add" size={14} />
            <span>{t('demo.addTask')}</span>
          </button>
        </section>

        <section class="group">
          <span class="group-label">{t('demo.pages')}</span>
          <div class="grid">
            {#each pages as page (page.id)}
              <button
                class="demo-btn"
                class:is-active={app.tab === page.id}
                onclick={() => app.setTab(page.id)}
              >{t(page.key)}</button>
            {/each}
          </div>
        </section>

        <section class="group">
          <span class="group-label">{t('demo.dialogs')}</span>
          <div class="grid">
            <button class="demo-btn" onclick={() => app.demoUpdate()}>{t('demo.update')}</button>
            <button class="demo-btn" onclick={() => app.demoDeps()}>{t('demo.deps')}</button>
          </div>
        </section>

        <section class="group">
          <span class="group-label">{t('demo.lang')}</span>
          <div class="grid">
            <button
              class="demo-btn"
              class:is-active={getLocale() === 'zh-CN'}
              onclick={() => app.setLanguage('zh-CN')}
            >{t('demo.zh')}</button>
            <button
              class="demo-btn"
              class:is-active={getLocale() === 'en-US'}
              onclick={() => app.setLanguage('en-US')}
            >{t('demo.en')}</button>
          </div>
        </section>

        <div class="panel-actions">
          <button class="demo-link" onclick={() => app.copyStateLink()}>
            <Icon name="link" size={13} />
            <span>{t('demo.copyLink')}</span>
          </button>
          <button class="demo-link" onclick={() => app.resetDemo()}>
            <Icon name="restart_alt" size={13} />
            <span>{t('demo.reset')}</span>
          </button>
        </div>

        <p class="panel-note">{t('demo.urlHint')}</p>
        <p class="panel-note panel-note--dim">{t('demo.note')}</p>
      </div>
  </section>
{/if}

<style>
  .panel {
    position: fixed;
    right: 12px;
    bottom: 38px;
    z-index: 80;
    width: 312px;
    max-height: min(72vh, 560px);
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-panel);
    border: 1px solid color-mix(in oklab, var(--panel-dark-fg) 14%, transparent);
    background: var(--panel-dark);
    color: var(--panel-dark-fg);
    box-shadow: 0 24px 60px -24px color-mix(in oklab, var(--panel-dark) 90%, transparent);
    overflow: hidden;
    animation: rise-in var(--dur-base) var(--ease-out);
  }

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 11px 12px;
    border-bottom: 1px solid color-mix(in oklab, var(--panel-dark-fg) 12%, transparent);
    flex: none;
  }
  .panel-title {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.01em;
  }
  .demo-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
  }
  .panel-sub {
    font-family: var(--font-code);
    font-size: 8px;
    letter-spacing: 0.12em;
    color: color-mix(in oklab, var(--panel-dark-fg) 45%, transparent);
  }
  .panel-close {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: var(--radius-small);
    background: transparent;
    color: color-mix(in oklab, var(--panel-dark-fg) 60%, transparent);
    flex: none;
  }
  .panel-close:hover {
    background: color-mix(in oklab, var(--panel-dark-fg) 10%, transparent);
    color: var(--panel-dark-fg);
  }

  .panel-scroll {
    padding: 12px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .group-label {
    font-family: var(--font-code);
    font-size: 8px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: color-mix(in oklab, var(--panel-dark-fg) 42%, transparent);
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 5px;
  }
  .demo-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 28px;
    padding: 0 8px;
    border-radius: 5px;
    border: 1px solid color-mix(in oklab, var(--panel-dark-fg) 13%, transparent);
    background: color-mix(in oklab, var(--panel-dark-fg) 5%, transparent);
    color: color-mix(in oklab, var(--panel-dark-fg) 82%, transparent);
    font-family: var(--font-ui);
    font-size: 10.5px;
    font-weight: 500;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }
  .demo-btn:hover {
    border-color: color-mix(in oklab, var(--accent) 45%, transparent);
    color: var(--panel-dark-fg);
  }
  .demo-btn.is-active {
    background: color-mix(in oklab, var(--accent) 20%, transparent);
    border-color: color-mix(in oklab, var(--accent) 62%, transparent);
    color: #ffd9a3;
  }
  .demo-btn--wide {
    width: 100%;
  }

  .panel-actions {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding-top: 10px;
    border-top: 1px solid color-mix(in oklab, var(--panel-dark-fg) 10%, transparent);
  }
  .demo-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 0;
    border: 0;
    background: none;
    color: color-mix(in oklab, var(--panel-dark-fg) 62%, transparent);
    font-family: var(--font-ui);
    font-size: 10px;
    text-align: left;
    transition: color var(--dur-fast) var(--ease-out);
  }
  .demo-link:hover {
    color: var(--accent);
  }

  .panel-note {
    margin: 0;
    font-size: 9px;
    line-height: 1.6;
    color: color-mix(in oklab, var(--panel-dark-fg) 44%, transparent);
  }
  .panel-note--dim {
    color: color-mix(in oklab, var(--panel-dark-fg) 30%, transparent);
  }

  @media (max-width: 820px) {
    .panel {
      left: 10px;
      right: 10px;
      bottom: 64px;
      width: auto;
      max-height: 68vh;
    }
  }
</style>
