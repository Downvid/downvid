/**
 * 应用状态机（单例）。
 *
 * 一个类实例 = 整个应用的状态。组件只读它、调它的方法。
 *
 * ## 与旧版（演示版）的差别
 *
 * 旧版每个方法里都是 `await sleep(1100)` + `Math.random()` 造假进度。
 * 现在**全部走后端**：
 *
 * | 行为 | 后端接口 |
 * |---|---|
 * | 解析 | `parseUrl()` → `Parse` |
 * | 下载 | `startDownload()` → `StartDownload` |
 * | 进度 | `onProgress()` 订阅 `download:progress` 事件 |
 * | 暂停 | `pauseDownload()` |
 * | 历史 | `historyList` / `historyAdd` / `historyDelete` |
 * | 依赖 | `detectDeps` / `installDeps` / `onDepsProgress` |
 * | 设置 | `loadSettings` / `saveSettings` |
 * | 更新 | `checkUpdate` |
 * | 系统 | `openPath` / `showInFolder` / `openExternal` / `diskSpace` |
 *
 * ## 保留的三条硬规则（都是真实产品的行为，不是演示的凑数）
 *
 * 1. **最多 3 个任务并发**（`downloading` / `merging` 占槽）
 * 2. **暂停不占槽**；继续要先回 `queued` 再调度
 * 3. **合并阶段单独展示**，完成后才写历史
 *
 * 注意规则 1 应该由**主进程**保证（它是唯一知道真实并发的地方），
 * 前端这份只是「别一次发 10 个请求」的本地节流。两者不一致时
 * 以主进程为准——前端多发的会被后端排队或拒绝。
 */
import {
  appVersion,
  checkUpdate as backendCheckUpdate,
  defaultDownloadDir,
  depsSummary,
  detectDeps,
  diskSpace,
  errorMarker,
  fetchImage,
  getCookieStatus,
  type CookieStatus,
  historyAdd,
  historyClear,
  historyDelete,
  historyList,
  installDeps,
  loadSettings,
  managedDir,
  onDepsProgress,
  onProgress,
  openExternal,
  openPath,
  parseUrl,
  pauseDownload,
  resetSettings as backendResetSettings,
  saveSettings,
  showInFolder,
  pickDirectory,
  pickFile,
  platform as backendPlatform,
  onUpdateProgress,
  requestUpdateDownload,
  requestUpdateInstall,
  changelogHistory as backendChangelogHistory,
  type ChangelogEntry,
  type MigrationHint,
  startDownload,
  stripMarker,
  testProxy as backendTestProxy,
} from './backend'
import { CONNECTION_STOPS, nearestConnectionStop, type Mode, type Tab } from './constants'
import { getLocale, resolveLocale, setLocale, t, type Locale } from './i18n.svelte'
import {
  DEFAULT_SETTINGS,
  fromBackend,
  loadLocalPrefs,
  saveLocalPrefs,
  toBackendPatch,
  type AppSettings,
} from './settings'
import { fetchAnnouncement, loadLocalAnnouncement, type AnnouncementDoc } from './announcement'
import type {
  DepItem,
  Dialog,
  HistoryItem,
  SettingsSection,
  TaskItem,
  ToastItem,
  UpdateStatus,
  VideoInfo,
} from './types'
import { detectPlatform, extractUrl, hostOf, platformName } from './url'
import { findExistingDownload } from './dedupe'
import { applyQualityDisambiguation } from './filename'
import { snapshotForRun } from './snapshot'
import { dayGroup, formatBytes as formatBytesUtil } from './format'

export type ParseState = 'idle' | 'parsing' | 'done' | 'error'

/** 进度节流：后端每 200ms 推一次，前端再合并一次渲染 */
const TICK_MS = 200

/**
 * 后端依赖结果 → 界面模型。
 *
 * 后端的 `kind` 是 `"yt-dlp"` 这种 id，界面还要显示名与「是否可选」——
 * 那两项后端也给了（`optional`），但 `id`/`name` 得在这里补。
 * 补而不是让后端加：显示名要翻译，不该由后端给死中文。
 */
