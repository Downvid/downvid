<script lang="ts">
  import Icon from './Icon.svelte'
  import { app } from '../lib/store.svelte'
  import { t } from '../lib/i18n.svelte'

  // 危险操作（删历史 / 清空）统一走这个弹窗：明确标题、后果说明、取消与确认。
  // 点背景、按 Esc、点取消都能退出；点确认才真删。
  const c = $derived(app.confirm)
</script>

{#if c}
  <div
    class="overlay"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) app.closeConfirm()
    }}
  >
    <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
      <header class="dialog-head">
        <span class="badge"><Icon name="delete_forever" size={18} /></span>
        <div class="head-copy">
          <h2 id="confirm-title">{c.title}</h2>
          <p>{c.message}</p>
        </div>
      </header>

      <footer class="dialog-foot">
        <button type="button" class="btn btn-ghost" onclick={() => app.closeConfirm()}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          class="btn btn-danger"
          onclick={() => {
            const action = c.action
            app.closeConfirm()
            action()
          }}
        >
          {c.confirmLabel}
        </button>
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
    width: min(420px, 100%);
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 20px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-card);
    background: var(--paper-raised);
    box-shadow: 0 18px 48px color-mix(in oklab, var(--ink) 22%, transparent);
    animation: dialog-in var(--dur-base) var(--ease-out);
  }
  .dialog-head {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  .badge {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    flex: none;
    border-radius: var(--radius-control);
    background: color-mix(in oklab, var(--danger) 12%, transparent);
    color: var(--danger);
  }
  .head-copy {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .head-copy h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 14.5px;
    font-weight: 700;
    letter-spacing: -0.015em;
    color: var(--ink-strong);
  }
  .head-copy p {
    margin: 0;
    font-size: 11.5px;
    line-height: 1.6;
    color: var(--color-on-surface-variant);
  }
  .dialog-foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .btn-danger {
    background: var(--danger);
    border-color: var(--danger);
    color: #fff;
  }
  .btn-danger:hover:not(:disabled) {
    background: color-mix(in oklab, var(--danger) 86%, black);
  }
  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
  @keyframes dialog-in {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.985);
    }
  }
</style>
