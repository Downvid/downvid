<script lang="ts">
  import Icon from './Icon.svelte'
  import GitHubIcon from './GitHubIcon.svelte'
  import logo from '../assets/logo.png'
  import donate from '../assets/donate.jpg'
  import goIcon from '../assets/tech/go.svg'
  import wailsIcon from '../assets/tech/wails.svg'
  import svelteIcon from '../assets/tech/svelte.svg'
  import typescriptIcon from '../assets/tech/typescript.svg'
  import { app } from '../lib/store.svelte'
  import { t } from '../lib/i18n.svelte'
  import { APP_VERSION, NEXT_VERSION, REPO_URL, WEBSITE_URL } from '../lib/mock'
  // 邮箱与 mailto 拼装沿用应用现有的唯一来源，避免在演示里复制一份
  import { CONTACT_EMAIL, contactMailto } from '../../../../shared/app'

  const ISSUES_URL = REPO_URL + '/issues/new'
  const LICENSE_URL = REPO_URL + '/blob/main/LICENSE'
  const year = new Date().getFullYear()
  let showDonate = $state(false)

  const sponsorMailto = $derived(contactMailto({ subject: t('about.mailSubjectSponsor') }))
  const businessMailto = $derived(contactMailto({ subject: t('about.mailSubjectBusiness') }))

  const checking = $derived(app.update.status === 'checking')
  const available = $derived(app.update.status === 'available')

  const updateLabel = $derived(
    checking
      ? t('settings.checking')
      : available
        ? t('about.updateAvailable', { version: NEXT_VERSION })
        : t('about.update'),
  )

  /** 固定贡献者名单，不走 GitHub API（未认证限额 60 次/小时，很容易 403）。 */
  const CONTRIBUTORS = [
    { login: 'yxxbc', role: 'DEV' },
    { login: 'cshuangyy', role: '' },
    { login: 'hailaij', role: 'CONTRIBUTOR' },
    { login: 'jwfstars', role: 'CONTRIBUTOR' },
    { login: 'zerow', role: 'CONTRIBUTOR' },
    { login: 'linuztx', role: 'CONTRIBUTOR' },
    { login: 'Glaroday', role: 'CONTRIBUTOR' },
  ] as const

  /** 语言 / 框架用官方品牌图标，yt-dlp 不是语言，用下载图标区分。 */
  const techStack = [
    { name: 'Go', icon: goIcon },
    { name: 'Wails', icon: wailsIcon },
    { name: 'Svelte 5', icon: svelteIcon },
    { name: 'TypeScript', icon: typescriptIcon },
    { name: 'yt-dlp', icon: '', material: 'download' },
  ] as const

  const releases = $derived([
    {
      version: 'v1.5.0',
      date: '2026-10-17',
      notes: [t('update.note1'), t('update.note2'), t('update.note3')],
    },
    {
      version: 'v1.4.0',
      date: '2026-10-16',
      notes: [t('about.release140Note1'), t('about.release140Note2'), t('about.release140Note3')],
    },
    {
      version: 'v1.3.4',
      date: '2026-10-14',
      notes: [t('about.release134Note1'), t('about.release134Note2'), t('about.release134Note3')],
    },
  ])
  let selectedVersion = $state('v1.5.0')
  const selectedRelease = $derived(
    releases.find((release) => release.version === selectedVersion) ?? releases[0],
  )

  function onVersionChange(event: Event): void {
    selectedVersion = (event.currentTarget as HTMLSelectElement).value
  }

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


</script>

