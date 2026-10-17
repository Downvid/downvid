<script lang="ts">
  import Icon from './Icon.svelte'
  import logo from '../assets/logo.png'
  import { app, type Tab } from '../lib/store.svelte'
  import { t, getLocale } from '../lib/i18n.svelte'

  const tabs: { id: Tab; key: string; icon: string }[] = [
    { id: 'download', key: 'nav.download', icon: 'download' },
    { id: 'history', key: 'nav.history', icon: 'history' },
    { id: 'settings', key: 'nav.settings', icon: 'settings' },
    { id: 'about', key: 'nav.about', icon: 'info' },
  ]

</script>

<header class="topbar">
  <div class="brand">
    <img class="brand-logo" src={logo} alt="DownVid" />
    <span class="brand-name">DownVid</span>
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

    <button
      class="announce"
      class:is-unread={!app.announcementRead}
      title={t('announcement.short')}
      onclick={() => app.openAnnouncement()}
    >
      <Icon name="campaign" size={15} />
      <span class="announce-label">{t('announcement.short')}</span>
    </button>

    <span class="topbar-divider"></span>

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

  </div>
</header>

<nav class="mobile-nav" aria-label="Main">
  {#each tabs as tab (tab.id)}
    <button
      class="mobile-tab"
      class:is-active={app.tab === tab.id}
      aria-current={app.tab === tab.id ? 'page' : undefined}
      onclick={() => app.setTab(tab.id)}
    >
      <Icon name={tab.icon} size={19} />
      <span>{t(tab.key)}</span>
    </button>
  {/each}
</nav>

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
    border-radius: var(--radius-control);
    flex: none;
    box-shadow: 0 0 0 1px var(--rule);
  }
  .nav {
    justify-self: center;
    flex: none;
    min-width: 0;
    height: auto;
    padding: 3px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-control);
    background: color-mix(in oklab, var(--paper-deep) 55%, transparent);
  }
  .topbar-right {
    justify-self: end;
  }

  .nav-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    border-radius: 6px;
    transition:
      background-color var(--dur-base) var(--ease-out),
      color var(--dur-base) var(--ease-out),
      box-shadow var(--dur-base) var(--ease-out);
  }
  .nav-item:hover {
    background: color-mix(in oklab, var(--color-on-surface) 5%, transparent);
    color: var(--ink);
  }
  .nav-item.is-active {
    background: var(--paper-raised);
    color: var(--ink-strong);
    box-shadow:
      0 1px 2px color-mix(in oklab, var(--color-on-surface) 14%, transparent),
      inset 0 1px 0 rgba(255, 255, 255, 0.6);
  }
  .nav-item.is-active::after {
    display: none;
  }
  .nav-item.is-active :global(.msi) {
    color: var(--accent-deep);
  }
  :global([data-theme='dark']) .nav-item.is-active {
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.5),
      inset 0 1px 0 rgba(255, 255, 255, 0.06);
  }

  .announce {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 9px;
    border-radius: 6px;
    border: 1px solid var(--rule);
    background: transparent;
    color: var(--color-on-surface-variant);
    font-family: var(--font-code);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.02em;
    white-space: nowrap;
    transition:
      border-color var(--dur-base) var(--ease-out),
      background-color var(--dur-base) var(--ease-out),
      color var(--dur-base) var(--ease-out);
  }
  .announce:hover {
    border-color: color-mix(in oklab, var(--accent-deep) 42%, transparent);
    color: var(--ink);
    background: color-mix(in oklab, var(--accent-wash) 35%, transparent);
  }
  .announce :global(.msi) {
    color: var(--accent-deep);
  }
  .announce.is-unread {
    padding-right: 15px;
  }
  .announce.is-unread::after {
    content: '';
    position: absolute;
    top: 4px;
    right: 5px;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--accent);
  }


  .mobile-nav {
    display: none;
  }

  @media (max-width: 900px) {
    .nav-label {
      display: none;
    }
    .nav-item {
      padding: 0 9px;
    }
    .announce-label {
      display: none;
    }
    .announce {
      padding: 0 8px;
    }
    .announce.is-unread {
      padding-right: 14px;
    }
  }

  @media (max-width: 820px) {
    .topbar {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      padding: 0 12px;
    }
    .nav {
      display: none;
    }
    .brand-name {
      font-size: 14px;
    }
    .mobile-nav {
      display: flex;
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 60;
      height: 54px;
      padding: 0 6px;
      border-top: 1px solid var(--rule);
      background: color-mix(in oklab, var(--paper) 94%, transparent);
    }
    .mobile-tab {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      border: 0;
      background: transparent;
      color: var(--color-on-surface-variant);
      font-family: var(--font-ui);
      font-size: 9.5px;
      font-weight: 500;
      transition: color var(--dur-base) var(--ease-out);
    }
    .mobile-tab.is-active {
      color: var(--accent-deep);
    }
    .mobile-tab.is-active :global(.msi) {
      color: var(--accent-deep);
    }
  }
</style>
