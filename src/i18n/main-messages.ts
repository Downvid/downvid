import { t } from './index'

/**
 * 把**主进程**产出的用户可见文案翻译成当前语言。
 *
 * ## 为什么需要这一层
 *
 * 主进程（`electron/`）抛出的错误文案是硬编码中文的，而它拿不到渲染进程的
 * 语言设置——那边没有 `localStorage`，也没有 Vue 的响应式。改造成「主进程
 * 只回错误码、渲染进程负责文案」是正确做法，但涉及 IPC 契约变更，风险大。
 *
 * 折中方案：主进程文案保持不变，渲染进程在**展示前**按「已知原文 → 词条」
 * 映射翻译。认不出来的文案原样透传（宁可显示中文，也不要显示空白或键名）。
 *
 * ## 维护约定
 *
 * 映射表的键必须与主进程源码里的字面量**逐字一致**——`lint:i18n` 会从
 * `electron/` 里扫出候选文案并与本表比对，主进程改了文案而这里没跟上时会报警。
 */

/** 主进程原文 → 词条键 */
const MAIN_MESSAGES: Record<string, string> = {
  '未找到可用的 yt-dlp': 'err.ytdlpMissing',
  '磁盘空间不足': 'err.diskFull',
  '网络连接中断，请重试': 'err.network',
}

/**
 * 翻译主进程文案。
 *
 * 支持两类：
 *   1. 整句精确匹配（`未找到可用的 yt-dlp`）
 *   2. 带参数的模板（`未找到可用的 ffmpeg，请在…`）——按前缀识别，
 *      参数从原文里抽出来
 */
export function translateMainMessage(raw: string): string {
  if (!raw) return raw

  const exact = MAIN_MESSAGES[raw]
  if (exact) return t(exact)

  // `未找到可用的 <kind>，请在「设置 → 运行依赖」中下载后重试`
  const missing = /^未找到可用的 (yt-dlp|ffmpeg|ffprobe)/.exec(raw)
  if (missing) return t('err.depMissing', { kind: missing[1] })

  return raw
}
