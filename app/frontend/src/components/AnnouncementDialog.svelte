<script lang="ts">
  // 演示用打包内置的 author.md；真实接入换成 fetchAnnouncement(locale)：
  // GitHub raw → jsDelivr → gh-proxy → 本地兜底（见 lib/announcement.ts）。
  import Icon from './Icon.svelte'
  import GitHubIcon from './GitHubIcon.svelte'
  import { app } from '../lib/store.svelte'
  import { getLocale, t } from '../lib/i18n.svelte'
  import { loadLocalAnnouncement } from '../lib/announcement'
  import { REPO_URL } from '../lib/constants'

  const doc = $derived(loadLocalAnnouncement(getLocale()))

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
