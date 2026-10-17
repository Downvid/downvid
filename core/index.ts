/**
 * core 的入口。
 *
 * 目前只导出**版本与平台无关的常量**，作用是让 `lint:boundaries`、`tsconfig`
 * 与后续的搬迁有一个真实存在的落点——空目录在多数工具链里等同于「不存在」，
 * 边界规则也就没有东西可检查。
 *
 * 真正的模块按迁移计划 C1–C6 逐个搬进来：
 *   core/parse  ← electron/parsers 中已纯净的部分
 *   core/fetch  ← electron/download 中已纯净的部分
 *   core/dep    ← electron/utils/{runtime,binary}
 *   core/queue  ← src/stores/download 的编排逻辑
 *   core/ports  ← DataDirs / EventSink / UserPrompt
 */

/**
 * 架构边界版本。
 *
 * 每完成一个迁移步骤就 +1。用途是让「代码里的 core 形状」与
 * `docs/provenance/migration-plan.md` 的进度能对上——文档里的勾选会失效，
 * 而一个常量改动必然出现在 diff 里。
 *
 *   0 = 只有骨架（C0）
 *   1 = C1–C3 完成：纯 Node 模块已搬入
 *   2 = C4–C6 完成：三个端口就位，容器端不再需要 shim
 */
export const CORE_BOUNDARY_VERSION = 0

/** 允许 import core 的目录（供 lint:boundaries 与文档共用同一份口径） */
export const CORE_CONSUMERS = ['electron', 'docker/server'] as const
