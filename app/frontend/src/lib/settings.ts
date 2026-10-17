/**
 * 用户设置的**前端模型**。
 *
 * ## 两类字段，存储位置不同（这不是冗余，是刻意的）
 *
 * | 字段 | 存哪 | 为什么 |
 * |---|---|---|
 * | `downloadDir` / `filenameTemplate` / `proxy` / `acceleration` / `updateSource` / … | **后端** `<dataDir>/settings.json` | 主进程真的要用它们去起 yt-dlp；容器端也要读 |
 * | `theme` / `radius` | **前端** `localStorage` | 纯展示偏好，后端完全不关心 |
 *
 * 如果把展示偏好也塞给后端，容器版的 `/settings` 里会混进一堆与它无关的字段；
 * 反过来把 `proxy` 只放前端，主进程读不到——这正是旧版 `localStorage['settings']`
 * 的问题：多个组件各自读，默认值还分成两份。
 *
 * ## 与 Go 侧 `internal/settings` 的字段对应
 *
 * | 前端 | 后端 | 备注 |
 * |---|---|---|
 * | `downloadDir` | `downloadDir` | 空串 = 用系统下载目录 |
 * | `filenameTemplate` | `filenameTemplate` | |
 * | `quality` | `preferredQuality` | **名字不同**：前端叫 quality 更好读 |
 * | `cookieFile` | `cookiesFile` | **名字不同**（单复数） |
 * | `maxConnections` | `acceleration.maxConnections` | 扁平化，组件更好用 |
 * | `accelEnabled` | `acceleration.enabled` | 同上 |
 *
 * 映射只在 `toBackendPatch()` / `fromBackend()` 两个函数里做，
 * 别处不要手写字段名——两处各拼一次必然漂移。
 */
import { CONNECTION_STOPS, nearestConnectionStop } from './constants'
import type { UpdateSourceId } from '../../../../shared/update-sources'
import type { DepMirrorId, DepKind } from '../../../../shared/acceleration'

/** 界面主题 */
export type ThemeSetting = 'auto' | 'light' | 'dark'
/** 圆角风格 */
export type RadiusSetting = 'default' | 'sharp' | 'round'
/** 界面语言 */
export type LanguageSetting = 'auto' | 'zh-CN' | 'en-US'
/** 画质偏好 */
export type QualitySetting = 'best' | '1080p' | '720p' | '480p'

/** 前端完整设置（后端字段 + 展示偏好） */
export interface AppSettings {
  // ===== 存后端 =====
  downloadDir: string
  filenameTemplate: string
  quality: QualitySetting
  cookieMode: 'auto' | 'manual'
  cookieFile: string
  proxy: string
  accelEnabled: boolean
  maxConnections: number
  updateSource: UpdateSourceId
  depMirror: DepMirrorId
  autoCheckUpdate: boolean
  autoDownloadUpdate: boolean
  /** 手动指定的依赖路径（只对探测生效，下载永远写托管目录） */
  depPaths: Partial<Record<DepKind, string>>

  // ===== 只存前端 =====
  theme: ThemeSetting
  radius: RadiusSetting
  language: LanguageSetting
}

export const DEFAULT_SETTINGS: AppSettings = {
  downloadDir: '',
  filenameTemplate: '%(title)s.%(ext)s',
  quality: 'best',
  cookieMode: 'auto',
  cookieFile: '',
  proxy: '',
  accelEnabled: true,
  maxConnections: 8,
  updateSource: 'auto',
  depMirror: 'auto',
  autoCheckUpdate: true,
  autoDownloadUpdate: false,
  depPaths: {},

  theme: 'auto',
  radius: 'default',
  language: 'auto',
}

/** 只存前端的字段名——写回 localStorage 时只取这些 */
const LOCAL_ONLY = ['theme', 'radius'] as const
const LOCAL_KEY = 'downvid.ui'

/**
 * 读本地的展示偏好。
 *
 * 坏数据直接忽略（不是报错）：主题读不出来退回 `auto`，
 * 用户最多觉得「颜色变了」，不该因此看到错误提示。
 */
export function loadLocalPrefs(): Pick<AppSettings, 'theme' | 'radius'> {
  const fallback = { theme: DEFAULT_SETTINGS.theme, radius: DEFAULT_SETTINGS.radius }
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      theme: parsed.theme === 'light' || parsed.theme === 'dark' ? parsed.theme : 'auto',
      radius:
        parsed.radius === 'sharp' || parsed.radius === 'round' ? parsed.radius : 'default',
    }
  } catch {
    return fallback
  }
}

