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
  DemoVideo,
  FormatOption,
  AudioOption,
  TrackOption,
  SubtitleOption,
  PlatformId,
} from './mock'

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

/** 后端解析失败时抛出的错误消息里的标记 */
export type ParseErrorMarker = '[[parse-error:' | '[[deps-missing:'

/** 从错误消息里取出标记的种类（没有标记时返回空串） */
export function errorMarker(message: string): { kind: 'parse' | 'deps' | ''; code: string } {
  const deps = /\[\[deps-missing:([\w-]+)\]\]/.exec(message)
  if (deps) return { kind: 'deps', code: deps[1] }
  const parse = /\[\[parse-error:([\w-]+)\]\]/.exec(message)
  if (parse) return { kind: 'parse', code: parse[1] }
  return { kind: '', code: '' }
}

/** 去掉标记，只留人类可读的部分 */
export function stripMarker(message: string): string {
  return message
    .replace(/\[\[(?:parse-error|deps-missing):[\w-]+\]\]/g, '')
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
  GetDefaultDownloadDir(): Promise<string>
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

// ===== 适配：BackendVideoInfo → DemoVideo =====

/**
 * 从 URL 判断平台（demo 的 DemoVideo 需要 platformId / platformName / host）。
 *
 * 放在前端而不是让后端给：这三个字段是**展示层**的（平台名要翻译、host 要显示），
 * 后端只该回答「这是什么视频」。
 */
function platformOf(url: string): { id: PlatformId; name: string; host: string } {
  const u = url.toLowerCase()
  if (u.includes('youtube.com') || u.includes('youtu.be')) {
    return { id: 'youtube', name: 'YouTube', host: 'youtube.com' }
  }
  if (u.includes('bilibili.com') || u.includes('b23.tv')) {
    return { id: 'bilibili', name: '哔哩哔哩', host: 'bilibili.com' }
  }
  if (u.includes('douyin.com')) return { id: 'douyin', name: '抖音', host: 'douyin.com' }
  if (u.includes('xiaohongshu.com')) return { id: 'xiaohongshu', name: '小红书', host: 'xiaohongshu.com' }
  if (u.includes('instagram.com')) return { id: 'instagram', name: 'Instagram', host: 'instagram.com' }
  if (u.includes('kuaishou.com')) return { id: 'kuaishou', name: '快手', host: 'kuaishou.com' }
  try {
    return { id: 'other', name: new URL(url).hostname, host: new URL(url).hostname }
  } catch {
    return { id: 'other', name: '其他', host: '' }
  }
}

/**
 * 把后端结果转成 demo store 的形状。
 *
 * 两边形状**故意不合并**：demo 的 `label` 是展示文案（随语言变），
 * 后端只给 `quality`（「1080P」这种与语言无关的事实）。
 * 让后端给死文案就没法翻译了。
 */
export function toDemoVideo(info: BackendVideoInfo, url: string): DemoVideo {
  const effectiveUrl = info.webpageUrl || url
  const platform = platformOf(effectiveUrl)

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
    needsCookies: Boolean(info.isYoutube),
    notice: info.parseNotice || undefined,
  }
}

// ===== 解析 =====

export interface ParseOutcome {
  ok: boolean
  video?: DemoVideo
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
    const info = await b.Parse(url, proxy)
    return { ok: true, video: toDemoVideo(info, url) }
  } catch (e) {
    const raw = String((e as Error)?.message ?? e)
    const marker = errorMarker(raw)
    return {
      ok: false,
      message: stripMarker(raw) || '解析失败',
      missingKind: marker.kind === 'deps' ? marker.code : undefined,
    }
  }
}

// ===== 下载 =====

export interface StartDownloadParams {
  taskId: string
  url: string
  formatId: string
  mode: 'video' | 'audio' | 'subtitle'
  hasAudio: boolean
  subtitles: string[]
  outputDir: string
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
      filenameTemplate: '%(title)s.%(ext)s',
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
