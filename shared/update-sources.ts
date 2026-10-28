/**
 * 用户可选的更新源。
 *
 * 实际链路在 Go 侧的 `app/internal/update/wml.go`（wmlUpdate）：
 *
 *   auto = GitHub → Gitee → CNB
 *
 * Gitee / CNB 都是完整镜像（清单 + 资产），所以三条都能独立完成
 * 检查与下载。这里只保留设置页需要的 id、标签与校验，不再维护旧链路的
 * jsDelivr / gh-proxy / 官网实现。
 */

export type UpdateSourceId = 'auto' | 'github' | 'gitee' | 'cnb'

/** 用户可选的更新源（`auto` 排第一，是默认值） */
export const UPDATE_SOURCE_IDS: readonly UpdateSourceId[] = [
  'auto',
  'github',
  'gitee',
  'cnb',
]

/** `auto` 的降级顺序 */
export const AUTO_CHAIN: readonly Exclude<UpdateSourceId, 'auto'>[] = [
  'github',
  'gitee',
  'cnb',
]

/** 源的展示名（诊断与日志用；界面文案仍走 i18n） */
export const SOURCE_LABELS: Record<Exclude<UpdateSourceId, 'auto'>, string> = {
  github: 'GitHub',
  gitee: 'Gitee',
  cnb: 'CNB',
}

/**
 * 校验用户设置里的源 id。
 *
 * 旧版本可能存着 jsdelivr / ghproxy / website；这些值一律回退 `auto`，
 * 而不是原样保留——否则界面显示一个不存在的源，用户永远收不到更新。
 */
export function normalizeUpdateSource(value: unknown): UpdateSourceId {
  return typeof value === 'string' &&
    (UPDATE_SOURCE_IDS as readonly string[]).includes(value)
    ? (value as UpdateSourceId)
    : 'auto'
}

/** 供设置面板展示的候选（顺序即展示顺序） */
export function updateSourceOptions(): Array<{ id: UpdateSourceId; label: string }> {
  return UPDATE_SOURCE_IDS.map((id) => ({ id, label: id }))
}
