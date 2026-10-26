# 项目结构

```
downvid/
├── app/                     # 桌面应用：Go + Wails + Svelte 5
│   ├── internal/            # 16 个零耦合业务包（各自独立可测）
│   ├── frontend/            # Svelte 5 + Vite 渲染进程（独立包，单独装依赖）
│   ├── scripts/build.sh     # 构建入口（先编依赖边车，再带 withsidecar 构建）
│   ├── cmd/downvid-server/  # 无头模式入口（HTTP + WebSocket RPC）
│   └── main.go / app.go     # Wails 壳与绑定入口
├── backend/                 # Go 依赖边车（探测 + 下载 yt-dlp / ffmpeg / aria2c）
│   ├── cmd/downvid-deps/    # 入口：detect / fetch 两个子命令
│   └── internal/
│       ├── probe/           # 执行二进制并解析版本号（含本地化输出的 aria2）
│       ├── runtime/         # 依赖探测（只认手动路径 + ~/.downvid 托管目录）
│       ├── fetch/           # 下载、SHA-256 校验、镜像回退、原子安装
│       ├── manifest/        # 版本与哈希清单（由脚本生成，勿手改）
│       └── cli/             # NDJSON 输出（stdout 只放 JSON，日志走 stderr）
├── shared/                  # 前端与脚本共用的纯数据 / 纯函数契约
│   ├── app.ts               # 仓库坐标与外部链接的唯一来源
│   ├── update-sources.ts    # 更新源链路与版本比较
│   ├── acceleration.ts      # 并发档位、依赖种类、下载源 ID
│   └── parse-error.ts       # 解析错误分类与 Issue 草稿
├── website/                 # 产品落地页（无构建，由 Vercel 的 Git 集成发布）
├── tests/                   # 根目录纯逻辑单测（shared/ 与发布脚本）
├── scripts/                 # 校验 / 生成 / 发布脚本（零依赖）
├── docs/                    # 文档
└── .github/workflows/       # CI / CodeQL / 依赖审查 / 发布 / 依赖清单更新
```

构建产物（`app/build/bin/`、`app/frontend/dist/`、`backend/build/`）不入库。

> 想看**代码怎么串起来**（模块地图、一次下载的生命周期、绑定契约、调试手段）请读
> [开发者指南](./development.md)；本文只回答「东西放在哪」。

## app/internal 的 16 个包

| 包 | 职责 |
|---|---|
| `changelog` | 解析 CHANGELOG 副本（`//go:embed` 不能跨目录） |
| `clipboard` | 读系统剪贴板 |
| `cookie` | Cookie 策略、浏览器 Cookie 提取与快照 |
| `deps` | 起边车、把 NDJSON 流转成事件并缓存 |
| `download` | yt-dlp 参数、进度行、进程树终止、aria2 进度 |
| `fetch` | 直链分块下载与续传检查点 |
| `history` | 下载历史（原子写 + 损坏恢复 + win32 路径归一） |
| `image` | 带 Referer 抓缩略图并转 data URL |
| `jsruntime` | Node / Deno 探测（YouTube 需要真实 JS 运行时） |
| `netx` | 带代理的 HTTP 客户端与代理探活 |
| `parse` | 站点解析、格式去重、错误分类、YouTube 有限回退 |
| `server` | 无头模式的 HTTP + WebSocket RPC |
| `settings` | 用户设置（落盘 `settings.json`） |
| `shell` | 打开路径 / 在文件夹中显示 / 磁盘剩余空间 |
| `sidecar` | 把依赖边车嵌进主二进制并在运行时落盘 |
| `update` | 更新检查、自更新下载/安装、产物识别 |

包之间**不得互相 import**，也不得依赖 `cmd`（`pnpm lint:boundaries` 校验）。

## scripts/ 说明

| 脚本 | 用途 | 何时运行 |
|------|------|----------|
| `gen-deps-manifest.mjs` | 抓取上游 tag 与 SHA-256 生成 `assets.gen.go` | `pnpm deps:manifest` / `deps:manifest:check` |
| `gen-release-notes.mjs` | 生成 Release 正文（下载徽章 + 对照表） | 发布流程内自动 |
| `gen-contributors.mjs` | 从 git 历史核对关于页贡献者名单 | `pnpm gen:contributors` |
| `gen-icon-names.mjs` | 生成图标名清单供 `lint-icons.mjs` 比对 | `pnpm icons:update` |
| `lint-icons.mjs` | 校验图标名有效（写错会静默渲染成文字） | `pnpm lint:icons`，CI 必跑 |
| `lint-i18n` 对应 `lint-frontend-i18n.mjs` | 校验中英词条双向一致、`t()` key 存在 | `pnpm lint:i18n:app`，CI 必跑 |
| `lint-website.mjs` | 校验官网多文件、引用资源、词条成对、配色、产物名模板 | `pnpm lint:website`，CI 必跑 |
| `lint-docs.mjs` | 校验 `AGENTS.md` ↔ `CLAUDE.md` 一致、引用路径与关键数字真实存在 | `pnpm lint:docs`，CI 必跑 |
| `lint-workflows.mjs` | 校验工作流里「用了某工具」与「装了该工具」成对 | `pnpm lint:workflows`，CI 必跑 |
| `lint-boundaries.mjs` | 校验 `app/internal` 包之间零依赖 | `pnpm lint:boundaries`，CI 必跑 |
| `lint-attribution.mjs` | 上游版权声明与剩余上游代码匹配 | `pnpm lint:attribution`，CI 必跑 |
| `audit-provenance.mjs` | 代码来源审计（逐字存活率 + 登记表） | `pnpm audit:provenance`，CI 必跑 |
| `verify-release.mjs` | 核对 tag 是否真有 Release 且三平台包齐全 | `pnpm verify:release` / `release-audit.yml` |
| `sync-*.mjs` | 仓库坐标 / 工具链版本 / CHANGELOG 副本 / 官网版本号 | 见 [仓库规范](./standards.md) |
| `test-e2e-real.mjs` | 真实 yt-dlp / ffmpeg 端到端 | `pnpm test:e2e:real` |
| `triage-*.mjs` | Issue 自动分类与巡检 | `triage.yml` 工作流内 |
| `lib/` | 脚本公共骨架（`harness.mjs`、`load-source.mjs`） | 被 `triage-*.mjs` 引用 |
| `data/` | 图标名清单、来源审计的上游快照与登记表 | 被校验脚本引用 |

## 手动维护点（改代码前请先看）

以下几处是**手工同步**的，漏改会静默失败。完整清单见 [仓库规范](./standards.md)：

1. **新增后端能力**：Go 导出方法 + `app/frontend/src/lib/backend.ts` + `types.ts` 字段名逐字一致
2. **新增广播事件**：Go emit 点、`backend.ts` 的订阅、订阅方的 unsubscribe
3. **改设置形状**：`app/internal/settings/settings.go` 是唯一入口，删改字段属于 MAJOR
4. **改产物名**：四处同步（`release.yml`、`app/internal/update/migration.go`、`website/app.js`、
   `scripts/gen-release-notes.mjs`）
5. **改官网**：`website/index.html` + `styles.css` + `app.js`，由 Vercel 直接发布，
   改完跑 `pnpm lint:website`
