import { normalizeAcceleration, type AccelerationSettings } from '../../shared/acceleration'
import { normalizeUpdateSource, type UpdateSourceId } from '../../shared/update-sources'
import { DEP_KINDS, normalizeDepMirror, type DepMirrorId, type DepKind } from '../../shared/acceleration'

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
  /**
   * 手动指定的依赖可执行文件路径，由 DepPanel 维护。
   *
   * 值类型必须是 `string | undefined`：早期用 `Partial<Record<...>>` 会与
   * 存档数据里可能出现任意类型的现实冲突（`normalizeDepPaths` 负责清洗）。
   */
  depPaths: { [K in DepKind]?: string }

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

  /**
   * 依赖下载源（yt-dlp / ffmpeg / ffprobe 从哪个源下载）。
   *
   * 与 `updateSource` 分开是因为两者代理的东西不同：更新走 release 元数据，
   * 依赖走 release 资产的原始文件，能用前者的镜像未必能代理后者。
   */
  depMirror: DepMirrorId

  /**
   * 更新源。
   *
   * `'auto'` 会依次尝试 GitHub → jsDelivr → gh-proxy → Gitee → 官网，任一成功即止。
   * 之所以做成可选而不只是固定链路：有些用户的网络能通某一条、有些反过来，
   * 而**更新通道本身坏了就没法靠发新版修**，只能让用户自己换一条路。
   */
  updateSource: UpdateSourceId

  /**
   * 界面语言。
   *
   * 'auto' = 跟随系统（默认）；其余为明确的 locale。
   * 之所以默认 'auto' 而不是固定中文：README 以英文为默认、官网双语、
   * 有相当比例的海外用户，固定中文会让他们的首次体验完全看不懂。
   */
  language: 'auto' | 'zh-CN' | 'en-US'
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
  updateSource: 'auto',
  depMirror: 'auto',
  language: 'auto',
}

/**
 * 清洗 depPaths：只保留已知依赖种类上的**非空字符串**。
 *
 * 存档数据可能被手工改坏，或是更早版本的形状（数组、字符串、null）。
 * 早先只判断 `typeof === 'object'`，于是 `[]` 会被当成合法值留下来，
 * 后续按对象使用就取不到任何路径 —— 表现为「手动填的路径没生效」，
 * 且完全没有报错。
 */
export function normalizeDepPaths(value: unknown): AppSettings['depPaths'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const raw = value as Record<string, unknown>
  const out: AppSettings['depPaths'] = {}
  for (const kind of DEP_KINDS) {
    const v = raw[kind]
    if (typeof v === 'string' && v.trim()) out[kind] = v.trim()
  }
  return out
}

/**
 * 清洗 language：只接受三个合法值，其余一律回退 'auto'。
 *
 * 存档数据可能被手工改坏，或来自未来版本。非法值直接当成 'auto'，
 * 而不是原样保留——否则界面语言会变成"没有语言"（t() 全部回退中文）。
 */
export function normalizeLanguage(value: unknown): AppSettings['language'] {
  return value === 'zh-CN' || value === 'en-US' || value === 'auto' ? value : 'auto'
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
      // depPaths 需要单独兜：旧数据里可能没有、不是对象，或类型不对
      depPaths: normalizeDepPaths(raw?.depPaths),
      // 更新源同理由这里兜：非法值不能原样留着，否则「一个源都不试」
      // 会表现成「永远检测不到更新」
      updateSource: normalizeUpdateSource(raw?.updateSource),
      depMirror: normalizeDepMirror(raw?.depMirror),
      language: normalizeLanguage(raw?.language),
    }
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      acceleration: normalizeAcceleration(),
      depPaths: {},
      updateSource: 'auto',
      depMirror: 'auto',
    }
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
