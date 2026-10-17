# core/ —— 纯 Node 业务核心

这个目录是 DownVid 的**业务核心**：下载任务编排、站点解析、进度与事件、依赖管理、
设置与数据持久化接口。它被桌面端（Electron）与容器端（Node）**共同复用**。

> 目标架构与七条边界规则见 [`docs/provenance/architecture.md`](../docs/provenance/architecture.md) §3。
> 迁移进度见 [`docs/provenance/migration-plan.md`](../docs/provenance/migration-plan.md)。

## 三条禁令（由 `pnpm lint:boundaries` 机械校验）

1. **不得 `import 'electron'`** —— 一旦引入，core 就只能在 Electron 里跑，容器端又得带 shim。
   Electron 能提供的能力（数据目录、发事件给界面、问用户）请通过**端口**注入：
   `DataDirs` / `EventSink` / `UserPrompt`（见架构文档 §3.1）。
2. **不得 import `src/**`、`electron/**`、`docker/**`** —— 核心不依赖界面、适配层或部署形态。
3. **只能被** `electron/**` 与 `docker/server/**` 依赖（单向）。

## 为什么需要这个目录

分叉自上游时，业务逻辑散在 `electron/main.ts`（2756 行单文件）与 `src/components/*.vue` 里。
容器端为了复用它们，只能靠 `docker/server/electron-shim.ts` 伪造一个 `electron` 模块 ——
shim 漏一个 API，容器端才炸，桌面端完全正常。这类故障在 CI 里是「几分钟后才可见」。

把可复用的部分集中到 `core/`，让边界可以被静态校验，是这个目录存在的唯一理由。

## 不要放什么

- 任何窗口 / 菜单 / 托盘 / 对话框代码 → `electron/`
- 任何 HTTP server / WebSocket → `docker/server/`
- 任何 Vue 组件或 Pinia store → `src/`
