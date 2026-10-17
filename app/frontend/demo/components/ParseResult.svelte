<script lang="ts">
  import Icon from './Icon.svelte'
  import { app } from '../lib/store.svelte'
  import { t } from '../lib/i18n.svelte'
  import { formatBytes, formatDuration } from '../lib/format'

  const video = $derived(app.video)
  const existing = $derived(app.alreadyDownloaded)

  const modes = $derived(
    video
      ? [
          { id: 'video' as const, label: t('mode.video'), icon: 'movie', count: video.formats.length },
          { id: 'audio' as const, label: t('mode.audio'), icon: 'music_note', count: video.audios.length },
          { id: 'subtitle' as const, label: t('mode.subtitle'), icon: 'subtitles', count: video.subtitles.length },
        ]
      : [],
  )

  function toSettings(section: 'network'): void {
    app.setTab('settings')
    app.settingsSection = section
  }
</script>

{#if video}
  <article class="result">
    <header class="result-head">
      <div class="result-thumb" style="background-image:url({video.thumbnail})">
        {#if video.duration}
          <span class="result-duration num">{formatDuration(video.duration)}</span>
        {/if}
      </div>

      <div class="result-meta">
        <div class="result-kicker">
          <span class="platform-pill">{video.platformName}</span>
          <span class="num result-host">{video.host}</span>
        </div>
        <h2 class="result-title">{video.title}</h2>
        <p class="result-sub">
          <span>{video.uploader}</span>
          <span class="sep">·</span>
          <span class="num">{formatDuration(video.duration)}</span>
          <span class="sep">·</span>
          <span>{t('result.formats', { count: video.formats.length })}</span>
        </p>
      </div>

      <button class="icon-btn" onclick={() => app.clearResult()} title={t('result.clear')} aria-label={t('result.clear')}>
        <Icon name="close" size={18} />
      </button>
    </header>

    {#if existing}
      <div class="dedupe-note">
        <Icon name="check_circle" size={16} />
        <span>{t('result.already')}</span>
        <button class="link-btn" onclick={() => app.setTab('history')}>
          {t('result.openHistory')}
          <Icon name="arrow_forward" size={12} />
        </button>
      </div>
    {/if}

    {#if video.needsCookies}
      <div class="cookie-note">
        <Icon name="cookie" size={15} />
        <span>{t('format.cookieNote')}</span>
        <button class="link-btn" onclick={() => toSettings('network')}>
          {t('format.cookieAction')}
          <Icon name="north_east" size={12} />
        </button>
      </div>
    {/if}

    <div class="modes" role="tablist" aria-label={t('result.eyebrow')}>
      {#each modes as mode (mode.id)}
        <button
          class="mode"
          class:is-active={app.mode === mode.id}
          role="tab"
          aria-selected={app.mode === mode.id}
          onclick={() => app.setMode(mode.id)}
        >
          <Icon name={mode.icon} size={16} />
          <span>{mode.label}</span>
          <span class="mode-count num">{mode.count}</span>
        </button>
      {/each}
    </div>

    <div class="format-body">
      {#if app.mode === 'video'}
        <div class="format-grid" role="radiogroup" aria-label={t('mode.video')}>
          {#each video.formats as format (format.id)}
            <button
              class="format-card"
              class:is-selected={app.selectedFormatId === format.id}
              role="radio"
              aria-checked={app.selectedFormatId === format.id}
              onclick={() => app.selectFormat(format.id)}
            >
              <span class="format-card-head">
                <span class="radio" class:radio--on={app.selectedFormatId === format.id}></span>
                <span class="format-quality">{format.label}</span>
                {#if format.recommended}
                  <span class="format-badge">{t('format.recommended')}</span>
                {/if}
              </span>
              <span class="format-card-meta">
                <span class="format-size num">{formatBytes(format.sizeBytes)}</span>
                <span class="format-tags">
                  {#if format.fps}
                    <span class="format-tag num">{t('format.fps', { fps: format.fps })}</span>
                  {/if}
                  {#if format.codec}
                    <span class="format-tag">{format.codec}</span>
                  {/if}
                </span>
              </span>
            </button>
          {/each}
        </div>
      {:else if app.mode === 'audio'}
        {#if video.tracks.length > 0}
          <div class="audio-track-row">
            <span class="sub-label">{t('audio.track')}</span>
            {#each video.tracks as track (track.id)}
              <button
                class="chip"
                class:chip--active={app.selectedTrackId === track.id}
                onclick={() => app.selectTrack(track.id)}
              >{track.name}</button>
            {/each}
          </div>
        {/if}

        {#if video.audios.length > 0}
          <div class="format-grid format-grid--three" role="radiogroup" aria-label={t('audio.title')}>
            {#each video.audios as audio (audio.id)}
              <button
                class="format-card"
                class:is-selected={app.selectedAudioId === audio.id}
                role="radio"
                aria-checked={app.selectedAudioId === audio.id}
                onclick={() => app.selectAudio(audio.id)}
              >
                <span class="format-card-head">
                  <span class="radio" class:radio--on={app.selectedAudioId === audio.id}></span>
                  <span class="format-quality">{audio.label}</span>
                </span>
                <span class="format-card-meta">
                  <span class="format-size num">{formatBytes(audio.sizeBytes)}</span>
                  <span class="format-tags">
                    <span class="format-tag num">{t('audio.bitrate', { kbps: audio.kbps })}</span>
                    {#if audio.codec}<span class="format-tag">{audio.codec}</span>{/if}
                  </span>
                </span>
              </button>
            {/each}
          </div>
        {:else}
          <p class="format-empty">{t('audio.empty')}</p>
        {/if}
      {:else}
        {#if video.subtitles.length > 0}
          <div class="format-grid format-grid--three">
            {#each video.subtitles as subtitle (subtitle.id)}
              <label class="format-card format-card--check" class:is-selected={app.subtitles.includes(subtitle.lang)}>
                <span class="format-card-head">
                  <span class="checkbox" class:checkbox--on={app.subtitles.includes(subtitle.lang)}>
                    <Icon name="check" size={12} />
                  </span>
                  <span class="format-quality">{subtitle.name}</span>
                </span>
                <span class="format-card-meta">
                  <span class="format-tag num">{subtitle.ext}</span>
                  {#if subtitle.auto}
                    <span class="format-tag">{t('subtitle.auto')}</span>
                  {/if}
                </span>
                <input
                  type="checkbox"
                  class="sr-only"
                  checked={app.subtitles.includes(subtitle.lang)}
                  onchange={() => app.toggleSubtitle(subtitle.lang)}
                />
              </label>
            {/each}
          </div>
          <p class="format-note">
            <Icon name="info" size={13} />
            <span>{t('subtitle.note')}</span>
          </p>
        {:else}
          <p class="format-empty">{t('subtitle.empty')}</p>
        {/if}
      {/if}
    </div>

    <footer class="result-foot">
      {#if existing}
        <div class="summary">
          <span class="summary-label">{t('result.alreadyHint')}</span>
          <span class="summary-path num">{existing.filePath}</span>
        </div>
        <button class="btn btn-ghost btn-lg download-btn" onclick={() => app.setTab('history')}>
          <Icon name="history" size={18} />
          <span>{t('result.openHistory')}</span>
        </button>
      {:else}
        <div class="summary">
          <span class="summary-label">{app.canDownload ? app.selectionSummary : app.selectionHint}</span>
          <span class="summary-path num">{t('format.downloadTo')} {app.settings.downloadDir}</span>
        </div>
        <button class="btn btn-primary btn-lg download-btn" disabled={!app.canDownload} onclick={() => app.addDownload()}>
          <Icon name="download" size={18} />
          <span>{t('format.download')}</span>
        </button>
      {/if}
    </footer>
  </article>
{/if}

<style>
  .result {
    border: 1px solid var(--rule);
    border-radius: var(--radius-panel);
    background: var(--paper-raised);
    box-shadow: var(--shadow-sheet);
    overflow: hidden;
  }

  /* ---------- 头部 ---------- */
  .result-head {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    padding: 18px 18px 16px;
  }
  .result-thumb {
    width: 168px;
    height: 94px;
    flex: none;
    border-radius: var(--radius-media);
    border: 1px solid var(--rule);
    background-color: var(--paper-sunk);
    background-size: cover;
    background-position: center;
    position: relative;
    overflow: hidden;
  }
  .result-duration {
    position: absolute;
    right: 6px;
    bottom: 6px;
    padding: 2px 5px;
    border-radius: 4px;
    background: color-mix(in oklab, var(--ink-strong) 82%, transparent);
    color: var(--paper);
    font-size: 10px;
    line-height: 1.4;
  }
  .result-meta {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    flex: 1;
    padding-top: 2px;
  }
  .result-kicker {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .platform-pill {
    height: 20px;
    display: inline-flex;
    align-items: center;
    padding: 0 8px;
    border-radius: 4px;
    background: color-mix(in oklab, var(--accent) 14%, transparent);
    color: var(--accent-deep);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .result-host {
    font-size: 10px;
    color: var(--color-on-surface-variant);
  }
  .result-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 700;
    line-height: 1.32;
    letter-spacing: -0.025em;
    color: var(--ink-strong);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .result-sub {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    color: var(--color-on-surface-variant);
  }
  .result-sub .sep {
    opacity: 0.45;
  }

  .cookie-note,
  .dedupe-note {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 18px;
    padding: 9px 12px;
    border: 1px solid color-mix(in oklab, var(--accent-deep) 22%, transparent);
    border-radius: var(--radius-control);
    background: var(--accent-wash);
    color: var(--accent-deep);
    font-size: 11.5px;
    line-height: 1.5;
  }
  .dedupe-note {
    margin-bottom: 12px;
  }
  .dedupe-note span {
    flex: 1;
    min-width: 0;
  }
  .cookie-note span {
    flex: 1;
    min-width: 0;
  }

  .link-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-deep);
    font: inherit;
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 2px;
    text-decoration-color: color-mix(in oklab, var(--accent-deep) 35%, transparent);
    white-space: nowrap;
  }
  .link-btn:hover {
    text-decoration-color: currentColor;
  }

  /* ---------- 模式切换 ---------- */
  .modes {
    display: flex;
    align-items: center;
    gap: 22px;
    padding: 0 18px;
    border-bottom: 1px solid var(--rule);
  }
  .mode {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 40px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-on-surface-variant);
    font-family: var(--font-ui);
    font-size: 12.5px;
    font-weight: 600;
    transition: color var(--dur-base) var(--ease-out);
  }
  .mode:hover {
    color: var(--ink);
  }
  .mode.is-active {
    color: var(--ink-strong);
  }
  .mode.is-active::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 2px;
    background: var(--accent);
  }
  .mode-count {
    font-size: 9.5px;
    color: var(--color-on-surface-variant);
    background: color-mix(in oklab, var(--color-on-surface) 6%, transparent);
    border-radius: 999px;
    padding: 1px 6px;
  }
  .mode.is-active .mode-count {
    background: var(--accent-wash);
    color: var(--accent-deep);
  }

  /* ---------- 格式卡片网格（不内部滚动） ---------- */
  .format-body {
    padding: 14px 18px 18px;
  }
  .format-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }
  .format-grid--three {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .format-card {
    display: flex;
    flex-direction: column;
    gap: 9px;
    min-width: 0;
    padding: 10px 11px;
    border: 1px solid var(--rule);
    border-radius: 8px;
    background: var(--paper-raised);
    text-align: left;
    font-family: var(--font-ui);
    transition:
      border-color var(--dur-base) var(--ease-out),
      background-color var(--dur-base) var(--ease-out),
      box-shadow var(--dur-base) var(--ease-out);
  }
  .format-card:hover {
    border-color: color-mix(in oklab, var(--accent-deep) 38%, transparent);
    background: color-mix(in oklab, var(--accent-wash) 35%, var(--paper-raised));
  }
  .format-card.is-selected {
    border-color: color-mix(in oklab, var(--accent-deep) 62%, transparent);
    background: var(--accent-wash);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent-deep) 18%, transparent);
  }
  .format-card--check {
    cursor: pointer;
  }

  .format-card-head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    min-width: 0;
  }
  .format-quality {
    font-size: 12.5px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--ink-strong);
    white-space: nowrap;
  }
  .format-card-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    flex-wrap: wrap;
  }
  .format-size {
    font-size: 11px;
    color: var(--color-on-surface-variant);
  }
  .format-tags {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }
  .format-tag {
    font-size: 9px;
    color: var(--color-on-surface-variant);
    border: 1px solid var(--rule);
    border-radius: 3px;
    padding: 0 4px;
    line-height: 14px;
    white-space: nowrap;
  }
  .format-badge {
    margin-left: auto;
    font-size: 8.5px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--accent-deep);
    background: color-mix(in oklab, var(--accent) 18%, transparent);
    border-radius: 3px;
    padding: 1px 5px;
    white-space: nowrap;
  }

  .radio {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1.5px solid var(--rule-strong);
    position: relative;
    flex: none;
  }
  .radio--on {
    border-color: var(--accent-deep);
  }
  .radio--on::after {
    content: '';
    position: absolute;
    inset: 2.5px;
    border-radius: 50%;
    background: var(--accent-deep);
  }
  .checkbox {
    display: grid;
    place-items: center;
    width: 15px;
    height: 15px;
    border-radius: 3px;
    border: 1.5px solid var(--rule-strong);
    color: transparent;
    flex: none;
  }
  .checkbox--on {
    background: var(--accent-deep);
    border-color: var(--accent-deep);
    color: var(--paper);
  }

  .audio-track-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 12px;
  }
  .sub-label {
    font-family: var(--font-code);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-on-surface-variant);
    margin-right: 4px;
  }

  .format-note {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 12px 0 0;
    color: var(--color-on-surface-variant);
    font-size: 11px;
  }
  .format-empty {
    margin: 0;
    padding: 22px 0;
    text-align: center;
    color: var(--color-on-surface-variant);
    font-size: 12px;
  }

  /* ---------- 底部 ---------- */
  .result-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 18px;
    border-top: 1px solid var(--rule);
    background: color-mix(in oklab, var(--paper-deep) 40%, var(--paper-raised));
  }
  .summary {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .summary-label {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ink-strong);
  }
  .summary-path {
    font-size: 9.5px;
    color: var(--color-on-surface-variant);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .download-btn {
    flex: none;
    min-width: 150px;
  }

  @media (max-width: 720px) {
    .format-grid,
    .format-grid--three {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .result-thumb {
      width: 120px;
      height: 68px;
    }
    .result-foot {
      flex-direction: column;
      align-items: stretch;
    }
    .download-btn {
      width: 100%;
    }
  }
</style>
