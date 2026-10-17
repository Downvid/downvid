/**
 * 演示状态与模拟引擎。
 *
 * 一个类实例 = 整个应用的状态。组件只读它、调它的方法，方便以后把这里的
 * 模拟实现替换成 Wails 绑定（或容器端 WebSocket）而不动 UI。
 *
 * 刻意保留真实产品的硬规则：
 *   - 最多 3 个任务并发（downloading / merging 占槽）
 *   - 暂停不占槽；继续要先回 queued 再调度
 *   - 合并阶段单独展示，完成后才写历史
 *   - 解析没有真实进度，只有阶段 + 已用秒数
 */
import {
  DEFAULT_SETTINGS,
  SAMPLE_URL,
  SAMPLE_URLS,
  STORAGE_FREE,
  STORAGE_TOTAL,
  depsSeed,
  extractUrl,
  historySeed,
  makeVideoInfo,
  type DemoSettings,
  type DemoVideo,
  type DepItem,
  type HistoryItem,
  type Mode,
  type TaskItem,
} from './mock'
import { getLocale, resolveLocale, setLocale, t, type Locale } from './i18n.svelte'

export type Tab = 'download' | 'history' | 'settings' | 'about'
export type ParseState = 'idle' | 'parsing' | 'done' | 'error'
export type Dialog = 'none' | 'update' | 'deps'
export type SettingsSection = 'download' | 'network' | 'acceleration' | 'deps' | 'update' | 'interface'
export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready'

export interface ToastItem {
  id: number
  text: string
  kind: 'info' | 'success' | 'error'
}

const STORAGE_KEY = 'downvid.demo.settings'
const MAX_ACTIVE = 3
const TICK_MS = 320

function loadSettings(): DemoSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<DemoSettings>) }
  } catch {
    /* demo 里坏掉的存档直接忽略 */
  }
  return { ...DEFAULT_SETTINGS }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function sanitizeFilename(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
}

class DemoStore {
  // ---- 导航 / 浮层 ----
  tab = $state<Tab>('download')
  dialog = $state<Dialog>('none')
  demoOpen = $state(false)
  railOpen = $state(true)

  // ---- 解析 ----
  parseState = $state<ParseState>('idle')
  parseStage = $state(0)
  parseElapsed = $state(0)
  parseError = $state('')
  parseErrorDetail = $state('')
  url = $state(SAMPLE_URL)
  video = $state<DemoVideo | null>(null)
  mode = $state<Mode>('video')
  selectedFormatId = $state<string | null>(null)
  selectedAudioId = $state<string | null>(null)
  selectedTrackId = $state<string | null>(null)
  subtitles = $state<string[]>([])

  // ---- 下载队列 ----
  tasks = $state<TaskItem[]>([])

  // ---- 历史 ----
  history = $state<HistoryItem[]>(historySeed())
  historySearch = $state('')
  historyFilter = $state<'all' | 'done' | 'missing'>('all')

  // ---- 设置 ----
  settings = $state<DemoSettings>(loadSettings())
  settingsSection = $state<SettingsSection>('download')
  autoSaveVisible = $state(false)
  proxyTesting = $state(false)
  proxyOk = $state(false)
  lang = $state<Locale>('zh-CN')

  // ---- 依赖 ----
  deps = $state<DepItem[]>(depsSeed())
  depsChecking = $state(false)
  depsPromptBusy = $state(false)
  depsPromptProgress = $state(0)

  // ---- 更新 ----
  update = $state<{ status: UpdateStatus; progress: number }>({ status: 'idle', progress: 0 })

  // ---- 反馈 ----
  toasts = $state<ToastItem[]>([])
  storageFree = $state(STORAGE_FREE)

  // 非响应式：计时器与内部标记
  private started = false
  private ticker: number | undefined
  private parseTimers: number[] = []
  private elapsedTimer: number | undefined
  private autoSaveTimer: number | undefined
  private toastSeq = 0

  // ============================================================
  // 生命周期
  // ============================================================

