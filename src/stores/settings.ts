import { normalizeAcceleration, type AccelerationSettings } from '../../shared/acceleration'

/**
 * 用户设置的读写。
 *
 * 设置存在 `localStorage['settings']`（**不在 Pinia** 中），由多个组件直接读写。
 *
 * ## 为什么必须有这个模块
 *
 * 此前每个写入点都做 `localStorage.setItem('settings', JSON.stringify(我的对象))`
 * ——**整体覆盖**。于是只要某个组件不知道别的字段，就会把它们抹掉：
 *
 *   - `SettingsView` 的 `Settings` 接口里没有 `depPaths`
 *   - `DepPanel` 把手动指定的依赖路径写进 `depPaths`
 *   - 用户在设置面板点一次「保存」→ `depPaths` 消失，手动路径白填
 *
 * 这类 bug 会反复出现，因为每加一个字段都要去改所有写入点。改成
 * **合并写入**后，写入方只需关心自己那几个字段。
 *
 * ## 约定
 *
 * - 读：`readSettings()`，返回已补齐默认值的完整对象
 * - 写：`updateSettings(patch)`，只覆盖传入的字段
 * - **不要**再直接 `localStorage.setItem('settings', ...)`
 */

export interface AppSettings {
  downloadDir: string
  filenameTemplate: string
  preferredQuality: string
  cookieMode: 'auto' | 'manual'
  cookiesFile: string
  proxy: string
  acceleration: AccelerationSettings
  /** 手动指定的依赖可执行文件路径，由 DepPanel 维护 */
  depPaths: Partial<Record<'yt-dlp' | 'ffmpeg' | 'ffprobe', string>>

  /**
   * 自动检查更新。
   *
   * 关闭后**不会**在启动时请求 GitHub，也不会在退出时自动安装已下载的更新；
   * 「关于」页的手动「检查更新」仍然可用（那是用户显式发起的）。
   * 默认开启：不检查更新会让用户长期停留在旧版本（实测存量用户升级率很低）。
   */
  autoCheckUpdate: boolean
  /**
   * 发现新版本时是否自动下载（仍需用户点「立即安装」）。
   *
   * 关闭时只提示有新版本，下载由用户决定——移动网络/计费流量下更友好。
   */
  autoDownloadUpdate: boolean
}

export const SETTINGS_KEY = 'settings'

export const DEFAULT_SETTINGS: AppSettings = {
  downloadDir: '',
  filenameTemplate: '%(title)s.%(ext)s',
  preferredQuality: 'best',
  cookieMode: 'auto',
  cookiesFile: '',
  proxy: '',
  acceleration: normalizeAcceleration(),
  depPaths: {},
  autoCheckUpdate: true,
  autoDownloadUpdate: false,
}

/**
 * 读取设置，并用默认值补齐缺失字段。
 *
 * 必须补默认值：老用户存的是旧形状，直接读会拿到 `undefined`。
 * 这也是新增字段时的兼容手段（不要删字段名，那属于 MAJOR 变更）。
 */
export function readSettings(): AppSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    return {
      ...DEFAULT_SETTINGS,
      ...raw,
      acceleration: normalizeAcceleration(raw?.acceleration),
      // depPaths 需要单独兜：旧数据里可能没有，或不是对象
      depPaths: raw && typeof raw.depPaths === 'object' && raw.depPaths ? raw.depPaths : {},
    }
  } catch {
    return { ...DEFAULT_SETTINGS, acceleration: normalizeAcceleration() }
  }
}

/**
 * 合并写入设置。
 *
 * 只覆盖 patch 里出现的字段，其余保持原样——这样各组件互不干扰。
 */
export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...readSettings(), ...patch }
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
  } catch {}
  return next
}

/** 只读写依赖手动路径的便捷入口 */
export function readDepPaths(): AppSettings['depPaths'] {
  return readSettings().depPaths
}

export function updateDepPaths(depPaths: AppSettings['depPaths']): void {
  updateSettings({ depPaths })
}
