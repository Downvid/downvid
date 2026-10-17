<script lang="ts">
  /**
   * 设置视图。
   *
   * 只读 app store、只通过 store 方法写入（updateSetting / setLanguage /
   * installDep / checkDeps / testProxy），组件本身不持有全局状态。
   * 所有文案走 t('key')，新增的键必须并回 lib/i18n.svelte.ts 与 src/i18n/core.ts。
   */
  import Icon from './Icon.svelte'
  import EffortSlider from './EffortSlider.svelte'
  import { app } from '../lib/store.svelte'
  import type { SettingsSection } from '../lib/store.svelte'
  import { t } from '../lib/i18n.svelte'
  import { APP_VERSION } from '../lib/constants'
  import type { AppSettings as DemoSettings } from '../lib/settings'

  const navItems: { id: SettingsSection; key: string; icon: string }[] = [
    { id: 'download', key: 'settings.navDownload', icon: 'download' },
    { id: 'network', key: 'settings.navNetwork', icon: 'lan' },
    { id: 'acceleration', key: 'settings.navAcceleration', icon: 'speed' },
    { id: 'deps', key: 'settings.navDeps', icon: 'dns' },
    { id: 'update', key: 'settings.navUpdate', icon: 'system_update' },
    { id: 'interface', key: 'settings.navInterface', icon: 'palette' },
  ]

  const qualityOptions = [
    { value: 'best', key: 'settings.qualityBest' },
    { value: '1080p', key: 'settings.quality1080' },
    { value: '720p', key: 'settings.quality720' },
    { value: '480p', key: 'settings.quality480' },
  ] as const


  const sourceOptions = [
    { value: 'auto', key: 'settings.sourceAuto' },
    { value: 'github', key: 'settings.sourceGithub' },
    { value: 'jsdelivr', key: 'settings.sourceJsdelivr' },
    { value: 'ghproxy', key: 'settings.sourceGhproxy' },
    { value: 'gitee', key: 'settings.sourceGitee' },
    { value: 'website', key: 'settings.sourceWebsite' },
  ] as const

  // 语言名用各自语言书写（中文叫「中文」、英文叫「English」），不翻译
  const languageOptions = [
    { value: 'auto', key: 'settings.languageAuto' },
    { value: 'zh-CN', key: 'lang.zh' },
    { value: 'en-US', key: 'lang.en' },
  ] as const

  const themeOptions = [
    { value: 'auto', key: 'settings.themeAuto' },
    { value: 'light', key: 'settings.themeLight' },
    { value: 'dark', key: 'settings.themeDark' },
  ] as const

  const radiusOptions = [
    { value: 'default', key: 'settings.radiusDefault' },
    { value: 'sharp', key: 'settings.radiusSharp' },
    { value: 'round', key: 'settings.radiusRound' },
  ] as const

  const aria2Dep = $derived(app.deps.find((dep) => dep.id === 'aria2c') ?? null)

  type TextKey = 'downloadDir' | 'filenameTemplate' | 'cookieFile' | 'proxy'

  function onTextInput(key: TextKey, event: Event): void {
    app.updateSetting(key, (event.currentTarget as HTMLInputElement).value)
  }

  function onQualityChange(event: Event): void {
    app.updateSetting('quality', (event.currentTarget as HTMLSelectElement).value as DemoSettings['quality'])
  }

  function onUpdateSourceChange(event: Event): void {
    app.updateSetting('updateSource', (event.currentTarget as HTMLSelectElement).value as DemoSettings['updateSource'])
  }

  function onLanguageChange(event: Event): void {
    app.setLanguage((event.currentTarget as HTMLSelectElement).value as DemoSettings['language'])
  }

  function toggleAccel(): void {
    app.updateSetting('accelEnabled', !app.settings.accelEnabled)
  }

  function toggleAutoCheck(): void {
    app.updateSetting('autoCheckUpdate', !app.settings.autoCheckUpdate)
  }

  function toggleAutoDownload(): void {
    app.updateSetting('autoDownloadUpdate', !app.settings.autoDownloadUpdate)
  }

  function onCheckUpdate(): void {
    if (app.update.status === 'checking') return
    if (app.update.status === 'available') app.openUpdateDialog()
    else void app.checkUpdate()
  }

  function depSourceLabel(dep: { source: 'system' | 'managed' | 'none' }): string {
    return dep.source === 'managed' ? t('settings.depsManaged') : t('settings.depsSystem')
  }
</script>

