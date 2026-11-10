<script lang="ts">
  import Icon from './Icon.svelte'
  import { app } from '../lib/store.svelte'
  import { t } from '../lib/i18n.svelte'

  const list = $derived(app.plugins)
  const loading = $derived(app.pluginsLoading)
</script>

<div class="plugins">
  <div class="row">
    <div class="row-label">
      <span class="row-title">{t('plugins.title')}</span>
      <span class="row-hint">{t('plugins.hint')}</span>
    </div>
    <button class="btn btn-ghost" onclick={() => app.loadPlugins(true)} disabled={loading}>
      <Icon name="refresh" size={15} />
      <span>{t('plugins.reload')}</span>
    </button>
  </div>

  {#if list.indexError}
    <!-- 拉索引失败不能藏起来，但也别吓人：已安装的插件仍然可用 -->
    <div class="plugin-note plugin-note--warn">
      <Icon name="cloud_off" size={14} />
      <span>{t('plugins.indexError')} {list.indexError}</span>
    </div>
  {/if}

  {#if loading && list.entries.length === 0}
    <p class="plugin-empty">{t('settings.depsChecking')}</p>
  {:else if list.entries.length === 0}
    <p class="plugin-empty">{t('plugins.empty')}</p>
  {:else}
    <ul class="plugin-list">
      {#each list.entries as p (p.id)}
        <li class="plugin-item" class:plugin-item--broken={Boolean(p.loadError)}>
          <div class="plugin-main">
            <div class="plugin-head">
              <span class="plugin-name">{p.name}</span>
              {#if p.installed}
                <span class="plugin-badge" class:plugin-badge--warn={Boolean(p.loadError)}>
                  {p.loadError ? t('plugins.loadFailed') : t('plugins.installed')}
                </span>
              {:else}
                <span class="plugin-badge plugin-badge--idle">{t('plugins.notInstalled')}</span>
              {/if}
            </div>
            {#if p.description}
              <p class="plugin-desc">{p.description}</p>
            {/if}
            {#if p.loadError}
              <!-- 装上却没生效时，原因是**唯一**有用的信息 -->
              <p class="plugin-error">{p.loadError}</p>
            {/if}
            <div class="plugin-meta">
              {#if p.sites && p.sites.length > 0}
                <span class="plugin-sites">
                  <span class="plugin-meta-label">{t('plugins.sitesLabel')}</span>
                  {p.sites.join(' · ')}
                </span>
              {/if}
              {#if p.repo}
                <button class="link-btn" onclick={() => app.openExternalUrl(`https://github.com/${p.repo}`)}>
                  {p.repo}
                  <Icon name="north_east" size={11} />
                </button>
              {/if}
            </div>
          </div>
          {#if p.installed}
            <button class="btn btn-ghost btn-sm" onclick={() => app.uninstallPlugin(p.id)}>
              <Icon name="delete" size={14} />
              <span>{t('plugins.uninstall')}</span>
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <!-- 安装入口：当前只给目录位置与说明，不做一键安装（见文档的审核约定） -->
  <div class="plugin-install">
    <div class="plugin-install-head">
      <Icon name="info" size={14} />
      <span>{t('plugins.install')}</span>
    </div>
    <p class="plugin-install-body">
      把一个插件目录放到下面的位置，然后点「重新扫描」。目录里需要
      <code>plugin.json</code>（其中 <code>playback</code> 为
      <code>downvid-parser</code>）与 <code>index.js</code>。
    </p>
    <div class="plugin-dir">
      <span class="plugin-meta-label">{t('plugins.dirLabel')}</span>
      <code class="scroll">{list.dir || '—'}</code>
    </div>
  </div>
</div>

<style>
  .plugins {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .plugin-note {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 10px;
    font-size: 12.5px;
    line-height: 1.5;
  }

  .plugin-note--warn {
    background: color-mix(in oklab, var(--warn) 12%, transparent);
    color: var(--warn);
  }

  .plugin-empty {
    margin: 0;
    padding: 18px 0;
    text-align: center;
    color: var(--color-on-surface-variant);
    font-size: 13px;
  }

  .plugin-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .plugin-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border-radius: 12px;
    border: 1px solid var(--rule);
    background: var(--paper-raised);
  }

  .plugin-item--broken {
    border-color: color-mix(in oklab, var(--warn) 40%, var(--rule));
  }

  .plugin-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .plugin-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .plugin-name {
    font-weight: 600;
    font-size: 13.5px;
  }

  .plugin-badge {
    font-size: 11px;
    padding: 1px 7px;
    border-radius: 999px;
    background: color-mix(in oklab, var(--accent) 16%, transparent);
    color: var(--accent);
  }

  .plugin-badge--warn {
    background: color-mix(in oklab, var(--warn) 18%, transparent);
    color: var(--warn);
  }

  .plugin-badge--idle {
    background: var(--paper-raised);
    color: var(--color-on-surface-variant);
  }

  .plugin-desc {
    margin: 0;
    font-size: 12.5px;
    color: var(--color-on-surface-variant);
    line-height: 1.5;
  }

  .plugin-error {
    margin: 0;
    font-size: 12px;
    color: var(--warn);
    line-height: 1.5;
    word-break: break-word;
  }

  .plugin-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    font-size: 12px;
    color: var(--color-on-surface-variant);
  }

  .plugin-meta-label {
    color: var(--color-on-surface-variant);
    margin-right: 4px;
  }

  .plugin-install {
    padding: 12px 14px;
    border-radius: 12px;
    border: 1px dashed var(--rule);
    background: var(--paper);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .plugin-install-head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
  }

  .plugin-install-body {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.6;
    color: var(--color-on-surface-variant);
  }

  .plugin-install-body code {
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--paper-raised);
    font-size: 11.5px;
  }

  .plugin-dir {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    min-width: 0;
  }

  .plugin-dir code {
    font-size: 11.5px;
    overflow-x: auto;
    white-space: nowrap;
    color: var(--color-on-surface-variant);
  }
</style>
