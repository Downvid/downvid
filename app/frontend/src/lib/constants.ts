/**
 * 应用常量与纯工具。
 *
 * 这些原本混在 `mock.ts`（演示数据）里，现在拆出来——
 * 演示数据整个删除，而这些是**正式代码真正需要的**。
 *
 * ## 为什么拆而不是直接改 mock.ts
 *
 * `mock.ts` 里三类东西混在一起：
 *   1. 演示用的假数据（`makeVideoInfo` / `historySeed` / `depsSeed` / 海报图）
 *   2. 正式需要的常量（`GB` / `CONNECTION_STOPS` / `APP_VERSION`）
 *   3. 正式需要的纯函数（`extractUrl` / `detectPlatform` / `nearestConnectionStop`）
 *
 * 第 2、3 类要留，第 1 类全删。所以拆成 `constants.ts` + 保留的 `mock.ts`
 * 不合适——`mock` 这个名字本身就是「可以删」的信号，留着它会让人以为还能删。
 * 直接拆成下面两个文件，然后**删掉 `mock.ts`**。
 */

/**
 * 仓库坐标与官网。
 *
 * **从 `shared/app.ts` 复用，不要在这里再写一份**——那是全仓唯一来源，
 * 主进程、官网校验脚本、README 徽章都引用它。手抄一份的结果是
 * 「换仓库后官网更新了、应用里的链接还是旧的」，而这类失效不会报错。
 */
export { REPO_URL, WEBSITE_URL, REPO_SLUG } from '../../../../shared/app'

/**
 * 应用版本。
 *
 * 构建期由 Vite 注入 `__APP_VERSION__`（见 vite.config.ts 的 define），
 * 取自 package.json。**不要手写**——写死的版本号会在下次发版时忘记改，
 * 而「关于页显示旧版本」是用户报障时最常见的第一条信息。
 */
declare const __APP_VERSION__: string
export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.6.4'

declare const __BUILD_DATE__: string
export const BUILD_DATE: string =
  typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : '2026.10.26'

export const KB = 1024
export const MB = 1024 * KB
export const GB = 1024 * MB

/**
 * 加速档位（连接数）。
 *
 * 与 Go 侧 `internal/settings` 的 `normalizeAcceleration` 保持一致：
 *   - 上限 16（clamp）
 *   - 最低 4（再低就不是「加速」了）
 *
 * 两处不一致时，用户拖到最高档、存进设置、后端读出来会变成更小的值，
 * 而界面仍显示 16——这种「设置看起来生效、实际没生效」很难排查。
 */
export const CONNECTION_STOPS = [4, 8, 12, 16] as const
export type ConnectionStop = (typeof CONNECTION_STOPS)[number]

/**
 * 把任意连接数归到最近的档位。
 *
 * 相等时**保留先出现的**（`<` 而不是 `<=`）：6 距 4 和 8 都是 2，
 * 取 4。若改成 `<=`，正中间的值会跳到后一档，表现是
 * 「拖到正中间时滑块突然跳一格」。
 */
export function nearestConnectionStop(value: number): ConnectionStop {
  return CONNECTION_STOPS.reduce((best, stop) =>
    Math.abs(stop - value) < Math.abs(best - value) ? stop : best,
  )
}

/** 下载模式 */
export type Mode = 'video' | 'audio' | 'subtitle'

/** 任务状态机 */
export type TaskStatus = 'queued' | 'downloading' | 'merging' | 'paused' | 'completed' | 'error'

/** 页面 */
export type Tab = 'download' | 'history' | 'settings' | 'about'

/** 应用内弹窗 */
export type Dialog = 'none' | 'update' | 'deps' | 'announcement'
