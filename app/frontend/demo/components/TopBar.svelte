<script lang="ts">
  import Icon from './Icon.svelte'
  import GitHubIcon from './GitHubIcon.svelte'
  import logo from '../assets/logo.png'
  import { app, type Tab } from '../lib/store.svelte'
  import { t, getLocale } from '../lib/i18n.svelte'
  import { REPO_URL } from '../lib/mock'

  const tabs: { id: Tab; key: string; icon: string }[] = [
    { id: 'download', key: 'nav.download', icon: 'download' },
    { id: 'history', key: 'nav.history', icon: 'history' },
    { id: 'settings', key: 'nav.settings', icon: 'settings' },
    { id: 'about', key: 'nav.about', icon: 'info' },
  ]

  function openRepo(): void {
    window.open(REPO_URL, '_blank', 'noopener')
  }
</script>

<header class="topbar">
  <div class="brand">
    <img class="brand-logo" src={logo} alt="DownVid" />
    <span class="brand-name">DownVid</span>
    <span class="brand-tag">DESKTOP · UI DEMO</span>
  </div>

  <nav class="nav" aria-label="Main">
    {#each tabs as tab (tab.id)}
      <button
        class="nav-item"
        class:is-active={app.tab === tab.id}
        aria-current={app.tab === tab.id ? 'page' : undefined}
        onclick={() => app.setTab(tab.id)}
      >
        <Icon name={tab.icon} size={15} />
        <span class="nav-label">{t(tab.key)}</span>
      </button>
    {/each}
  </nav>

  <div class="topbar-right">
    {#if app.hasTasks && !app.railOpen && (app.tab === 'download' || app.tab === 'history')}
      <button
        class="btn btn-ghost btn-sm rail-reopen"
        onclick={() => (app.railOpen = true)}
        title={t('queue.expand')}
      >
        <Icon name="swap_vert" size={15} />
        <span>{t('status.tasks', { count: app.activeTasks.length + app.queuedTasks.length })}</span>
      </button>
    {/if}

    <div class="seg" role="group" aria-label={t('top.language')}>
      <button
        class:is-active={getLocale() === 'zh-CN'}
        aria-pressed={getLocale() === 'zh-CN'}
        onclick={() => app.setLanguage('zh-CN')}
      >中</button>
      <button
        class:is-active={getLocale() === 'en-US'}
        aria-pressed={getLocale() === 'en-US'}
        onclick={() => app.setLanguage('en-US')}
      >EN</button>
    </div>

    <button
      class="demo-trigger"
      class:is-open={app.demoOpen}
      aria-expanded={app.demoOpen}
      aria-controls="demo-panel"
      title={t('demo.open')}
      onclick={() => (app.demoOpen = !app.demoOpen)}
    >
      <span class="demo-trigger-dot"></span>
      <span>DEMO</span>
    </button>

    <span class="topbar-divider"></span>

    <button class="icon-btn" title={t('top.github')} aria-label={t('top.github')} onclick={openRepo}>
      <GitHubIcon size={17} />
    </button>
  </div>
</header>

<style>
  .topbar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 14px;
  }
  .brand {
    justify-self: start;
    min-width: 0;
  }
  .brand-logo {
    display: block;
    width: 26px;
    height: 26px;
    border-radius: 7px;
    flex: none;
    box-shadow: 0 0 0 1px var(--rule);
  }
  .nav {
    justify-self: center;
    flex: none;
    min-width: 0;
  }
  .topbar-right {
    justify-self: end;
  }

  .nav-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .nav-item.is-active :global(.msi) {
    color: var(--accent-deep);
  }

  .demo-trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 8px;
    border-radius: 999px;
    border: 1px solid var(--rule);
    background: transparent;
    color: var(--color-on-surface-variant);
    font-family: var(--font-code);
    font-size: 8.5px;
    font-weight: 700;
    letter-spacing: 0.13em;
    transition:
      border-color var(--dur-base) var(--ease-out),
      color var(--dur-base) var(--ease-out),
      background-color var(--dur-base) var(--ease-out);
  }
  .demo-trigger:hover {
    border-color: color-mix(in oklab, var(--accent-deep) 45%, transparent);
    color: var(--accent-deep);
  }
  .demo-trigger.is-open {
    border-color: color-mix(in oklab, var(--accent-deep) 55%, transparent);
    background: var(--accent-wash);
    color: var(--accent-deep);
  }
  .demo-trigger-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--accent);
  }

  @media (max-width: 900px) {
    .nav-label {
      display: none;
    }
    .nav-item {
      padding: 0 9px;
    }
    .brand-tag {
      display: none;
    }
  }
</style>
