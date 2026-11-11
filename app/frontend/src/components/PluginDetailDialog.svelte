<script lang="ts">
  /**
   * 插件详情。
   *
   * 卡片只放得下两行描述，安装前真正要看的东西——作者、仓库、当前版本、
   * 完整支持站点、加载失败/不可安装的原因——都在这里。参考插件市场的
   * 做法：卡片是索引，详情是决策页。
   *
   * 不在这里请求 README：当前后端只返回索引字段，前端直接拉 GitHub 会
   * 撞上 CORS，也会把「插件可信吗」这个问题变成「网络通不通」。
   * 仓库入口放在最显眼的位置，让用户自己去看源码。
   */
  import Icon from './Icon.svelte'
  import GitHubIcon from './GitHubIcon.svelte'
  import { app } from '../lib/store.svelte'
  import { t } from '../lib/i18n.svelte'
  import { canInstall, hasUpdate } from '../lib/plugin-filter'
  import type { PluginEntry } from '../lib/types'

  const p = $derived(app.pluginDetail)
  const busy = $derived(p ? app.pluginBusy[p.id] || '' : '')
  const update = $derived(p ? hasUpdate(p) : false)

  /** 图标加载失败的插件 id：只影响那一张图，换插件后自动恢复 */
  let brokenIconFor = $state('')

  function isImage(icon?: string): boolean {
    return Boolean(icon && /^https?:\/\//i.test(icon))
  }
  function initial(name: string): string {
    return (name || '?').trim().slice(0, 1).toUpperCase()
  }
  function statusOf(entry: PluginEntry): string {
    if (entry.loadError) return t('plugins.loadFailed')
    if (hasUpdate(entry)) return t('plugins.updateHint')
    return entry.installed ? t('plugins.installed') : t('plugins.notInstalled')
  }
  function close(): void {
    app.closePluginDetail()
  }
  function onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) close()
  }
  function uninstall(): void {
    if (!p) return
    close()
    app.uninstallPlugin(p.id)
  }
</script>

