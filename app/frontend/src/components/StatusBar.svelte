<script lang="ts">
  import Icon from './Icon.svelte'
  import { app } from '../lib/store.svelte'
  import { t } from '../lib/i18n.svelte'
  import { formatSpeed } from '../lib/format'

  function openDeps(): void {
    app.setTab('settings')
    app.settingsSection = 'deps'
  }

  function toggleRail(): void {
    if (app.tab === 'settings' || app.tab === 'about') {
      app.setTab('download')
      app.railOpen = true
      return
    }
    app.railOpen = !app.railOpen
  }
  const ytdlpDep = $derived(app.deps.find((d) => d.id === 'yt-dlp'))
  const depLabel = $derived.by(() => {
    if (!ytdlpDep) return 'yt-dlp'
    if (ytdlpDep.version) {
      return ytdlpDep.stale
        ? `yt-dlp ${ytdlpDep.version} (${t('settings.depsOutdated')})`
        : `yt-dlp ${ytdlpDep.version}`
    }
    return ytdlpDep.stale
      ? `yt-dlp (${t('settings.depsOutdated')})`
      : `yt-dlp (${t('settings.depsMissing')})`
  })
</script>

<footer class="statusbar">
  <button class="status-btn" onclick={openDeps} title={t('settings.navDeps')}>
    <span class="dot" class:dot--danger={!app.depsReady}></span>
    <span>{app.depsReady ? t('status.deps') : t('status.depsMissing')}</span>
    <span class="status-sep">·</span>
    <span class="num">{depLabel}</span>
  </button>

  <span class="grow"></span>

  {#if app.hasTasks}
    <button class="status-btn" onclick={toggleRail} title={t('queue.expand')}>
      {#if app.totalSpeed > 0}
        <span class="dot dot--live"></span>
        <span>{formatSpeed(app.totalSpeed)}</span>
      {/if}
      <span>{t('status.tasks', { count: app.activeTasks.length + app.queuedTasks.length })}</span>
      <Icon name="unfold_more" size={13} />
    </button>
  {:else}
    <span class="status-idle">{t('status.queueIdle')}</span>
  {/if}

  <span class="grow"></span>

  <button class="status-btn" onclick={() => app.openDownloadDir()} title={t('status.openFolder')}>
    <Icon name="folder" size={13} />
    <span>{t('status.storage', { size: app.freeStorageLabel })}</span>
  </button>
</footer>

<style>
  .status-sep {
    opacity: 0.45;
  }
  .status-idle {
    opacity: 0.8;
  }
</style>