<div class="about-view">
  <header class="page-head">
    <span class="eyebrow">{t('about.eyebrow')}</span>
    <h1 class="page-title">{t('about.title')}</h1>
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
        <select
          class="version-select num"
          value={selectedVersion}
          onchange={onVersionChange}
          aria-label={t('about.changelog')}
        >
          {#each releases as release (release.version)}
            <option value={release.version}>{release.version} · {release.date}</option>
          {/each}
        </select>
      </div>
      <ol class="notes">
        {#each selectedRelease.notes as note, index (index)}
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
          <span class="link-icon">
            {#if link.id === 'repo'}
              <GitHubIcon size={16} />
            {:else if link.id === 'website'}
              <img class="link-brand" src={logo} alt="" />
            {:else}
              <Icon name={link.icon} size={16} />
            {/if}
          </span>
          <span class="link-arrow"><Icon name="north_east" size={13} /></span>
          <span class="link-title">{link.title}</span>
          <span class="link-hint">{link.hint}</span>
        </button>
      {/each}
    </div>
  </section>

  <section class="contributors-section">
    <div class="section-head">
      <span class="section-label">{t('about.contributors')}</span>
      <span class="section-rule"></span>
    </div>
    <div class="contributors">
      {#each CONTRIBUTORS as person (person.login)}
        <a
          class="contributor"
          href={'https://github.com/' + person.login}
          target="_blank"
          rel="noopener"
        >
          <span class="avatar">
            <span class="avatar-fallback">{person.login.slice(0, 1).toUpperCase()}</span>
            <img
              src={'https://github.com/' + person.login + '.png?size=112'}
              alt=""
              loading="lazy"
              onerror={(event) => {
                ;(event.currentTarget as HTMLImageElement).style.display = 'none'
              }}
            />
          </span>
          <span class="contributor-name">{person.login}</span>
          {#if person.role}<span class="contributor-role num">{person.role}</span>{/if}
        </a>
      {/each}
    </div>
  </section>

  <section class="sheet support" id="support">
    <div class="support-head">
      <span class="support-icon"><Icon name="favorite" size={17} /></span>
      <div class="support-copy">
        <h2>{t('about.support')}</h2>
        <p>{t('about.supportHint')}</p>
      </div>
      <button
        type="button"
        class="btn btn-ghost btn-sm support-toggle"
        aria-expanded={showDonate}
        onclick={() => (showDonate = !showDonate)}
      >
        <Icon name={showDonate ? 'expand_less' : 'qr_code_2'} size={15} />
        <span>{showDonate ? t('about.hideDonate') : t('about.showDonate')}</span>
      </button>
    </div>

    {#if showDonate}
      <div class="donate-body">
        <img src={donate} alt={t('about.donateAlt')} />
        <p>{t('about.donateCaption')}</p>
      </div>
    {/if}

    <div class="contact-block">
      <p class="contact-hint">{t('about.contactHint')}</p>
      <div class="contact-grid">
        <a class="contact" href={sponsorMailto}>
          <span class="contact-icon"><Icon name="handshake" size={16} /></span>
          <span class="contact-body">
            <span class="contact-title">{t('about.contactSponsor')}</span>
            <span class="contact-email num">{CONTACT_EMAIL}</span>
          </span>
        </a>
        <a class="contact" href={businessMailto}>
          <span class="contact-icon"><Icon name="campaign" size={16} /></span>
          <span class="contact-body">
            <span class="contact-title">{t('about.contactBusiness')}</span>
            <span class="contact-email num">{CONTACT_EMAIL}</span>
          </span>
        </a>
      </div>
    </div>
  </section>

  <section class="meta-row">
    <div class="meta-tech">
      <span class="meta-label">{t('about.tech')}</span>
      <div class="tech-chips">
        {#each techStack as techItem (techItem.name)}
          <span class="chip num tech-chip">
            {#if techItem.icon}
              <img class="tech-icon" src={techItem.icon} alt="" width="13" height="13" />
            {:else}
              <Icon name={techItem.material} size={13} />
            {/if}
            <span>{techItem.name}</span>
          </span>
        {/each}
      </div>
    </div>
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
    border-radius: var(--radius-media);
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
  .version-select {
    width: auto;
    max-width: 170px;
    height: 27px;
    padding: 0 24px 0 8px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-control);
    background: var(--paper-raised);
    color: var(--color-on-surface-variant);
    font-family: var(--font-code);
    font-size: 9.5px;
    outline: none;
    cursor: pointer;
  }
  .version-select:focus-visible {
    border-color: var(--accent-deep);
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
    border-radius: var(--radius-control);
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
    border-radius: var(--radius-small);
    color: var(--accent-deep);
  }
  .link-brand {
    display: block;
    width: 17px;
    height: 17px;
    object-fit: contain;
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

  /* ---------- 贡献者 ---------- */
  .contributors-section {
    margin-top: 24px;
  }
  .contributors {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 8px;
  }
  .contributor {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    min-width: 0;
    padding: 10px 6px 9px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-control);
    background: var(--paper-raised);
    text-decoration: none;
    transition:
      border-color var(--dur-base) var(--ease-out),
      background-color var(--dur-base) var(--ease-out);
  }
  .contributor:hover {
    border-color: color-mix(in oklab, var(--accent-deep) 40%, transparent);
    background: color-mix(in oklab, var(--accent-wash) 35%, var(--paper-raised));
  }
  .avatar {
    position: relative;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    overflow: hidden;
    border-radius: 50%;
    background: var(--accent-wash);
  }
  .avatar img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .avatar-fallback {
    font-family: var(--font-code);
    font-size: 13px;
    font-weight: 700;
    color: var(--accent-deep);
  }
  .contributor-name {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-code);
    font-size: 9px;
    color: var(--ink);
  }
  .contributor-role {
    font-size: 7px;
    letter-spacing: 0.04em;
    color: color-mix(in oklab, var(--accent-deep) 78%, transparent);
  }

  /* ---------- 底部信息 ---------- */
  /* ---------- 支持作者 ---------- */
  .support {
    margin-top: 14px;
    padding: 18px 20px;
  }
  .support-head {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  .support-icon {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    flex: none;
    border-radius: var(--radius-control);
    background: var(--accent-wash);
    color: var(--accent-deep);
  }
  .support-copy {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .support-copy h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.015em;
    color: var(--ink-strong);
  }
  .support-copy p {
    margin: 0;
    font-size: 11.5px;
    line-height: 1.6;
    color: var(--color-on-surface-variant);
  }
  .support-toggle {
    flex: none;
  }
  .donate-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding-top: 14px;
  }
  .donate-body img {
    width: 188px;
    max-width: 70%;
    border-radius: 8px;
    border: 1px solid var(--rule);
    background: #fff;
  }
  .donate-body p {
    margin: 0;
    font-size: 10px;
    color: var(--color-on-surface-variant);
  }
  .contact-block {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--rule-soft);
  }
  .contact-hint {
    margin: 0 0 8px;
    font-size: 10.5px;
    line-height: 1.6;
    color: var(--color-on-surface-variant);
  }
  .contact-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .contact {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
    padding: 9px 10px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-control);
    background: var(--paper-raised);
    text-decoration: none;
    transition:
      border-color var(--dur-base) var(--ease-out),
      background-color var(--dur-base) var(--ease-out);
  }
  .contact:hover {
    border-color: color-mix(in oklab, var(--accent-deep) 40%, transparent);
    background: color-mix(in oklab, var(--accent-wash) 35%, var(--paper-raised));
  }
  .contact-icon {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    flex: none;
    border-radius: 6px;
    background: var(--paper-deep);
    color: var(--color-on-surface-variant);
  }
  .contact-body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .contact-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--ink);
  }
  .contact-email {
    font-size: 9.5px;
    color: var(--color-on-surface-variant);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tech-chip {
    gap: 5px;
  }
  .tech-icon {
    display: block;
    flex: none;
    object-fit: contain;
  }

  .meta-row {
    display: flex;
    align-items: center;
    justify-content: flex-start;
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
    .support-head {
      flex-wrap: wrap;
    }
    .support-toggle {
      width: 100%;
      justify-content: center;
    }
    .contact-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .contributors {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .card-head {
      flex-wrap: wrap;
    }
    .version-select {
      max-width: 100%;
    }
  }
</style>
