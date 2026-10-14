import path from 'node:path'
import type { HistoryRecord } from '../src/types'

/** 历史代表本地文件；同 URL 的不同清晰度或输出目录仍是独立文件。 */
export function historyFileKey(filePath: string, platform: NodeJS.Platform = process.platform): string {
  const paths = platform === 'win32' ? path.win32 : path.posix
  const key = paths.resolve(filePath)
  return platform === 'win32' ? key.toLowerCase() : key
}

export function dedupeHistory(history: HistoryRecord[], platform: NodeJS.Platform = process.platform): HistoryRecord[] {
  const seen = new Set<string>()
  return history.filter(record => {
    if (!record || typeof record.filePath !== 'string' || !record.filePath.trim()) return false
    const key = historyFileKey(record.filePath, platform)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).map(({ fileExists: _, ...record }) => record)
}

export function upsertHistory(
  history: HistoryRecord[],
  record: Omit<HistoryRecord, 'id' | 'createdAt' | 'fileExists'>,
  id: string,
  createdAt: string,
  platform: NodeJS.Platform = process.platform,
): HistoryRecord[] {
  const key = historyFileKey(record.filePath, platform)
  const existing = history.find(item => historyFileKey(item.filePath, platform) === key)
  const updated = { ...record, id: existing?.id || id, createdAt: existing?.createdAt || createdAt }
  return [updated, ...dedupeHistory(history, platform).filter(item => historyFileKey(item.filePath, platform) !== key)].slice(0, 100)
}
