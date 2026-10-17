/**
 * 「这条视频是不是已经下过」的判定规则。
 *
 * 抽成纯函数（不碰 `$state`）有两个原因：
 *
 *   1. 它能被 vitest 直接测——`store.svelte.ts` 依赖 Svelte 的 runes，
 *      在没有 svelte 插件的 node 环境里 import 不了；
 *   2. 这个判据**出过两次错**，每次都是「功能悄悄失效」而不是报错：
 *      先是只比 URL，导致下过 1080P 就再也下不了 4K；再是把它算成
 *      「解析时的一次性状态」，换清晰度后界面仍停在「已下载」分支。
 *
 * 判定必须同时满足三件事：**同一个视频**、**同一清晰度**、**同一模式**。
 * 任一不同就是另一个文件，允许再下一次。
 */

import type { HistoryItem } from './types'
import type { Mode } from './constants'

/** 判定「同一条视频」的两个依据（URL 优先，URL 缺失时才用标题） */
export interface VideoIdentity {
  url: string
  title: string
}

/** 当前选择：清晰度 + 模式。为 null 表示还没选出可比的东西 */
export interface PickIdentity {
  quality: string
  mode: Mode
}

/** 归一化：大小写、首尾与连续空白都不该影响「是不是同一个」 */
const normalize = (v: string): string => (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * 找出与当前选择冲突的历史记录。
 *
 * 返回 null 表示「可以下载」。
 *
 * 规则里有两个**刻意的宽松**：
 *
 *   - `pick` 为 null 时退化为「同 URL 就算重复」。拿不到清晰度时
 *     宁可多拦一次，也不要让同一个文件被重复下载两遍。
 *   - `fileExists` 为 false 的历史不参与判定。文件已经被用户删掉的记录
 *     只是「曾经下过」，拦下来只会让用户困惑（他要的就是重新拿到文件）。
 */
export function findExistingDownload(
  history: readonly HistoryItem[],
  video: VideoIdentity,
  url: string,
  pick: PickIdentity | null,
): HistoryItem | null {
  const sameUrl = normalize(url)
  const sameTitle = normalize(video.title)

  for (const h of history) {
    if (!h.fileExists) continue

    // URL 为空时（极少数解析器给不出规范化 URL）才退回标题比较：
    // 只比标题会把两个都叫《预告片》的视频误判成同一个。
    const identityMatch = sameUrl
      ? normalize(h.url) === sameUrl
      : normalize(h.title) === sameTitle
    if (!identityMatch) continue

    if (!pick) return h
    if (normalize(h.quality) !== normalize(pick.quality)) continue
    if (h.mode !== pick.mode) continue

    return h
  }
  return null
}
