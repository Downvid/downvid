<script lang="ts">
  import { fly } from 'svelte/transition'
  import Icon from './Icon.svelte'
  import { app } from '../lib/store.svelte'

  function iconFor(kind: 'info' | 'success' | 'error'): string {
    if (kind === 'success') return 'check_circle'
    if (kind === 'error') return 'error'
    return 'info'
  }
</script>

<div class="toasts" aria-live="polite" aria-atomic="false">
  {#each app.toasts as toast (toast.id)}
    <div
      class="toast"
      class:toast--success={toast.kind === 'success'}
      class:toast--error={toast.kind === 'error'}
      role="status"
      transition:fly={{ y: 10, duration: 180 }}
    >
      <Icon name={iconFor(toast.kind)} size={16} />
      <span class="toast-text">{toast.text}</span>
      <button class="toast-close" aria-label="Dismiss" onclick={() => app.dismissToast(toast.id)}>
        <Icon name="close" size={13} />
      </button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 16px;
    bottom: 42px;
    z-index: 95;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    pointer-events: none;
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: min(520px, calc(100vw - 48px));
    padding: 9px 10px 9px 12px;
    border-radius: 8px;
    border: 1px solid color-mix(in oklab, var(--paper) 16%, transparent);
    background: var(--ink-strong);
    color: var(--color-surface);
    box-shadow: 0 10px 28px -12px color-mix(in oklab, var(--ink-strong) 70%, transparent);
    font-size: 11.5px;
    pointer-events: auto;
  }
  .toast :global(.msi) {
    color: var(--accent);
    flex: none;
  }
  .toast--success :global(.msi) {
    color: #b8d3a6;
  }
  .toast--error :global(.msi) {
    color: #ffb199;
  }
  .toast-text {
    line-height: 1.5;
  }
  .toast-close {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: color-mix(in oklab, var(--paper) 60%, transparent);
    flex: none;
  }
  .toast-close:hover {
    background: color-mix(in oklab, var(--paper) 14%, transparent);
    color: var(--paper);
  }
</style>
