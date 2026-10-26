/**
 * 后端适配层：把 Wails 绑定包成 demo store 需要的形状。
 *
 * ## 为什么单独一层，而不是在 store 里直接 import 绑定
 *
 * 1. **demo 要在浏览器里跑**（`pnpm demo:ui` 打开 `http://localhost:5173/demo/`），
 *    那里没有 Wails 运行时，直接 import `wailsjs/go/main/App` 会抛错。
 *    这一层在浏览器里自动退回 mock，在 Wails 里走真实后端。
 * 2. 后端方法的签名（Go 风格：`(url, proxy)`）与 store 期望的（对象参数）
 *    不一样，转换集中在这里，改动只影响一个文件。
 *
 * ## 怎么接到 store
 *
 * store 里只有三处需要改：
 *
 * | store 方法 | 现在 | 改成 |
 * |---|---|---|
 * | `finishParse` | `makeVideoInfo(url)` | `await backend.parse(url)` |
 * | `pump()` / `tick()` | 本地模拟进度 | 订阅 `backend.onProgress` |
 * | `togglePause` | 改本地 status | `await backend.pause(taskId)` |
 *
 * 其余（UI 状态、筛选、格式化）都不需要动。
 */

import type {
  VideoInfo,
  FormatOption,
  AudioOption,
  TrackOption,
  SubtitleOption,
} from './types'
import { detectPlatform, platformName, hostOf } from './url'
import { t } from './i18n.svelte'
import { APP_VERSION, BUILD_DATE } from './constants'

/** 后端是否可用（浏览器里为 false） */
export const hasBackend = (): boolean =>
  typeof window !== 'undefined' && typeof (window as any).go?.main?.App === 'object'

/**
 * 后端返回的 VideoInfo（Go 侧 `parse.VideoInfo` 的 JSON 形状）。
 *
 * 字段名与后端**逐字一致**。改这里等于改前后端契约，
 * 数组一侧改了不会有类型错误，只会让界面显示空白。
 */
export interface BackendVideoInfo {
  id: string
  title: string
  description: string
  thumbnail: string
  duration: number
  uploader: string
  webpageUrl: string
  formats: Array<{
    formatId: string
    quality: string
    ext: string
    filesize: number
    width: number
    height: number
    fps: number
    hasAudio: boolean
  }>
  audioFormats?: Array<{
    formatId: string
    quality: string
    ext: string
    filesize: number
    abr: number
    acodec: string
  }>
  audioTracks?: Array<{ id: string; name: string; language: string; formatId: string; isM3u8?: boolean }>
  subtitles?: Array<{ language: string; name: string; url: string }>
  isYoutube: boolean
  parseNotice: string
  cacheFile?: string
  /** 平台 CDN 直链（仅抖音/快手；有它时后端不走 yt-dlp） */
  directUrl?: string
}

/** 后端发出的下载进度事件（Go 侧 `DownloadProgress`） */
export interface BackendProgress {
  taskId: string
  url?: string
  status: 'downloading' | 'merging' | 'completed' | 'error' | 'paused'
  percent: number
  totalSize?: string
  speed?: string
  eta?: string
  message?: string
  filePath?: string
  error?: string
}

/**
 * 后端解析失败时抛出的错误消息里的标记。
 *
 * `deps-missing` 与 `deps-stale` 必须分开：前者是「没装」，后者是
 * 「装了但版本过旧」。合并成一个会让「检测页说版本过旧、解析说未找到」
 * 同时出现，用户按提示重下也解决不了。
 */
export type ParseErrorMarker = '[[parse-error:' | '[[deps-missing:' | '[[deps-stale:'

/** 从错误消息里取出标记的种类（没有标记时返回空串） */
export function errorMarker(message: string): { kind: 'parse' | 'deps' | 'deps-stale' | ''; code: string } {
  const stale = /\[\[deps-stale:([\w-]+)\]\]/.exec(message)
  if (stale) return { kind: 'deps-stale', code: stale[1] }
  const deps = /\[\[deps-missing:([\w-]+)\]\]/.exec(message)
  if (deps) return { kind: 'deps', code: deps[1] }
  const parse = /\[\[parse-error:([\w-]+)\]\]/.exec(message)
  if (parse) return { kind: 'parse', code: parse[1] }
  return { kind: '', code: '' }
}

