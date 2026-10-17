/**
 * 「续传 / 重试时该用哪个格式」的判定。
 *
 * ## 这里曾经有一个不会报错、只会下错东西的 bug
 *
 * 暂停后点「继续」，走的是 `this.currentPick()` —— 也就是**解析面板当前选中
 * 的格式**。而用户暂停之后很可能已经：
 *
 *   - 解析了另一个视频（此时 currentPick 是别人的 formatId）
 *   - 清空了结果（currentPick 返回 null，于是「继续」按钮点了没反应）
 *   - 在同一个视频里换了清晰度（此时续传会下成另一个分辨率）
 *
 * 三种情况都不会报错。前两种的表现是「点了没反应」，第三种更糟：
 * 任务标题还是旧的，实际下的是新格式，而 yt-dlp 从 `.part` 续传时
 * 会因为格式不匹配而从头开始 —— 用户看到的是「进度条突然归零」。
 *
 * 正确的做法是：**任务是一次下载的完整快照**，续传只认任务上的字段。
 */

/** 一次下载发起时需要的全部参数（发起时从界面捕获，之后不再变） */
export interface DownloadSnapshot {
  formatId: string
  /** 该格式是否自带音轨（决定后端的格式选择器） */
  hasAudio: boolean
  audioTrack?: { formatId: string; language: string; isM3u8?: boolean }
  subtitles: string[]
}

/** 界面当前的选择（会随用户操作变化） */
export interface CurrentSelection {
  formatId: string
  hasAudio: boolean
  audioTrack?: { formatId: string; language: string; isM3u8?: boolean }
  subtitles: string[]
}

/**
 * 取「这次下载」应该用的参数。
 *
 * @param task    已存在的任务（续传 / 重试时传它）
 * @param current 界面当前选择（*首次*发起到下载时传它）
 *
 * 规则很简单但很关键：**有任务就用任务的**。
 * 只有首次发起（还没有任务快照）时才读界面当前值。
 */
export function snapshotForRun(
  task: DownloadSnapshot | null,
  current: CurrentSelection | null,
): DownloadSnapshot | null {
  if (task) {
    // 复制一份数组：调用方之后改界面上的字幕选择不该影响这次下载
    return {
      formatId: task.formatId,
      hasAudio: task.hasAudio,
      audioTrack: task.audioTrack ? { ...task.audioTrack } : undefined,
      subtitles: [...task.subtitles],
    }
  }
  if (!current) return null
  return {
    formatId: current.formatId,
    hasAudio: current.hasAudio,
    audioTrack: current.audioTrack ? { ...current.audioTrack } : undefined,
    subtitles: [...current.subtitles],
  }
}
