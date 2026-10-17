<script lang="ts">
  import Icon from './Icon.svelte'
  import { app } from '../lib/store.svelte'
  import { t } from '../lib/i18n.svelte'
  import { parseInline, reflowMarkdown } from '../lib/markdown'
  
  const percent = $derived(
    app.updateInfo.status === 'downloading' ? Math.round(app.updateInfo.progress * 100) : 0,
  )

  /**
   * 这一版的更新内容。
   *
   * 优先用 Release notes（那是**新版本**的内容，本地 CHANGELOG 还没有），
   * 没有就退回本地 CHANGELOG 里对应版本的记录。
   */
  /**
   * 这一版的更新内容（已 token 化）。
   *
   * Release notes 与本地 CHANGELOG **都是 Markdown**，必须解析：
   * 不解析的话用户看到的是 `**修复**：...` 这种带星号的原文
   * ——那正是真机上出现的问题。
   */
  const notes = $derived.by(() => {
    const raw: string[] = []
    const releaseNotes = app.updateInfo.notes?.trim()
    if (releaseNotes) {
      // Release notes 是整段 Markdown：按行拆，去掉列表符号
      for (const line of releaseNotes.split('\n')) {
        const cleaned = line.replace(/^[-*]\s*/, '').trim()
        if (cleaned && !cleaned.startsWith('#')) raw.push(cleaned)
      }
    } else {
      const local = app.currentChangelog
      if (local) {
        for (const section of local.sections) {
          for (const item of section.items.slice(0, 3)) raw.push(item)
        }
      }
    }
    return raw.slice(0, 8).map((line) => parseInline(reflowMarkdown(line)))
  })
</script>

<div
  class="overlay"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget) app.dialog = 'none'
  }}
>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="update-title">
    <header class="dialog-head">
      <span class="dialog-icon"><Icon name="system_update" size={21} /></span>
      <div class="dialog-heading">
        <h2 id="update-title">{t('update.title')}</h2>
        <p class="num">
          {t('update.subtitle', { version: app.updateInfo.version ?? '', size: '', date: app.updateInfo.date ?? '' })}
        </p>
      </div>
      <button class="icon-btn" title={t('common.close')} aria-label={t('common.close')} onclick={() => (app.dialog = 'none')}>
        <Icon name="close" size={18} />
      </button>
    </header>

    <div class="dialog-body scroll">
      <section class="notes">
        <span class="sub-label">{t('update.notes')}</span>
        <!--
          更新内容来自后端：
            - 有 Release notes（GitHub 给的）就用它——那是**新版本**的内容
            - 没有（Gitee / 部分镜像不给 body）就退回本地 CHANGELOG 里
              该版本的记录
          早先这里固定渲染 `t('update.note1')` 三句占位话，
          用户点开更新只看到三句与真实发布无关的文案。
        -->
        {#if notes.length > 0}
          <ul>
            {#each notes as tokens, index (index)}
              <li>
                <span class="note-bullet"></span>
                <!-- 逐 token 渲染，不用 {@html}：Release notes 是外部输入 -->
                <span>
                  {#each tokens as token, tIndex (tIndex)}
                    {#if token.kind === 'strong'}
                      <strong>{token.text}</strong>
                    {:else if token.kind === 'code'}
                      <code>{token.text}</code>
                    {:else if token.kind === 'link'}
                      <span class="md-link">{token.text}</span>
                    {:else}
                      {token.text}
                    {/if}
                  {/each}
                </span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="notes-empty">{t('update.noNotes')}</p>
        {/if}
      </section>

      {#if app.updateInfo.status === 'downloading'}
        <section class="progress-block">
          <div class="progress-row">
            <span>{t('update.downloading', { percent })}</span>
            <span class="num">{percent}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="transform:scaleX({app.updateInfo.progress})"></div>
          </div>
          <p class="progress-hint">{t('about.update')} · 24.8 MB</p>
        </section>
      {:else if app.updateInfo.status === 'downloaded'}
        <section class="ready-block">
          <Icon name="download_done" size={18} />
          <div>
            <strong>{t('update.ready')}</strong>
            <p>{t('update.readyHint')}</p>
          </div>
        </section>
      {/if}
    </div>

    <footer class="dialog-foot">
      {#if app.updateInfo.status === 'downloading'}
        <span class="foot-hint">{t('update.doNotClose')} · 24.8 MB</span>
        <button class="btn btn-ghost" onclick={() => (app.dialog = 'none')}>{t('common.close')}</button>
      {:else if app.updateInfo.status === 'downloaded'}
        <button class="btn btn-ghost" onclick={() => (app.dialog = 'none')}>{t('update.later')}</button>
        <button class="btn btn-primary" onclick={() => app.installUpdate()}>
          <Icon name="restart_alt" size={16} />
          <span>{t('update.restart')}</span>
        </button>
      {:else}
        <button class="btn btn-ghost" onclick={() => (app.dialog = 'none')}>{t('update.later')}</button>
        <button class="btn btn-primary" onclick={() => app.downloadUpdate()}>
          <Icon name="download" size={16} />
          <span>{t('update.download')}</span>
        </button>
      {/if}
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
    max-height: min(80vh, 640px);
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
    font-size: 17px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--ink-strong);
  }
  .dialog-heading p {
    margin: 0;
    font-size: 10px;
    color: var(--color-on-surface-variant);
  }

  .dialog-body {
    padding: 18px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .sub-label {
    display: block;
    margin-bottom: 8px;
    font-family: var(--font-code);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-on-surface-variant);
  }
  .notes ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .notes code {
    padding: 1px 5px;
    border-radius: 4px;
    background: color-mix(in oklab, var(--accent) 10%, transparent);
    font-family: var(--font-code);
    font-size: 0.92em;
  }
  .notes strong {
    font-weight: 650;
    color: var(--ink-strong);
  }
  /* 更新弹窗里的链接不做成可点：那会让用户在「还没更新」时就跳走，
     而且 Release notes 里的相对路径在应用里点不开 */
  .md-link {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .notes li {
    display: flex;
    gap: 9px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--ink);
  }
  .note-bullet {
    width: 4px;
    height: 4px;
    margin-top: 7px;
    border-radius: 50%;
    background: var(--accent);
    flex: none;
  }

  .progress-block {
    padding: 14px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-control);
    background: var(--paper-deep);
  }
  .progress-row {
    display: flex;
    justify-content: space-between;
    font-size: 11.5px;
    color: var(--ink);
  }
  .progress-track {
    height: 4px;
    margin: 10px 0 8px;
    border-radius: 999px;
    background: var(--rule);
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: var(--accent);
    transform-origin: left center;
    transition: transform 140ms linear;
  }
  .progress-hint {
    margin: 0;
    font-size: 9.5px;
    color: var(--color-on-surface-variant);
  }

  .ready-block {
    display: flex;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid color-mix(in oklab, var(--success) 30%, transparent);
    border-radius: 8px;
    background: color-mix(in oklab, var(--success) 6%, transparent);
    color: var(--success);
  }
  .ready-block strong {
    display: block;
    font-size: 12px;
  }
  .ready-block p {
    margin: 3px 0 0;
    font-size: 10.5px;
    color: var(--color-on-surface-variant);
  }

  .dialog-foot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--rule);
    background: color-mix(in oklab, var(--paper-deep) 40%, var(--paper-raised));
  }
  .foot-hint {
    margin-right: auto;
    font-family: var(--font-code);
    font-size: 9.5px;
    color: var(--color-on-surface-variant);
  }
</style>
