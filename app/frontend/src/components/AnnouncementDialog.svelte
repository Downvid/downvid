<script lang="ts">
  /**
   * 「作者的话」。
   *
   * 正文由 store 提供：**优先远端**（GitHub raw → jsDelivr → gh-proxy
   * 三级镜像降级），全失败才用打包内置的那份。
   *
   * 早先这里写的是 `loadLocalAnnouncement()` —— 只读本地文件。
   * `fetchAnnouncement()` 早就写好了却从没被调用过，于是作者更新了
   * 公告用户也永远看不到，界面上一直是打包那天的内容。
   */
  import Icon from './Icon.svelte'
  import GitHubIcon from './GitHubIcon.svelte'
  import { app } from '../lib/store.svelte'
  import { getLocale, t } from '../lib/i18n.svelte'
  import { loadLocalAnnouncement } from '../lib/announcement'
  import { REPO_URL } from '../lib/constants'

  // store 里没有时（比如直接从 URL 打开对话框）退回本地，保证总有内容
  const doc = $derived(app.announcement ?? loadLocalAnnouncement(getLocale()))

  function openRepo(): void {
    window.open(REPO_URL, '_blank', 'noopener')
  }
</script>

<div
  class="overlay"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget) app.dialog = 'none'
  }}
>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="announcement-title">
    <header class="dialog-head">
      <span class="dialog-icon"><Icon name="campaign" size={21} /></span>
      <div class="dialog-heading">
        <h2 id="announcement-title">{doc.title}</h2>
        <p class="num">
          {doc.date}{#if doc.signature} · {doc.signature}{/if}
          <!--
            如实标出内容来源。用户看到「离线副本」时能自己判断
            「作者可能更新了但我这边网络不通」，而不是以为作者没写新的。
          -->
          {#if app.announcementSource === 'local'}
            <span class="source-badge">{t('announcement.offline')}</span>
          {:else if app.announcementSource === 'loading'}
            <span class="source-badge">{t('announcement.loading')}</span>
          {/if}
        </p>
      </div>
      <button
        class="icon-btn"
        title={t('common.close')}
        aria-label={t('common.close')}
        onclick={() => (app.dialog = 'none')}
      >
        <Icon name="close" size={18} />
      </button>
    </header>

    <div class="dialog-body scroll">
      {#each doc.blocks as block, index (index)}
        {#if block.type === 'h2'}
          <h3>{block.text}</h3>
        {:else if block.type === 'li'}
          <div class="list-item">
            <span class="bullet"></span>
            <span>{block.text}</span>
          </div>
        {:else}
          <p>{block.text}</p>
        {/if}
      {/each}
    </div>

    <footer class="dialog-foot">
      <button class="btn btn-ghost" onclick={() => (app.dialog = 'none')}>
        {t('announcement.close')}
      </button>
      <button class="btn btn-primary" onclick={openRepo}>
        <GitHubIcon size={15} />
        <span>{t('announcement.repo')}</span>
      </button>
    </footer>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 70;
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--scrim);
    animation: fade-in var(--dur-base) var(--ease-out);
  }
  .dialog {
    width: min(520px, 100%);
    max-height: min(82vh, 660px);
    display: flex;
    flex-direction: column;
    border: 1px solid var(--rule);
    border-radius: var(--radius-panel);
    background: var(--paper-raised);
    box-shadow: var(--shadow-pop);
    animation: rise-in var(--dur-slow) var(--ease-out);
    overflow: hidden;
  }

  .dialog-head {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 18px 18px 14px;
    border-bottom: 1px solid var(--rule);
  }
  .dialog-icon {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    flex: none;
    border-radius: var(--radius-control);
    background: var(--accent-wash);
    color: var(--accent-deep);
  }
  .dialog-heading {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding-top: 2px;
  }
  .dialog-heading h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.025em;
    color: var(--ink-strong);
  }
  .source-badge {
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 999px;
    background: color-mix(in oklab, var(--accent) 12%, transparent);
    font-size: 9px;
    color: var(--accent-deep);
  }

  .dialog-heading p {
    margin: 0;
    font-size: 9.5px;
    color: var(--color-on-surface-variant);
  }

  .dialog-body {
    padding: 18px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 11px;
  }
  .dialog-body p {
    margin: 0;
    font-size: 12px;
    line-height: 1.75;
    color: var(--ink);
  }
  .dialog-body h3 {
    margin: 5px 0 -2px;
    font-family: var(--font-code);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-on-surface-variant);
  }
  .list-item {
    display: flex;
    gap: 9px;
    font-size: 11.5px;
    line-height: 1.65;
    color: var(--color-on-surface-variant);
  }
  .bullet {
    width: 4px;
    height: 4px;
    margin-top: 7px;
    border-radius: 50%;
    background: var(--accent);
    flex: none;
  }

  .dialog-foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--rule);
    background: color-mix(in oklab, var(--paper-deep) 40%, var(--paper-raised));
  }
</style>