  init(): void {
    if (this.started) return
    this.started = true

    const params = new URLSearchParams(window.location.search)
    const lang = params.get('lang')
    if (lang === 'en' || lang === 'en-US') this.settings.language = 'en-US'
    else if (lang === 'zh' || lang === 'zh-CN') this.settings.language = 'zh-CN'
    this.applyLanguage(this.settings.language)

    const tab = params.get('tab')
    if (tab === 'download' || tab === 'history' || tab === 'settings' || tab === 'about') {
      this.tab = tab
    }

    this.ticker = window.setInterval(() => this.tick(), TICK_MS)

    const state = params.get('state')
    if (state === 'parsing') this.demoParsing()
    else if (state === 'parsed') this.demoParsed()
    else if (state === 'error') this.demoError()
    else if (state === 'busy') this.demoBusy()

    if (params.get('update') === '1') this.demoUpdate()
    if (params.get('deps') === '1') this.demoDeps()
  }

  destroy(): void {
    if (this.ticker) window.clearInterval(this.ticker)
    this.clearParseTimers()
    if (this.autoSaveTimer) window.clearTimeout(this.autoSaveTimer)
  }

  // ============================================================
  // 导航 / 语言
  // ============================================================

  setTab(tab: Tab): void {
    this.tab = tab
  }

  private applyLanguage(setting: DemoSettings['language']): void {
    const next = resolveLocale(setting)
    this.lang = next
    setLocale(next)
  }

  setLanguage(setting: DemoSettings['language']): void {
    this.settings = { ...this.settings, language: setting }
    this.applyLanguage(setting)
    this.persistSettings()
  }

  toggleLocale(): void {
    this.setLanguage(getLocale() === 'zh-CN' ? 'en-US' : 'zh-CN')
  }

  // ============================================================
  // 解析
  // ============================================================

  private clearParseTimers(): void {
    for (const id of this.parseTimers) window.clearTimeout(id)
    this.parseTimers = []
    if (this.elapsedTimer) window.clearInterval(this.elapsedTimer)
    this.elapsedTimer = undefined
  }

  parse(hold = false): void {
    if (this.parseState === 'parsing') return
    const raw = this.url.trim()
    if (!raw) {
      this.toast(t('toast.parseFirst'), 'error')
      return
    }
    const extracted = extractUrl(raw)
    if (!extracted) {
      this.showParseError(t('error.invalidLink'), raw)
      return
    }
    if (extracted.includes('example.invalid')) {
      this.showParseError(t('error.sampleMessage'), 'ERROR: Private video. Sign in if you have been granted access to this video.')
      return
    }

    this.clearParseTimers()
    this.url = extracted
    this.video = null
    this.parseState = 'parsing'
    this.parseStage = 0
    this.parseElapsed = 0
    this.parseError = ''
    this.parseErrorDetail = ''

    this.parseTimers.push(window.setTimeout(() => (this.parseStage = 1), 620))
    this.parseTimers.push(window.setTimeout(() => (this.parseStage = 2), 1480))
    this.parseTimers.push(window.setTimeout(() => (this.parseStage = 3), 2320))
    this.elapsedTimer = window.setInterval(() => (this.parseElapsed += 1), 1000)
    if (!hold) {
      this.parseTimers.push(window.setTimeout(() => this.finishParse(extracted), 3050))
    }
  }

  private finishParse(url: string): void {
    this.clearParseTimers()
    const video = makeVideoInfo(url)
    this.video = video
    this.parseState = 'done'
    this.applyDefaults(video)
  }

  private applyDefaults(video: DemoVideo): void {
    this.mode = 'video'
    const recommended = video.formats.find((f) => f.recommended) ?? video.formats[0] ?? null
    this.selectedFormatId = recommended ? recommended.id : null
    this.selectedAudioId = null
    this.selectedTrackId = video.tracks[0]?.id ?? null
    this.subtitles = []
  }

  private showParseError(message: string, detail: string): void {
    this.clearParseTimers()
    this.parseState = 'error'
    this.parseError = message
    this.parseErrorDetail = detail
    this.video = null
  }

  cancelParse(): void {
    this.clearParseTimers()
    this.parseState = 'idle'
    this.parseStage = 0
    this.parseElapsed = 0
  }

  clearResult(): void {
    this.clearParseTimers()
    this.parseState = 'idle'
    this.video = null
    this.parseStage = 0
    this.url = ''
  }

