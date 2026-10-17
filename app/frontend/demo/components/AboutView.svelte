<script lang="ts">
  import Icon from './Icon.svelte'
  import logo from '../assets/logo.png'
  import { app } from '../lib/store.svelte'
  import { t } from '../lib/i18n.svelte'
  import { APP_VERSION, NEXT_VERSION, REPO_URL, WEBSITE_URL } from '../lib/mock'

  const ISSUES_URL = REPO_URL + '/issues/new'
  const LICENSE_URL = REPO_URL + '/blob/main/LICENSE'
  const year = new Date().getFullYear()

  const checking = $derived(app.update.status === 'checking')
  const available = $derived(app.update.status === 'available')

  const updateLabel = $derived(
    checking
      ? t('settings.checking')
      : available
        ? t('about.updateAvailable', { version: NEXT_VERSION })
        : t('about.update'),
  )

  const notes = $derived([t('update.note1'), t('update.note2'), t('update.note3')])
  const tech = $derived(t('about.techValue').split(' · '))

  const links = $derived([
    {
      id: 'feedback',
      icon: 'bug_report',
      title: t('about.feedback'),
      hint: t('about.feedbackHint'),
      url: ISSUES_URL,
    },
    {
      id: 'website',
      icon: 'public',
      title: t('about.website'),
      hint: t('about.websiteHint'),
      url: WEBSITE_URL,
    },
    {
      id: 'repo',
      icon: 'code',
      title: t('about.repo'),
      hint: t('about.repoHint'),
      url: REPO_URL,
    },
    {
      id: 'license',
      icon: 'gavel',
      title: t('about.license'),
      hint: t('about.licenseValue'),
      url: LICENSE_URL,
    },
  ])

  function openExternal(url: string): void {
    window.open(url, '_blank', 'noopener')
  }

  function onUpdateClick(): void {
    if (available) app.openUpdateDialog()
    else void app.checkUpdate()
  }

  function onDonate(): void {
    app.toast(t('about.donateHint'))
  }
</script>