/** 去掉标记，只留人类可读的部分 */
export function stripMarker(message: string): string {
  return message
    .replace(/\[\[(?:parse-error|deps-missing|deps-stale):[\w-]+\]\]/g, '')
    .trim()
}

// ===== 绑定加载 =====
//
// 用动态 import 而不是顶层 import：顶层 import 在浏览器里会直接抛
// `Failed to resolve module`，整个 demo 页都打不开。

type Bindings = {
  Parse(url: string, proxy: string): Promise<BackendVideoInfo>
  ParseDump(): Promise<BackendVideoInfo>
  StartDownload(opts: Record<string, unknown>): Promise<{ ok: boolean; error?: string; missingKind?: string }>
  PauseDownload(taskID: string): Promise<boolean>
  DetectDependencies(): Promise<Array<{ kind: string; found: boolean; path?: string; version?: string; source?: string; reason?: string }>>
  HistoryGet(): Promise<Array<Record<string, unknown>>>
  HistoryAdd(record: Record<string, unknown>): Promise<boolean>
  HistoryDelete(id: string): Promise<boolean>
  HistoryClear(): Promise<boolean>
  CheckUpdate(source: string): Promise<Record<string, unknown>>
  GetVersion(): Promise<string>
  GetBuildDate?(): Promise<string>
  GetDefaultDownloadDir(): Promise<string>
  GetDataDir(): Promise<string>
  GetPlatform(): Promise<string>
  GetSettings(): Promise<Record<string, unknown>>
  UpdateSettings(patchJSON: string): Promise<{ ok: boolean; error?: string }>
  ResetSettings(): Promise<{ ok: boolean; error?: string }>
  GetDiskSpace(dir: string): Promise<{ free: number; total: number; error?: string }>
  FetchImage(url: string, referer: string): Promise<string>
  OpenPath(path: string): Promise<{ ok: boolean; error?: string }>
  ShowInFolder(path: string): Promise<{ ok: boolean; error?: string }>
  OpenExternal(url: string): Promise<{ ok: boolean; error?: string }>
  DepsSummary(): Promise<Record<string, unknown>>
  InstallDeps(opts: Record<string, unknown>): Promise<{ ok: boolean; error?: string }>
  CancelDepsInstall(): Promise<boolean>
  IsInstallingDeps(): Promise<boolean>
  OpenManagedDir(): Promise<string>
  TestProxy(proxy: string): Promise<{ ok: boolean; latencyMs?: number; status?: number; error?: string; kind?: string }>
  ReadClipboard(): Promise<{ text: string; error?: string }>
  DownloadUpdate(version: string, source: string): Promise<{ ok: boolean; error?: string }>
  InstallUpdate(): Promise<{ ok: boolean; error?: string }>
  PendingUpdateInfo(): Promise<{ pending: boolean; version?: string; kind?: string }>
  PickDirectory(title: string): Promise<string>
  PickFile(title: string, extensions: string[]): Promise<string>
  ChangelogList(): Promise<ChangelogEntry[]>
  ChangelogCurrent(): Promise<ChangelogEntry | null>
  ChangelogHistory(): Promise<ChangelogEntry[]>
  ClassifyError(raw: string): Promise<string>
  Diagnostic(raw: string, ytdlp: string, runtime: string): Promise<string>
  GetCookieStatus(): Promise<CookieStatus>
}

let cached: Bindings | null = null

/**
 * 取后端绑定。浏览器里返回 null（调用方应退化为 mock）。
 *
 * 这是**唯一**决定「走真实后端还是 mock」的地方——
 * 不要在别处再写 `hasBackend()` 判断，那种分散判断迟早会漏一处。
 */
export async function backend(): Promise<Bindings | null> {
  if (cached) return cached
  if (!hasBackend()) return null

  try {
    const mod = await import('../../wailsjs/go/main/App')
    cached = mod as unknown as Bindings
    return cached
  } catch {
    // 构建产物里路径不同 / Wails 未注入：退回 mock，不让整个页面挂掉
    return null
  }
}

// ===== Cookie 状态 =====

export interface CookieStatus {
  manual: boolean
  hasSnapshot: boolean
  snapshotAgeMs: number
  lastGoodBrowser: string
  availableBrowsers: string[]
  cookieReady: boolean
}

let cachedCookieStatus: CookieStatus | null = null

