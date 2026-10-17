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
  /** 最近 24 次采样的速度（画迷你折线用） */
  speedHistory: number[]
  filePath: string
  error?: string
  statusMessage?: string
}

/** 一个运行依赖（对应后端 `deps.Status`） */
export interface DepItem {
  id: string
  name: string
  /** 是否已找到 */
  found: boolean
  /** 可选依赖（ffprobe / aria2）：缺失不影响基本下载 */
  optional: boolean
  path?: string
  version?: string
  /** 来源：system / managed / manual */
  source?: string
  /** 找到了但版本过旧 */
  stale?: boolean
  /** 未找到的原因 */
  reason?: string
  /** 二进制形态（仅 yt-dlp）：zipapp 启动 0.4s / native 首次 9~12s */
  form?: string
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