  setMode(mode: Mode): void {
    this.mode = mode
    if (mode === 'video' && !this.selectedFormat && this.video?.formats.length) {
      this.selectedFormatId = this.video.formats[0].id
    }
    if (mode === 'audio' && !this.selectedAudio && this.video?.audios.length) {
      this.selectedAudioId = this.video.audios[0].id
    }
    if (mode === 'subtitle' && this.subtitles.length === 0 && this.video?.subtitles.length) {
      this.subtitles = [this.video.subtitles[0].lang]
    }
  }

  selectFormat(id: string): void {
    this.selectedFormatId = id
    this.mode = 'video'
  }

  selectAudio(id: string): void {
    this.selectedAudioId = id
    this.mode = 'audio'
  }

  selectTrack(id: string): void {
    this.selectedTrackId = id
  }

  toggleSubtitle(lang: string): void {
    this.mode = 'subtitle'
    this.subtitles = this.subtitles.includes(lang)
      ? this.subtitles.filter((l) => l !== lang)
      : [...this.subtitles, lang]
  }

  // ============================================================
  // 选择结果（getter 保持响应式）
  // ============================================================

  get selectedFormat() {
    return this.video?.formats.find((f) => f.id === this.selectedFormatId) ?? null
  }

  get selectedAudio() {
    return this.video?.audios.find((a) => a.id === this.selectedAudioId) ?? null
  }

  get selectedTrack() {
    return this.video?.tracks.find((track) => track.id === this.selectedTrackId) ?? null
  }

  get canDownload(): boolean {
    if (this.parseState !== 'done' || !this.video) return false
    if (this.mode === 'video') return this.selectedFormat !== null
    if (this.mode === 'audio') return this.selectedAudio !== null
    return this.subtitles.length > 0
  }

  get selectionSummary(): string {
    if (this.mode === 'video' && this.selectedFormat) {
      const f = this.selectedFormat
      return t('format.summaryVideo', { quality: f.label, ext: f.ext, size: this.formatSize(f.sizeBytes) })
    }
    if (this.mode === 'audio' && this.selectedAudio) {
      const a = this.selectedAudio
      return t('format.summaryAudio', { quality: a.label, ext: a.ext, size: this.formatSize(a.sizeBytes) })
    }
    return t('format.summarySubtitle', { count: this.subtitles.length })
  }

  get selectionHint(): string {
    if (this.mode === 'video') return t('format.selectHint')
    if (this.mode === 'audio') return t('format.selectAudioHint')
    return t('format.selectSubtitleHint')
  }

  get selectionBytes(): number {
    if (this.mode === 'video') return this.selectedFormat?.sizeBytes ?? 0
    if (this.mode === 'audio') return this.selectedAudio?.sizeBytes ?? 0
    return this.subtitles.length * 64 * 1024
  }

  private formatSize(bytes: number): string {
    return this.formatBytes(bytes)
  }

  formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  // ============================================================
  // 下载队列
  // ============================================================

  private createTask(video: DemoVideo, mode: Mode, quality: string, ext: string, sizeBytes: number): TaskItem {
    const now = Date.now()
    return {
      id: uid(),
      title: video.title,
      thumbnail: video.thumbnail,
      url: video.url,
      mode,
      quality,
      ext,
      totalBytes: sizeBytes,
      bytesDone: 0,
      progress: 0,
      speedBps: 0,
      speedBase: 0,
      etaSec: 0,
      status: 'queued',
      createdAt: now,
      startedAt: 0,
      seed: Math.random() * 10,
      speedHistory: [],
      filePath: this.settings.downloadDir + '/' + sanitizeFilename(video.title) + '.' + ext.toLowerCase(),
    }
  }

  addDownload(): void {
    if (!this.video || !this.canDownload) return
    const video = this.video
    let task: TaskItem
    if (this.mode === 'video' && this.selectedFormat) {
      const f = this.selectedFormat
      task = this.createTask(video, 'video', f.label, f.ext, f.sizeBytes)
    } else if (this.mode === 'audio' && this.selectedAudio) {
      const a = this.selectedAudio
      task = this.createTask(video, 'audio', a.label, a.ext, a.sizeBytes)
    } else {
      task = this.createTask(video, 'subtitle', t('mode.subtitle'), 'SRT', this.subtitles.length * 64 * 1024)
    }
    this.tasks = [task, ...this.tasks]
    this.railOpen = true
    this.pump()
    this.toast(t('toast.queued'), 'success')
  }