export async function getCookieStatus(): Promise<CookieStatus | null> {
  const b = await backend()
  if (!b || typeof (b as any).GetCookieStatus !== 'function') return null
  try {
    cachedCookieStatus = await (b as any).GetCookieStatus()
    return cachedCookieStatus
  } catch {
    return null
  }
}

// ===== 适配：BackendVideoInfo → VideoInfo =====

/**
 * 把后端结果转成前端的形状。
 *
 * 两边形状**故意不合并**：前端的 `label` 是展示文案（随语言变），
 * 后端只给 `quality`（「1080P」这种与语言无关的事实）。
 * 让后端给死文案就没法翻译了。
 */
export function toVideoInfo(info: BackendVideoInfo, url: string, cookieReady = false): VideoInfo {
  const effectiveUrl = info.webpageUrl || url
  const platformId = detectPlatform(effectiveUrl)
  const platform = {
    id: platformId,
    name: platformName(platformId),
    host: hostOf(effectiveUrl),
  }

  // formats 已经由后端去重并按「兼容性优先」排好序（AVC > HEVC > AV1），
  // 前端不再排序——两处各排一次必然漂移
  const formats: FormatOption[] = (info.formats ?? []).map((f, i) => ({
    id: f.formatId,
    label: f.quality,
    ext: f.ext || 'mp4',
    sizeBytes: f.filesize || 0,
    height: f.height || undefined,
    fps: f.fps || undefined,
    hasAudio: f.hasAudio,
    recommended: i === 0,
  }))

  const audios: AudioOption[] = (info.audioFormats ?? []).map((a) => ({
    id: a.formatId,
    label: a.quality,
    kbps: Math.round(a.abr || 0),
    ext: a.ext || 'm4a',
    sizeBytes: a.filesize || 0,
    codec: a.acodec || undefined,
  }))

  const tracks: TrackOption[] = (info.audioTracks ?? []).map((tk) => ({
    id: tk.id,
    name: tk.name,
    lang: tk.language,
    // 这两个字段决定后端能不能真的选中这条音轨，漏了就是「选了没用」
    formatId: tk.formatId,
    isM3u8: tk.isM3u8,
  }))

  const subtitles: SubtitleOption[] = (info.subtitles ?? []).map((s) => ({
    id: s.language,
    lang: s.language,
    name: s.name,
    ext: 'srt',
  }))

  return {
    url: effectiveUrl,
    platformId: platform.id,
    platformName: platform.name,
    host: platform.host,
    title: info.title || '未知标题',
    uploader: info.uploader || '',
    duration: Math.round(info.duration || 0),
    thumbnail: info.thumbnail || '',
    formats,
    audios,
    tracks,
    subtitles,
    needsCookies: Boolean(info.isYoutube && !cookieReady),
    notice: info.parseNotice || undefined,
    cacheFile: info.cacheFile,
    // 直链原样带过去：后端据此决定走 yt-dlp 还是直连
    directUrl: info.directUrl,
  }
}

// ===== 解析 =====

export interface ParseOutcome {
  ok: boolean
  video?: VideoInfo
  /** 失败原因（已去掉标记，可直接显示） */
  message?: string
  /** 缺依赖时要弹「一键下载」 */
  missingKind?: string
}

/**
 * 解析一个 URL。
 *
 * 失败时**不抛异常**，而是返回 `{ok:false}`：解析失败是预期内的常见情况
 * （离线、限流、需要登录），做成异常会让每个调用点都写 try/catch，
 * 最后总有一处写成「出错了就当作成功」。
 */
export async function parseUrl(url: string, proxy = ''): Promise<ParseOutcome> {
  const b = await backend()
  if (!b) {
    // 浏览器里没有后端：明确告知，而不是假装成功（那会让 demo 骗自己）
    return { ok: false, message: '当前是浏览器预览，没有后端。请用 pnpm dev 或打包后的应用。' }
  }

  try {
    const status = await getCookieStatus()
    const cookieReady = status ? status.cookieReady : false
    const info = await b.Parse(url, proxy)
    return { ok: true, video: toVideoInfo(info, url, cookieReady) }
  } catch (e) {
    const raw = String((e as Error)?.message ?? e)
    const marker = errorMarker(raw)
    return {
      ok: false,
      message: stripMarker(raw) || '解析失败',
      // 版本过旧同样要打开依赖面板（下一步是「更新」而不是「下载」）
      missingKind: marker.kind === 'deps' || marker.kind === 'deps-stale' ? marker.code : undefined,
    }
  }
}