function toDepItems(
  list: Array<{
    kind: string
    found: boolean
    optional?: boolean
    stale?: boolean
    path?: string
    version?: string
    source?: string
    reason?: string
    form?: string
  }>,
  /** 上一次的界面态（busy / progress）：探测不该把「正在下载」冲掉 */
  previous: DepItem[] = [],
): DepItem[] {
  const labels: Record<string, string> = {
    'yt-dlp': 'yt-dlp',
    ffmpeg: 'FFmpeg',
    ffprobe: 'FFprobe',
    // key 是**后端 kind**（aria2），显示名才是二进制名（aria2c）。
    // 早先整个前端用 'aria2c' 当 id，于是 `deps.find(id==='aria2c')` 永远
    // 找不到——加速页就一直显示「未找到 aria2c」，而后端其实探测到了。
    aria2: 'aria2c',
  }
  const optional = new Set(['ffprobe', 'aria2'])
  return list.map((d) => {
    const prev = previous.find((p) => p.id === d.kind)
    return {
      id: d.kind,
      name: labels[d.kind] ?? d.kind,
      found: d.found,
      // 后端给了 optional 就用后端的（单一真相），没有才退回本地表
      optional: d.optional ?? optional.has(d.kind),
      path: d.path,
      version: d.version,
      source: d.source,
      reason: d.reason,
      form: d.form,
      stale: d.stale,
      required: !(d.optional ?? optional.has(d.kind)),
      // 「找到了但版本过旧」与「压根没找到」是两种处置：前者要引导更新，
      // 后者要引导安装。界面上的圆点颜色与按钮文案都靠这个区分。
      status: d.found ? 'ready' : d.stale ? 'outdated' : 'missing',
      busy: prev?.busy ?? false,
      progress: prev?.progress ?? 0,
    }
  })
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

class AppStore {
  // ===== 导航 =====
  tab = $state<Tab>('download')
  dialog = $state<Dialog>('none')
  railOpen = $state(true)
  settingsSection = $state<SettingsSection>('download')

  // ===== 解析 =====
  parseState = $state<ParseState>('idle')
  parseStage = $state(0)
  parseElapsed = $state(0)
  parseError = $state('')
  parseErrorDetail = $state('')
  url = $state('')
  video = $state<VideoInfo | null>(null)
  mode = $state<Mode>('video')
  selectedFormatId = $state<string | null>(null)
  selectedAudioId = $state<string | null>(null)
  selectedTrackId = $state<string | null>(null)
  subtitles = $state<string[]>([])

  // ===== 任务与历史 =====
  tasks = $state<TaskItem[]>([])
  history = $state<HistoryItem[]>([])
  historySearch = $state('')
  historyFilter = $state<'all' | 'done' | 'missing'>('all')

  // ===== 设置 =====
  settings = $state<AppSettings>({ ...DEFAULT_SETTINGS, ...loadLocalPrefs() })
  resolvedTheme = $state<'light' | 'dark'>('light')
  autoSaveVisible = $state(false)
  proxyTesting = $state(false)
  proxyOk = $state(false)
  lang = $state<Locale>('zh-CN')

  // ===== 依赖 =====
  deps = $state<DepItem[]>([])
  depsChecking = $state(false)
  depsPromptBusy = $state(false)
  depsPromptProgress = $state(0)

  // ===== 更新 =====
  /**
   * 更新检查/下载的状态快照。
   *
   * 叫 `updateInfo` 而不是 `update`：`AppStore` 上已经有一个 `update(patch)`
   * 方法（写设置）。同名会让组件里 `app.update.status` 解析成**方法对象**，
   * 于是 `status` 永远是 undefined——界面上的更新按钮因此从来不会变状态。
   */
  updateInfo = $state<{
    status: UpdateStatus
    progress: number
    version?: string
    notes?: string
    summary?: string
    /** Release 发布时间（ISO），仅用于展示 */
    date?: string
    /** 当前二进制属于哪个架构（electron 过渡版 / wails 新架构） */
    architecture?: 'electron' | 'wails'
    /** 新架构迁移判定：这一版有没有发布适合本机的 Wails 包 */
    migration?: MigrationHint
  }>({ status: 'idle', progress: 0 })

  // ===== 公告 =====
  announcementRead = $state(false)

  /**
   * 公告（作者的话）的正文。
   *
   * 优先从**远端**拉（GitHub raw → jsDelivr → gh-proxy 三级降级），
   * 全失败才用构建时打进包里的那一份。
   *
   * 早先只读本地：`fetchAnnouncement()` 写好了却从来没被调用过——
   * 于是「作者的话」永远停在打包那天的内容，作者改了什么用户看不到。
   */
  announcement = $state<AnnouncementDoc | null>(null)
  /** 公告的加载状态：远端取到 vs 用了本地兜底 */
  announcementSource = $state<'idle' | 'loading' | 'remote' | 'local'>('idle')

  // ===== Toast =====
  toasts = $state<ToastItem[]>([])

  // ===== 磁盘 =====
  storageFree = $state(0)
  storageTotal = $state(0)

  // ===== Cookie 状态 =====
  cookieStatus = $state<CookieStatus | null>(null)

  // ===== 应用信息 =====
  version = $state('0.0.0-dev')

  /**
   * 平台标识（`darwin` / `windows` / `linux`）。
   *
   * macOS 上要给窗口红绿灯让出左上角，否则「DownVid」标识被三个圆点压住，
   * 而且那块区域既是红绿灯又拦住了拖拽。浏览器预览时为空串（按非 mac 处理）。
   */
  platform = $state('')

  /**
   * 更新日志（来自本地内嵌的 CHANGELOG，离线可用）。
   *
   * 早先「关于」页的版本列表是**硬编码**的 3 条（v1.5.0 / v1.4.0 / v1.3.4），
   * 内容还是 `t('about.release140Note1')` 这类占位词条——用户点了「查看更新内容」
   * 看到的三句话与真实发布毫无关系。现在读真实的 CHANGELOG。
   */
  changelog = $state<ChangelogEntry[]>([])

  private started = false
  private toastSeq = 0
  private ticker: number | null = null
  private cleanups: Array<() => void> = []

  // ============================================================
  // 生命周期
  // ============================================================

  async init(): Promise<void> {
    if (this.started) return
    this.started = true

    this.applyTheme(this.settings.theme)
    this.applyRadius(this.settings.radius)
    this.applyLanguage(this.settings.language)

    // 后端设置优先于本地默认值（本地只提供 theme / radius）
    const raw = await loadSettings()
    if (raw) this.settings = fromBackend(raw, loadLocalPrefs())
    else this.settings = { ...this.settings, ...loadLocalPrefs() }

    this.applyTheme(this.settings.theme)
    this.applyRadius(this.settings.radius)
    this.applyLanguage(this.settings.language)

    this.version = await appVersion()
    this.platform = await backendPlatform()
    void this.loadChangelog()

    // 默认下载目录：后端返回空时（浏览器预览）留空
    if (!this.settings.downloadDir) {
      const dir = await defaultDownloadDir()
      if (dir) this.settings = { ...this.settings, downloadDir: dir }
    }

    void this.refreshStorage()
    void this.loadHistory()
    void this.refreshCookieStatus()

    // 订阅后端事件。**必须保存 unsubscribe 并在 destroy 时调用**，
    // 否则热重载会累积监听（旧版漏过，表现为「用久了越来越卡」）。
    this.cleanups.push(await onProgress((p) => this.onBackendProgress(p as never)))
    this.cleanups.push(
      await onDepsProgress((p) => {
        const ev = p as { event?: string; downloaded?: number; total?: number; message?: string }
        if (ev.event === 'progress' && ev.total) {
          this.depsPromptProgress = (ev.downloaded ?? 0) / ev.total
        }
      }),
    )

    // 更新下载进度
    this.cleanups.push(
      await onUpdateProgress((p: unknown) => {
        const ev = p as { status?: string; percent?: number; message?: string; version?: string }
        if (ev.status === 'downloading') {
          this.updateInfo = {
            ...this.updateInfo,
            status: 'downloading',
            progress: (ev.percent ?? 0) / 100,
          }
        } else if (ev.status === 'downloaded') {
          this.updateInfo = {
            ...this.updateInfo,
            status: 'downloaded',
            progress: 1,
            version: ev.version ?? this.updateInfo.version,
          }
          this.toast(t('update.downloadedReady'), 'success')
        } else if (ev.status === 'error') {
          this.updateInfo = { ...this.updateInfo, status: 'error', summary: ev.message }
          this.toast(ev.message || t('update.downloadFailed'), 'error')
        }
      }),
    )

    // 依赖探测：不阻塞首屏，失败也不弹错（缺依赖时解析会给出可行动提示）
    void this.checkDepsSilently()

    // 自动检查更新（用户关掉就不查）
    if (this.settings.autoCheckUpdate) {
      void this.checkUpdate(true)
    }
  }

  destroy(): void {
    if (this.ticker !== null) {
      clearInterval(this.ticker)
      this.ticker = null
    }
    for (const off of this.cleanups) {
      try {
        off()
      } catch {
        // 单个 unsubscribe 失败不该阻止其它清理
      }
    }
    this.cleanups = []
    this.started = false
  }

  // ============================================================
  // 主题 / 圆角 / 语言（纯前端）
  // ============================================================

  applyRadius(setting: AppSettings['radius']): void {
    const root = document.documentElement
    root.dataset.radius = setting
  }

  applyTheme(setting: AppSettings['theme']): void {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const dark = setting === 'dark' || (setting === 'auto' && prefersDark)
    this.resolvedTheme = dark ? 'dark' : 'light'
    document.documentElement.dataset.theme = this.resolvedTheme
    document.documentElement.classList.toggle('dark', dark)
  }

  private applyLanguage(setting: AppSettings['language']): void {
    const next = resolveLocale(setting)
    setLocale(next)
    this.lang = getLocale()
  }

  setLanguage(setting: AppSettings['language']): void {
    this.settings = { ...this.settings, language: setting }
    this.applyLanguage(setting)
    void this.persistSettings({ language: setting })
  }

  toggleLocale(): void {
    this.setLanguage(getLocale() === 'zh-CN' ? 'en-US' : 'zh-CN')
  }

  setTheme(setting: AppSettings['theme']): void {
    this.settings = { ...this.settings, theme: setting }
    this.applyTheme(setting)
    // 只存前端：主题是展示偏好，后端不关心
    saveLocalPrefs({ theme: this.settings.theme, radius: this.settings.radius })
  }

  setRadius(setting: AppSettings['radius']): void {
    this.settings = { ...this.settings, radius: setting }
    this.applyRadius(setting)
    saveLocalPrefs({ theme: this.settings.theme, radius: this.settings.radius })
  }

  setTab(tab: Tab): void {
    this.tab = tab
  }

  // ============================================================
  // 解析
  // ============================================================

  /**
   * 解析当前 URL。
   *
   * 旧版这里是 `setTimeout(3050)` + `makeVideoInfo()` 造假数据。
   * 现在调后端，**失败不抛异常**（`parseUrl` 返回 `{ok:false}`）——
   * 解析失败是预期内的常见情况（离线、限流、需要登录）。
   */
  async parse(): Promise<void> {
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

    this.url = extracted
    this.video = null
    this.parseState = 'parsing'
    this.parseStage = 0
    this.parseElapsed = 0
    this.parseError = ''
    this.parseErrorDetail = ''

    // 解析阶段拿不到真实进度（yt-dlp 只在下载阶段输出进度行），
    // 所以只显示已用秒数 + 一个不确定进度条。
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      this.parseElapsed = Math.round((Date.now() - startedAt) / 1000)
    }, 1000)

    try {
      const outcome = await parseUrl(extracted, this.settings.proxy)

      if (!outcome.ok || !outcome.video) {
        this.parseState = 'error'
        this.showParseError(outcome.message || t('error.parseFailed'), outcome.missingKind ?? '')
        return
      }

      this.video = outcome.video
      this.parseState = 'done'
      this.applyDefaults(outcome.video)

      // B 站封面有防盗链，得由主进程代抓（带 Referer）
      if (outcome.video.thumbnail) {
        const referer = outcome.video.host ? `https://${outcome.video.host}/` : ''
        const dataUrl = await fetchImage(outcome.video.thumbnail, referer)
        if (dataUrl && this.video) this.video = { ...this.video, thumbnail: dataUrl }
      }
    } finally {
      clearInterval(timer)
      if (this.parseState === 'parsing') this.parseState = 'idle'
    }
  }

  cancelParse(): void {
    // 解析没有可中断的后端句柄（yt-dlp 进程由主进程管，它自己有超时）。
    // 用户点取消时只清界面状态——后端那次解析会在超时后自行退出。
    this.parseState = 'idle'
    this.parseStage = 0
    this.parseElapsed = 0
  }

  clearResult(): void {
    this.parseState = 'idle'
    this.video = null
    this.selectedFormatId = null
    this.selectedAudioId = null
    this.selectedTrackId = null
    this.subtitles = []
  }

  /**
   * 找出「这条视频 + 这个清晰度 + 这个模式」已经下过的那条历史。
   *
   * ## 为什么必须带上清晰度
   *
   * 早先只比 URL（`normalize(h.url) === normalize(url)`），于是
   * **下过 1080P 就再也下不了 4K**：解析完成后 `alreadyDownloaded` 非空，
   * 底部按钮直接变成「打开历史」，用户完全没有别的入口。
   * 而「同一个视频想要另一个清晰度」恰恰是最常见的一次重复使用——
   * 手机上是 720P、投屏前要 4K，或者先要视频后要音频。
   *
   * 现在的判据是三件事都相同：URL、清晰度、模式（视频/音频/字幕）。
   * 任一不同就允许再下一次，历史里会多一条——**这是对的**：
   * 它们本来就是两个文件。
   *
   * 标题兜底只在 URL 为空时启用：只比标题会把「同名不同视频」
   * （如两个都叫《预告片》）误判成重复。
   */
  private findExistingDownload(
    video: VideoInfo,
    url: string,
    pick: { quality: string; mode: Mode } | null,
  ): HistoryItem | null {
    // 判据抽在 lib/dedupe.ts：那里是不碰 runes 的纯函数，vitest 能直接测。
    return findExistingDownload(this.history, video, url, pick)
  }

  /** 默认选中第一个格式（让「粘贴 → 解析 → 下载」能一路点完） */
  private applyDefaults(video: VideoInfo): void {
    this.selectedFormatId = video.formats[0]?.id ?? null
    this.selectedAudioId = null
    this.selectedTrackId = video.tracks[0]?.id ?? null
    this.subtitles = []
    this.mode = video.formats.length > 0 ? 'video' : video.audios.length > 0 ? 'audio' : 'subtitle'
  }

  private showParseError(message: string, detail: string): void {
    this.parseState = 'error'
    this.parseError = message
    this.parseErrorDetail = detail
  }

  setMode(mode: Mode): void {
    this.mode = mode
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
    this.subtitles = this.subtitles.includes(lang)
      ? this.subtitles.filter((l) => l !== lang)
      : [...this.subtitles, lang]
    this.mode = this.subtitles.length ? 'subtitle' : this.mode === 'subtitle' ? 'video' : this.mode
  }

  // ============================================================
  // 任务
  // ============================================================

  /** 当前选中的格式（视频 / 音频 / 字幕三选一） */
  private currentPick(): {
    formatId: string
    quality: string
    ext: string
    totalBytes: number
    hasAudio: boolean
    /** 分辨率高度；0 / undefined 表示这一格式没有高度（纯音频、直链等） */
    height?: number
  } | null {
    const v = this.video
    if (!v) return null
    if (this.mode === 'video') {
      const f = v.formats.find((x) => x.id === this.selectedFormatId)
      return f
        ? {
            formatId: f.id,
            quality: f.label,
            ext: f.ext,
            totalBytes: f.sizeBytes,
            hasAudio: Boolean(f.hasAudio),
            height: f.height,
          }
        : null
    }
    if (this.mode === 'audio') {
      const a = v.audios.find((x) => x.id === this.selectedAudioId)
      return a ? { formatId: a.id, quality: a.label, ext: a.ext, totalBytes: a.sizeBytes, hasAudio: true } : null
    }
    // 字幕：后端按 formatId 无意义，传视频格式即可（后端看 downloadMode）
    const f = v.formats.find((x) => x.id === this.selectedFormatId)
    return f
      ? { formatId: f.id, quality: t('mode.subtitle'), ext: 'SRT', totalBytes: 0, hasAudio: false }
      : null
  }

  /**
   * 当前「视频 + 清晰度 + 模式」是否已经下过。
   *
   * **必须是派生值，不能是解析时算一次的状态**：用户解析完会换清晰度，
   * 早先算一次的实现会让「换成 4K 之后」仍然显示「已下载过」，
   * 而且底部按钮停在该分支上，根本没有再次下载的入口。
   */
  get alreadyDownloaded(): HistoryItem | null {
    const video = this.video
    if (!video || this.parseState !== 'done') return null
    const pick = this.currentPick()
    return this.findExistingDownload(video, this.url || video.url, {
      quality: pick?.quality ?? '',
      mode: this.mode,
    })
  }

  /**
   * 把当前选中的音轨转成下载用的快照。
   *
   * 返回 undefined 表示「不指定音轨」（走后端默认的 `bestaudio`）。
   * 注意 `formatId` 为空时**也要**带上 language：后端会退化成
   * `bestaudio[language^=xx]`，这比丢掉选择要好。
   */
  private currentTrackSnapshot(): { formatId: string; language: string; isM3u8?: boolean } | undefined {
    if (!this.selectedTrackId) return undefined
    const track = this.video?.tracks.find((x) => x.id === this.selectedTrackId)
    if (!track) return undefined
    return { formatId: track.formatId, language: track.lang, isM3u8: track.isM3u8 }
  }

  /** 是否可下载（界面的按钮 enable 条件） */
  get canDownload(): boolean {
    if (!this.video) return false
    if (this.mode === 'subtitle') return this.subtitles.length > 0
    return this.currentPick() !== null
  }

  /**
   * 加入下载队列。
   *
   * 旧版这里 `createTask` + `pump()` 造进度。现在：建任务 → 调后端 → 订阅事件。
   */
  async addDownload(): Promise<void> {
    const video = this.video
    const pick = this.currentPick()
    if (!video || !pick) return

    // 这一清晰度确实已下过：提示并停在当前页，**不跳走**。
    //
    // 早先这里会自动跳到历史页，用户想换清晰度还得再点回来；
    // 现在留在原地，用户直接改选清晰度就能继续下一次。
    if (this.alreadyDownloaded) {
      this.toast(t('result.alreadyToast'), 'info')
      return
    }

    const task: TaskItem = {
      id: uid(),
      title: video.title,
      thumbnail: video.thumbnail,
      url: video.url,
      mode: this.mode,
      quality: pick.quality,
      ext: pick.ext,
      // 把选择**固化到任务上**：暂停后「继续」要用它，而不是读解析面板。
      // 详见 TaskItem.formatId 的注释（读面板会把续传变成「按当前格式重下」）。
      formatId: pick.formatId,
      hasAudio: pick.hasAudio,
      audioTrack: this.currentTrackSnapshot(),
      // 直链要固化在任务上：它是几十分钟后过期的 CDN 地址，
      // 续传时若回去读解析面板，可能已经指向别的视频了
      directUrl: video.directUrl,
      subtitles: [...this.subtitles],
      totalBytes: pick.totalBytes,
      bytesDone: 0,
      progress: 0,
      speedBps: 0,
      etaSec: 0,
      status: 'queued',
      createdAt: Date.now(),
      startedAt: 0,
      speedHistory: [],
      filePath: '',
    }
    this.tasks = [task, ...this.tasks]
    this.railOpen = true

    await this.launch(task, pick.height)
  }

  /** 真正发起一次下载（也用于重试） */
  private async launch(task: TaskItem, height?: number): Promise<void> {
    // 走 `snapshotForRun`：有任务就用任务的快照，只在首次发起时读界面选择。
    // 这条规则被 7 条用例钉住（见 lib/snapshot.test.ts）。
    const snap = snapshotForRun(task, null)
    if (!snap) return
    const res = await startDownload({
      taskId: task.id,
      url: task.url,
      // 用**任务上**的 formatId，而不是解析面板当前选中的
      formatId: snap.formatId,
      mode: task.mode,
      // 全部从任务上读：任务是一次下载的**完整快照**，
      // 界面上的「当前选中」随时会被用户改掉，不能作为续传依据。
      hasAudio: snap.hasAudio,
      subtitles: snap.subtitles,
      audioTrack: snap.audioTrack,
      directUrl: task.directUrl,
      title: task.title,
      outputDir: this.settings.downloadDir,
      // 有分辨率才让它进文件名。
      //
      // 纯音频/直链这类没有高度的格式，`%(height)s` 会渲染成 `NA`，
      // 产物名就成了 `标题 [NAp].mp4`。这里提前删掉那个占位符，
      // 比让 yt-dlp 事后回退到 format_id（`[mp4]`）更干净。
      filenameTemplate: applyQualityDisambiguation(this.settings.filenameTemplate, height),
    })

    if (!res.ok) {
      this.patchTask(task.id, { status: 'error', error: res.message || t('error.downloadFailed') })
      // 缺依赖时弹「一键下载」——这是用户能自己解决的事
      if (res.missingKind) {
        this.dialog = 'deps'
        this.depsPromptBusy = false
        void this.checkDeps(true)
      }
      return
    }

    this.patchTask(task.id, { status: 'downloading', startedAt: Date.now() })
    this.ensureTicker()
  }

  private patchTask(id: string, patch: Partial<TaskItem>): void {
    this.tasks = this.tasks.map((x) => (x.id === id ? { ...x, ...patch } : x))
  }

  /**
   * 后端进度事件。
   *
   * 后端推的字段是 `percent` 0..100、`totalSize`/`speed`/`eta` 是**已格式化的字符串**
   * （`"12.3 MB"`）——那是给人看的，前端画折线需要数值，所以这里只取 percent，
   * 速度用上一帧差分估算。
   */
  private onBackendProgress(p: {
    taskId: string
    status: string
    percent?: number
    filePath?: string
    error?: string
    message?: string
  }): void {
    const task = this.tasks.find((x) => x.id === p.taskId)
    if (!task) return

    // 已暂停/已取消的任务忽略所有进度（包括迟到的 completed）：
    // 主进程 kill 子进程时可能还会残留一条结束事件，照单全收会把任务
    // 标成「已完成」并清掉暂停标记，用户就只能重新下载了。
    if (task.status === 'paused' || task.status === 'error') return

    const now = Date.now()
    switch (p.status) {
      case 'downloading': {
        const percent = Math.max(0, Math.min(100, p.percent ?? 0))
        const bytesDone = task.totalBytes > 0 ? (task.totalBytes * percent) / 100 : 0
        const dt = (now - (task.startedAt || now)) / 1000
        const speed = dt > 0 ? bytesDone / dt : 0
        this.patchTask(task.id, {
          progress: percent / 100,
          bytesDone,
          speedBps: speed,
          etaSec: speed > 0 && task.totalBytes > 0 ? Math.max(0, Math.round((task.totalBytes - bytesDone) / speed)) : 0,
          speedHistory: [...task.speedHistory, speed].slice(-24),
          filePath: p.filePath || task.filePath,
        })
        break
      }
      case 'merging':
        this.patchTask(task.id, { status: 'merging', progress: 1, speedBps: 0, statusMessage: p.message })
        break
      case 'completed':
        this.patchTask(task.id, { status: 'completed', progress: 1, speedBps: 0, etaSec: 0, filePath: p.filePath || task.filePath })
        this.recordHistory({ ...task, filePath: p.filePath || task.filePath })
        this.toast(t('toast.completed', { title: task.title.slice(0, 28) }), 'success')
        break
      case 'paused':
        this.patchTask(task.id, { status: 'paused', speedBps: 0 })
        break
      case 'error':
        this.patchTask(task.id, { status: 'error', error: stripMarker(p.error || '') || t('error.downloadFailed') })
        break
    }
  }

  /** 写一条历史（后端落盘 + 本地刷新） */
  private recordHistory(task: TaskItem): void {
    const item: HistoryItem = {
      id: task.id,
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
    this.history = [item, ...this.history.filter((h) => h.filePath !== item.filePath)]

    void historyAdd({
      filePath: item.filePath,
      title: item.title,
      thumbnail: item.thumbnail,
      url: item.url,
      format: item.ext,
      quality: item.quality,
      createdAt: new Date(item.createdAt).toISOString(),
    })
  }

  /**
   * 本地并发闸门。
   *
   * 见文件头「硬规则 1」——**主进程才是唯一权威**，这里只是避免一次发太多请求。
   * 后端如果拒绝（返回 `已有下载任务正在进行`），任务会落到 error 状态。
   *
   * 旧版这里还有 `pump()` 从 queued 队列自动补位。现在不需要了：
   * 每个任务在 `addDownload` 时就已发出，后端自己排队。
   */
  private ensureTicker(): void {
    if (this.ticker !== null) return
    this.ticker = window.setInterval(() => {
      const active = this.tasks.some((x) => x.status === 'downloading' || x.status === 'merging')
      if (!active && this.ticker !== null) {
        clearInterval(this.ticker)
        this.ticker = null
      }
    }, TICK_MS)
  }

  /** 暂停（终止整棵进程树，后端等待落盘后才返回） */
  async togglePause(id: string): Promise<void> {
    const task = this.tasks.find((x) => x.id === id)
    if (!task) return

    if (task.status === 'downloading' || task.status === 'merging') {
      await pauseDownload(task.id)
      this.patchTask(id, { status: 'paused', speedBps: 0 })
      return
    }

    if (task.status === 'paused') {
      // 继续 = 重新发起一次下载（yt-dlp 会从 .part 续传）。
      //
      // 用**任务自己**的 formatId / subtitles（`launch` 内部从 task 读）。
      // 早先这里取 `this.currentPick()`——即解析面板当前选中的格式，
      // 而用户暂停后很可能已经解析了别的视频：续传会下成另一个清晰度，
      // 甚至下成另一个视频的格式，而任务标题还是旧的。
      //
      // **没有跨重启恢复**：任务列表只活在内存里，重启后已暂停的任务不会自己回来。
      await this.launch(task)
    }
  }

  async cancelTask(id: string): Promise<void> {
    const task = this.tasks.find((x) => x.id === id)
    if (!task) return
    if (task.status === 'downloading' || task.status === 'merging') {
      await pauseDownload(id)
    }
    this.tasks = this.tasks.filter((x) => x.id !== id)
  }

  async retryTask(id: string): Promise<void> {
    const task = this.tasks.find((x) => x.id === id)
    if (!task) return
    // 重试同样用任务自己的格式：失败的那个任务与「当前选中的格式」
    // 完全可能是两回事（用户已经往下操作了）。
    this.patchTask(id, { status: 'queued', progress: 0, bytesDone: 0, speedBps: 0, etaSec: 0, error: undefined, speedHistory: [] })
    await this.launch(task)
  }

  clearCompleted(): void {
    this.tasks = this.tasks.filter((x) => x.status !== 'completed')
  }

  /**
   * 打开下载目录（状态栏的文件夹按钮、设置页目录旁的按钮都走这里）。
   *
   * 设置里没指定目录时退到系统「下载」目录（后端给的默认值），
   * **不要**退到托管目录——那里放的是 yt-dlp/ffmpeg，不是用户的视频。
   */
  async openDownloadDir(): Promise<void> {
    let dir = this.settings.downloadDir
    if (!dir) dir = await defaultDownloadDir()
    if (!dir) {
      this.toast(t('error.openFolderFailed'), 'error')
      return
    }
    const res = await openPath(dir)
    if (!res.ok) this.toast(res.message || t('error.openFolderFailed'), 'error')
  }

  /**
   * 选一个目录（设置页「默认下载目录」旁边的按钮）。
   *
   * 与 `openDownloadDir()` 分开：那是**打开**，这是**选择**。
   * 早先两者混用，用户点「换目录」却弹出了 Finder。
   */
  async chooseDownloadDir(): Promise<void> {
    const dir = await pickDirectory(t('settings.pickDownloadDir'))
    if (!dir) return // 用户取消：什么都不做，不要弹提示
    this.update({ downloadDir: dir })
    void this.refreshStorage()
  }

  /** 选 Cookie 文件（同样与 openCookieDir 分开） */
  async chooseCookieFile(): Promise<void> {
    const file = await pickFile(t('settings.cookieFile'), ['txt'])
    if (!file) return
    this.update({ cookieFile: file })
    void this.refreshCookieStatus()
  }

  /** 刷新 Cookie 状态 */
  async refreshCookieStatus(): Promise<void> {
    this.cookieStatus = await getCookieStatus()
  }

  /** 打开 Cookie 文件所在的目录 */
  async openCookieDir(): Promise<void> {
    const file = this.settings.cookieFile.trim()
    if (!file) {
      this.toast(t('settings.cookieFileMissing'), 'info')
      return
    }
    // 用「在文件管理器中显示」而不是「打开目录」：直接跳到该文件上，
    // 比让用户在目录里自己找更省事
    const res = await showInFolder(file)
    if (!res.ok) this.toast(res.message || t('error.openFolderFailed'), 'error')
  }

  /** 打开依赖托管目录（设置页「运行依赖」里的入口） */
  async openDepsDir(): Promise<void> {
    const dir = await managedDir()
    if (!dir) {
      this.toast(t('settings.depsNotInstalledYet'), 'info')
      return
    }
    const res = await openPath(dir)
    if (!res.ok) this.toast(res.message || t('error.openFolderFailed'), 'error')
  }

  // ============================================================
  // 历史
  // ============================================================

  async loadHistory(): Promise<void> {
    const rows = await historyList()
    if (!rows) return
    this.history = rows.map((r) => ({
      id: String(r.id ?? ''),
      title: String(r.title ?? ''),
      thumbnail: String(r.thumbnail ?? ''),
      url: String(r.url ?? ''),
      filePath: String(r.filePath ?? ''),
      quality: String(r.quality ?? ''),
      ext: String(r.format ?? 'mp4'),
      mode: 'video' as Mode,
      sizeBytes: Number(r.sizeBytes ?? r.size ?? 0),
      createdAt: Date.parse(String(r.createdAt ?? '')) || Date.now(),
      fileExists: Boolean(r.fileExists),
    }))
  }

  async removeHistory(id: string): Promise<void> {
    if (!(await historyDelete(id))) return
    this.history = this.history.filter((h) => h.id !== id)
  }

  async clearHistory(): Promise<void> {
    if (!(await historyClear())) return
    this.history = []
  }

  /** 从历史重新解析（点历史条目 → 回到下载页） */
  async reparse(item: HistoryItem): Promise<void> {
    this.setTab('download')
    this.url = item.url
    await this.parse()
  }

  async openHistoryFolder(item: HistoryItem): Promise<void> {
    const res = await showInFolder(item.filePath)
    if (!res.ok) this.toast(res.message || t('error.openFolderFailed'), 'error')
  }

  // ============================================================
  // 磁盘
  // ============================================================

  async refreshStorage(): Promise<void> {
    const res = await diskSpace(this.settings.downloadDir)
    if (!res) return
    this.storageFree = res.free
    this.storageTotal = res.total
  }

  // ============================================================
  // 设置
  // ============================================================

  /** 合并写入：只传改了的字段，其余保持不变 */
  private async persistSettings(patch: Partial<AppSettings>): Promise<void> {
    const backendPatch = toBackendPatch(patch)
    if (Object.keys(backendPatch).length === 0) return
    const res = await saveSettings(backendPatch)
    if (!res.ok) this.toast(res.message || t('error.saveFailed'), 'error')
  }

  /**
   * 改设置。**两种调用形式都支持**，因为它们各自更顺手：
   *
   *   updateSetting('maxConnections', 16)          // 单字段，组件里最常见
   *   updateSetting({ theme: 'dark', radius: 'round' }) // 一次改多个
   *
   * ## 为什么必须显式实现两种，而不是只留 patch 形式
   *
   * 组件里写的是 `updateSetting('maxConnections', value)` 这种**两参数**形式。
   * 只声明 `(patch)` 时，运行时会调用 `{...settings, ...'maxConnections'}`——
   * 把字符串按字符下标展开成 `{0:'m',1:'a',...}`，**设置一个字段都没改**，
   * 而且不报错。表现就是「滑块拖了、界面数值变了、重启又回去」。
   *
   * 这不是假设：`.svelte` 里的类型错误 `tsc` 检查不到（它不解析 .svelte），
   * 于是这个错签名的调用一直存在，直到接入 svelte-check 才暴露。
   */
  updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void
  updateSetting(patch: Partial<AppSettings>): void
  updateSetting(keyOrPatch: keyof AppSettings | Partial<AppSettings>, value?: unknown): void {
    if (typeof keyOrPatch === 'string') {
      this.update({ [keyOrPatch]: value } as Partial<AppSettings>)
      return
    }
    this.update(keyOrPatch)
  }

  /** 写入并落盘。字段级的副作用（主题/圆角/语言）在这里统一触发 */
  update(patch: Partial<AppSettings>): void {
    this.settings = { ...this.settings, ...patch }
    if (patch.theme) this.applyTheme(patch.theme)
    if (patch.radius) this.applyRadius(patch.radius)
    if (patch.language) this.applyLanguage(patch.language)
    void this.persistSettings(patch)
  }

  async resetAllSettings(): Promise<void> {
    const res = await backendResetSettings()
    if (!res.ok) {
      this.toast(res.message || t('error.saveFailed'), 'error')
      return
    }
    this.settings = { ...DEFAULT_SETTINGS, ...loadLocalPrefs() }
    this.applyTheme(this.settings.theme)
    this.applyRadius(this.settings.radius)
    this.applyLanguage(this.settings.language)
  }

  /**
   * 测试代理连通性。
   *
   * 真的发一次请求（后端 `TestProxy` → `netx.Probe`），不是正则校验。
   *
   * 早先这里只跑正则，于是「Clash 没开」「端口填错」「填了 socks5」
   * 全都显示「代理可用」。随后所有下载都超时，而用户以为代理没问题——
   * **假阳性比不检查更糟**。
   */
  async testProxy(): Promise<void> {
    this.proxyTesting = true
    try {
      const proxy = this.settings.proxy.trim()
      const res = await backendTestProxy(proxy)
      if (!res) {
        // 浏览器预览：如实说明没有后端，不说「可用」
        this.proxyOk = false
        this.toast(t('toast.proxyNoBackend'), 'info')
        return
      }

      this.proxyOk = res.ok
      if (res.ok) {
        // 延迟对用户有实际意义（判断代理是否慢到影响下载）
        this.toast(
          proxy
            ? t('toast.proxyOkLatency', { ms: res.latencyMs ?? 0 })
            : t('toast.directOkLatency', { ms: res.latencyMs ?? 0 }),
          'success',
        )
      } else {
        this.toast(res.error || t('toast.proxyBad'), 'error')
      }
    } finally {
      this.proxyTesting = false
    }
  }

  // ============================================================
  // 依赖
  // ============================================================

  /** 首屏静默探测：失败不弹错（缺依赖时解析会给出可行动提示） */
  private async checkDepsSilently(): Promise<void> {
    const list = await detectDeps()
    if (list) this.deps = toDepItems(list, this.deps)
  }

  async checkDeps(interactive = false): Promise<void> {
    if (this.depsChecking) return
    this.depsChecking = true
    try {
      const list = await detectDeps()
      if (list) this.deps = toDepItems(list, this.deps)
      if (interactive) {
        const missing = this.deps.filter((d) => !d.found && !d.optional)
        this.toast(
          missing.length ? t('toast.depsMissing', { count: missing.length }) : t('toast.depsReady'),
          missing.length ? 'error' : 'success',
        )
      }
    } finally {
      this.depsChecking = false
    }
  }

  /**
   * 安装（或更新）一个依赖。
   *
   * `kind` 是**后端 kind**：`yt-dlp` / `ffmpeg` / `ffprobe` / `aria2`。
   * 传二进制名（`aria2c`）会被后端当成未知种类静默忽略——下载「完成」了
   * 但什么都没装上，所以调用方一律用 `dep.id` 而不是 `dep.name`。
   */
  async installDep(kind: string): Promise<void> {
    this.depsPromptBusy = true
    this.depsPromptProgress = 0
    // 让这一行立刻进入「下载中」：接口是异步的，用户点了按钮要马上有反应
    this.deps = this.deps.map((d) => (d.id === kind ? { ...d, busy: true, progress: 0 } : d))

    const unsubscribe = await onDepsProgress((p) => {
      const ev = p as { event?: string; tool?: string; downloaded?: number; total?: number; message?: string }
      // tool 是依赖种类；老版本边车可能不带它，那就按「当前正在装的那个」算
      if (ev.event === 'progress' && (!ev.tool || ev.tool === kind)) {
        const ratio = ev.total ? (ev.downloaded ?? 0) / ev.total : 0
        this.depsPromptProgress = ratio
        this.deps = this.deps.map((d) =>
          d.id === kind ? { ...d, busy: true, progress: ratio } : d,
        )
      }
    })

    try {
      const res = await installDeps({ only: [kind], mirror: this.settings.depMirror })
      if (!res.ok) {
        this.toast(res.message || t('toast.depInstallFailed'), 'error')
        return
      }
      // 装完重新探测：界面必须立刻看到新状态（版本号、来源都可能变）
      await this.checkDeps(false)
      this.toast(t('toast.depInstalled'), 'success')
    } finally {
      unsubscribe()
      this.depsPromptBusy = false
      this.depsPromptProgress = 0
      this.deps = this.deps.map((d) => (d.id === kind ? { ...d, busy: false, progress: 0 } : d))
    }
  }

  async downloadPromptDeps(): Promise<void> {
    this.depsPromptBusy = true
    try {
      const res = await installDeps({ mirror: this.settings.depMirror })
      if (!res.ok) {
        this.toast(res.message || t('toast.depInstallFailed'), 'error')
        return
      }
      await this.checkDeps(false)
      this.dialog = 'none'
    } finally {
      this.depsPromptBusy = false
    }
  }

  async openDepDir(): Promise<void> {
    const dir = await managedDir()
    const res = await openPath(dir)
    if (!res.ok) this.toast(res.message || t('error.openFolderFailed'), 'error')
  }

  /** 依赖诊断（「诊断」按钮用） */
  async depDiagnostics(): Promise<Record<string, unknown> | null> {
    return depsSummary()
  }

  // ============================================================
  // 更新日志
  // ============================================================

  /** 读更新日志。失败不弹错：它只是展示内容，缺了不该拦住用户干活。 */
  async loadChangelog(): Promise<void> {
    const list = await backendChangelogHistory()
    // `list` 可能是 null（后端出错时 Go 返回 nil 切片，JSON 成了 `null`）。
    // 必须**用 Array.isArray 判断**而不是 `if (list)`：
    //   - `if (list)` 对 null 是 falsy，看起来没问题
    //   - 但如果有人把判断写成 `if (list !== undefined)`（很自然的写法），
    //     null 就会被赋进 changelog，随后 `app.changelog.map(...)` 直接抛
    //     `Cannot read properties of null (reading 'length')`，整个关于页白屏。
    // 真机上就是这么崩的：页面点开后一片空白，控制台才有一行 TypeError。
    this.changelog = Array.isArray(list) ? list : []
  }

  /** 当前运行版本对应的更新日志（找不到时退回最新一条已发布版本） */
  get currentChangelog(): ChangelogEntry | null {
    const exact = this.changelog.find((e) => e.version === this.version.replace(/^v/, ''))
    return exact ?? this.changelog[0] ?? null
  }

  // ============================================================
  // 更新
  // ============================================================

  async checkUpdate(silent = false): Promise<void> {
    if (this.updateInfo.status === 'checking') return
    this.updateInfo = { status: 'checking', progress: 0 }

    const res = await backendCheckUpdate(this.settings.updateSource)
    if (!res) {
      this.updateInfo = { status: 'error', progress: 0, summary: t('update.offline') }
      if (!silent) this.toast(t('update.offline'), 'error')
      return
    }

    if (!res.hasUpdate) {
      this.updateInfo = {
        status: 'latest',
        progress: 0,
        version: res.currentVersion,
        architecture: res.architecture,
        // 即使「已是最新」也保留迁移判定：用户可能停在旧版本，
        // 而最新版已经提供了新架构的包
        migration: res.migration,
      }
      if (!silent) this.toast(t('toast.upToDate'), 'info')
      return
    }

    this.updateInfo = {
      status: 'available',
      progress: 0,
      version: res.version,
      notes: res.notes,
      summary: res.summary,
      // 发布时间来自 Release 的 releaseDate：更新弹窗里要显示「这版是哪天的」，
      // 早先模板读 `date`、快照里却没有这个字段，于是永远渲染成空串。
      date: res.date,
      architecture: res.architecture,
      migration: res.migration,
    }
    this.dialog = 'update'
  }

  openUpdateDialog(): void {
    if (this.updateInfo.status === 'idle') {
      void this.checkUpdate()
      return
    }
    this.dialog = 'update'
  }

  /**
   * 安装更新。
   *
   * 桌面端由 electron-updater 负责（Go 侧未移植），容器版靠拉新镜像。
   * 这里**如实打开 Releases 页面**，不假装安装成功——假装会让用户
   * 以为已经升级，然后继续用旧版本。
   */
  /**
   * 打开新架构（Wails）包的下载页。
   *
   * 只打开 Releases 页、不自动下载安装：迁移是单向门（装上新架构后
   * 没有 electron-updater 可用，回不到 Electron 版），所以这一步必须
   * 由用户自己确认。
   */
  async openMigrationDownload(): Promise<void> {
    const v = this.updateInfo.migration?.version || this.updateInfo.version
    await openExternal(v ? `${REPO_RELEASES}/tag/v${v}` : REPO_RELEASES)
    this.toast(t('update.migrationManual'), 'info')
  }

  /**
   * 安装已下载的更新并重启。
   *
   * 真机上替换动作发生在**本进程退出之后**（各平台实现见
   * `internal/update/install_*.go`），所以这里返回后应用会自己退出重启。
   */
  async installUpdate(): Promise<void> {
    const res = await requestUpdateInstall()
    if (!res.ok) {
      // 装不上时退回「打开下载页」—— 用户至少还能手动装
      await openExternal(REPO_RELEASES)
      this.toast(res.message || t('update.manualDownload'), 'error')
      return
    }
    this.dialog = 'none'
    this.toast(t('update.installing'), 'info')
  }

  /**
   * 下载更新。
   *
   * **后端没有实现这条**（Go 侧只有更新检查，没有 electron-updater 的下载/安装）。
   * 如实告知用户去 Releases 页面手动下载，而不是假装下载成功。
   */
  /**
   * 下载更新包（异步，进度走 `update:progress`）。
   *
   * 早先这里只是「打开 Releases 页面」—— 那是**没实现**，不是设计。
   * 现在真的下载并校验；校验不过会删掉已下载的文件并报错。
   */
  async downloadUpdate(): Promise<void> {
    const version = this.updateInfo.version
    if (!version) {
      await openExternal(REPO_RELEASES)
      return
    }

    this.updateInfo = { ...this.updateInfo, status: 'downloading', progress: 0 }
    const res = await requestUpdateDownload(version, this.settings.updateSource)

    if (!res.ok) {
      this.updateInfo = { ...this.updateInfo, status: 'error', summary: res.message }
      // 自动下载失败时退回手动：用户至少还能自己下
      await openExternal(`${REPO_RELEASES}/tag/v${version}`)
      this.toast(res.message || t('update.manualDownload'), 'error')
    }
  }

  // ============================================================
  // 派生（纯计算，不碰后端）
  // ============================================================

  /** 字节数 → 展示字符串（派生 getter 用）。与 lib/format.ts 的规则一致。 */
  private formatSize(bytes: number): string {
    if (!bytes || bytes <= 0) return '—'
    return this.formatBytes(bytes)
  }

  /** 供组件直接调用的字节格式化 */
  formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return '—'
    return formatBytesUtil(bytes)
  }

  get selectedFormat() {
    return this.video?.formats.find((f) => f.id === this.selectedFormatId) ?? null
  }

  get selectedAudio() {
    return this.video?.audios.find((a) => a.id === this.selectedAudioId) ?? null
  }

  get selectedTrack() {
    return this.video?.tracks.find((track) => track.id === this.selectedTrackId) ?? null
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

  get hasTasks(): boolean {
    return this.tasks.length > 0
  }

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
      const key = dayGroup(item.createdAt, now)
      const existing = groups.find((group) => group.key === key)
      if (existing) existing.items.push(item)
      else groups.push({ key, items: [item] })
    }
    return groups
  }

  /** 必需依赖是否都就绪（可选依赖缺失不影响） */
  get depsReady(): boolean {
    return this.deps.filter((dep) => !dep.optional).every((dep) => dep.found && !dep.stale)
  }

  get missingRequiredDeps(): DepItem[] {
    return this.deps.filter((dep) => !dep.optional && !dep.found)
  }

  get storageUsedPercent(): number {
    return Math.round(((this.storageTotal - this.storageFree) / this.storageTotal) * 100)
  }

  get freeStorageLabel(): string {
    return this.formatBytes(this.storageFree)
  }

  /** 打开「作者的话」 */
  openAnnouncement(): void {
    this.announcementRead = true
    this.dialog = 'announcement'
    // 打开时确保有内容：先给本地（立即可见），同时后台拉远端
    if (!this.announcement) {
      this.announcement = loadLocalAnnouncement(getLocale())
      this.announcementSource = 'local'
    }
    void this.refreshAnnouncement()
  }

  /**
   * 从远端刷新公告（三级镜像降级）。
   *
   * 失败不弹错：公告只是内容，取不到就用本地那份，不该打断用户。
   */
  async refreshAnnouncement(): Promise<void> {
    if (this.announcementSource === 'loading') return
    this.announcementSource = 'loading'
    try {
      // 用**返回值里的 source**，不再靠「内容长度猜」。
      // 猜的写法在「远端内容比本地短」时会错判成本地（作者删改过内容时就会）。
      const result = await fetchAnnouncement(getLocale())
      this.announcement = result.doc
      this.announcementSource = result.source
    } catch {
      this.announcement = loadLocalAnnouncement(getLocale())
      this.announcementSource = 'local'
    }
  }

  // ============================================================
  // Toast
  // ============================================================

  toast(text: string, kind: ToastItem['kind'] = 'info', duration = 3200): void {
    const item: ToastItem = { id: ++this.toastSeq, text, kind, at: Date.now() }
    this.toasts = [...this.toasts, item]
    window.setTimeout(() => this.dismissToast(item.id), duration)
  }

  dismissToast(id: number): void {
    this.toasts = this.toasts.filter((x) => x.id !== id)
  }
}

/** Releases 页（更新按钮的回退目标） */
const REPO_RELEASES = 'https://github.com/Downvid/downvid/releases'

export const app = new AppStore()

/** 供组件用的派生工具：把连接数归到档位 */
export { CONNECTION_STOPS, nearestConnectionStop, detectPlatform, hostOf, platformName, errorMarker }
