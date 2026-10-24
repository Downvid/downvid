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
  import { parseInline, splitSummary } from '../lib/markdown'
  import { t } from '../lib/i18n.svelte'
  import { APP_VERSION, REPO_URL, WEBSITE_URL } from '../lib/constants'
  import { openExternal } from '../lib/backend'
  // 邮箱与 mailto 拼装沿用应用现有的唯一来源，避免在演示里复制一份
  import { CONTACT_EMAIL, contactMailto } from '../../../../shared/app'

  const ISSUES_URL = REPO_URL + '/issues/new'
  const LICENSE_URL = REPO_URL + '/blob/main/LICENSE'
  const year = new Date().getFullYear()
  let showDonate = $state(false)

  const sponsorMailto = $derived(contactMailto({ subject: t('about.mailSubjectSponsor') }))
  const businessMailto = $derived(contactMailto({ subject: t('about.mailSubjectBusiness') }))

  const checking = $derived(app.updateInfo.status === 'checking')
  const available = $derived(app.updateInfo.status === 'available')

  const updateLabel = $derived(
    checking
      ? t('settings.checking')
      : available
        ? t('about.updateAvailable', { version: app.updateInfo.version ?? '' })
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
  const techStack: ReadonlyArray<{ name: string; icon?: string; material?: string }> = [
    { name: 'Go', icon: goIcon },
    { name: 'Wails', icon: wailsIcon },
    { name: 'Svelte 5', icon: svelteIcon },
    { name: 'TypeScript', icon: typescriptIcon },
    { name: 'yt-dlp', icon: '', material: 'download' },
  ]

  /**
   * 版本列表来自**真实 CHANGELOG**（后端内嵌，离线可用）。
   *
   * 早先这里是硬编码的三条，notes 还是 `t('about.release140Note1')` 这类占位词条。
   * 「关于」页的「更新内容」因此与真实发布毫无关系——而这恰恰是用户
   * 想确认「我这版修了什么」时唯一的入口。
   */
  /**
   * 永远按数组读。
   *
   * store 里的 `changelog` 类型是数组，但**运行时**可能是 null（后端出错时
   * Go 返回 nil 切片 → JSON `null`）。类型检查管不到这条路径，而后果是整个
   * 关于页白屏（`Cannot read properties of null (reading 'length')`）。
   *
   * 这一层是给「将来又有人在别处给它赋了 null」兜底——界面正确性不该
   * 依赖上游每个赋值点都记得判空。
   */
  const changelogList = $derived(Array.isArray(app.changelog) ? app.changelog : [])

  const releases = $derived(
    changelogList.map((entry) => ({
      version: `v${entry.version}`,
      date: entry.date,
      // 每条小标题下的条目拍平成一行，并解析行内 Markdown。
      //
      // 两步都不能省：
      //   1. `reflowMarkdown` —— CHANGELOG 按 80 列硬换行，直接渲染会在句中
      //      断开、中文之间多出空格（真机上就是这样）
      //   2. `parseInline` —— 不解析的话 `**粗体**` 的星号会原样显示
      // `sections` / `items` 同样可能是 null（Go 的 omitempty + nil 切片）
      notes: (entry.sections ?? [])
        .filter((section) => (section.items ?? []).length > 0)
        .flatMap((section) =>
          (section.items ?? []).map((item) => {
            // 拆成「标题 + 展开说明」：CHANGELOG 每条都是
            // `**一句话标题**：8~10 行展开说明`，全铺开会把页面拉得很长
            // （真机上一屏只放得下 3 条）。
            const { summary, detail } = splitSummary(item)
            return {
              section: section.title,
              summary: parseInline(summary),
              detail: detail ? parseInline(detail) : null,
            }
          }),
        ),
    })),
  )

  /**
   * 组件自己保证有数据。
   *
   * store 的 `init()` 会在启动时拉一次 changelog，但那是**异步**的，
   * 而且 init 可能在关于页之外的地方失败。这里在挂载时兜一次：
   * store 里已有就不重复请求。
   *
   * 为什么不能只靠 init：真机上曾出现「关于页打开了但更新日志一条都没有」，
   * 而 store 里的数据是否到位取决于一次早于组件挂载的异步调用——
   * 这种「谁先谁后」的依赖非常脆，不该让界面正确性建立在时序上。
   */
  let askedChangelog = false
  $effect(() => {
    // `askedChangelog` 是**必须的**：没有它，下面这行会自我循环——
    // effect 读 `changelog.length`，`loadChangelog()` 改它，于是 effect 再跑，
    // 而只要后端返回空（浏览器预览 / 后端异常），条件永远成立 → 无限请求。
    if (askedChangelog || changelogList.length > 0) return
    askedChangelog = true
    void app.loadChangelog()
  })

  /**
   * 用户选中的版本。
   *
   * ## 这个 `$effect` 曾经让下拉框**完全不能换版本**
   *
   * 上一版写的是「每次 `selectedVersion` 变化就把它强制改回当前运行版本」，
   * 于是用户在 `<select>` 里选历史版本时：
   *
   *   1. `onchange` 把 `selectedVersion` 设成目标版本
   *   2. `$effect` 看到它 ≠ 当前版本，立刻改回去
   *   3. 下拉框弹回当前版本，下方内容也跟着回去
   *
   * 表现就是「选了没反应」。这类 bug 很难从代码上看出来（effect 的意图
   * 本身是合理的），必须真的点一下才发现。
   *
   * 正确做法：**只在还没有选中值时对齐一次**（`synced` 守卫），
   * 之后完全由用户控制。
   */
  let selectedVersion = $state('')
  let syncedVersion = false
  $effect(() => {
    if (syncedVersion || releases.length === 0) return
    syncedVersion = true
    // 当前运行版本不在列表里（开发构建的 0.0.0-dev）时退回第一条，
    // 否则 `<select value=...>` 会渲染成空白（浏览器行为）
    const wanted = `v${app.version.replace(/^v/, '')}`
    selectedVersion = releases.some((r) => r.version === wanted) ? wanted : releases[0].version
  })

  const selectedRelease = $derived(
    releases.find((release) => release.version === selectedVersion) ?? releases[0] ?? null,
  )

  /**
   * 折叠状态：默认只显示前 N 条。
   *
   * ## 为什么需要折叠
   *
   * 一个版本的 CHANGELOG 动辄 15~20 条（1.4.0 是 20 条），全部铺开会把
   * 整个「关于」页拉得很长——用户要滑很久才能看到下面的链接区，而
   * 「看这一版改了什么」通常只需要前几条。
   *
   * 切换版本时**重置折叠状态**：否则在第 1.4.0 展开了、切到 1.3.4
   * 仍然处于展开态，用户会以为那一版也很长。
   */
  /**
   * 哪几条被展开（按条目下标）。
   *
   * 用「逐条展开」而不是「全部展开」：用户通常只关心其中一两条，
   * 一次全展开等于没解决「太长」。默认全部收起，只看得到标题。
   */
  let openNotes = $state<Record<number, boolean>>({})
  // 版本一变就全部收起（`selectedVersion` 是唯一入口）
  $effect(() => {
    void selectedVersion
    openNotes = {}
  })

  function toggleNote(index: number): void {
    openNotes = { ...openNotes, [index]: !openNotes[index] }
  }

  /**
   * 一屏最多列几条。
   *
   * 两条措施缺一不可：
   *   1. **每条只显示标题**（8~10 行的展开说明折起来）
   *   2. **列表本身限长**（标题再短，20 条仍然占满两屏）
   *
   * 真机上只做第 1 条时，卡片仍有 824px —— 一屏放不下。
   */
  const MAX_LISTED = 4
  let showAllNotes = $state(false)
  $effect(() => {
    void selectedVersion
    showAllNotes = false
  })

  const allNotes = $derived(selectedRelease ? selectedRelease.notes : [])
  const visibleNotes = $derived(
    showAllNotes ? allNotes : allNotes.slice(0, MAX_LISTED),
  )
  const hiddenCount = $derived(Math.max(0, allNotes.length - MAX_LISTED))

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
          <span class="identity-meta num">{t('about.version')} v{app.version || APP_VERSION}</span>
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
      {#if selectedRelease}
        <ol class="notes">
          {#each visibleNotes as note, index (index)}
            <li class="note" class:is-open={openNotes[index]}>
              <span class="note-index num">{String(index + 1).padStart(2, '0')}</span>
              <span class="note-text">
                <!--
                  默认只显示**标题那一句**，其余折起来。
                  CHANGELOG 每条都是「**一句话标题**：8~10 行展开说明」，
                  全部铺开时一屏只放得下 3 条（真机截图确认过）。

                  逐 token 渲染而不是 `{@html}`：CHANGELOG 是可编辑的文本，
                  直接注入 HTML 会让 `<script>` / `<img onerror>` 变成执行入口。
                -->
                <button
                  type="button"
                  class="note-summary"
                  onclick={() => toggleNote(index)}
                  aria-expanded={Boolean(openNotes[index])}
                  disabled={!note.detail}
                >
                  <span class="note-summary-text">
                    {#each note.summary as token, tIndex (tIndex)}
                      {#if token.kind === 'code'}
                        <code>{token.text}</code>
                      {:else if token.kind === 'link'}
                        <span class="inline-link-text">{token.text}</span>
                      {:else}
                        {token.text}
                      {/if}
                    {/each}
                  </span>
                  {#if note.detail}
                    <Icon name={openNotes[index] ? 'expand_less' : 'expand_more'} size={13} />
                  {/if}
                </button>

                {#if note.detail && openNotes[index]}
                  <div class="note-detail">
                    {#each note.detail as token, tIndex (tIndex)}
                      {#if token.kind === 'strong'}
                        <strong>{token.text}</strong>
                      {:else if token.kind === 'code'}
                        <code>{token.text}</code>
                      {:else if token.kind === 'link'}
                        <button type="button" class="inline-link" onclick={() => openExternal(token.href)}>
                          {token.text}
                        </button>
                      {:else}
                        {token.text}
                      {/if}
                    {/each}
                  </div>
                {/if}
              </span>
            </li>
          {/each}
        </ol>
        {#if hiddenCount > 0}
          <button
            type="button"
            class="notes-more"
            onclick={() => (showAllNotes = !showAllNotes)}
            aria-expanded={showAllNotes}
          >
            <span>{showAllNotes ? t('about.collapseNotes') : t('about.showAllNotes', { count: hiddenCount })}</span>
            <Icon name={showAllNotes ? 'expand_less' : 'expand_more'} size={14} />
          </button>
        {/if}
      {:else}
        <!--
          没有更新日志时如实说明，而不是显示空列表或占位文案。
          真机上这只会在「内嵌 CHANGELOG 漏了」时出现——那是个构建问题，
          用户看到一句说明比看到一片空白更容易反馈。
        -->
        <p class="notes-empty">{t('about.changelogEmpty')}</p>
      {/if}
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
    <div class="marquee-wrapper">
      <div class="marquee-track">
        <div class="marquee-group">
          {#each CONTRIBUTORS as person (person.login)}
            <button
              type="button"
              class="contributor-chip"
              onclick={() => openExternal('https://github.com/' + person.login)}
              title={'GitHub: ' + person.login}
            >
              <span class="chip-avatar">
                <span class="chip-fallback">{person.login.slice(0, 1).toUpperCase()}</span>
                <img
                  src={'https://github.com/' + person.login + '.png?size=72'}
                  alt=""
                  loading="lazy"
                  onerror={(event) => {
                    ;(event.currentTarget as HTMLElement).style.display = 'none'
                  }}
                />
              </span>
              <span class="chip-name num">{person.login}</span>
              {#if person.role}
                <span class="chip-role num">{person.role}</span>
              {/if}
            </button>
          {/each}
        </div>
        <div class="marquee-group" aria-hidden="true">
          {#each CONTRIBUTORS as person (`dup-${person.login}`)}
            <button
              type="button"
              class="contributor-chip"
              tabindex="-1"
              onclick={() => openExternal('https://github.com/' + person.login)}
              title={'GitHub: ' + person.login}
            >
              <span class="chip-avatar">
                <span class="chip-fallback">{person.login.slice(0, 1).toUpperCase()}</span>
                <img
                  src={'https://github.com/' + person.login + '.png?size=72'}
                  alt=""
                  loading="lazy"
                  onerror={(event) => {
                    ;(event.currentTarget as HTMLElement).style.display = 'none'
                  }}
                />
              </span>
              <span class="chip-name num">{person.login}</span>
              {#if person.role}
                <span class="chip-role num">{person.role}</span>
              {/if}
            </button>
          {/each}
        </div>
      </div>
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
        <a
          class="contact"
          href={sponsorMailto}
          onclick={(e) => {
            e.preventDefault()
            openExternal(sponsorMailto)
          }}
        >
          <span class="contact-icon"><Icon name="handshake" size={16} /></span>
          <span class="contact-body">
            <span class="contact-title">{t('about.contactSponsor')}</span>
            <span class="contact-email num">{CONTACT_EMAIL}</span>
          </span>
        </a>
        <a
          class="contact"
          href={businessMailto}
          onclick={(e) => {
            e.preventDefault()
            openExternal(businessMailto)
          }}
        >
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
              <Icon name={techItem.material ?? 'download'} size={13} />
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
  /* 行内 Markdown 的样式。
   *
   * 三个都不能省：
   *   - `code` 不加底色时会和正文混在一起，`shared/app.ts` 这类路径很难读
   *   - `strong` 用 `ink-strong`（正文用 ink），保证粗体真的**看起来更重**
   *   - 内联链接用按钮而不是 <a>：点击要走系统浏览器（openExternal），
   *     用 <a href> 会在 WebView 里直接导航走，整个应用界面就没了
   */
  .note-text code {
    padding: 1px 5px;
    border-radius: 4px;
    background: color-mix(in oklab, var(--accent) 10%, transparent);
    font-family: var(--font-code);
    font-size: 0.92em;
  }
  .note-text strong {
    font-weight: 650;
    color: var(--ink-strong);
  }
  .inline-link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-deep);
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }
  .inline-link:hover {
    color: var(--accent);
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

  /* ---------- 贡献者无限横幅滚动 ---------- */
  .contributors-section {
    margin-top: 24px;
  }
  .marquee-wrapper {
    overflow: hidden;
    position: relative;
    width: 100%;
    padding: 8px 0;
    mask-image: linear-gradient(to right, transparent, black 5%, black 95%, transparent);
    -webkit-mask-image: linear-gradient(to right, transparent, black 5%, black 95%, transparent);
  }
  .marquee-track {
    display: flex;
    width: max-content;
    animation: marquee-scroll 24s linear infinite;
  }
  .marquee-track:hover {
    animation-play-state: paused;
  }
  .marquee-group {
    display: flex;
    align-items: center;
    gap: 12px;
    padding-right: 12px;
  }
  @keyframes marquee-scroll {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(-50%);
    }
  }
  .contributor-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px 5px 6px;
    border-radius: 9999px;
    background: var(--paper-raised);
    border: 1px solid var(--rule);
    color: var(--ink);
    cursor: pointer;
    transition:
      transform 0.16s ease,
      border-color 0.16s ease,
      box-shadow 0.16s ease,
      background-color 0.16s ease;
    white-space: nowrap;
    user-select: none;
  }
  .contributor-chip:hover {
    transform: translateY(-2px);
    border-color: color-mix(in oklab, var(--accent-deep) 50%, transparent);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    background: var(--paper);
  }
  .chip-avatar {
    position: relative;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    overflow: hidden;
    background: var(--accent-wash);
    flex-shrink: 0;
  }
  .chip-avatar img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .chip-fallback {
    font-family: var(--font-code);
    font-size: 11px;
    font-weight: 700;
    color: var(--accent-deep);
  }
  .chip-name {
    font-size: 12px;
    font-weight: 500;
    color: var(--ink);
  }
  .chip-role {
    font-size: 8px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 4px;
    background: color-mix(in oklab, var(--accent-deep) 12%, transparent);
    color: var(--accent-deep);
    letter-spacing: 0.04em;
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
    .card-head {
      flex-wrap: wrap;
    }
    .version-select {
      max-width: 100%;
    }
  }
</style>