// ===== 下载 =====

export interface StartDownloadParams {
  /** 文件名模板（来自用户设置；后端会在缺少清晰度字段时自动补 `[height]p`） */
  filenameTemplate?: string
  taskId: string
  url: string
  formatId: string
  mode: 'video' | 'audio' | 'subtitle'
  hasAudio: boolean
  subtitles: string[]
  outputDir: string
  /** 选中的音轨（仅 YouTube 多音轨） */
  audioTrack?: { formatId: string; language: string; isM3u8?: boolean }
  /**
   * 平台 CDN 直链（仅抖音/快手）。有它时后端走直链下载器，不经过 yt-dlp。
   */
  directUrl?: string
  /** 标题：直链路径拿不到 info JSON，文件名只能由前端带过来 */
  title?: string
}

/**
 * 启动下载。进度通过 `onProgress` 事件推送。
 *
 * 返回 `ok:false` 时 `missingKind` 非空表示缺依赖——
 * 前端据此弹「一键下载」，而不是只说「下载失败」。
 */
export async function startDownload(
  p: StartDownloadParams,
): Promise<{ ok: boolean; message?: string; missingKind?: string }> {
  const b = await backend()
  if (!b) return { ok: false, message: '当前是浏览器预览，没有后端。' }

  try {
    const res = await b.StartDownload({
      taskId: p.taskId,
      url: p.url,
      formatId: p.formatId,
      downloadMode: p.mode,
      hasAudio: p.hasAudio,
      subtitles: p.subtitles,
      outputDir: p.outputDir,
      audioTrack: p.audioTrack,
      directUrl: p.directUrl,
      title: p.title,
      // 用**用户设置**里的模板。早先这里写死 `'%(title)s.%(ext)s'`,
      // 于是设置页改了文件名模板对下载毫无影响——用户改完再下载，
      // 文件名还是老样子。
      filenameTemplate: p.filenameTemplate,
    })
    return { ok: res.ok, message: res.error, missingKind: res.missingKind }
  } catch (e) {
    return { ok: false, message: stripMarker(String((e as Error)?.message ?? e)) }
  }
}

/** 暂停（终止整棵进程树） */
export async function pauseDownload(taskId: string): Promise<boolean> {
  const b = await backend()
  if (!b) return false
  return b.PauseDownload(taskId)
}

/**
 * 订阅下载进度事件。
 *
 * 返回 unsubscribe —— 调用方**必须**在组件卸载时调用，否则热重载会累积监听
 * （旧版就漏过这个，表现为「用久了越来越卡」）。
 */
export async function onProgress(cb: (p: BackendProgress) => void): Promise<() => void> {
  const b = await backend()
  if (!b) return () => {}

  try {
    const mod = await import('../../wailsjs/runtime/runtime')
    const off = mod.EventsOn('download:progress', (data: unknown) => {
      cb(data as BackendProgress)
    })
    return typeof off === 'function' ? off : () => {}
  } catch {
    return () => {}
  }
}

// ===== 依赖 =====

export interface DepInfo {
  kind: string
  found: boolean
  path?: string
  version?: string
  source?: string
  reason?: string
}

export async function detectDeps(): Promise<DepInfo[] | null> {
  const b = await backend()
  if (!b) return null
  try {
    return await b.DetectDependencies()
  } catch {
    return null
  }
}

// ===== 历史 =====

export async function historyList(): Promise<Array<Record<string, unknown>> | null> {
  const b = await backend()
  if (!b) return null
  try {
    return await b.HistoryGet()
  } catch {
    return null
  }
}

export async function historyAdd(record: Record<string, unknown>): Promise<boolean> {
  const b = await backend()
  if (!b) return false
  return b.HistoryAdd(record)
}

export async function historyDelete(id: string): Promise<boolean> {
  const b = await backend()
  if (!b) return false
  return b.HistoryDelete(id)
}

export async function historyClear(): Promise<boolean> {
  const b = await backend()
  if (!b) return false
  return b.HistoryClear()
}

// ===== 依赖安装 =====

export interface DepsInstallRequest {
  only?: string[]
  force?: boolean
  mirror?: string
}