  private pump(): void {
    const active = this.tasks.filter(
      (task) => task.status === 'downloading' || task.status === 'merging',
    ).length
    if (active >= MAX_ACTIVE) return
    const queued = this.tasks
      .filter((task) => task.status === 'queued')
      .sort((a, b) => a.createdAt - b.createdAt)
    for (const task of queued.slice(0, MAX_ACTIVE - active)) {
      task.status = 'downloading'
      task.startedAt = Date.now()
      task.speedBase = (8 + Math.random() * 6) * 1024 * 1024
      task.speedBps = task.speedBase
    }
  }

  private tick(): void {
    const now = Date.now()
    let changed = false
    for (const task of this.tasks) {
      if (task.status === 'downloading') {
        const wobble = 0.78 + 0.22 * Math.sin((now - task.startedAt) / 820 + task.seed)
        task.speedBps = task.speedBase * wobble
        task.bytesDone = Math.min(task.totalBytes, task.bytesDone + task.speedBps * (TICK_MS / 1000))
        task.progress = task.bytesDone / task.totalBytes
        const remaining = Math.max(1, task.totalBytes - task.bytesDone)
        task.etaSec = Math.round(remaining / Math.max(1, task.speedBps))
        task.speedHistory = [...task.speedHistory, task.speedBps].slice(-24)
        changed = true
        if (task.progress >= 1) {
          task.status = 'merging'
          task.progress = 1
          task.speedBps = 0
          task.mergeUntil = now + 1600
        }
      } else if (task.status === 'merging' && task.mergeUntil && now >= task.mergeUntil) {
        this.completeTask(task)
        changed = true
      }
    }
    if (changed) this.pump()
  }

  private completeTask(task: TaskItem): void {
    task.status = 'completed'
    task.progress = 1
    task.speedBps = 0
    task.etaSec = 0
    this.storageFree = Math.max(0, this.storageFree - task.totalBytes)
    const record: HistoryItem = {
      id: uid(),
      title: task.title,
      thumbnail: task.thumbnail,
      url: task.url,
      filePath: task.filePath,
      quality: task.quality,
      ext: task.ext,
      mode: task.mode,
      sizeBytes: task.totalBytes,
      createdAt: Date.now(),
      fileExists: true,
    }
    this.history = [record, ...this.history.filter((h) => h.filePath !== record.filePath)]
    this.toast(t('toast.completed', { title: task.title.slice(0, 28) }), 'success')
  }

  togglePause(id: string): void {
    const task = this.tasks.find((item) => item.id === id)
    if (!task) return
    if (task.status === 'downloading' || task.status === 'merging') {
      task.status = 'paused'
      task.speedBps = 0
      task.mergeUntil = undefined
    } else if (task.status === 'paused') {
      task.status = 'queued'
      this.pump()
    }
  }

  cancelTask(id: string): void {
    this.tasks = this.tasks.filter((task) => task.id !== id)
    this.pump()
  }

  retryTask(id: string): void {
    const task = this.tasks.find((item) => item.id === id)
    if (!task) return
    task.status = 'queued'
    task.progress = 0
    task.bytesDone = 0
    task.speedBps = 0
    task.etaSec = 0
    task.error = undefined
    task.speedHistory = []
    this.pump()
  }

  clearCompleted(): void {
    this.tasks = this.tasks.filter((task) => task.status !== 'completed' && task.status !== 'error')
  }

  openTaskFolder(): void {
    this.toast(t('toast.folder'), 'info')
  }

  get activeTasks(): TaskItem[] {
    return this.tasks.filter(
      (task) => task.status === 'downloading' || task.status === 'merging' || task.status === 'paused',
    )
  }

  get queuedTasks(): TaskItem[] {
    return this.tasks.filter((task) => task.status === 'queued').sort((a, b) => a.createdAt - b.createdAt)
  }

  get finishedTasks(): TaskItem[] {
    return this.tasks.filter((task) => task.status === 'completed' || task.status === 'error').slice(0, 3)
  }

  get totalSpeed(): number {
    return this.tasks
      .filter((task) => task.status === 'downloading')
      .reduce((sum, task) => sum + task.speedBps, 0)
  }

