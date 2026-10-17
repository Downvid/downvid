<script lang="ts">
  import Icon from './Icon.svelte'
  import { app } from '../lib/store.svelte'
  import { t } from '../lib/i18n.svelte'
  import { SAMPLE_URL } from '../lib/mock'

  let { compact = false }: { compact?: boolean } = $props()

  let inputEl = $state<HTMLInputElement | null>(null)
  let pasting = $state(false)

  async function paste(): Promise<void> {
    if (pasting) return
    pasting = true
    try {
      const text = await navigator.clipboard.readText()
      if (text.trim()) {
        app.url = text.trim()
        inputEl?.focus()
      } else {
        app.toast(t('toast.parseFirst'), 'error')
      }
    } catch {
      // 浏览器没给剪贴板权限时，填一条示例，保证预览能继续
      app.url = SAMPLE_URL
      inputEl?.focus()
    } finally {
      pasting = false
    }
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault()
      app.parse()
    }
  }
</script>

<form
  class="capture"
  class:capture--compact={compact}
  onsubmit={(event) => {
    event.preventDefault()
    app.parse()
  }}
>
  <span class="capture-icon">
    <Icon name="link" size={compact ? 18 : 20} />
  </span>

  <input
    bind:this={inputEl}
    class="capture-input"
    value={app.url}
    oninput={(event) => (app.url = (event.target as HTMLInputElement).value)}
    onkeydown={onkeydown}
    placeholder={t('capture.placeholder')}
    aria-label={t('capture.url')}
    spellcheck="false"
    autocomplete="off"
  />

  <div class="capture-actions">
    {#if !compact}
      <button type="button" class="btn btn-quiet btn-sm capture-paste" onclick={paste} disabled={pasting}>
        <Icon name="content_paste" size={15} />
        <span>{t('capture.paste')}</span>
      </button>
    {/if}
    <button type="submit" class="btn btn-primary" class:btn-lg={!compact} disabled={app.parseState === 'parsing'}>
      {#if app.parseState === 'parsing'}
        <Icon name="progress_activity" size={16} class="spin" />
      {:else}
        <Icon name="bolt" size={16} />
      {/if}
      <span>{app.parseState === 'parsing' ? t('capture.parsing') : t('capture.parse')}</span>
    </button>
  </div>
</form>

<style>
  .capture {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 64px;
    padding: 0 12px 0 18px;
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius-panel);
    background: var(--paper-raised);
    box-shadow: var(--shadow-lift);
    transition:
      border-color var(--dur-base) var(--ease-out),
      box-shadow var(--dur-base) var(--ease-out);
  }
  .capture:focus-within {
    border-color: color-mix(in oklab, var(--accent-deep) 55%, transparent);
    box-shadow:
      0 0 0 3px color-mix(in oklab, var(--accent) 16%, transparent),
      var(--shadow-lift);
  }
  .capture--compact {
    height: 48px;
    padding-left: 14px;
    border-color: var(--rule);
    box-shadow: none;
    border-radius: var(--radius-control);
  }

  .capture-icon {
    display: grid;
    place-items: center;
    color: var(--accent-deep);
    flex: none;
  }

  .capture-input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    background: transparent;
    color: var(--ink-strong);
    font-family: var(--font-code);
    font-size: 13px;
    letter-spacing: -0.01em;
  }
  .capture-input::placeholder {
    color: color-mix(in oklab, var(--color-on-surface-variant) 68%, transparent);
    font-family: var(--font-ui);
    font-size: 14px;
    letter-spacing: 0;
  }
  .capture-input:focus {
    outline: none;
  }

  .capture-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
  }
  .capture-paste {
    color: var(--color-on-surface-variant);
  }

  .btn-lg {
    height: 44px;
    padding: 0 20px;
    font-size: 13.5px;
  }

  @media (max-width: 720px) {
    .capture-paste {
      display: none;
    }
  }
</style>
