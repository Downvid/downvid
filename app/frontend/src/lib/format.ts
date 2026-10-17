/**
 * 演示用的展示格式化。纯函数，无框架依赖。
 * 规则与旧版 formatFileSize / formatDuration 对齐，避免演示和真实 UI 两套口径。
 */

export function formatBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null) return '—'
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2
  return String(value.toFixed(digits)) + ' ' + units[unit]
}

export function formatSpeed(bytesPerSecond: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return '0 B/s'
  return formatBytes(bytesPerSecond) + '/s'
}

/** 剩余时间：mm:ss，超过一小时用 h:mm:ss */
export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
}

/** 视频时长：18:42；超过一小时用 1:02:03 */
export function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return ''
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
  return m + ':' + String(s).padStart(2, '0')
}

export type DayGroup = 'today' | 'yesterday' | 'earlier'

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function dayGroup(ts: number, now = Date.now()): DayGroup {
  const diff = startOfDay(now) - startOfDay(ts)
  if (diff <= 0) return 'today'
  if (diff === 86_400_000) return 'yesterday'
  return 'earlier'
}

export function formatClock(ts: number): string {
  const d = new Date(ts)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

export function formatDate(ts: number): string {
  const d = new Date(ts)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 截断标题，用于 toast 与窄列 */
export function ellipsis(text: string, max = 42): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}