<section class="settings">
  <header class="page-head">
    <div class="page-head-text">
      <span class="eyebrow">{t('settings.eyebrow')}</span>
      <h1 class="settings-title">{t('settings.title')}</h1>
      <p class="settings-sub">{t('settings.subtitle')}</p>
    </div>
    <span class="autosave" class:is-visible={app.autoSaveVisible} aria-live="polite">
      <Icon name="check" size={13} />
      <span>{t('settings.autoSave')}</span>
    </span>
  </header>

  <div class="settings-body">
    <nav class="settings-nav" aria-label={t('settings.title')}>
      {#each navItems as item (item.id)}
        <button
          type="button"
          class="settings-tab"
          class:is-active={app.settingsSection === item.id}
          aria-current={app.settingsSection === item.id ? 'page' : undefined}
          onclick={() => (app.settingsSection = item.id)}
        >
          <span class="settings-tab-icon"><Icon name={item.icon} size={15} /></span>
          <span>{t(item.key)}</span>
        </button>
      {/each}
    </nav>

    <div class="settings-panel sheet">
      {#if app.settingsSection === 'download'}
        <div class="row">
          <div class="row-label">
            <span class="row-title">{t('settings.downloadDir')}</span>
            <span class="row-hint">{t('settings.downloadDirHint')}</span>
          </div>
          <div class="row-control">
            <input
              class="field field--mono"
              value={app.settings.downloadDir}
              oninput={(event) => onTextInput('downloadDir', event)}
              aria-label={t('settings.downloadDir')}
              spellcheck="false"
              autocomplete="off"
            />
            <button
              type="button"
              class="icon-btn icon-btn--bordered"
              title={t('status.openFolder')}
              aria-label={t('status.openFolder')}
              onclick={() => app.toast(t('toast.folder'))}
            >
              <Icon name="folder" size={16} />
            </button>
          </div>
        </div>

        <div class="row">
          <div class="row-label">
            <span class="row-title">{t('settings.filenameTemplate')}</span>
            <span class="row-hint">{t('settings.filenameTemplateHint')}</span>
          </div>
          <div class="row-control">
            <input
              class="field field--mono"
              value={app.settings.filenameTemplate}
              oninput={(event) => onTextInput('filenameTemplate', event)}
              aria-label={t('settings.filenameTemplate')}
              spellcheck="false"
              autocomplete="off"
            />
          </div>
        </div>

        <div class="row">
          <div class="row-label">
            <span class="row-title">{t('settings.quality')}</span>
          </div>
          <div class="row-control">
            <select class="field" value={app.settings.quality} onchange={onQualityChange} aria-label={t('settings.quality')}>
              {#each qualityOptions as option (option.value)}
                <option value={option.value}>{t(option.key)}</option>
              {/each}
            </select>
          </div>
        </div>
      {:else if app.settingsSection === 'network'}
        <div class="row">
          <div class="row-label">
            <span class="row-title">{t('settings.cookieMode')}</span>
            <span class="row-hint">{t('settings.cookieHint')}</span>
          </div>
          <div class="row-control">
            <div class="seg" role="group" aria-label={t('settings.cookieMode')}>
              <button
                type="button"
                class:is-active={app.settings.cookieMode === 'auto'}
                aria-pressed={app.settings.cookieMode === 'auto'}
                onclick={() => app.updateSetting('cookieMode', 'auto')}>{t('settings.cookieAuto')}</button>
              <button
                type="button"
                class:is-active={app.settings.cookieMode === 'manual'}
                aria-pressed={app.settings.cookieMode === 'manual'}
                onclick={() => app.updateSetting('cookieMode', 'manual')}>{t('settings.cookieManual')}</button>
            </div>
          </div>
        </div>

        {#if app.settings.cookieMode === 'manual'}
          <div class="row">
            <div class="row-label">
              <span class="row-title">{t('settings.cookieFile')}</span>
            </div>
            <div class="row-control">
              <input
                class="field field--mono"
                value={app.settings.cookieFile}
                oninput={(event) => onTextInput('cookieFile', event)}
                aria-label={t('settings.cookieFile')}
                spellcheck="false"
                autocomplete="off"
              />
              <button
                type="button"
                class="icon-btn icon-btn--bordered"
                title={t('settings.cookieFile')}
                aria-label={t('settings.cookieFile')}
                onclick={() => app.toast(t('toast.folder'))}
              >
                <Icon name="folder" size={16} />
              </button>
            </div>
          </div>
        {/if}

        <div class="row">
          <div class="row-label">
            <span class="row-title">{t('settings.proxy')}</span>
            <span class="row-hint">{t('settings.proxyHint')}</span>
          </div>
          <div class="control-stack">
            <div class="control-line">
              <input
                class="field field--mono"
                value={app.settings.proxy}
                oninput={(event) => onTextInput('proxy', event)}
                aria-label={t('settings.proxy')}
                spellcheck="false"
                autocomplete="off"
              />
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                onclick={() => app.testProxy()}
                disabled={app.proxyTesting}
              >
                {#if app.proxyTesting}
                  <Icon name="progress_activity" size={14} class="spin" />
                {:else}
                  <Icon name="network_check" size={14} />
                {/if}
                <span>{t('settings.testProxy')}</span>
              </button>
            </div>
            {#if app.proxyOk}
              <span class="ok-note">
                <Icon name="check_circle" size={13} />
                <span>{t('settings.proxyOk')}</span>
              </span>
            {/if}
          </div>
        </div>
      {:else if app.settingsSection === 'acceleration'}
        <div class="row">
          <div class="row-label">
            <span class="row-title">{t('settings.accel')}</span>
            <span class="row-hint">{t('settings.accelHint')}</span>
          </div>
          <div class="row-control">
            <button
              type="button"
              role="switch"
              class="switch"
              aria-checked={app.settings.accelEnabled}
              aria-label={t('settings.accel')}
              onclick={toggleAccel}
            ></button>
          </div>
        </div>

        <div class="row">
          <div class="row-label">
            <span class="row-title">{t('settings.maxConnections')}</span>
          </div>
          <div class="row-control">
            <EffortSlider
              value={app.settings.maxConnections}
              onchange={(value) => app.updateSetting('maxConnections', value)}
            />
          </div>
        </div>

        <div class="row">
          <div class="row-label">
            <span class="row-title">{t('settings.aria2')}</span>
            <span class="row-hint">{t('settings.depsOptional')}</span>
          </div>
          <div class="row-control">
            {#if aria2Dep}
              {#if aria2Dep.busy}
                <div class="progress-wrap">
                  <div
                    class="progress"
                    role="progressbar"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    aria-valuenow={Math.round((aria2Dep.progress ?? 0) * 100)}
                  >
                    <div class="progress-fill" style="transform:scaleX({aria2Dep.progress ?? 0})"></div>
                  </div>
                  <span class="pct num">{Math.round((aria2Dep.progress ?? 0) * 100)}%</span>
                </div>
              {:else if aria2Dep.status === 'ready'}
                <span class="dep-ready">
                  <Icon name="check" size={14} />
                  {#if aria2Dep.version}<span class="dep-version num">{aria2Dep.version}</span>{/if}
                  <span>{t('settings.depsReady')}</span>
                </span>
              {:else}
                <span class="status-note">{t('settings.aria2Missing')}</span>
                <button type="button" class="btn btn-ghost btn-sm" onclick={() => app.installDep('aria2c')}>
                  <Icon name="download" size={14} />
                  <span>{t('settings.depsDownload')}</span>
                </button>
              {/if}
            {:else}
              <span class="status-note">{t('settings.depsMissing')}</span>
            {/if}
          </div>
        </div>
      {:else if app.settingsSection === 'deps'}
        <div class="panel-head">
          <div class="panel-head-text">
            <span class="panel-title">{t('settings.depsTitle')}</span>
            <span class="panel-hint">{t('settings.depsHint')}</span>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            onclick={() => app.checkDeps()}
            disabled={app.depsChecking}
          >
            <Icon name="refresh" size={14} class={app.depsChecking ? 'spin' : ''} />
            <span>{app.depsChecking ? t('settings.depsChecking') : t('settings.depsRecheck')}</span>
          </button>
        </div>

        {#each app.deps as dep (dep.id)}
          <div class="dep">
            <span
              class="dot"
              class:dot--danger={dep.status === 'missing'}
              class:dot--warn={dep.status === 'outdated'}
            ></span>

            <div class="dep-body">
              <div class="dep-head">
                <span class="dep-name">{dep.name}</span>
                {#if dep.version}
                  <span class="dep-version num">{dep.version}</span>
                {:else}
                  <span class="dep-missing">{t('settings.depsMissing')}</span>
                {/if}
                {#if dep.source !== 'none'}
                  <span class="chip" class:chip--active={dep.source === 'managed'}>{depSourceLabel(dep)}</span>
                {/if}
                {#if !dep.required}
                  <span class="chip">{t('settings.depsOptional')}</span>
                {/if}
              </div>
              {#if dep.path}
                <span class="dep-path num" title={dep.path}>{dep.path}</span>
              {/if}
              {#if dep.busy}
                <div class="progress-wrap dep-progress">
                  <div
                    class="progress"
                    role="progressbar"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    aria-valuenow={Math.round((dep.progress ?? 0) * 100)}
                  >
                    <div class="progress-fill" style="transform:scaleX({dep.progress ?? 0})"></div>
                  </div>
                  <span class="pct num">{Math.round((dep.progress ?? 0) * 100)}%</span>
                </div>
              {/if}
            </div>

            <div class="dep-action">
              {#if !dep.busy}
                {#if dep.status === 'outdated'}
                  <button type="button" class="btn btn-ghost btn-sm" onclick={() => app.installDep(dep.id)}>
                    <Icon name="system_update" size={14} />
                    <span>{t('settings.depsUpdate')}</span>
                  </button>
                {:else if dep.status === 'missing'}
                  <button type="button" class="btn btn-ghost btn-sm" onclick={() => app.installDep(dep.id)}>
                    <Icon name="download" size={14} />
                    <span>{t('settings.depsDownload')}</span>
                  </button>
                {:else}
                  <span class="dep-ready">
                    <Icon name="check" size={14} />
                    <span>{t('settings.depsReady')}</span>
                  </span>
                {/if}
              {/if}
            </div>
          </div>
        {/each}
      {:else if app.settingsSection === 'update'}
        <div class="row">
          <div class="row-label">
            <span class="row-title">{t('settings.updateSource')}</span>
            <span class="row-hint">{t('settings.updateSourceHint')}</span>
          </div>
          <div class="row-control">
            <select
              class="field"
              value={app.settings.updateSource}
              onchange={onUpdateSourceChange}
              aria-label={t('settings.updateSource')}
            >
              {#each sourceOptions as option (option.value)}
                <option value={option.value}>{t(option.key)}</option>
              {/each}
            </select>
          </div>
        </div>

        <div class="row">
          <div class="row-label">
            <span class="row-title">{t('settings.autoCheck')}</span>
          </div>
          <div class="row-control">
            <button
              type="button"
              role="switch"
              class="switch"
              aria-checked={app.settings.autoCheckUpdate}
              aria-label={t('settings.autoCheck')}
              onclick={toggleAutoCheck}
            ></button>
          </div>
        </div>

        <div class="row">
          <div class="row-label">
            <span class="row-title">{t('settings.autoDownload')}</span>
          </div>
          <div class="row-control">
            <button
              type="button"
              role="switch"
              class="switch"
              aria-checked={app.settings.autoDownloadUpdate}
              aria-label={t('settings.autoDownload')}
              onclick={toggleAutoDownload}
            ></button>
          </div>
        </div>

        <div class="row">
          <div class="row-label">
            <span class="row-title">{t('settings.version')}</span>
          </div>
          <div class="row-control">
            <span class="version num">v{APP_VERSION}</span>
          </div>
        </div>

        <div class="action-bar">
          <button
            type="button"
            class="btn btn-primary"
            onclick={onCheckUpdate}
            disabled={app.update.status === 'checking'}
          >
            {#if app.update.status === 'checking'}
              <Icon name="progress_activity" size={15} class="spin" />
              <span>{t('settings.checking')}</span>
            {:else if app.update.status === 'available'}
              <Icon name="new_releases" size={15} />
              <span>{t('about.updateAvailable', { version: app.updateState.version ?? '' })}</span>
            {:else}
              <Icon name="refresh" size={15} />
              <span>{t('settings.checkNow')}</span>
            {/if}
          </button>
        </div>
      {:else}
        <div class="row">
          <div class="row-label">
            <span class="row-title">{t('settings.theme')}</span>
            <span class="row-hint">{t('settings.themeHint')}</span>
          </div>
          <div class="row-control">
            <div class="seg" role="group" aria-label={t('settings.theme')}>
              {#each themeOptions as option (option.value)}
                <button
                  type="button"
                  class:is-active={app.settings.theme === option.value}
                  aria-pressed={app.settings.theme === option.value}
                  onclick={() => app.updateSetting('theme', option.value)}
                >{t(option.key)}</button>
              {/each}
            </div>
          </div>
        </div>

        <div class="row">
          <div class="row-label">
            <span class="row-title">{t('settings.radius')}</span>
          </div>
          <div class="row-control">
            <div class="seg" role="group" aria-label={t('settings.radius')}>
              {#each radiusOptions as option (option.value)}
                <button
                  type="button"
                  class:is-active={app.settings.radius === option.value}
                  aria-pressed={app.settings.radius === option.value}
                  onclick={() => app.updateSetting('radius', option.value)}
                >{t(option.key)}</button>
              {/each}
            </div>
          </div>
        </div>

        <div class="row">
          <div class="row-label">
            <span class="row-title">{t('settings.language')}</span>
          </div>
          <div class="row-control">
            <select
              class="field"
              value={app.settings.language}
              onchange={onLanguageChange}
              aria-label={t('settings.language')}
            >
              {#each languageOptions as option (option.value)}
                <option value={option.value}>{t(option.key)}</option>
              {/each}
            </select>
          </div>
        </div>

        <div class="row">
          <div class="row-label">
            <span class="row-title">{t('settings.version')}</span>
            <span class="row-hint">{t('about.build')}</span>
          </div>
          <div class="row-control">
            <span class="version num">v{APP_VERSION}</span>
            <span class="build muted">{t('about.buildValue')}</span>
          </div>
        </div>
      {/if}
    </div>
  </div>
</section>

<style>
  .settings {
    width: 100%;
    max-width: 1000px;
    margin: 0 auto;
  }

  /* ---------- 页头 ---------- */
  .page-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 26px;
  }
  .page-head-text {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-width: 0;
  }
  .settings-title {
    margin: 8px 0 0;
    font-family: var(--font-display);
    font-size: 30px;
    font-weight: 700;
    line-height: 1.08;
    letter-spacing: -0.035em;
    color: var(--ink-strong);
  }
  .settings-sub {
    margin: 7px 0 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--color-on-surface-variant);
  }

  /* 自动保存：只淡入淡出，不推动布局 */
  .autosave {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: none;
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--rule-soft);
    border-radius: 999px;
    color: var(--success);
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
    opacity: 0;
    transform: translateY(-3px);
    transition:
      opacity 180ms ease,
      transform 180ms ease;
  }
  .autosave.is-visible {
    opacity: 1;
    transform: translateY(0);
  }

  /* ---------- 两栏 ---------- */
  .settings-body {
    display: grid;
    grid-template-columns: 176px minmax(0, 1fr);
    gap: 24px;
    align-items: start;
  }

  .settings-nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .settings-tab {
    position: relative;
    display: flex;
    align-items: center;
    gap: 9px;
    min-height: 34px;
    padding: 7px 10px 7px 12px;
    line-height: 1.35;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--color-on-surface-variant);
    font-size: 12.5px;
    font-weight: 600;
    text-align: left;
    transition:
      color 160ms ease,
      background-color 160ms ease;
  }
  .settings-tab:hover {
    color: var(--ink);
    background: color-mix(in oklab, var(--ink) 4%, transparent);
  }
  .settings-tab.is-active {
    color: var(--ink-strong);
  }
  /* 左侧 2px 琥珀条是选中态唯一的强信号 */
  .settings-tab.is-active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 7px;
    bottom: 7px;
    width: 2px;
    border-radius: 2px;
    background: var(--accent);
  }
  .settings-tab-icon {
    display: inline-flex;
    flex: none;
    color: var(--color-on-surface-variant);
  }
  .settings-tab.is-active .settings-tab-icon {
    color: var(--accent-deep);
  }

  .settings-panel {
    min-width: 0;
    overflow: hidden;
  }

  /* ---------- 行 ---------- */
  .row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    padding: 15px 20px;
  }
  .row + .row {
    border-top: 1px solid var(--rule-soft);
  }
  .row-label {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    max-width: 44%;
  }
  .row-title {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.4;
    color: var(--ink-strong);
  }
  .row-hint {
    font-size: 11.5px;
    line-height: 1.55;
    color: var(--color-on-surface-variant);
  }
  .row-control {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }
  .row-control > .field {
    flex: 0 1 300px;
    width: auto;
    min-width: 0;
  }
  .row-control > select.field {
    flex: 0 1 auto;
    min-width: 200px;
    max-width: 320px;
  }
  .control-stack {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 7px;
    flex: 1;
    min-width: 0;
  }
  .control-line {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    width: 100%;
    min-width: 0;
  }
  .control-line .field {
    flex: 1 1 auto;
    min-width: 0;
  }

  .ok-note {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--success);
  }
  .status-note {
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--color-on-surface-variant);
    max-width: 300px;
    text-align: right;
  }
  .version {
    font-size: 12px;
    color: var(--ink-strong);
    white-space: nowrap;
  }
  .build {
    font-size: 11px;
    white-space: nowrap;
  }

  .action-bar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    padding: 15px 20px;
    border-top: 1px solid var(--rule-soft);
  }

  /* ---------- 依赖 ---------- */
  .panel-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 20px 14px;
    border-bottom: 1px solid var(--rule-soft);
  }
  .panel-head-text {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .panel-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-strong);
  }
  .panel-hint {
    font-size: 11.5px;
    line-height: 1.55;
    color: var(--color-on-surface-variant);
  }

  .dep {
    display: grid;
    grid-template-columns: 8px minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    padding: 13px 20px;
  }
  .dep + .dep {
    border-top: 1px solid var(--rule-soft);
  }
  .dep-body {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .dep-head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 7px;
    min-width: 0;
  }
  .dep-name {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ink-strong);
  }
  .dep-version {
    font-size: 11px;
    color: var(--color-on-surface-variant);
  }
  .dep-missing {
    font-size: 11px;
    color: var(--danger);
  }
  .dep-path {
    font-size: 10.5px;
    color: var(--color-on-surface-variant);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dep .chip {
    height: 20px;
    padding: 0 7px;
    font-size: 10px;
  }
  .dep-action {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }
  .dep-ready {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--success);
    white-space: nowrap;
  }


  /* ---------- 进度条 ---------- */
  .progress-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    max-width: 300px;
  }
  .progress {
    position: relative;
    flex: 1;
    min-width: 60px;
    height: 4px;
    border-radius: 999px;
    background: var(--rule-soft);
    overflow: hidden;
  }
  .progress-fill {
    position: absolute;
    inset: 0;
    background: var(--accent);
    transform-origin: left center;
    transition: transform 140ms linear;
  }
  .pct {
    flex: none;
    min-width: 30px;
    font-size: 10.5px;
    color: var(--color-on-surface-variant);
    text-align: right;
  }
  .dep-progress {
    max-width: 360px;
    margin-top: 3px;
  }

  /* ---------- 窄屏：竖导航变成横向 chip 行 ---------- */
  @media (max-width: 640px) {
    .row {
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
      padding: 13px 16px;
    }
    .row-label {
      max-width: none;
    }
    .row-control {
      justify-content: flex-start;
    }
    .row-control > .field,
    .row-control > select.field {
      flex: 1 1 auto;
      width: 100%;
      max-width: none;
      min-width: 0;
    }
    .control-stack {
      align-items: stretch;
    }
    .control-line {
      justify-content: flex-start;
    }
  }

  @media (max-width: 900px) {
    .settings-body {
      grid-template-columns: minmax(0, 1fr);
      gap: 14px;
    }
    .settings-nav {
      flex-direction: row;
      flex-wrap: wrap;
      gap: 6px;
    }
    .settings-tab {
      min-height: 30px;
      padding: 6px 12px;
      border: 1px solid var(--rule);
      border-radius: 999px;
      font-size: 11.5px;
    }
    .settings-tab.is-active {
      border-color: color-mix(in oklab, var(--accent-deep) 55%, transparent);
      background: var(--accent-wash);
      color: var(--accent-deep);
    }
    .settings-tab.is-active::before {
      display: none;
    }
    .settings-tab-icon {
      display: none;
    }
  }

  @media (max-width: 720px) {
    .page-head {
      position: relative;
      flex-direction: column;
      gap: 14px;
    }
    .page-head .autosave {
      position: absolute;
      top: 0;
      right: 0;
    }
    .settings-title {
      font-size: 26px;
    }
    .row {
      flex-direction: column;
      align-items: stretch;
      gap: 10px;
    }
    .row-label {
      max-width: none;
    }
    .row-control {
      justify-content: flex-start;
    }
    .row-control > .field {
      flex: 1 1 auto;
    }
    .row-control > select.field {
      flex: 1 1 auto;
      width: 100%;
      max-width: none;
    }
    .control-stack {
      align-items: flex-start;
    }
    .control-line {
      justify-content: flex-start;
    }
    .status-note {
      max-width: none;
      text-align: left;
    }
    .action-bar {
      justify-content: stretch;
    }
    .action-bar .btn {
      width: 100%;
    }
    .dep {
      grid-template-columns: 8px minmax(0, 1fr);
    }
    .dep-action {
      grid-column: 2;
      justify-content: flex-start;
    }
  }
</style>
