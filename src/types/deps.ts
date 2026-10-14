/**
 * 运行依赖（yt-dlp / ffmpeg）的共享类型。
 *
 * DownVid 不再随安装包分发二进制：启动时探测机器上已安装的版本并直接复用，
 * 探测不到时由用户点击按钮触发下载（主进程调用 Go 边车完成）。
 * 这里定义的类型同时被 preload、env.d.ts 与渲染进程使用。
 */

export type DepKind = 'yt-dlp' | 'ffmpeg' | 'ffprobe'

/** 依赖来源，用于界面标识与排查 */
export type DepSource = 'system' | 'managed' | 'manual' | 'scanned'

export interface DepStatus {
  kind: DepKind
  found: boolean
  /** 非必需依赖（ffprobe）：缺失不阻塞下载 */
  optional?: boolean
  path?: string
  version?: string
  source?: DepSource
  /** 未找到时的原因，直接展示给用户 */
  reason?: string
  /** 由 DownVid 下载并托管，可安全覆盖更新 */
  managed?: boolean
  /** 当前清单要求的最低版本；界面据此判断「是否真的该提示更新」 */
  requiredVersion?: string
  /** 找到了副本但版本落后于清单（此时 found 为 false） */
  stale?: boolean
}

export interface RuntimeStatus {
  platform: string
  managedDir: string
  checkedAt: number
  results: DepStatus[]
}

/** 探测/下载请求参数 */
export interface DepsSettings {
  /** 设置里手动指定的可执行文件路径 */
  manualPaths?: Partial<Record<DepKind, string>>
  proxy?: string
}

export interface DepsResponse {
  success: boolean
  status?: RuntimeStatus
  error?: string
}

export interface DepsProgress {
  event: 'start' | 'progress' | 'retry' | 'installed' | 'error' | 'warn' | 'done'
  tool?: DepKind
  downloaded?: number
  total?: number
  path?: string
  message?: string
}
