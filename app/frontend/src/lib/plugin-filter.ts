/**
 * 插件列表的搜索与筛选 —— 纯函数。
 *
 * 抽到 lib/ 而不是留在 store 里：store 带 runes，vitest 没法直接跑。
 * 而这段逻辑恰恰最容易被后续改动碰坏（例如加筛选条件时漏掉一条、
 * 搜索字段少算一个），必须能独立测。
 */
import type { PluginEntry } from './types'

export type PluginFilter = 'all' | 'installed' | 'updatable' | 'available'

/** 该插件是否有新版本可更新。 */
export function hasUpdate(p: PluginEntry): boolean {
  return Boolean(p.installed && p.version && p.installedVersion && p.version !== p.installedVersion)
}

/**
 * 过滤插件。
 *
 * 搜索范围包括名称、描述、id 与支持站点——用户往往记得「那个支持 B 站的」，
 * 而不是插件叫什么。不做权重排序：列表本来就不长，保持索引顺序读者更容易
 * 建立位置记忆。
 */
export function filterPlugins(
  entries: PluginEntry[],
  query: string,
  filter: PluginFilter,
): PluginEntry[] {
  const q = query.trim().toLowerCase()
  return entries.filter((p) => {
    if (filter === 'installed' && !p.installed) return false
    if (filter === 'available' && p.installed) return false
    if (filter === 'updatable' && !hasUpdate(p)) return false
    if (!q) return true
    const hay = [p.name, p.description ?? '', p.id, ...(p.sites ?? [])].join(' ').toLowerCase()
    return hay.includes(q)
  })
}

/** 各筛选项下的数量（用于在筛选条上显示计数）。 */
export function countPlugins(entries: PluginEntry[]): Record<PluginFilter, number> {
  return {
    all: entries.length,
    installed: entries.filter((p) => p.installed).length,
    updatable: entries.filter(hasUpdate).length,
    available: entries.filter((p) => !p.installed).length,
  }
}
