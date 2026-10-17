<script lang="ts">
  import Icon from './Icon.svelte'
  import { app } from '../lib/store.svelte'
  import { t } from '../lib/i18n.svelte'

  const activeStage = $derived(Math.min(app.parseStage, 2))
  const stages = $derived([t('parsing.stage1'), t('parsing.stage2'), t('parsing.stage3')])
  const host = $derived(hostOf(app.url))

  function hostOf(url: string): string {
    try {
      return new URL(url).hostname
    } catch {
      return url
    }
  }
</script>

<section class="parse-panel sheet">
  <div class="parse-head">
    <span class="parse-host num">{host}</span>
    <span class="dot dot--live"></span>
    <span class="parse-elapsed num">{t('parsing.elapsed', { seconds: app.parseElapsed })}</span>
    <span class="grow"></span>
    <button class="icon-btn" onclick={() => app.cancelParse()} title={t('capture.cancel')}>
      <Icon name="close" size={17} />
    </button>
  </div>

  <div class="scan-track scan-line">
    <div class="scan-progress" style="transform: scaleX({(activeStage + 1) / 3})"></div>
  </div>

  <ol class="stages">
    {#each stages as stage, index (stage)}
      <li class:is-done={index < activeStage} class:is-active={index === activeStage}>
        <span class="stage-index num">{String(index + 1).padStart(2, '0')}</span>
        <span class="stage-name">{stage}</span>
        <span class="stage-mark">
          {#if index < activeStage}
            <Icon name="check" size={15} />
          {:else if index === activeStage}
            <Icon name="progress_activity" size={15} class="spin" />
          {:else}
            <span class="stage-pending"></span>
          {/if}
        </span>
      </li>
    {/each}
  </ol>

  <p class="parse-hint">{t('parsing.hint')}</p>
</section>

<style>
  .parse-panel {
    padding: 18px 20px 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .grow {
    flex: 1;
  }

  .parse-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .parse-host {
    font-size: 11.5px;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .parse-elapsed {
    font-size: 10.5px;
    color: var(--color-on-surface-variant);
  }

  .scan-track {
    position: relative;
    height: 2px;
    border-radius: 2px;
    background: var(--rule-soft);
  }
  .scan-progress {
    position: absolute;
    inset: 0;
    background: var(--accent);
    transform-origin: left center;
    transition: transform 600ms var(--ease-out);
  }

  .stages {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .stages li {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 34px;
    padding: 0 4px;
    color: var(--color-on-surface-variant);
    font-size: 12.5px;
    border-radius: 6px;
  }
  .stages li.is-active {
    color: var(--ink-strong);
  }
  .stages li.is-done {
    color: var(--color-on-surface-variant);
  }
  .stage-index {
    font-size: 10px;
    color: color-mix(in oklab, var(--color-on-surface-variant) 70%, transparent);
    width: 18px;
  }
  .stage-name {
    flex: 1;
  }
  .stage-mark {
    display: grid;
    place-items: center;
    width: 20px;
    color: var(--accent-deep);
  }
  .stage-pending {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--rule-strong);
  }

  .parse-hint {
    margin: 0;
    font-size: 11.5px;
    color: var(--color-on-surface-variant);
    line-height: 1.6;
  }
</style>
