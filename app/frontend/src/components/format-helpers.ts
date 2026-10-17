/**
 * 组件的展示规则（无框架依赖）。
 *
 * ## 为什么要单独抽出来
 *
 * 旧版里 `formatFileSize` 在 **VideoInfoCard.vue 与 FormatSelector.vue 各写一份**
 * （两份完全相同），`formatDuration` 只在 VideoInfoCard 里。
 * 迁到 Svelte 时若照抄，就会变成新的两份——两个组件对同一个文件大小
 * 显示不同格式的那天，就是这份重复的代价。
 *
 * ## 纯函数的好处
 *
 * 能直接被 vitest 测（node 环境，不需要 svelte 插件）。
 * 组件只负责把结果放进模板。
 */
import { translate, type Locale } from '../i18n/core'

/** 当前语言（组件调用时传入，避免这个文件依赖响应式状态） */
export type { Locale }

/**
 * 文件大小的展示字符串。
 *
 * 三个边界都有真实理由：
 *   - `undefined` / `null`：平台没返回字段 → 「未知」
 *   - `0`：平台明确返回 0（常见于「大小待定」）→ 「大小未知」，
 *     **不能显示成 0.0 MB**，那会让用户以为文件是空的
 *   - 1024 MB 分界：与旧版一致，不是 1000
 */
export function formatFileSize(bytes: number | null | undefined, locale: Locale = 'zh-CN'): string {
  if (bytes === undefined || bytes === null) return translate(locale, 'common.unknown')
  if (bytes === 0) return translate(locale, 'formats.sizeUnknown')
  const mb = bytes / 1024 / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

/**
 * 时长的展示字符串（`分:秒`）。
 *
 * 超过一小时仍用分钟表示（754 秒 → `12:34`，3600 秒 → `60:00`）——
 * 这是旧版的行为，迁移时保持原样：改成 `1:00:00` 会让界面看起来不一致，
 * 而这个组件是用户第一眼看到的东西。
 *
 * 0 / undefined 返回空串（不显示 `0:00`）。
 */
export function formatDuration(seconds?: number): string {
  if (!seconds) return ''
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
