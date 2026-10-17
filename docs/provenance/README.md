# DownVid 架构治理（issue #74）

本目录是 [issue #74「规划 DownVid 轻量化跨平台架构，并分阶段摆脱 Videdown 实现依赖」](https://github.com/yxxbc/downvid/issues/74)
的落地文档，按 issue 的四个阶段一一对应。

| 文档 | 对应 issue 阶段 | 回答什么问题 |
| --- | --- | --- |
| [代码来源审计](./audit.md) | 一、审计代码来源与模块耦合 | 哪些代码来自上游 Videdown、哪些是改造、哪些是自研；依赖与体积是多少；哪里耦合 |
| [目标架构](./architecture.md) | 二、制定 DownVid 自身的目标架构 | 模块边界、公共接口、事件与持久化约定、三端职责 |
| [分阶段迁移计划](./migration-plan.md) | 三、分阶段迁移并逐步验证 | 拆成哪些可独立合并的 PR，顺序与依赖关系，怎么证明行为一致 |
| [发布质量、署名与合规](./release-quality.md) | 四、保障发布质量并保留必要署名 | 哪些承诺不能破、怎么验收、署名保留什么 |
| [技术选型决策（ADR）](./decisions.md) | 重构选型的实测依据 | Go 后端 / Wails 壳 / Svelte 5 / PWA 各自的数字与放弃项 |
| [仓库迁移手册](./repo-migration.md) | 迁移到 `Downvid/Downvid` | 9600+ 存量用户不丢更新的完整步骤（必须 Transfer，不能新建） |

## 快速结论

- DownVid 从 `cshuangyy/videdown@0c620c1`（2026-08-22）分叉，分叉点是 `1d7b041`。
- 上游 **2707** 条有效源码行中 **1241** 行（**45.8%**）仍逐字保留；但 `backend/`、`docker/`、
  `scripts/`、`tests/`、`website/` 全部是分叉后新增，**没有任何上游成分**。
- 真正的分界在**层次**而非目录：界面外壳与上游高度同源，依赖边车 / 下载调度 / 更新 / 容器化基本自研。
- 最需要动手的不是「删上游代码」，而是**边界**：容器端直接 import 12 个 `electron/*` 模块靠 shim 撑着，
  且桌面 IPC 与容器 RPC 之间没有任何静态校验。

## 怎么复核本文档里的数字

```bash
pnpm audit:provenance                                   # CI 跑这个；登记表与实测不一致直接红叉
node scripts/audit-provenance.mjs --report              # 打印完整表格，不写文件
node scripts/audit-provenance.mjs --write               # 重算并写入登记表（改代码后）
```

上游快照在 `scripts/data/provenance/upstream/`（20 个上游源文件 + `_SOURCE.txt`，236 KB，**不要修改**），
来源与 commit 记在同目录的 `_SOURCE.txt`。

## 相关文档

- [项目结构](../project-structure.md) — 目录树与每个目录的职责
- [开发者指南](../development.md) — 代码导读、一次下载的生命周期、调试手段
- [服务端模式（设计）](../server-mode.md) — Docker / WebUI 的设计与风险边界
- [仓库规范](../standards.md) — 分支、提交、评审约定
- [发布流程](../release.md) — 版本语义与产物命名契约
- [AGENTS.md](../../AGENTS.md) — 改动落点清单（改任何东西之前先读）