/** 下载并安装依赖（异步，进度走 onDepsProgress） */
export async function installDeps(opts: DepsInstallRequest = {}): Promise<{ ok: boolean; message?: string }> {
  const b = await backend()
  if (!b) return { ok: false, message: '浏览器预览模式没有后端' }
  try {
    const res = await b.InstallDeps(opts as Record<string, unknown>)
    return { ok: res.ok, message: res.error }
  } catch (e) {
    return { ok: false, message: String((e as Error)?.message ?? e) }
  }
}

/** 取消依赖下载 */
export async function cancelDeps(): Promise<boolean> {
  const b = await backend()
  return b ? b.CancelDepsInstall() : false
}

/** 依赖下载进度事件（与 download:progress 同一套订阅方式） */
export async function onDepsProgress(cb: (p: unknown) => void): Promise<() => void> {
  return subscribe('deps:progress', cb)
}

/** 依赖的「缺什么 / 哪个过旧」摘要 */
export async function depsSummary(): Promise<Record<string, unknown> | null> {
  const b = await backend()
  if (!b) return null
  try {
    return await b.DepsSummary()
  } catch {
    return null
  }
}

/** 托管目录（界面的「打开目录」用） */
export async function managedDir(): Promise<string> {
  const b = await backend()
  return b ? b.OpenManagedDir() : ''
}

// ===== 设置 =====

/**
 * 读设置。
 *
 * 返回 `null` 表示「没有后端」或「读取失败」——调用方应退回本地默认值，
 * 而不是把 undefined 散进界面。
 */
export async function loadSettings(): Promise<Record<string, unknown> | null> {
  const b = await backend()
  if (!b) return null
  try {
    return await b.GetSettings()
  } catch {
    return null
  }
}

/**
 * 合并写入设置（只改传入的字段）。
 *
 * **不要用整体覆盖**：那会把别的组件写的字段抹掉——
 * 历史事故：在设置面板点一次「保存」，`depPaths` 就没了。
 */
