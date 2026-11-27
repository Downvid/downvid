import type { DepItem } from './types'

export interface DepInstallEvent {
  event?: string
  tool?: string
  downloaded?: number
  total?: number
}

/** 批量安装按任务等权聚合；单项安装只能更新已在下载的对应行。 */
export function applyDepInstallEvent(
  deps: DepItem[],
  { event, tool, downloaded = 0, total = 0 }: DepInstallEvent,
  batch?: Map<string, number>,
): DepItem[] {
  if (!tool) return deps
  let ratio: number
  if (event === 'start') ratio = 0
  else if (event === 'installed') ratio = 1
  else if (event === 'progress' && total > 0) ratio = Math.min(1, Math.max(0, downloaded / total))
  else return deps

  if (batch && (event === 'start' || batch.has(tool))) batch.set(tool, ratio)
  return deps.map((dep) =>
    dep.id === tool && (dep.busy || batch?.has(tool)) ? { ...dep, busy: true, progress: ratio } : dep,
  )
}

export function totalDepInstallProgress(batch: Map<string, number>): number {
  if (!batch.size) return 0
  let total = 0
  for (const ratio of batch.values()) total += ratio
  return total / batch.size
}