<div class="about-view">
  <header class="page-head">
    <span class="eyebrow">{t('about.eyebrow')}</span>
    <h1 class="page-title">{t('about.title')}</h1>
    <p class="page-sub">{t('about.tagline')}</p>
  </header>

  <div class="top-grid">
    <section class="sheet identity">
      <div class="identity-head">
        <img class="identity-logo" src={logo} alt="DownVid" />
        <div class="identity-id">
          <span class="identity-name">DownVid</span>
          <span class="identity-meta num">{t('about.version')} v{APP_VERSION}</span>
        </div>
      </div>

      <p class="identity-intro">{t('about.intro')}</p>

      <div class="identity-foot">
        <span class="identity-build num">
          <span class="meta-label">{t('about.build')}</span>
          {t('about.buildValue')}
        </span>
        <button
          type="button"
          class="btn btn-sm update-btn"
          class:btn-primary={available}
          class:btn-ghost={!available}
          disabled={checking}
          onclick={onUpdateClick}
        >
          {#if checking}
            <Icon name="refresh" size={15} class="spin" />
          {:else if available}
            <Icon name="system_update" size={15} />
          {:else}
            <Icon name="update" size={15} />
          {/if}
          <span aria-live="polite">{updateLabel}</span>
        </button>
      </div>
    </section>

    <section class="sheet changelog">
      <div class="card-head">
        <span class="card-title">{t('about.changelog')}</span>
        <span class="card-version num">v{NEXT_VERSION}</span>
      </div>
      <ol class="notes">
        {#each notes as note, index (index)}
          <li class="note">
            <span class="note-index num">{String(index + 1).padStart(2, '0')}</span>
            <span class="note-text">{note}</span>
          </li>
        {/each}
      </ol>
    </section>
  </div>

  <section class="links-section">
    <div class="section-head">
      <span class="section-label">{t('about.links')}</span>
      <span class="section-rule"></span>
    </div>
    <div class="links-grid">
      {#each links as link (link.id)}
        <button type="button" class="link-card" onclick={() => openExternal(link.url)}>
          <span class="link-icon"><Icon name={link.icon} size={16} /></span>
          <span class="link-arrow"><Icon name="north_east" size={13} /></span>
          <span class="link-title">{link.title}</span>
          <span class="link-hint">{link.hint}</span>
        </button>
      {/each}
    </div>
  </section>

  <section class="meta-row">
    <div class="meta-tech">
      <span class="meta-label">{t('about.tech')}</span>
      <div class="tech-chips">
        {#each tech as name (name)}
          <span class="chip num">{name}</span>
        {/each}
      </div>
    </div>

    <button type="button" class="donate-link" onclick={onDonate}>
      <Icon name="favorite" size={14} />
      <span>{t('about.donate')}</span>
    </button>
  </section>

  <footer class="page-foot">
    <span class="num">© {year} DownVid</span>
    <span class="num">{t('about.licenseValue')}</span>
  </footer>
</div>

<style>
  .about-view {
    max-width: 1000px;
    margin: 0 auto;
  }

  /* ---------- 页头：与历史 / 设置页同一套尺度 ---------- */
  .page-head {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin-bottom: 18px;
  }
  .page-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 30px;
    font-weight: 700;
    letter-spacing: -0.035em;
    line-height: 1.1;
    color: var(--ink-strong);
  }
  .page-sub {
    margin: 0;
    font-size: 12.5px;
    color: var(--color-on-surface-variant);
  }

  /* ---------- 上排：身份 + 更新日志，等高 ---------- */
  .top-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
    gap: 14px;
    align-items: stretch;
  }
  .top-grid > .sheet {
    display: flex;
    flex-direction: column;
    padding: 20px;
  }

  .identity {
    gap: 14px;
  }
  .identity-head {
    display: flex;
    align-items: center;
    gap: 13px;
  }
  .identity-logo {
    display: block;
    width: 52px;
    height: 52px;
    flex: none;
    border-radius: 12px;
    box-shadow: 0 0 0 1px var(--rule);
  }
  .identity-id {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .identity-name {
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.03em;
    line-height: 1.1;
    color: var(--ink-strong);
  }
  .identity-meta {
    font-size: 9.5px;
    color: var(--color-on-surface-variant);
  }
  .identity-intro {
    margin: 0;
    font-size: 11.5px;
    line-height: 1.72;
    color: var(--color-on-surface-variant);
  }
  .identity-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: auto;
    padding-top: 14px;
    border-top: 1px solid var(--rule-soft);
  }
  .identity-build {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 9.5px;
    color: var(--color-on-surface-variant);
    min-width: 0;
  }
  .identity-build .meta-label {
    margin: 0;
  }
  .update-btn {
    flex: none;
  }

  .changelog {
    gap: 4px;
  }
  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 11px;
    border-bottom: 1px solid var(--rule-soft);
  }
  .card-title {
    font-family: var(--font-code);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-on-surface-variant);
  }
  .card-version {
    font-size: 9.5px;
    color: var(--color-on-surface-variant);
    border: 1px solid var(--rule);
    border-radius: 4px;
    padding: 1px 6px;
  }
  .notes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .note {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr);
    gap: 10px;
    padding: 9px 0;
    border-top: 1px solid var(--rule-soft);
  }
  .note:first-child {
    border-top: 0;
    padding-top: 12px;
  }
  .note:last-child {
    padding-bottom: 2px;
  }
  .note-index {
    font-size: 9px;
    line-height: 1.75;
    color: color-mix(in oklab, var(--accent-deep) 80%, transparent);
  }
  .note-text {
    font-size: 11px;
    line-height: 1.65;
    color: var(--color-on-surface-variant);
  }

  /* ---------- 链接：四列等宽 ---------- */
  .links-section {
    margin-top: 24px;
  }
  .section-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
  }
  .section-label {
    font-family: var(--font-code);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-on-surface-variant);
  }
  .section-rule {
    flex: 1;
    height: 1px;
    background: var(--rule);
  }
  .links-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
  }
  .link-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-height: 96px;
    padding: 13px 14px;
    border: 1px solid var(--rule);
    border-radius: 9px;
    background: var(--paper-raised);
    text-align: left;
    transition:
      border-color var(--dur-base) var(--ease-out),
      background-color var(--dur-base) var(--ease-out);
  }
  .link-card:hover {
    border-color: color-mix(in oklab, var(--accent-deep) 42%, transparent);
    background: color-mix(in oklab, var(--accent-wash) 40%, var(--paper-raised));
  }
  .link-icon {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    margin-bottom: 6px;
    border: 1px solid var(--rule);
    border-radius: 6px;
    color: var(--accent-deep);
  }
  .link-title {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--ink);
  }
  .link-hint {
    font-size: 9.5px;
    line-height: 1.5;
    color: var(--color-on-surface-variant);
  }
  .link-arrow {
    position: absolute;
    top: 13px;
    right: 13px;
    display: grid;
    place-items: center;
    color: var(--color-on-surface-variant);
    opacity: 0.55;
    transition:
      opacity var(--dur-base) var(--ease-out),
      color var(--dur-base) var(--ease-out);
  }
  .link-card:hover .link-arrow {
    opacity: 1;
    color: var(--accent-deep);
  }

  /* ---------- 底部信息 ---------- */
  .meta-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-top: 22px;
    padding: 14px 0;
    border-top: 1px solid var(--rule);
    border-bottom: 1px solid var(--rule);
  }
  .meta-tech {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    min-width: 0;
  }
  .meta-label {
    font-family: var(--font-code);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-on-surface-variant);
  }
  .tech-chips {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
  }
  .donate-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-on-surface-variant);
    font-family: var(--font-ui);
    font-size: 10.5px;
    font-weight: 500;
    white-space: nowrap;
    transition: color var(--dur-base) var(--ease-out);
  }
  .donate-link:hover {
    color: var(--accent-deep);
  }

  .page-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-top: 13px;
    font-size: 9.5px;
    color: color-mix(in oklab, var(--color-on-surface-variant) 72%, transparent);
  }

  @media (max-width: 900px) {
    .top-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .links-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 620px) {
    .links-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .meta-row {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
