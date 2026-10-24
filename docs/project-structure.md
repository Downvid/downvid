# 项目结构

```
downvid/
├── app/                    # 全新架构（主线）：Go + Wails + Svelte 5 桌面应用
│   ├── internal/           # 16 个零耦合业务包（download / parse / deps / settings...）
│   ├── frontend/           # Svelte 5 + Vite 渲染进程
│   ├── scripts/build.sh    # 主线构建入口（编译依赖边车 + 内嵌单文件打包）
│   ├── cmd/downvid-server/ # 容器端 / 无头服务入口
│   └── main.go / app.go    # Wails 壳与绑定入口
├── backend/                # Go 依赖边车（探测 + 下载 yt-dlp / ffmpeg，双架构共用）
│   ├── cmd/downvid-deps/   # 入口：detect / fetch 两个子命令
│   └── internal/
│       ├── probe/          # 执行二进制并解析版本号
│       ├── runtime/        # 候选路径解析（系统优先，登录 shell 补 PATH）
│       ├── fetch/          # 下载、SHA-256 校验、原子安装
│       ├── manifest/       # 版本与哈希清单（由脚本生成，勿手改）
│       └── cli/            # NDJSON 输出（stdout 只放 JSON，日志走 stderr）
├── electron/               # Electron 主进程
│   ├── main.ts             # 入口：窗口、生命周期、日志
│   ├── ipc/                # IPC 按域拆分：app / deps / download / history / system
│   ├── download/           # 下载实现：direct（CDN 直链）/ ytdlp / progress
│   ├── parsers/            # 平台解析：douyin / kuaishou / ytdlp / formats / shared
│   ├── utils/              # runtime（边车）、binary（依赖解析）、cookies、browser
│   ├── store.ts            # 窗口引用与 activeDownloads
│   ├── menu.ts             # 应用菜单（仅 macOS 注册）
│   └── updater.ts          # 应用内更新（含 macOS 自实现替换 .app）
├── src/                    # 渲染进程（Vue 3 + Tailwind + Pinia）
│   ├── components/         # 视图与组件（含 DepPanel / DepsPrompt / icons）
│   ├── composables/        # useErrorModal / useUpdater
│   ├── stores/             # Pinia：download（队列）、deps（运行依赖）
│   ├── types/              # 共享类型
│   └── style.css           # Tailwind v4 主题（@theme 定义语义色）
├── shared/app.ts           # 仓库坐标与外部链接的唯一来源
├── website/                # 产品落地页（单文件无构建，由 Vercel 的 Git 集成发布）
├── tests/                  # Vitest 纯逻辑单测
├── scripts/                # 见下
├── docs/                   # 文档
└── .github/workflows/      # CI / CodeQL / 依赖审查 / 发布 / 依赖清单更新
```

构建产物（`dist/`、`dist-electron/`、`backend/build/`、`release/`）不入库。

> 想看**代码怎么串起来**（模块地图、一次下载的生命周期、IPC 契约、调试手段）请读
> [开发者指南](./development.md)；本文只回答「东西放在哪」。

## scripts/ 说明

| 脚本 | 用途 | 何时运行 |
|------|------|----------|
| `build-backend.sh` | 交叉编译当前系统的全部架构边车 | `pnpm deps:build`，或由 vite 插件自动调用 |
| `gen-deps-manifest.mjs` | 抓取上游 tag 与 SHA-256 生成 `assets.gen.go` | `pnpm deps:manifest` / `deps:manifest:check` |
| `gen-update-manifests.mjs` | 按最终产物重新生成 `latest*.yml` | 发布流程内自动 |
| `gen-release-notes.mjs` | 生成 Release 正文（下载徽章 + 对照表） | 发布流程内自动 |
| `gen-icon-names.mjs` | 生成图标名清单供 `lint-icons.mjs` 比对 | 维护时手动 |
| `gen-social-preview.mjs` | 生成社交预览图 | `pnpm preview:social` |
| `lint-ipc.mjs` | 校验 IPC 三处同步、env.d.ts 约束、产物命名契约、仓库坐标 | `pnpm lint:ipc`，CI 必跑 |
| `lint-i18n.mjs` | 校验中英词条双向一致、占位符一致、无硬编码界面中文 | `pnpm lint:i18n`，CI 必跑 |
| `lint-icons.mjs` | 校验图标名有效（写错会静默渲染成文字） | `pnpm lint:icons`，CI 必跑 |
| `lint-website.mjs` | 校验官网多文件、引用资源、中英词条成对、配色与应用一致、产物名模板与徽章坐标 | `pnpm lint:website`，CI 必跑 |
| `lint-docs.mjs` | 校验 `AGENTS.md` ↔ `CLAUDE.md` 一致、引用路径与关键数字真实存在 | `pnpm lint:docs`，CI 必跑 |
| `lint-workflows.mjs` | 校验工作流里「用了某工具」与「装了该工具」成对 | `pnpm lint:workflows`，CI 必跑 |
| `verify-release.mjs` | 核对 tag 是否真有 Release 且带全部 `latest*.yml` | `pnpm verify:release` |
| `test-*.mjs` | 集成回归（下载 / 解析 / 加速 / 更新 / 设置迁移 / 打包产物 / Windows 运行依赖 / Issue 分类） | 见 [开发者指南 §6](./development.md#6-测试与校验矩阵) |
| `triage-*.mjs` | Issue 自动分类与巡检 | `triage.yml` 工作流内 |
| `lib/` | 集成脚本公共骨架（`harness.mjs` 断言与用例、`load-source.mjs` 加载生产源码） | 被 `test-*.mjs` 引用 |
| `data/`、`fixtures/` | 图标名清单数据、边车测试用的假二进制源码 | 被校验 / 测试脚本引用 |

## 手动维护点（改代码前请先看）

以下几处是**手工同步**的，漏改会静默失败。完整清单见 [仓库规范](./standards.md#5-改动落点清单)：

1. **新增 IPC**：`electron/ipc/*.ts`、`electron/preload.ts`、`src/env.d.ts` 三处都要改（`pnpm lint:ipc` 会拦住漏改；
   字段清单与契约表见 [开发者指南 §4](./development.md#4-ipc-契约)）
2. **新增广播事件**：主进程 emit 点、preload 的 `on`、订阅方的 unsubscribe
3. **改设置形状**：设置存在 `localStorage['settings']`，删改字段会让老用户设置失效
4. **改产物名**：会切断存量用户的自动更新，见[发布流程](./release.md#产物命名契约)
5. **改官网**：`website/index.html` + `styles.css` + `app.js`，由 Vercel 直接发布，
   改完跑 `pnpm lint:website`（引错图、漏翻译、配色漂移都只会在线上暴露，见 `website/README.md`）
