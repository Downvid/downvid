/**
 * 运行依赖（yt-dlp / ffmpeg）的共享类型。
 *
 * DownVid 不再随安装包分发二进制：启动时探测机器上已安装的版本并直接复用，
 * 探测不到时由用户点击按钮触发下载（主进程调用 Go 边车完成）。
 * 这里定义的类型同时被 preload、env.d.ts 与渲染进程使用。
 */

export type { DepKind } from '../../shared/acceleration'
import type { DepKind } from '../../shared/acceleration'

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
  /**
   * 二进制形态（仅 yt-dlp 有值）：`zipapp` 或 `native`。
   *
   * 两者的 `--version` 完全相同，但启动时间差 20 倍（0.4s vs 9~10s）：
   * PyInstaller 独立包每次启动都要解压 ~72MB。所以「版本一样」不代表
   * 「装对了」——界面必须能看出形态，否则用户永远在等一个没必要等的时间。
   */
  form?: 'zipapp' | 'native'
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
  /** 下载源偏好（见 shared/acceleration.ts 的 DEP_MIRROR_IDS） */
  mirror?: string
}

export interface DepsResponse {
  success: boolean
  status?: RuntimeStatus
  error?: string
}

export interface DepsProgress {
  /**
   * `mirror` 是「直连不通、正在换下一个镜像源」（Go 边车在回退时发出）。
   * 必须单独一类：与 `retry` 混在一起时，用户看到的文案是「网络不稳定，正在重试」，
   * 而实际发生的是「换了一条路」——两者对用户的意义完全不同。
   */
  event: 'start' | 'progress' | 'retry' | 'mirror' | 'installed' | 'error' | 'warn' | 'done'
  tool?: DepKind
  downloaded?: number
  total?: number
  path?: string
  message?: string
}