{#if p}
  <div class="overlay" role="presentation" onclick={onBackdrop}>
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="plugin-detail-title">
      <header class="dialog-head">
        <span class="plugin-icon" aria-hidden="true">
          {#if isImage(p.icon) && brokenIconFor !== p.id}
            <img src={p.icon} alt="" onerror={() => (brokenIconFor = p.id)} />
          {:else if p.icon && !isImage(p.icon)}
            {p.icon}
          {:else}
            <span class="plugin-icon-fallback">{initial(p.name)}</span>
          {/if}
        </span>

        <div class="head-copy">
          <h2 id="plugin-detail-title">{p.name}</h2>
          <div class="head-sub">
            {#if p.author}
              <span class="author">{p.author}</span>
            {/if}
            {#if p.repo}
              <button
                type="button"
                class="repo-btn"
                title={`https://github.com/${p.repo}`}
                onclick={() => app.openExternalUrl(`https://github.com/${p.repo}`)}
              >
                <span class="repo-text">{p.repo}</span>
                <Icon name="north_east" size={11} />
              </button>
            {/if}
          </div>
        </div>

        <button
          class="icon-btn"
          title={t('common.close')}
          aria-label={t('common.close')}
          onclick={close}
        >
          <Icon name="close" size={18} />
        </button>
      </header>

      <div class="dialog-body scroll">
        <p class="plugin-desc">{p.description || t('plugins.noDescription')}</p>

        <dl class="meta-grid">
          <div>
            <dt>{t('plugins.versionLabel')}</dt>
            <dd class="num">{p.version ? `v${p.version}` : '—'}</dd>
          </div>
          <div>
            <dt>{t('plugins.installedVersionLabel')}</dt>
            <dd class="num">{p.installedVersion ? `v${p.installedVersion}` : '—'}</dd>
          </div>
          <div>
            <dt>{t('plugins.statusLabel')}</dt>
            <dd>{statusOf(p)}</dd>
          </div>
          <div>
            <dt>{t('plugins.authorLabel')}</dt>
            <dd>{p.author || '—'}</dd>
          </div>
        </dl>

        {#if p.sites && p.sites.length > 0}
          <section class="section">
            <span class="section-label">{t('plugins.sitesLabel')}</span>
            <div class="site-tags">
              {#each p.sites as site (site)}
                <span class="site-tag">{site}</span>
              {/each}
            </div>
          </section>
        {/if}

        {#if p.loadError}
          <div class="note note--warn" role="status">
            <Icon name="error" size={15} />
            <div>
              <strong>{t('plugins.loadFailed')}</strong>
              <span>{p.loadError}</span>
            </div>
          </div>
        {/if}

        {#if p.blockedReason}
          <div class="note note--warn">
            <Icon name="error" size={15} />
            <div>
              <strong>{t('plugins.blocked')}</strong>
              <span>{p.blockedReason}</span>
            </div>
          </div>
        {/if}

        <div class="note note--info">
          <Icon name="info" size={15} />
          <span>{t('plugins.risk')}</span>
        </div>

        {#if busy}
          <p class="busy" role="status">
            <span class="spinner" aria-hidden="true"></span>{busy}
          </p>
        {/if}
      </div>

      <footer class="dialog-foot">
        {#if p.repo}
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            onclick={() => app.openExternalUrl(`https://github.com/${p.repo}`)}
          >
            <GitHubIcon size={14} />
            <span>{t('plugins.openRepo')}</span>
          </button>
        {:else}
          <span class="local-note">{t('plugins.localOnly')}</span>
        {/if}

        <div class="foot-actions">
          <button type="button" class="btn btn-ghost" onclick={close}>
            {t('common.close')}
          </button>

          {#if p.installed}
            {#if update}
              <button
                type="button"
                class="btn btn-primary"
                disabled={Boolean(busy)}
                onclick={() => app.installOrUpdatePlugin(p.id, true)}
              >
                <Icon name="system_update" size={15} />
                <span>{busy ? t('plugins.updating') : t('plugins.updateAction')}</span>
              </button>
            {/if}
            <button
              type="button"
              class="btn btn-ghost"
              disabled={Boolean(busy)}
              onclick={uninstall}
            >
              <Icon name="delete" size={15} />
              <span>{t('plugins.uninstall')}</span>
            </button>
          {:else}
            <button
              type="button"
              class="btn btn-primary"
              disabled={Boolean(busy) || !canInstall(p)}
              title={p.blockedReason || (!p.repo ? t('plugins.localOnly') : '')}
              onclick={() => app.installOrUpdatePlugin(p.id)}
            >
              <Icon name="download" size={15} />
              <span>{busy ? t('plugins.installing') : t('plugins.installAction')}</span>
            </button>
          {/if}
        </div>
      </footer>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--scrim);
    animation: fade-in var(--dur-base) var(--ease-out);
  }

  .dialog {
    width: min(600px, 100%);
    max-height: min(84vh, 760px);
    display: flex;
    flex-direction: column;
    border: 1px solid var(--rule);
    border-radius: var(--radius-card);
    background: var(--paper-raised);
    box-shadow: var(--shadow-pop);
    animation: rise-in var(--dur-base) var(--ease-out);
    overflow: hidden;
  }

  .dialog-head {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 18px 20px 14px;
    border-bottom: 1px solid var(--rule-soft);
  }

  .plugin-icon {
    flex: 0 0 46px;
    width: 46px;
    height: 46px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    overflow: hidden;
    background: var(--paper-sunk);
    font-size: 24px;
    line-height: 1;
  }

  .plugin-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .plugin-icon-fallback {
    font-size: 17px;
    font-weight: 600;
    color: var(--color-on-surface-variant);
  }

  .head-copy {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .head-copy h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 16px;
    font-weight: 700;
    letter-spacing: -0.015em;
    color: var(--ink-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .head-sub {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-size: 11.5px;
    color: var(--color-on-surface-variant);
  }

  .author {
    flex: none;
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .repo-btn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--color-on-surface-variant);
    font-size: 11.5px;
    transition: color var(--dur-base) var(--ease-out);
  }
  .repo-btn:hover {
    color: var(--ink);
  }
  .repo-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dialog-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px 20px;
    overflow-y: auto;
    min-height: 0;
  }

  .plugin-desc {
    margin: 0;
    font-size: 13px;
    line-height: 1.65;
    color: var(--ink);
    overflow-wrap: anywhere;
  }

  .meta-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1px;
    margin: 0;
    border: 1px solid var(--rule);
    border-radius: 10px;
    overflow: hidden;
    background: var(--rule-soft);
  }

  .meta-grid > div {
    min-width: 0;
    padding: 9px 12px;
    background: var(--paper-raised);
  }

  .meta-grid dt {
    margin: 0;
    font-size: 10.5px;
    color: var(--color-on-surface-variant);
  }

  .meta-grid dd {
    margin: 3px 0 0;
    font-size: 12.5px;
    color: var(--ink-strong);
    overflow-wrap: anywhere;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .section-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--color-on-surface-variant);
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

  .note {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 10px;
    font-size: 12px;
    line-height: 1.55;
    overflow-wrap: anywhere;
  }

  .note :global(.msi) {
    flex: none;
    margin-top: 1px;
  }

  .note strong {
    display: block;
    font-weight: 600;
  }

  .note span {
    display: block;
  }

  .note--warn {
    background: color-mix(in oklab, var(--warn) 12%, transparent);
    color: var(--warn);
  }

  .note--info {
    background: var(--paper-sunk);
    color: var(--color-on-surface-variant);
  }

  .busy {
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

  .dialog-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 14px 20px;
    border-top: 1px solid var(--rule-soft);
  }

  .foot-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .local-note {
    font-size: 11.5px;
    color: var(--color-on-surface-variant);
  }

  @media (max-width: 560px) {
    .overlay {
      padding: 14px;
    }
    .dialog-head,
    .dialog-body,
    .dialog-foot {
      padding-left: 16px;
      padding-right: 16px;
    }
    .meta-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .dialog-foot {
      align-items: stretch;
    }
    .foot-actions {
      justify-content: flex-end;
    }
  }
</style>
