<script lang="ts">
  import Icon from './Icon.svelte'
  import { app } from '../lib/store.svelte'
  import { t } from '../lib/i18n.svelte'
  import type { PluginEntry } from '../lib/types'

  const list = $derived(app.plugins)
  const loading = $derived(app.pluginsLoading)
  const shown = $derived(app.filteredPlugins)
  const counts = $derived(app.pluginCounts)

  const filters = $derived([
    { id: 'all' as const, key: 'plugins.filterAll', n: counts.all },
    { id: 'installed' as const, key: 'plugins.filterInstalled', n: counts.installed },
    { id: 'updatable' as const, key: 'plugins.filterUpdatable', n: counts.updatable },
    { id: 'available' as const, key: 'plugins.filterAvailable', n: counts.available },
  ])

  /** 图标：图片地址直接渲染，emoji 原样显示，都没有时用名称首字 */
  function isImage(icon?: string): boolean {
    return Boolean(icon && /^https?:\/\//i.test(icon))
  }
  function initial(name: string): string {
    return (name || '?').trim().slice(0, 1).toUpperCase()
  }
  function busyOf(p: PluginEntry): string {
    return app.pluginBusy[p.id] || ''
  }
</script>

<div class="plugins">
  <!-- 头部：标题 + 重新扫描 -->
  <div class="plugins-head">
    <div class="plugins-head-text">
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

  <!-- 搜索 + 筛选：插件多了以后靠它定位 -->
  {#if counts.all > 0}
    <div class="plugins-tools">
      <div class="search">
        <Icon name="search" size={16} />
        <input
          class="field search-input"
          type="search"
          bind:value={app.pluginSearch}
          placeholder={t('plugins.search')}
          aria-label={t('plugins.search')}
          spellcheck="false"
          autocomplete="off"
        />
      </div>
      <div class="chips" role="tablist" aria-label={t('plugins.title')}>
        {#each filters as f (f.id)}
          <button
            type="button"
            class="chip"
            class:chip--active={app.pluginFilter === f.id}
            role="tab"
            aria-selected={app.pluginFilter === f.id}
            onclick={() => (app.pluginFilter = f.id)}
          >
            {t(f.key)}
            {#if f.n > 0}<span class="chip-count num">{f.n}</span>{/if}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if loading && counts.all === 0}
    <p class="plugin-empty">{t('settings.depsChecking')}</p>
  {:else if counts.all === 0}
    <p class="plugin-empty">{t('plugins.empty')}</p>
  {:else if shown.length === 0}
    <p class="plugin-empty">{t('plugins.noMatch')}</p>
  {:else}
    <!-- 卡片网格：插件多了按行铺开，比长列表好扫 -->
    <ul class="plugin-grid">
      {#each shown as p (p.id)}
        {@const busy = busyOf(p)}
        {@const update = app.pluginHasUpdate(p)}
        <li class="plugin-card" class:plugin-card--broken={Boolean(p.loadError)}>
          <div class="card-top">
            <span class="plugin-icon" aria-hidden="true">
              {#if isImage(p.icon)}
                <img src={p.icon} alt="" loading="lazy" />
              {:else if p.icon}
                {p.icon}
              {:else}
                <span class="plugin-icon-fallback">{initial(p.name)}</span>
              {/if}
            </span>

            <div class="card-titles">
              <div class="card-name-row">
                <span class="plugin-name" title={p.name}>{p.name}</span>
                {#if p.version}
                  <span class="plugin-version num">v{p.version}</span>
                {/if}
              </div>
              <div class="card-badges">
                {#if update}
                  <span class="plugin-badge plugin-badge--new">{t('plugins.updateHint')}</span>
                {:else if p.installed}
                  <span class="plugin-badge" class:plugin-badge--warn={Boolean(p.loadError)}>
                    {p.loadError ? t('plugins.loadFailed') : t('plugins.installed')}
                  </span>
                {:else}
                  <span class="plugin-badge plugin-badge--idle">{t('plugins.notInstalled')}</span>
                {/if}
              </div>
            </div>
          </div>

          <!-- 描述固定两行，保证卡片高度一致、网格不参差 -->
          <p class="plugin-desc">{p.description || '—'}</p>

          {#if p.loadError}
            <!-- 装上却没生效时，原因是**唯一**有用的信息 -->
            <p class="plugin-error">{p.loadError}</p>
          {:else if p.blockedReason}
            <!-- 不能装时要说明缺什么，否则用户只会看到按钮是灰的 -->
            <p class="plugin-error">
              {t('plugins.blocked')}：{p.blockedReason}
            </p>
          {/if}

          {#if busy}
            <p class="plugin-busy"><span class="spinner" aria-hidden="true"></span>{busy}</p>
          {/if}

          {#if p.sites && p.sites.length > 0}
            <div class="site-tags">
              {#each p.sites.slice(0, 3) as site (site)}
                <span class="site-tag">{site}</span>
              {/each}
              {#if p.sites.length > 3}
                <span class="site-tag site-tag--more">+{p.sites.length - 3}</span>
              {/if}
            </div>
          {/if}

          <!-- 卡片底部：仓库链接在左，动作在右 -->
          <div class="card-foot">
            {#if p.repo}
              <button class="link-btn repo-link" title={`https://github.com/${p.repo}`}
                onclick={() => app.openExternalUrl(`https://github.com/${p.repo}`)}>
                {p.repo}
                <Icon name="north_east" size={11} />
              </button>
            {:else}
              <span class="repo-link repo-link--none">{t('plugins.localOnly')}</span>
            {/if}

            <div class="card-actions">
              {#if p.installed}
                {#if update}
                  <button class="btn btn-primary btn-sm" disabled={Boolean(busy)}
                    onclick={() => app.installOrUpdatePlugin(p.id, true)}>
                    <Icon name="system_update" size={14} />
                    <span>{t('plugins.updateAction')}</span>
                  </button>
                {/if}
                <button class="btn btn-ghost btn-sm icon-only" disabled={Boolean(busy)}
                  title={t('plugins.uninstall')} aria-label={t('plugins.uninstall')}
                  onclick={() => app.uninstallPlugin(p.id)}>
                  <Icon name="delete" size={14} />
                </button>
              {:else}
                <button class="btn btn-primary btn-sm"
                  disabled={Boolean(busy) || Boolean(p.blockedReason) || !p.repo}
                  title={p.blockedReason || ''}
                  onclick={() => app.installOrUpdatePlugin(p.id)}>
                  <Icon name="download" size={14} />
                  <span>{busy ? t('plugins.installing') : t('plugins.installAction')}</span>
                </button>
              {/if}
            </div>
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  <!-- 索引之外的手动安装方式 -->
  <div class="plugin-install">
    <div class="plugin-install-head">
      <Icon name="info" size={14} />
      <span>{t('plugins.install')}</span>
    </div>
    <p class="plugin-install-body">
      点「安装」从作者仓库下载。也可以手动把插件目录放到下面的位置，然后点「重新扫描」——目录里需要
      <code>plugin.json</code>（其中 <code>playback</code> 为 <code>downvid-parser</code>）与
      <code>index.js</code>。
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

  .plugins-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .plugins-head-text {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
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

  /* ---------- 搜索与筛选 ---------- */
  .plugins-tools {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .search {
    position: relative;
    width: 260px;
    flex-shrink: 0;
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

  .chips {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 30px;
    padding: 0 11px;
    border-radius: 999px;
    border: 1px solid var(--rule);
    background: transparent;
    color: var(--color-on-surface-variant);
    font-size: 12px;
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  }
  .chip:hover {
    background: var(--paper-sunk);
  }
  .chip--active {
    background: var(--accent-wash);
    border-color: color-mix(in oklab, var(--accent) 45%, var(--rule));
    color: var(--accent-deep);
    font-weight: 600;
  }
  .chip-count {
    font-size: 11px;
    opacity: 0.75;
  }

  /* ---------- 卡片网格 ---------- */
  .plugin-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    /* auto-fill + minmax：容器变窄时自动少一列，不写断点也不溢出 */
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 10px;
  }

  .plugin-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 13px 14px;
    border-radius: 12px;
    border: 1px solid var(--rule);
    background: var(--paper-raised);
    min-width: 0;
  }

  .plugin-card--broken {
    border-color: color-mix(in oklab, var(--warn) 40%, var(--rule));
  }

  .card-top {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    min-width: 0;
  }

  /* 图标：固定 38px 方块，图片与 emoji 都塞得下 */
  .plugin-icon {
    flex: 0 0 38px;
    width: 38px;
    height: 38px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    overflow: hidden;
    background: var(--paper-sunk);
    font-size: 20px;
    line-height: 1;
  }

  .plugin-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .plugin-icon-fallback {
    font-size: 15px;
    font-weight: 600;
    color: var(--color-on-surface-variant);
  }

  .card-titles {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .card-name-row {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
  }

  .plugin-name {
    font-weight: 600;
    font-size: 13.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .plugin-version {
    font-size: 11px;
    color: var(--color-on-surface-variant);
    flex-shrink: 0;
  }

  .card-badges {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
  }

  .plugin-badge {
    font-size: 10.5px;
    padding: 1px 7px;
    border-radius: 999px;
    background: color-mix(in oklab, var(--accent) 16%, transparent);
    color: var(--accent-deep);
  }

  .plugin-badge--warn {
    background: color-mix(in oklab, var(--warn) 18%, transparent);
    color: var(--warn);
  }

  .plugin-badge--new {
    background: color-mix(in oklab, var(--success) 18%, transparent);
    color: var(--success);
  }

  .plugin-badge--idle {
    background: var(--paper-sunk);
    color: var(--color-on-surface-variant);
  }

  /* 描述固定两行：卡片高度一致，网格不参差 */
  .plugin-desc {
    margin: 0;
    font-size: 12.5px;
    color: var(--color-on-surface-variant);
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    min-height: calc(1.5em * 2);
  }

  .plugin-error {
    margin: 0;
    font-size: 11.5px;
    color: var(--warn);
    line-height: 1.5;
    word-break: break-word;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .plugin-busy {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--color-on-surface-variant);
  }

  .spinner {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    border: 1.5px solid color-mix(in oklab, var(--color-on-surface) 25%, transparent);
    border-top-color: var(--accent-deep);
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .site-tags {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .site-tag {
    font-size: 11px;
    padding: 1px 7px;
    border-radius: 5px;
    background: var(--paper-sunk);
    color: var(--color-on-surface-variant);
  }

  .site-tag--more {
    opacity: 0.7;
  }

  /* 底部固定在卡片底边：动作按钮对齐，不随描述长度上下跳 */
  .card-foot {
    margin-top: auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-top: 6px;
    border-top: 1px solid var(--rule-soft);
  }

  .repo-link {
    font-size: 11.5px;
    color: var(--color-on-surface-variant);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .repo-link--none {
    opacity: 0.6;
  }

  .card-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .icon-only {
    padding-left: 8px;
    padding-right: 8px;
  }

  .plugin-empty {
    margin: 0;
    padding: 22px 0;
    text-align: center;
    color: var(--color-on-surface-variant);
    font-size: 13px;
  }

  /* ---------- 手动安装说明 ---------- */
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
    background: var(--paper-sunk);
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
