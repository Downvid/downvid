<script lang="ts">
  import Icon from './Icon.svelte'
  import { app } from '../lib/store.svelte'
  import { t } from '../lib/i18n.svelte'
  import type { PluginEntry } from '../lib/types'
  import { canInstall, hasUpdate } from '../lib/plugin-filter'

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

  /** 图片失败过的插件 id：失败后退回名称首字，别把破图图标摆在卡片上 */
  let brokenIcons = $state<Record<string, boolean>>({})

  /** 图标：图片地址直接渲染，emoji 原样显示，都没有时用名称首字 */
  function isImage(icon?: string): boolean {
    return Boolean(icon && /^https?:\/\//i.test(icon))
  }
  function showImage(p: PluginEntry): boolean {
    return isImage(p.icon) && !brokenIcons[p.id]
  }
  function markIconBroken(id: string): void {
    brokenIcons = { ...brokenIcons, [id]: true }
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
      {#if loading}
        <span class="spinner" aria-hidden="true"></span>
        <span>{t('plugins.reloading')}</span>
      {:else}
        <Icon name="refresh" size={15} />
        <span>{t('plugins.reload')}</span>
      {/if}
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
  <!-- 加载中也显示工具栏：否则数据一到搜索框和筛选条突然出现，整页往下跳 -->
  {#if loading || counts.all > 0}
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
        {#if app.pluginSearch}
          <!-- 清空搜索：type=search 的原生按钮被隐藏了，否则 macOS 上样式不统一 -->
          <button
            type="button"
            class="search-clear"
            title={t('plugins.clearSearch')}
            aria-label={t('plugins.clearSearch')}
            onclick={() => (app.pluginSearch = '')}
          >
            <Icon name="close" size={14} />
          </button>
        {/if}
      </div>
      <!-- 用 aria-pressed 的按钮组，而不是 tablist：这里没有对应的 tabpanel，
           标成 tab 会让读屏用户以为切走就能看到另一块内容 -->
      <div class="chips" role="group" aria-label={t('plugins.title')}>
        {#each filters as f (f.id)}
          <button
            type="button"
            class="chip"
            class:chip--active={app.pluginFilter === f.id}
            aria-pressed={app.pluginFilter === f.id}
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
    <!-- 首次拉索引还要逐个校验风险声明，可能等几秒。先把卡片的形状画出来，
         比只给一句「加载中」更不容易让人以为页面卡死。 -->
    <ul class="plugin-grid" aria-hidden="true">
      {#each [0, 1, 2, 3] as i (i)}
        <li class="plugin-card plugin-card--skeleton">
          <div class="card-top">
            <span class="plugin-icon sk-shimmer"></span>
            <div class="card-titles">
              <span class="sk-line sk-line--name sk-shimmer"></span>
              <span class="sk-line sk-line--badge sk-shimmer"></span>
            </div>
          </div>
          <span class="sk-line sk-line--desc sk-shimmer"></span>
          <span class="sk-line sk-line--desc sk-shimmer" style="width:62%"></span>
          <div class="card-foot">
            <span class="sk-line sk-line--foot sk-shimmer"></span>
          </div>
        </li>
      {/each}
    </ul>
    <p class="sr-only" role="status">{t('plugins.loading')}</p>
  {:else if counts.all === 0}
    <div class="plugin-empty">
      <span class="plugin-empty-icon"><Icon name="extension" size={22} /></span>
      <strong>{list.indexError ? t('plugins.empty') : t('plugins.indexEmpty')}</strong>
      <span>{t('plugins.emptyHint')}</span>
    </div>
  {:else if shown.length === 0}
    <div class="plugin-empty plugin-empty--compact">
      <Icon name="search" size={18} />
      <span>{t('plugins.noMatch')}</span>
      {#if app.pluginSearch}
        <button class="btn btn-ghost btn-sm" onclick={() => (app.pluginSearch = '')}>
          {t('plugins.clearSearch')}
        </button>
      {/if}
    </div>
  {:else}
    <!-- 卡片网格：插件多了按行铺开，比长列表好扫 -->
    <ul class="plugin-grid">
      {#each shown as p (p.id)}
        {@const busy = busyOf(p)}
        {@const update = hasUpdate(p)}
        <li
          class="plugin-card"
          class:plugin-card--broken={Boolean(p.loadError)}
          aria-busy={Boolean(busy)}
        >
          <!-- 整卡可点：真正的 button 垫在内容下面，内容层不接管鼠标，
               动作按钮再单独恢复点击。这样键盘也能打开详情，
               不用给 li 套 role=button（button 里不能嵌 button）。 -->
          <button
            type="button"
            class="card-open"
            aria-label={`${t('plugins.detail')} ${p.name}`}
            onclick={() => app.openPluginDetail(p)}
          ></button>

          <div class="card-inner">
            <div class="card-top">
              <span class="plugin-icon" aria-hidden="true">
                {#if showImage(p)}
                  <img src={p.icon} alt="" loading="lazy" onerror={() => markIconBroken(p.id)} />
                {:else if p.icon && !isImage(p.icon)}
                  {p.icon}
                {:else}
                  <span class="plugin-icon-fallback">{initial(p.name)}</span>
                {/if}
              </span>

              <div class="card-titles">
                <span class="plugin-name" title={p.name}>{p.name}</span>
                <div class="card-sub">
                  {#if p.author}
                    <span class="plugin-author" title={p.author}>{p.author}</span>
                  {:else if p.repo}
                    <span class="plugin-author" title={p.repo}>{p.repo}</span>
                  {/if}
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

              <!-- 主操作放右上角：卡片变短，和参考的插件市场一致 -->
              <div class="card-actions">
                {#if p.installed}
                  {#if update}
                    <button class="btn btn-primary btn-sm" disabled={Boolean(busy)}
                      onclick={() => app.installOrUpdatePlugin(p.id, true)}>
                      <Icon name="system_update" size={14} />
                      <span>{busy ? t('plugins.updating') : t('plugins.updateAction')}</span>
                    </button>
                  {/if}
                  <button class="btn btn-ghost btn-sm icon-only" disabled={Boolean(busy)}
                    title={t('plugins.uninstall')} aria-label={t('plugins.uninstall')}
                    onclick={() => app.uninstallPlugin(p.id)}>
                    <Icon name="delete" size={14} />
                  </button>
                {:else}
                  <button class="btn btn-primary btn-sm"
                    disabled={Boolean(busy) || !canInstall(p)}
                    title={p.blockedReason || (!p.repo ? t('plugins.localOnly') : '')}
                    onclick={() => app.installOrUpdatePlugin(p.id)}>
                    <Icon name="download" size={14} />
                    <span>{busy ? t('plugins.installing') : t('plugins.installAction')}</span>
                  </button>
                {/if}
              </div>
            </div>

            <!-- 描述固定两行，保证卡片高度一致、网格不参差 -->
            <p class="plugin-desc">{p.description || '—'}</p>

            {#if p.loadError}
              <!-- 装上却没生效时，原因是**唯一**有用的信息。卡片上只留两行，
                   完整内容放在 title 里，长错误不会把卡片撑坏 -->
              <p class="plugin-error" title={p.loadError}>{p.loadError}</p>
            {:else if p.blockedReason}
              <!-- 不能装时要说明缺什么，否则用户只会看到按钮是灰的 -->
              <p class="plugin-error" title={p.blockedReason}>
                {t('plugins.blocked')} · {p.blockedReason}
              </p>
            {/if}

            {#if busy}
              <p class="plugin-busy" role="status">
                <span class="spinner" aria-hidden="true"></span>{busy}
              </p>
            {/if}

            <!-- 底部只留元信息：站点在左，版本在右。仓库与完整站点在详情里 -->
            <div class="card-foot">
              {#if p.sites && p.sites.length > 0}
                <div class="site-tags" title={p.sites.join(' · ')}>
                  {#each p.sites.slice(0, 3) as site (site)}
                    <span class="site-tag">{site}</span>
                  {/each}
                  {#if p.sites.length > 3}
                    <span class="site-tag site-tag--more">+{p.sites.length - 3}</span>
                  {/if}
                </div>
              {:else}
                <span class="repo-link repo-link--none" title={p.repo || t('plugins.localOnly')}>
                  {p.repo || t('plugins.localOnly')}
                </span>
              {/if}

              {#if p.version}
                <!-- 可更新时直接摆出「本机版本 → 索引版本」，
                     否则用户只看到最新版本号，不知道现在装的是哪一版 -->
                <span
                  class="plugin-version num"
                  title={update && p.installedVersion
                    ? `v${p.installedVersion} → v${p.version}`
                    : `v${p.version}`}
                >
                  {#if update && p.installedVersion}
                    <span class="version-old">v{p.installedVersion}</span>
                    <span class="version-arrow" aria-hidden="true">→</span>
                    <span>v{p.version}</span>
                  {:else}
                    v{p.version}
                  {/if}
                </span>
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
    <p class="plugin-install-body">{t('plugins.manualHint')}</p>
    <div class="plugin-files">
      <span class="plugin-files-label">{t('plugins.manualFiles')}</span>
      <ul>
        <li>
          <code>plugin.json</code>
          <span>{t('plugins.manualPlayback')}</span>
        </li>
        <li><code>index.js</code></li>
      </ul>
    </div>
    <div class="plugin-dir">
      <span class="plugin-meta-label">{t('plugins.dirLabel')}</span>
      <code class="scroll" title={list.dir || ''}>{list.dir || '—'}</code>
      <button
        type="button"
        class="icon-btn icon-btn--bordered plugin-dir-open"
        title={t('plugins.openDir')}
        aria-label={t('plugins.openDir')}
        disabled={!list.dir}
        onclick={() => app.openPluginDir()}
      >
        <Icon name="folder_open" size={15} />
      </button>
    </div>
  </div>
</div>

<style>
  .plugins {
    display: flex;
    flex-direction: column;
    gap: 14px;
    /* 这一页直接挂在 .settings-panel 里，而其它设置分区靠 .row 的内边距撑开。
       不在这里补内边距，标题、搜索和卡片就会贴着面板边框。 */
    padding: 18px 20px 20px;
  }

  .plugins-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    min-width: 0;
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
    flex: 0 1 280px;
    width: 260px;
    min-width: 180px;
  }
  /* 只定位搜索框左侧的放大镜。不要写成 `.search :global(.msi)`：
     清空按钮里也有一个 .msi，会被一起拎到左边叠在放大镜上。 */
  .search > :global(.msi) {
    position: absolute;
    left: 11px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--color-on-surface-variant);
    pointer-events: none;
  }
  .search .search-input {
    padding-left: 34px;
    /* 右侧留给清除按钮，否则输入的长查询会压在按钮下面 */
    padding-right: 32px;
    height: 34px;
    font-size: 12px;
  }
  .search-input::-webkit-search-cancel-button {
    -webkit-appearance: none;
    appearance: none;
  }
  .search-clear {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--color-on-surface-variant);
    transition:
      background-color var(--dur-base) var(--ease-out),
      color var(--dur-base) var(--ease-out);
  }
  .search-clear:hover {
    background: color-mix(in oklab, var(--color-on-surface) 7%, transparent);
    color: var(--ink);
  }

  .chips {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
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
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 13px 14px;
    border-radius: 12px;
    border: 1px solid var(--rule);
    background: var(--paper-raised);
    min-width: 0;
    transition: border-color var(--dur-base) var(--ease-out);
  }
  /* 只有正常卡片响应悬停：出错的卡片保持自己的警示色 */
  .plugin-card:not(.plugin-card--broken):hover {
    border-color: var(--rule-strong);
  }

  /* 垫在内容下面的整卡点击层 */
  .card-open {
    position: absolute;
    inset: 0;
    z-index: 0;
    padding: 0;
    border: 0;
    border-radius: inherit;
    background: transparent;
  }
  .card-open:focus-visible {
    outline-offset: 2px;
  }

  /* 内容层不接管鼠标，点击穿透到下面的 .card-open；
     动作按钮单独恢复 pointer-events（见 .card-actions）。 */
  .card-inner {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
    min-width: 0;
    pointer-events: none;
  }

  .plugin-card--broken {
    border-color: color-mix(in oklab, var(--warn) 40%, var(--rule));
  }

  /* 加载骨架：与卡片同尺寸、同排版，数据到了直接替换，不跳版 */
  .plugin-card--skeleton {
    pointer-events: none;
  }
  .sk-line {
    display: block;
    height: 10px;
    border-radius: 5px;
  }
  .sk-line--name {
    width: 58%;
    height: 13px;
  }
  .sk-line--badge {
    width: 34%;
    height: 9px;
    margin-top: 7px;
  }
  .sk-line--desc {
    width: 100%;
  }
  .sk-line--foot {
    width: 42%;
    height: 9px;
  }
  .plugin-icon.sk-shimmer {
    width: 38px;
    height: 38px;
    flex: 0 0 38px;
    border-radius: 10px;
  }
  .sk-shimmer {
    position: relative;
    overflow: hidden;
    background: var(--paper-sunk);
  }
  /* 只动 transform：背景位移会触发整块重绘，低端机上骨架会一卡一卡的 */
  .sk-shimmer::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent,
      color-mix(in oklab, var(--paper-raised) 85%, transparent),
      transparent
    );
    transform: translate3d(-100%, 0, 0);
    animation: plugin-shimmer 1.4s ease infinite;
  }
  @keyframes plugin-shimmer {
    from {
      transform: translate3d(-100%, 0, 0);
    }
    to {
      transform: translate3d(100%, 0, 0);
    }
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

  .plugin-name {
    display: block;
    font-weight: 600;
    font-size: 13.5px;
    color: var(--ink-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-sub {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex-wrap: wrap;
  }

  .plugin-author {
    min-width: 0;
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11.5px;
    color: var(--color-on-surface-variant);
  }

  .plugin-version {
    display: inline-flex;
    align-items: baseline;
    gap: 3px;
    font-size: 11px;
    color: var(--color-on-surface-variant);
    flex-shrink: 0;
  }
  .version-old {
    opacity: 0.7;
  }
  .version-arrow {
    opacity: 0.55;
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
    min-width: 0;
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
    min-height: 20px;
    padding-top: 2px;
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
    position: relative;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    /* 内容层整体 pointer-events:none，动作按钮必须单独恢复 */
    pointer-events: auto;
  }

  .icon-only {
    padding-left: 8px;
    padding-right: 8px;
  }

  .plugin-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 7px;
    margin: 0;
    padding: 34px 20px;
    text-align: center;
    color: var(--color-on-surface-variant);
    font-size: 12.5px;
    line-height: 1.55;
    border: 1px dashed var(--rule);
    border-radius: var(--radius-panel);
    background: color-mix(in oklab, var(--paper-sunk) 35%, transparent);
  }
  .plugin-empty strong {
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-strong);
  }
  .plugin-empty > span:last-child {
    max-width: 460px;
  }
  .plugin-empty-icon {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 10px;
    background: var(--paper-sunk);
    color: var(--color-on-surface-variant);
  }
  .plugin-empty--compact {
    flex-direction: row;
    justify-content: center;
    gap: 8px;
    padding: 16px;
    font-size: 12.5px;
  }
  .plugin-empty--compact :global(.msi) {
    color: var(--color-on-surface-variant);
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

  .plugin-files code {
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--paper-sunk);
    font-size: 11.5px;
  }

  .plugin-files {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .plugin-files-label {
    font-size: 11.5px;
    color: var(--color-on-surface-variant);
  }

  .plugin-files ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .plugin-files li {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--color-on-surface-variant);
  }

  .plugin-dir {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    min-width: 0;
  }

  .plugin-meta-label {
    flex: none;
    font-size: 11.5px;
    color: var(--color-on-surface-variant);
  }

  .plugin-dir code {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 11.5px;
    overflow-x: auto;
    white-space: nowrap;
    color: var(--color-on-surface-variant);
  }

  .plugin-dir-open {
    flex: none;
  }
  .plugin-dir-open:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }

  @media (max-width: 640px) {
    .plugins {
      padding: 14px 16px 18px;
    }
    .search {
      flex: 1 1 100%;
      width: 100%;
      max-width: none;
    }
  }
</style>
