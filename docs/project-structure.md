# 项目结构

```
downvid/
├── backend/                # Go 依赖边车（探测 + 下载 yt-dlp / ffmpeg）
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

## scripts/ 说明

| 脚本 | 用途 | 何时运行 |
|------|------|----------|
| `build-backend.sh` | 交叉编译当前系统的全部架构边车 | `pnpm deps:build`，或由 vite 插件自动调用 |
| `gen-deps-manifest.mjs` | 抓取上游 tag 与 SHA-256 生成 `assets.gen.go` | `pnpm deps:manifest` / `deps:manifest:check` |
| `gen-update-manifests.mjs` | 按最终产物重新生成 `latest*.yml` | 发布流程内自动 |
| `gen-release-notes.mjs` | 生成 Release 正文（下载徽章 + 对照表） | 发布流程内自动 |
| `lint-ipc.mjs` | 校验 IPC 三处同步、env.d.ts 约束、产物命名契约 | `pnpm lint:ipc`，CI 必跑 |
| `lint-website.mjs` | 校验官网单文件、引用资源、中英词条成对、配色与应用一致 | `pnpm lint:website`，CI 必跑 |
| `gen-website-stats.mjs` | 汇总 Releases 下载量写回官网 hero | `pnpm website:stats`，发布后手动跑 |

## 手动维护点（改代码前请先看）

以下几处是**手工同步**的，漏改会静默失败。完整清单见 [仓库规范](./standards.md#5-改动落点清单)：

1. **新增 IPC**：`electron/ipc/*.ts`、`electron/preload.ts`、`src/env.d.ts` 三处都要改（`pnpm lint:ipc` 会拦住漏改）
2. **新增广播事件**：主进程 emit 点、preload 的 `on`、订阅方的 unsubscribe
3. **改设置形状**：设置存在 `localStorage['settings']`，删改字段会让老用户设置失效
4. **改产物名**：会切断存量用户的自动更新，见[发布流程](./release.md#产物命名契约)
5. **改官网**：`website/index.html` 是单文件、由 Vercel 直接发布，改完跑 `pnpm lint:website`
   （引错图、漏翻译、配色漂移都只会在线上暴露，见 `website/README.md`）
