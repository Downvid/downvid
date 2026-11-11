/**
 * 插件列表的搜索与筛选 —— 纯函数。
 *
 * 抽到 lib/ 而不是留在 store 里：store 带 runes，vitest 没法直接跑。
 * 而这段逻辑恰恰最容易被后续改动碰坏（例如加筛选条件时漏掉一条、
 * 搜索字段少算一个），必须能独立测。
 */
import type { PluginEntry } from './types'

export type PluginFilter = 'all' | 'installed' | 'updatable' | 'available'

/** 是否能安装：被拦下的（如缺风险声明）一律不能。 */
export function canInstall(p: PluginEntry): boolean {
  return !p.installed && Boolean(p.repo) && !p.blockedReason
}

/** 该插件是否有新版本可更新。 */
export function hasUpdate(p: PluginEntry): boolean {
  return Boolean(p.installed && p.version && p.installedVersion && p.version !== p.installedVersion)
}

/**
 * 过滤插件。
 *
 * 搜索范围包括名称、描述、id、作者、仓库与支持站点——用户往往记得「那个支持
 * B 站的」或「某个作者做的」，而不是插件叫什么。
 *
 * 空格分隔的多个词按「都要命中」处理（AND）：搜「B站 1080」时，
 * 只要插件同时提到这两点就能找到，而不是要求用户在描述里逐字匹配整句。
 *
 * 不做权重排序：列表本来就不长，保持索引顺序读者更容易建立位置记忆。
 */
export function filterPlugins(
  entries: PluginEntry[],
  query: string,
  filter: PluginFilter,
): PluginEntry[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return entries.filter((p) => {
    if (filter === 'installed' && !p.installed) return false
    if (filter === 'available' && p.installed) return false
    if (filter === 'updatable' && !hasUpdate(p)) return false
    if (terms.length === 0) return true
    const hay = [
      p.name,
      p.description ?? '',
      p.id,
      p.author ?? '',
      p.repo,
      ...(p.sites ?? []),
    ]
      .join(' ')
      .toLowerCase()
    return terms.every((term) => hay.includes(term))
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
