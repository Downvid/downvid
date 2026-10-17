/**
 * 依赖下载源。
 *
 * 与「更新源」是同一类设计，但**不能复用**：更新走的是 release 元数据 +
 * 安装包（electron-updater / 版本号接口），依赖下载走的是 GitHub release 资产
 * 的原始文件，只有**前缀式反代**能代理它（jsDelivr / Gitee 都不行）。
 * 所以这里只列真正能下的那几条。
 *
 * `auto` = GitHub → gh-proxy.com → ghproxy.net → ghfast.top 依次降级；
 * 其余值为钉死某个源（排查「到底是不是这个镜像的问题」时用）。
 * 取值必须与 `backend/internal/fetch/mirror.go` 的 `Mirrors` 一致，
 * `tests/deps-error.test.ts` 会比对两边。
 */
/**
 * 运行依赖的种类（唯一来源）。
 *
 * aria2 也在这里：它以前被单独放在 `electron/download/aria2.ts` 里自己探测，
 * 导致「加速」页有检测、依赖页却没有下载入口，用户看到的是一个半边功能。
 * 现在它与其他三个走同一套探测 / 下载 / 校验流程，类型也只定义一次。
 *
 * 顺序即界面展示顺序：必需依赖在前，可选的 aria2 在后。
 */
export const DEP_KINDS = ['yt-dlp', 'ffmpeg', 'ffprobe', 'aria2'] as const
export type DepKind = (typeof DEP_KINDS)[number]

/** 只有这些种类缺失会真正阻塞下载（aria2 缺了只是不走加速） */
export const REQUIRED_DEP_KINDS: readonly DepKind[] = ['yt-dlp', 'ffmpeg']

export const DEP_MIRROR_IDS = ['auto', 'direct', 'ghproxy', 'ghproxy-net', 'ghfast'] as const
export type DepMirrorId = (typeof DEP_MIRROR_IDS)[number]

/** 非法值一律回退 `auto`：回退成「一个源都不试」会让下载永久失败。 */
export function normalizeDepMirror(value: unknown): DepMirrorId {
  return typeof value === 'string' && (DEP_MIRROR_IDS as readonly string[]).includes(value)
    ? (value as DepMirrorId)
    : 'auto'
}

export interface AccelerationSettings {
  enabled: boolean
  maxConnections: number
  aria2Path: string
}

export interface AccelerationStatus {
  found: boolean
  path: string | null
  version: string
  reason: string
}

export function normalizeAcceleration(value?: unknown): AccelerationSettings {
  const raw = value && typeof value === 'object' ? value as Partial<AccelerationSettings> : {}
  const count = Number(raw.maxConnections)
  return {
    enabled: raw.enabled !== false,
    maxConnections: Number.isFinite(count) ? Math.max(1, Math.min(16, Math.trunc(count))) : 8,
    aria2Path: typeof raw.aria2Path === 'string' ? raw.aria2Path.trim() : '',
  }
}

export function accelerationConnections(value?: unknown): number {
  const settings = normalizeAcceleration(value)
  return settings.enabled ? settings.maxConnections : 1
}
