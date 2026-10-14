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

/**
 * 同时下载的任务数上限。
 *
 * 为什么必须有这道闸：`startDownload()` 在同步流程里就把 `isDownloading` 置回
 * false，所以它拦不住第二次点击。用户连点几次「下载」会有多个任务同时跑，
 * 而每个任务又各自开 8～16 路分块请求——它们互相抢带宽，**每一个都变慢**，
 * 总耗时反而更长，还更容易触发站点的 429 限流。
 *
 * 取 3 而不是 1：单个任务常受制于单站点限速，留出一点并行能提升总吞吐；
 * 再多则并发分块相乘，收益递减而限流风险上升。
 */
export const MAX_CONCURRENT_DOWNLOADS = 99 // 提高并发，下载更快！

/** 正在占用下载槽位的状态（'merging' 也在跑 ffmpeg，同样占槽位） */
export function isActiveStatus(status: string): boolean {
  return status === 'downloading' || status === 'merging'
}

/** 已入队但尚未开始的状态 */
export function isQueuedStatus(status: string): boolean {
  return status === 'pending'
}

/**
 * 从队列里挑出现在**可以开始**的任务 id，最多 `limit - 正在运行数` 个。
 *
 * 纯函数，不碰 IPC / Pinia，因此可以直接断言「并发上限是否真的生效」——
 * 这类「多开导致互相抢带宽」的问题在真机上表现为「都变慢」，很难归因，
 * 必须靠用例钉住。
 *
 * 按 `createdAt` 升序取（先进先出）：先加进队列的任务先下载，否则用户会看到
 * 后加的任务先跑，像是队列坏了。
 */
export function selectStartableTasks(
  tasks: { id: string; status: string; createdAt?: string }[],
  limit = MAX_CONCURRENT_DOWNLOADS,
): string[] {
  const running = tasks.filter((t) => isActiveStatus(t.status)).length
  const slots = Math.max(0, limit - running)
  if (slots === 0) return []
  return tasks
    .filter((t) => isQueuedStatus(t.status))
    .slice()
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    .slice(0, slots)
    .map((t) => t.id)
}

/**
 * 重试一个失败任务时要重置的字段。
 *
 * 关键是**必须回到 `pending`**：若只清掉 error 而保留原状态，
 * 任务会卡在 `error` 上不再被队列调度，点了「重试」看起来毫无反应。
 * 进度也要归零——上次的百分比留着会让人以为在续传，实际是从头下。
 */
export function retryReset(): {
  status: 'pending'
  progress: number
  error: undefined
  speed: undefined
  eta: undefined
} {
  return { status: 'pending', progress: 0, error: undefined, speed: undefined, eta: undefined }
}