  get railVisible(): boolean {
    return this.railOpen && this.tasks.length > 0 && this.tab !== 'settings' && this.tab !== 'about'
  }

  get hasTasks(): boolean {
    return this.tasks.length > 0
  }

  // ============================================================
  // 历史
  // ============================================================

  get filteredHistory(): HistoryItem[] {
    const query = this.historySearch.trim().toLowerCase()
    return this.history.filter((item) => {
      if (this.historyFilter === 'done' && !item.fileExists) return false
      if (this.historyFilter === 'missing' && item.fileExists) return false
      if (!query) return true
      return (
        item.title.toLowerCase().includes(query) || item.filePath.toLowerCase().includes(query)
      )
    })
  }

  get groupedHistory(): { key: 'today' | 'yesterday' | 'earlier'; items: HistoryItem[] }[] {
    const groups: { key: 'today' | 'yesterday' | 'earlier'; items: HistoryItem[] }[] = []
    const now = Date.now()
    for (const item of this.filteredHistory) {
      const key = dayGroupOf(item.createdAt, now)
      const existing = groups.find((group) => group.key === key)
      if (existing) existing.items.push(item)
      else groups.push({ key, items: [item] })
    }
    return groups
  }

  removeHistory(id: string): void {
    this.history = this.history.filter((item) => item.id !== id)
    this.toast(t('toast.deleted'), 'success')
  }

  clearHistory(): void {
    this.history = []
    this.toast(t('toast.cleared'), 'success')
  }

  reparse(item: HistoryItem): void {
    this.tab = 'download'
    this.url = item.url
    this.parse()
  }

  openHistoryFolder(item: HistoryItem): void {
    this.toast(item.fileExists ? t('toast.folder') : t('toast.fileMissing'), item.fileExists ? 'info' : 'error')
  }

  // ============================================================
  // 设置
  // ============================================================

  updateSetting<K extends keyof DemoSettings>(key: K, value: DemoSettings[K]): void {
    this.settings = { ...this.settings, [key]: value }
    if (key === 'language') this.applyLanguage(value as DemoSettings['language'])
    this.persistSettings()
    this.autoSaveVisible = true
    if (this.autoSaveTimer) window.clearTimeout(this.autoSaveTimer)
    this.autoSaveTimer = window.setTimeout(() => (this.autoSaveVisible = false), 2000)
  }