export async function saveSettings(patch: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> {
  const b = await backend()
  if (!b) return { ok: false, message: '浏览器预览模式没有后端' }
  try {
    const res = await b.UpdateSettings(JSON.stringify(patch))
    return { ok: res.ok, message: res.error }
  } catch (e) {
    return { ok: false, message: String((e as Error)?.message ?? e) }
  }
}

export async function resetSettings(): Promise<{ ok: boolean; message?: string }> {
  const b = await backend()
  if (!b) return { ok: false, message: '浏览器预览模式没有后端' }
  try {
    const res = await b.ResetSettings()
    return { ok: res.ok, message: res.error }
  } catch (e) {
    return { ok: false, message: String((e as Error)?.message ?? e) }
  }
}

// ===== 系统集成 =====

export async function openPath(path: string): Promise<{ ok: boolean; message?: string }> {
  const b = await backend()
  if (!b) return { ok: false }
  const res = await b.OpenPath(path)
  return { ok: res.ok, message: res.error }
}

export async function showInFolder(path: string): Promise<{ ok: boolean; message?: string }> {
  const b = await backend()
  if (!b) return { ok: false }
  const res = await b.ShowInFolder(path)
  return { ok: res.ok, message: res.error }
}

export async function openExternal(url: string): Promise<{ ok: boolean; message?: string }> {
  const b = await backend()
  if (!b) return { ok: false }
  const res = await b.OpenExternal(url)
  return { ok: res.ok, message: res.error }
}

/** 磁盘剩余空间 */
export async function diskSpace(dir = ''): Promise<{ free: number; total: number } | null> {
  const b = await backend()
  if (!b) return null
  try {
    const res = await b.GetDiskSpace(dir)
    if (res.error) return null
    return { free: res.free, total: res.total }
  } catch {
    return null
  }
}

/**
 * 抓远程图片（B 站封面防盗链）。
 *
 * 失败返回空串——前端渲染占位图，不弹错误框。
 */
export async function fetchImage(url: string, referer = ''): Promise<string> {
  const b = await backend()
  if (!b) return ''
  try {
    return await b.FetchImage(url, referer)
  } catch {
    return ''
  }
}

export async function appVersion(): Promise<string> {
  const b = await backend()
  if (!b) return APP_VERSION
  try {
    const v = await b.GetVersion()
    if (v && v !== '0.0.0-dev' && v !== '0.0.0-preview') return v
    return APP_VERSION
  } catch {
    return APP_VERSION
  }
}

export async function appBuildDate(): Promise<string> {
  const b = await backend()
  if (!b) return BUILD_DATE
  try {
    if (b.GetBuildDate) {
      const d = await b.GetBuildDate()
      if (d) return d
    }
    return BUILD_DATE
  } catch {
    return BUILD_DATE
  }
}

export async function defaultDownloadDir(): Promise<string> {
  const b = await backend()
  if (!b) return ''
  try {
    return await b.GetDefaultDownloadDir()
  } catch {
    return ''
  }
}

// ===== 更新 =====

export interface UpdateCheckResult {
  hasUpdate: boolean
  version?: string
  currentVersion?: string
  /** 各源的尝试轨迹（诊断面板用） */
  attempts?: Array<{ source: string; ok: boolean; failure?: string; detail?: string }>
  /** 人话版的失败说明 */
  summary?: string
  /** Release 正文（Markdown） */
  notes?: string
  /** 发布日期 */
  date?: string
  /** 当前这个二进制属于哪个架构：electron（过渡） / wails（新架构） */
  architecture?: 'electron' | 'wails'
  /** 新架构迁移判定（后端的 EvaluateMigration） */
  migration?: MigrationHint
}

/**
 * 「可以迁移到新架构」的判定结果（对应 Go 的 `update.MigrationHint`）。
 *
 * 为什么只做成**提示**、不做自动迁移：迁移是单向门——装上新架构后
 * 没有 electron-updater 可用，回不到 Electron 版。在新架构稳定之前，
 * 把不可逆操作做成自动的，风险远大于收益。
 */
export interface MigrationHint {
  available: boolean
  /** 适合本机的新架构包文件名（界面显示给用户） */
  assetName?: string
  version?: string
  /** 不可用的原因（含「这个更新源查不到产物清单」这种） */
  reason?: string
}

export async function checkUpdate(source = 'auto'): Promise<UpdateCheckResult | null> {
  const b = await backend()
  if (!b) return null
  try {
    const raw = await b.CheckUpdate(source)
    const release = raw.release as { version?: string; releaseNotes?: string; releaseDate?: string } | null
    return {
      hasUpdate: Boolean(raw.hasUpdate),
      version: release?.version,
      currentVersion: raw.version as string | undefined,
      attempts: raw.attempts as UpdateCheckResult['attempts'],
      summary: raw.summary as string | undefined,
      notes: release?.releaseNotes,
      date: release?.releaseDate,
      architecture: raw.architecture as 'electron' | 'wails' | undefined,
      migration: raw.migration as MigrationHint | undefined,
    }
  } catch {
    return null
  }
}

/** 平台标识（Go 风格：windows / darwin / linux）。 */
export async function platform(): Promise<string> {
  const b = await backend()
  if (!b) return ''
  try {
    return await b.GetPlatform()
  } catch {
    return ''
  }
}

/**
 * 下载更新包（异步，进度走 `update:progress` 事件）。
 *
 * 与早先「打开 Releases 页面」的区别：这是真的把包装到本地并校验 sha512。
 * 校验不过会删掉已下载的文件并报错 —— 损坏的包装上去，应用就再也打不开了。
 */
export async function requestUpdateDownload(
  version: string,
  source = 'auto',
): Promise<{ ok: boolean; message?: string }> {
  const b = await backend()
  if (!b) return { ok: false, message: '浏览器预览没有后端' }
  try {
    const res = await b.DownloadUpdate(version, source)
    return { ok: res.ok, message: res.error }
  } catch (e) {
    return { ok: false, message: String((e as Error)?.message ?? e) }
  }
}

/** 应用已下载的更新并重启。 */
export async function requestUpdateInstall(): Promise<{ ok: boolean; message?: string }> {
  const b = await backend()
  if (!b) return { ok: false, message: '浏览器预览没有后端' }
  try {
    const res = await b.InstallUpdate()
    return { ok: res.ok, message: res.error }
  } catch (e) {
    return { ok: false, message: String((e as Error)?.message ?? e) }
  }
}

/** 是否有已下载待安装的更新（启动时提示用）。 */
export async function pendingUpdate(): Promise<{ pending: boolean; version?: string; kind?: string } | null> {
  const b = await backend()
  if (!b) return null
  try {
    return await b.PendingUpdateInfo()
  } catch {
    return null
  }
}

/**
 * 读剪贴板。
 *
 * 桌面端走 Go（`pbpaste` / `Get-Clipboard` / `wl-paste`），**不碰**
 * `navigator.clipboard` —— 那个在 WebView 里要剪贴板权限，macOS 上会弹
 * 系统授权框，用户点「粘贴」看到的是权限菜单而不是真的粘贴。
 *
 * 浏览器预览没有后端时才回退到 `navigator.clipboard`。
 */
export async function readClipboard(): Promise<{ text: string; error?: string }> {
  const b = await backend()
  if (b) {
    try {
      return await b.ReadClipboard()
    } catch (e) {
      return { text: '', error: String((e as Error)?.message ?? e) }
    }
  }
  // 浏览器预览：只能用 Web API（可能被权限拒绝，那是预期行为）
  try {
    const text = await navigator.clipboard.readText()
    return { text }
  } catch {
    return { text: '', error: t('toast.pasteNoPermission') }
  }
}

/**
 * 弹系统目录选择框，返回选中目录（取消时返回空串）。
 *
 * 与 `openPath` 的区别：这个是**选**，那个是**开**。设置页的「默认下载目录」
 * 旁边那个文件夹按钮早先调的是 `openPath` —— 用户想换位置，点一下却弹出了
 * Finder，只能自己把路径敲进输入框。
 */
export async function pickDirectory(title = ''): Promise<string> {
  const b = await backend()
  if (!b) return ''
  try {
    return await b.PickDirectory(title)
  } catch {
    return ''
  }
}

/** 弹系统文件选择框，返回选中文件（取消时返回空串）。 */
export async function pickFile(title = '', extensions: string[] = []): Promise<string> {
  const b = await backend()
  if (!b) return ''
  try {
    return await b.PickFile(title, extensions)
  } catch {
    return ''
  }
}

/** 一条更新日志（对应后端 `changelog.Entry`） */
export interface ChangelogEntry {
  /** 版本号；Unreleased 段为空串 */
  version: string
  /** 发布日期；Unreleased 段为空 */
  date: string
  unreleased?: boolean
  sections: Array<{ title: string; items: string[] }>
  /** 完整 Markdown 正文（含小标题，不含版本标题行） */
  body: string
}

/**
 * 读更新日志（本地内嵌，离线可用）。
 *
 * 返回 null 表示没有后端（浏览器预览）。**不要**在那种情况下退回硬编码文案：
 * 那正是之前的做法，界面上的「更新内容」与真实发布内容毫无关系。
 */
export async function changelogList(): Promise<ChangelogEntry[] | null> {
  const b = await backend()
  if (!b) return null
  try {
    return await b.ChangelogList()
  } catch {
    return null
  }
}

export async function changelogCurrent(): Promise<ChangelogEntry | null> {
  const b = await backend()
  if (!b) return null
  try {
    return await b.ChangelogCurrent()
  } catch {
    return null
  }
}

export async function changelogHistory(): Promise<ChangelogEntry[] | null> {
  const b = await backend()
  if (!b) return null
  try {
    return await b.ChangelogHistory()
  } catch {
    return null
  }
}

/**
 * 测试代理连通性（真实发一次请求，不是正则校验）。
 *
 * 返回 null 表示没有后端（浏览器预览），调用方要如实说明而不是假装成功。
 */
export async function testProxy(
  proxy: string,
): Promise<{ ok: boolean; latencyMs?: number; status?: number; error?: string; kind?: string } | null> {
  const b = await backend()
  if (!b) return null
  try {
    return await b.TestProxy(proxy)
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) }
  }
}

// ===== 通用事件订阅 =====

/**
 * 订阅一个广播事件。
 *
 * 抽成公共函数是因为 download / deps / history / update 都用同一套：
 * `EventsOn(name, cb)` 返回 unsubscribe。**调用方必须在卸载时调用它**，
 * 否则热重载会累积监听（旧版漏过，表现为「用久了越来越卡」）。
 */
async function subscribe(name: string, cb: (data: unknown) => void): Promise<() => void> {
  try {
    const mod = await import('../../wailsjs/runtime/runtime')
    const off = mod.EventsOn(name, cb)
    return typeof off === 'function' ? off : () => {}
  } catch {
    return () => {}
  }
}

/** 订阅更新下载进度（与 download:progress 同一套订阅方式） */
export async function onUpdateProgress(cb: (p: unknown) => void): Promise<() => void> {
  return subscribe('update:progress', cb)
}
