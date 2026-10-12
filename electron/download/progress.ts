import { BrowserWindow } from 'electron'

/**
 * 下载进度上报。
 *
 * 两条下载路径（直链、yt-dlp）都要发同样的进度事件，因此把广播与格式化
 * 抽到这里，避免两处各写一遍、字段慢慢漂移。
 */

/** 广播进度到所有窗口 */
export function sendDownloadProgress(data: Record<string, unknown>) {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) win.webContents.send('download:progress', data)
  })
}

// 进度更新节流：每个 taskId 最多每 200ms 发送一次 IPC。
// yt-dlp 的进度行可能非常密集，不节流会拖慢渲染进程。
const progressThrottles = new Map<string, number>()

export function throttledProgress(data: { taskId: string } & Record<string, unknown>) {
  const now = Date.now()
  const last = progressThrottles.get(data.taskId) || 0
  if (now - last < 200) return
  progressThrottles.set(data.taskId, now)
  sendDownloadProgress(data)
}

/** 任务结束时清理节流状态，避免 Map 随下载数无限增长 */
export function clearProgressThrottle(taskId: string) {
  progressThrottles.delete(taskId)
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`
}