/** 只写展示偏好（不动后端字段） */
export function saveLocalPrefs(patch: Pick<AppSettings, 'theme' | 'radius'>): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(patch))
  } catch {
    // 隐私模式下 localStorage 可能抛错——展示偏好丢了不影响使用
  }
}

/**
 * 前端设置 → 后端 patch。
 *
 * 只输出**后端认识的字段**，且把扁平的 `accelEnabled` / `maxConnections`
 * 组装回 `acceleration` 对象。字段名映射见文件头。
 */
export function toBackendPatch(s: Partial<AppSettings>): Record<string, unknown> {
  const patch: Record<string, unknown> = {}

  if (s.downloadDir !== undefined) patch.downloadDir = s.downloadDir
  if (s.filenameTemplate !== undefined) patch.filenameTemplate = s.filenameTemplate
  // quality ↔ preferredQuality（名字不同，见文件头）
  if (s.quality !== undefined) patch.preferredQuality = s.quality
  if (s.cookieMode !== undefined) patch.cookieMode = s.cookieMode
  // cookieFile ↔ cookiesFile（单复数）
  if (s.cookieFile !== undefined) patch.cookiesFile = s.cookieFile
  if (s.proxy !== undefined) patch.proxy = s.proxy
  if (s.updateSource !== undefined) patch.updateSource = s.updateSource
  if (s.depMirror !== undefined) patch.depMirror = s.depMirror
  if (s.autoCheckUpdate !== undefined) patch.autoCheckUpdate = s.autoCheckUpdate
  if (s.autoDownloadUpdate !== undefined) patch.autoDownloadUpdate = s.autoDownloadUpdate
  if (s.depPaths !== undefined) patch.depPaths = s.depPaths

  // 扁平字段 → 嵌套对象。只传改了的那些，避免覆盖另一个字段
  if (s.accelEnabled !== undefined || s.maxConnections !== undefined) {
    const acceleration: Record<string, unknown> = {}
    if (s.accelEnabled !== undefined) acceleration.enabled = s.accelEnabled
    if (s.maxConnections !== undefined) acceleration.maxConnections = s.maxConnections
    patch.acceleration = acceleration
  }

  return patch
}

/**
 * 后端设置 → 前端设置（补齐缺失字段）。
 *
 * 缺失用默认值补齐——这是「只增不删」的实现：
 * 老版本的后端文件没有新字段时，前端仍能正常工作。
 */
export function fromBackend(
  raw: Record<string, unknown> | null,
  local: Pick<AppSettings, 'theme' | 'radius'>,
): AppSettings {
  const base = { ...DEFAULT_SETTINGS, ...local }
  if (!raw) return base

  const str = (v: unknown, fallback: string): string =>
    typeof v === 'string' ? v : fallback
  const bool = (v: unknown, fallback: boolean): boolean =>
    typeof v === 'boolean' ? v : fallback

  const acceleration = (raw.acceleration ?? {}) as Record<string, unknown>
  const rawQuality = str(raw.preferredQuality, DEFAULT_SETTINGS.quality)

  return {
    ...base,
    downloadDir: str(raw.downloadDir, base.downloadDir),
    filenameTemplate: str(raw.filenameTemplate, base.filenameTemplate),
    quality: (['best', '1080p', '720p', '480p'] as const).includes(rawQuality as QualitySetting)
      ? (rawQuality as QualitySetting)
      : base.quality,
    cookieMode: raw.cookieMode === 'manual' ? 'manual' : 'auto',
    cookieFile: str(raw.cookiesFile, base.cookieFile),
    proxy: str(raw.proxy, base.proxy),
    accelEnabled: bool(acceleration.enabled, base.accelEnabled),
    // 连接数归到最近的档位：后端的合法范围是 1..16，而滑块只有四档，
    // 直接透传一个 7 会让滑块找不到对应位置
    maxConnections: nearestConnectionStop(
      typeof acceleration.maxConnections === 'number'
        ? acceleration.maxConnections
        : base.maxConnections,
    ),
    updateSource: (str(raw.updateSource, base.updateSource) as UpdateSourceId),
    depMirror: (str(raw.depMirror, base.depMirror) as DepMirrorId),
    autoCheckUpdate: bool(raw.autoCheckUpdate, base.autoCheckUpdate),
    autoDownloadUpdate: bool(raw.autoDownloadUpdate, base.autoDownloadUpdate),
    depPaths: (raw.depPaths ?? {}) as AppSettings['depPaths'],
    language: (['auto', 'zh-CN', 'en-US'] as const).includes(raw.language as LanguageSetting)
      ? (raw.language as LanguageSetting)
      : base.language,
  }
}

/** 供测试确认档位与后端 clamp 上限一致 */
export const CONNECTION_STOP_VALUES = CONNECTION_STOPS
export { LOCAL_ONLY }
