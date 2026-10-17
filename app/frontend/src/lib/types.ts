/**
 * 前端类型契约。
 *
 * 这些类型与 Go 侧的结构体**逐字对应**（字段名即 JSON 键），
 * 改这里等于改前后端契约：改错了不会有类型错误，只会让界面显示空白。
 *
 * 命名去掉了 `Demo` 前缀——原来的 `DemoVideo` 现在就是产品里的 `VideoInfo`。
 */
import type { Dialog, Mode, TaskStatus } from './constants'
export type { Dialog }

/** 站点标识 */
export type PlatformId =
  | 'bilibili'
  | 'youtube'
  | 'douyin'
  | 'xiaohongshu'
  | 'instagram'
  | 'kuaishou'
  | 'other'

/** 一个可选的视频格式（对应后端 `parse.Format`） */
export interface FormatOption {
  /** yt-dlp 的 format_id */
  id: string
  /** 展示标签（「1080P」这类，由后端给 quality） */
  label: string
  ext: string
  sizeBytes: number
  height?: number
  fps?: number
  codec?: string
  /** 是否推荐（后端已按兼容性排序，首个即推荐） */
  recommended?: boolean
  hasAudio?: boolean
}

/** 纯音频格式 */
export interface AudioOption {
  id: string
  label: string
  kbps: number
  ext: string
  sizeBytes: number
  codec?: string
}

/** YouTube 多音轨 */
export interface TrackOption {
  id: string
  name: string
  lang: string
  /**
   * 该音轨对应的 yt-dlp format id。
   *
   * **必须带**：后端要靠它把格式选择器拼成 `bestaudio[language^=xx]`，
   * 或者（m3u8 音轨）直接用这个 format id。少了它，用户在界面上选的语言
   * 完全不起作用——下下来的还是默认音轨，而且没有任何提示。
   */
  formatId: string
  /** m3u8 音轨要单独处理（不能走 `bestaudio` 选择器） */
  isM3u8?: boolean
}

/** 字幕 */
export interface SubtitleOption {
  id: string
  lang: string
  name: string
  ext: string
  auto?: boolean
}

/**
 * 一次解析的结果。
 *
 * 对应后端 `parse.VideoInfo` 在前端加工后的形状：
 * `platformId` / `platformName` / `host` 是**展示层**信息，由前端从 URL 推断
 * （平台名要翻译，后端给死文案就没法 i18n）。
 */
export interface VideoInfo {
  url: string
  platformId: PlatformId
  platformName: string
  host: string
  title: string
  uploader: string
  duration: number
  thumbnail: string
  formats: FormatOption[]
  audios: AudioOption[]
  tracks: TrackOption[]
  subtitles: SubtitleOption[]
  needsCookies: boolean
  notice?: string
  /** 后端缓存的原始 info JSON（下载时 --load-info-json 用） */
  cacheFile?: string
}

/** 一条下载历史（对应后端 `history.Record`） */
export interface HistoryItem {
  id: string
  title: string
  thumbnail: string
  url: string
  filePath: string
  quality: string
  ext: string
  mode: Mode
  sizeBytes: number
  createdAt: number
  /** 展示期字段：文件是否还在（不落盘） */
  fileExists: boolean
}

/** 一个下载任务 */
export interface TaskItem {
  id: string
  title: string
  thumbnail: string
  url: string
  mode: Mode
  quality: string
  ext: string
  totalBytes: number
  bytesDone: number
  progress: number
  speedBps: number
  etaSec: number
  status: TaskStatus
  createdAt: number
  startedAt: number
  /**
   * 这个任务实际下载的格式 / 音轨 / 字幕。
   *
   * **必须存在任务上，不能从解析面板现取**：暂停后点「继续」时，用户很可能
   * 已经解析了另一个视频（甚至清空了结果），此时 `currentPick()` 拿到的是
   * 完全不相干的格式——续传会下成另一个清晰度，而界面上的任务标题还是旧的。
   * 这个 bug 的表现是「继续之后进度从头开始、文件名也变了」。
   */
  formatId: string
  /**
   * 这个格式是否**自带音轨**。
   *
   * 它决定后端拼出的格式选择器：`hasAudio` 时是 `<id>/bv*+ba/b`
   * （单文件带音频），否则是 `<id>+bestaudio`（视频流 + 单独音轨）。
   * 猜错的结果是「下到没有声音的视频」，而这一点在进度条上完全看不出来。
   * 所以必须随任务一起保存，续传时原样用。
   */
  hasAudio: boolean
  /**
   * 选中的音轨快照（仅 YouTube 多音轨）。
   *
   * 存完整对象而不是只存 id：后端要的是 `formatId` + `language` + `isM3u8`
   * 三样，只存 id 的话续传时还得回去查解析结果——而那份结果可能已经被
   * 用户换成别的视频了。
   */
  audioTrack?: { formatId: string; language: string; isM3u8?: boolean }
  subtitles: string[]
  /** 最近 24 次采样的速度（画迷你折线用） */
  speedHistory: number[]
  filePath: string
  error?: string
  statusMessage?: string
}

/** 一个运行依赖（对应后端 `deps.Result` / `Dependency`） */
export interface DepItem {
  /**
   * 后端返回的 kind（`yt-dlp` / `ffmpeg` / `ffprobe` / `aria2`）。
   *
   * **注意不是二进制名**：aria2 的可执行文件叫 `aria2c`，但 kind 是 `aria2`。
   * 曾经设置页按 `aria2c` 查找，于是「加速页永远显示未找到 aria2c」
   * 而后端其实已经探测到了——两种命名混用不会有任何报错。
   */
  id: string
  name: string
  /** 是否已找到 */
  found: boolean
  /** 可选依赖（ffprobe / aria2）：缺失不影响基本下载 */
  optional: boolean
  path?: string
  version?: string
  /** 来源：system / managed / manual / scanned */
  source?: string
  /** 找到了但版本过旧 */
  stale?: boolean
  /** 未找到的原因 */
  reason?: string
  /** 二进制形态（仅 yt-dlp）：zipapp 启动 0.4s / native 首次 9~12s */
  form?: string

  /** ===== 以下是**界面态**，不是后端字段 ===== */

  /** 三态：`ready` 可用 / `outdated` 版本过旧 / `missing` 未找到 */
  status: 'ready' | 'outdated' | 'missing'
  /** 是否为必需依赖（`!optional` 的镜像，模板里读起来更顺） */
  required: boolean
  /** 正在下载安装 */
  busy: boolean
  /** 安装进度 0..1 */
  progress: number
}

/** 更新状态机 */
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'latest'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

/** 设置分区（设置页的侧栏） */
export type SettingsSection = 'download' | 'acceleration' | 'network' | 'update' | 'deps' | 'appearance' | 'language'

/** 一条 toast */
export interface ToastItem {
  id: number
  text: string
  kind: 'info' | 'success' | 'error'
  at: number
}
