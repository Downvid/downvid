/**
 * 下载状态流转的纯逻辑规则。
 *
 * 单独成文件是为了可测试：这些规则各自对应一个真实 bug，而 store 本身依赖
 * IPC 与 Pinia，不便直接单测。抽出来后 store 与用例引用的是**同一份实现**。
 */

/** 主进程下载结果的形状（与 ytdlp:download 的返回一致） */
export interface DownloadResult {
  paused?: boolean
  filePath?: string
  success?: boolean
}

/**
 * 已暂停的任务是否应忽略来自主进程的进度事件。
 *
 * 返回 true 表示忽略。**completed 也要忽略**：主进程 kill 子进程时可能残留
 * 一条结束事件，若照单全收会把任务标成"已完成"并清掉暂停标记，用户就只能
 * 重新下载了（这正是"点击暂停后按钮消失"的原因）。
 */
export function shouldIgnoreProgress(isPaused: boolean): boolean {
  return isPaused
}

/**
 * 下载结束后任务应处于的状态。
 *
 * 暂停时**不能**标成 completed，否则界面显示已完成、进度 100%。
 */
export function statusAfterResult(result: DownloadResult): 'paused' | 'completed' {
  return result?.paused ? 'paused' : 'completed'
}

/**
 * 是否应写入下载历史。
 *
 * 此前无论成功与否都写入，于是暂停、重试、失败都会留下记录。
 * 只有在**真正拿到文件**时才值得记录。
 */
export function shouldRecordHistory(result: DownloadResult): boolean {
  if (result?.paused) return false
  return !!result?.filePath
}
