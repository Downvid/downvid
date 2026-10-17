<script lang="ts">
  import Icon from './Icon.svelte'
  import { app } from '../lib/store.svelte'
  import { t } from '../lib/i18n.svelte'

  const missing = $derived(app.missingRequiredDeps.map((dep) => dep.name).join(', '))
  const percent = $derived(Math.round(app.depsPromptProgress * 100))
</script>

<div
  class="overlay"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget && !app.depsPromptBusy) app.dialog = 'none'
  }}
>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="deps-title">
    <div class="dialog-icon"><Icon name="terminal" size={22} /></div>
    <div class="dialog-body">
      <h2 id="deps-title">{t('depsPrompt.title')}</h2>
      <p class="deps-tools num">{t('depsPrompt.body', { tools: missing })}</p>
      <p class="deps-hint">{t('depsPrompt.hint')}</p>

      {#if app.depsPromptBusy}
        <div class="dep-progress">
          <div class="progress-track">
            <div class="progress-fill" style="transform:scaleX({app.depsPromptProgress})"></div>
          </div>
          <span class="num">{percent}%</span>
        </div>
      {/if}
    </div>
    <footer class="dialog-foot">
      <button class="btn btn-ghost" disabled={app.depsPromptBusy} onclick={() => (app.dialog = 'none')}>
        {t('depsPrompt.later')}
      </button>
      <button class="btn btn-primary" disabled={app.depsPromptBusy} onclick={() => app.downloadPromptDeps()}>
        <Icon name="cloud_download" size={16} />
        <span>{t('depsPrompt.download')}</span>
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
    width: min(460px, 100%);
    border: 1px solid var(--rule);
    border-radius: var(--radius-panel);
    background: var(--paper-raised);
    box-shadow: var(--shadow-pop);
    overflow: hidden;
    animation: rise-in var(--dur-slow) var(--ease-out);
  }
  .dialog-icon {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin: 20px 20px 0;
    border-radius: var(--radius-media);
    background: var(--accent-wash);
    color: var(--accent-deep);
  }
  .dialog-body {
    padding: 14px 20px 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 17px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--ink-strong);
  }
  .deps-tools {
    margin: 0;
    font-size: 12px;
    color: var(--danger);
  }
  .deps-hint {
    margin: 0;
    font-size: 11.5px;
    line-height: 1.65;
    color: var(--color-on-surface-variant);
  }
  .dep-progress {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 6px;
  }
  .progress-track {
    flex: 1;
    height: 4px;
    border-radius: 999px;
    background: var(--rule);
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: var(--accent);
    transform-origin: left center;
    transition: transform 120ms linear;
  }
  .dep-progress span {
    font-size: 10px;
    color: var(--color-on-surface-variant);
  }
  .dialog-foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 20px;
    border-top: 1px solid var(--rule);
    background: color-mix(in oklab, var(--paper-deep) 40%, var(--paper-raised));
  }
</style>