  private persistSettings(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings))
    } catch {
      /* 隐私模式下写不进去，不影响预览 */
    }
  }

  resetSettings(): void {
    this.settings = { ...DEFAULT_SETTINGS }
    this.applyLanguage('auto')
    this.persistSettings()
    this.toast(t('toast.settingsReset'), 'success')
  }

  async testProxy(): Promise<void> {
    if (this.proxyTesting) return
    this.proxyTesting = true
    this.proxyOk = false
    await sleep(900)
    this.proxyTesting = false
    this.proxyOk = true
    this.toast(t('settings.proxyOk'), 'success')
  }

  // ============================================================
  // 依赖
  // ============================================================

  get depsReady(): boolean {
    return this.deps.filter((dep) => dep.required).every((dep) => dep.status === 'ready')
  }

  get missingRequiredDeps(): DepItem[] {
    return this.deps.filter((dep) => dep.required && dep.status !== 'ready')
  }

  async checkDeps(): Promise<void> {
    if (this.depsChecking) return
    this.depsChecking = true
    await sleep(1200)
    this.depsChecking = false
    this.toast(t('toast.depsReady'), 'success')
  }

  async installDep(id: string): Promise<void> {
    const dep = this.deps.find((item) => item.id === id)
    if (!dep) return
    dep.busy = true
    dep.progress = 0
    for (let p = 0; p <= 1; p += 0.06) {
      await sleep(110)
      dep.progress = Math.min(1, p)
    }
    dep.busy = false
    dep.progress = undefined
    dep.status = 'ready'
    dep.source = 'managed'
    dep.version = dep.id === 'aria2c' ? '1.37.0' : '2026.10.10'
    dep.path = '~/Library/Application Support/DownVid/runtime/bin/' + dep.id
    this.toast(t(dep.id === 'aria2c' ? 'toast.aria2' : 'toast.depsReady'), 'success')
  }

  demoDeps(): void {
    this.deps = this.deps.map((dep) =>
      dep.id === 'ffmpeg'
        ? { ...dep, status: 'missing', version: undefined, source: 'none', path: undefined }
        : dep,
    )
    this.depsPromptProgress = 0
    this.depsPromptBusy = false
    this.dialog = 'deps'
  }

  async downloadPromptDeps(): Promise<void> {
    if (this.depsPromptBusy) return
    this.depsPromptBusy = true
    this.depsPromptProgress = 0
    for (let p = 0; p <= 1; p += 0.05) {
      await sleep(100)
      this.depsPromptProgress = Math.min(1, p)
    }
    this.depsPromptBusy = false
    this.deps = this.deps.map((dep) => (dep.id === 'ffmpeg' ? { ...dep, status: 'ready' } : dep))
    this.dialog = 'none'
    this.toast(t('toast.depsReady'), 'success')
  }

  // ============================================================
  // 更新
  // ============================================================

  async checkUpdate(): Promise<void> {
    if (this.update.status === 'checking') return
    this.update = { status: 'checking', progress: 0 }
    await sleep(1100)
    this.update = { status: 'available', progress: 0 }
    this.dialog = 'update'
  }

  openUpdateDialog(): void {
    if (this.update.status === 'available' || this.update.status === 'ready') {
      this.dialog = 'update'
    } else if (this.update.status === 'idle') {
      void this.checkUpdate()
    } else {
      this.dialog = 'update'
    }
  }

  async downloadUpdate(): Promise<void> {
    if (this.update.status !== 'available') return
    this.update = { status: 'downloading', progress: 0 }
    while (this.update.status === 'downloading' && this.update.progress < 1) {
      await sleep(110)
      this.update = {
        status: 'downloading',
        progress: Math.min(1, this.update.progress + 0.045),
      }
    }
    this.update = { status: 'ready', progress: 1 }
    this.toast(t('toast.updateDownloaded'), 'success')
  }

  installUpdate(): void {
    this.dialog = 'none'
    this.update = { status: 'ready', progress: 1 }
    this.toast(t('toast.updateReady'), 'success')
  }

  demoUpdate(): void {
    this.update = { status: 'available', progress: 0 }
    this.dialog = 'update'
  }

  // ============================================================
  // Toast
  // ============================================================

  toast(text: string, kind: ToastItem['kind'] = 'info', duration = 3200): void {
    const id = ++this.toastSeq
    this.toasts = [...this.toasts, { id, text, kind }]
    window.setTimeout(() => this.dismissToast(id), duration)
  }

  dismissToast(id: number): void {
    this.toasts = this.toasts.filter((toast) => toast.id !== id)
  }

  // ============================================================
  // 演示控制台
  // ============================================================

  demoIdle(): void {
    this.clearParseTimers()
    this.parseState = 'idle'
    this.parseStage = 0
    this.parseElapsed = 0
    this.parseError = ''
    this.video = null
    this.tasks = []
    this.tab = 'download'
    this.dialog = 'none'
    this.railOpen = true
    this.url = SAMPLE_URL
  }

  demoParsing(): void {
    this.tab = 'download'
    this.dialog = 'none'
    this.tasks = []
    this.video = null
    this.url = SAMPLE_URL
    this.parse(true)
  }

  demoParsed(): void {
    this.tab = 'download'
    this.dialog = 'none'
    this.tasks = []
    this.url = SAMPLE_URL
    this.clearParseTimers()
    this.finishParse(SAMPLE_URL)
  }

  demoError(): void {
    this.tab = 'download'
    this.dialog = 'none'
    this.tasks = []
    this.url = SAMPLE_URL
    this.showParseError(
      t('error.sampleMessage'),
      'ERROR: [youtube] n_PxJ2Pyecl: Private video. Sign in if you have been granted access to this video',
    )
  }

  demoBusy(): void {
    this.tab = 'download'
    this.dialog = 'none'
    this.clearParseTimers()
    this.finishParse(SAMPLE_URL)
    const youtube = this.video!
    const bilibili = makeVideoInfo(SAMPLE_URLS.bilibili)
    const douyin = makeVideoInfo(SAMPLE_URLS.douyin)

    const main = this.createTask(youtube, 'video', '1080P60', 'MP4', 457.1 * 1024 * 1024)
    main.status = 'downloading'
    main.startedAt = Date.now() - 9000
    main.speedBase = 9.2 * 1024 * 1024
    main.bytesDone = main.totalBytes * 0.42
    main.progress = 0.42
    main.etaSec = 31
    main.speedHistory = seedSpeedHistory(9.2 * 1024 * 1024)

    const second = this.createTask(bilibili, 'video', '1080P60', 'MP4', 612.0 * 1024 * 1024)
    second.status = 'downloading'
    second.startedAt = Date.now() - 4000
    second.speedBase = 5.3 * 1024 * 1024
    second.bytesDone = second.totalBytes * 0.18
    second.progress = 0.18
    second.etaSec = 78
    second.speedHistory = seedSpeedHistory(5.3 * 1024 * 1024)

    const third = this.createTask(douyin, 'video', '1080P', 'MP4', 24.8 * 1024 * 1024)
    third.status = 'downloading'
    third.startedAt = Date.now() - 1500
    third.speedBase = 3.6 * 1024 * 1024
    third.bytesDone = third.totalBytes * 0.08
    third.progress = 0.08
    third.etaSec = 6
    third.speedHistory = seedSpeedHistory(3.6 * 1024 * 1024)

    const queued = this.createTask(makeVideoInfo(SAMPLE_URLS.xiaohongshu), 'video', '1080P', 'MP4', 88.6 * 1024 * 1024)
    queued.createdAt = Date.now() - 6000

    const done = this.createTask(makeVideoInfo(SAMPLE_URLS.bilibili), 'audio', 'M4A 192k', 'M4A', 29.8 * 1024 * 1024)
    done.status = 'completed'
    done.progress = 1
    done.bytesDone = done.totalBytes
    done.createdAt = Date.now() - 120000

    this.tasks = [main, second, third, queued, done]
    this.railOpen = true
  }

  demoAddTask(): void {
    if (this.parseState !== 'done' || !this.video) this.demoParsed()
    this.addDownload()
  }

  resetDemo(): void {
    this.settings = { ...DEFAULT_SETTINGS }
    this.applyLanguage('auto')
    this.deps = depsSeed()
    this.history = historySeed()
    this.historySearch = ''
    this.historyFilter = 'all'
    this.update = { status: 'idle', progress: 0 }
    this.storageFree = STORAGE_FREE
    this.depsPromptBusy = false
    this.depsPromptProgress = 0
    this.demoIdle()
    this.toast(t('toast.settingsReset'), 'info')
  }

  get demoStateLabel(): string {
    if (this.tasks.some((task) => task.status === 'downloading' || task.status === 'merging')) {
      return 'busy'
    }
    return this.parseState
  }

  async copyStateLink(): Promise<void> {
    const params = new URLSearchParams()
    params.set('tab', this.tab)
    const state = this.demoStateLabel
    if (state === 'parsing' || state === 'done' || state === 'error') {
      params.set('state', state === 'done' ? 'parsed' : state)
    } else if (state === 'busy') {
      params.set('state', 'busy')
    }
    params.set('lang', getLocale() === 'zh-CN' ? 'zh' : 'en')
    const link = window.location.origin + window.location.pathname + '?' + params.toString()
    try {
      await navigator.clipboard.writeText(link)
      this.toast(t('demo.linkCopied'), 'success')
    } catch {
      this.toast(link, 'info', 6000)
    }
  }

  get storageUsedPercent(): number {
    return Math.round(((STORAGE_TOTAL - this.storageFree) / STORAGE_TOTAL) * 100)
  }

  get freeStorageLabel(): string {
    return this.formatBytes(this.storageFree)
  }
}

function dayGroupOf(ts: number, now: number): 'today' | 'yesterday' | 'earlier' {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const base = start.getTime()
  if (ts >= base) return 'today'
  if (ts >= base - 86_400_000) return 'yesterday'
  return 'earlier'
}

function seedSpeedHistory(base: number): number[] {
  return Array.from({ length: 20 }, (_, index) => base * (0.72 + 0.28 * Math.sin(index / 2.1)))
}

export const app = new DemoStore()
