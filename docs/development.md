# 开发者指南

面向要在本仓库改代码的人。目标不是把每个文件讲一遍，而是回答三个问题：
**东西在哪、一次请求怎么走、改一处还要动哪些地方。**

配套必读：[项目结构](./project-structure.md) · [仓库规范](./standards.md) ·
[根目录 AGENTS.md 速查](../AGENTS.md)

---

## 1. 先理解三件事

### 1.1 安装包不携带 yt-dlp / ffmpeg

单文件产物约 18 MB，其中不含运行依赖。启动后由 Go 边车按「系统优先，缺失才下载」的顺序解析：

1. 设置里手动指定的路径（**只对探测生效**）
2. `~/.downvid/runtime/bin/`（DownVid 下载的）
3. 登录 shell 的 PATH + 各平台常见安装目录
4. 裸命令名交给 PATH 兜底

所以调试时**不要**假设依赖一定在某个路径；先看 `deps` 事件里的 `source` / `form` 字段。

### 1.2 两条下载路径完全独立

| 路径 | 触发条件 | 实现 |
| --- | --- | --- |
| 直链分块 | 解析结果是平台 CDN 直链（抖音/快手） | `app/internal/fetch`：Range 可用时按小块队列调度，`.part.json` 存续传检查点 |
| yt-dlp | 其它所有站点 | `app/internal/download`：spawn yt-dlp，进度来自 `--progress-template` |

直链路径存在的理由是那些 CDN 地址有效期很短，走 yt-dlp 会二次请求平台接口、拿不到同一份地址。

### 1.3 每个包只能独立存在

`app/internal/*` 之间**不得互相 import**（`pnpm lint:boundaries`）。需要共享的逻辑要么复制少量、
要么下沉成新包。这条约束让每个包都能单独测试、单独替换——换传输层（Wails 绑定 → WebSocket）
时才不会变成大工程。

---

## 2. 模块地图

| 关注点 | 先看这里 |
| --- | --- |
| 窗口 / 生命周期 / 事件广播 | `app/app.go`、`app/main.go` |
| 前端可调用的方法 | `app/bindings_download.go`、`app/app.go` |
| 解析与格式选择 | `app/internal/parse`（`formats.go` 是纯函数） |
| 下载执行 | `app/internal/download`（`ytdlp_args.go` / `progress_line.go` / `process_tree.go`） |
| 直链下载 | `app/internal/fetch` |
| 依赖探测与安装 | `backend/`（主程序侧只做转发：`app/internal/deps`） |
| 历史 | `app/internal/history` |
| 设置 | `app/internal/settings` |
| 更新 | `app/internal/update`（检查 / 下载 / 安装 / 产物识别） |
| 前端状态 | `app/frontend/src/lib/store.svelte.ts` |
| 前端文案 | `app/frontend/src/lib/i18n.svelte.ts` |
| 前端 ↔ 后端适配 | `app/frontend/src/lib/backend.ts` |

---

## 3. 一次解析请求流过哪些文件

```
ParsePanel.svelte
  → store.svelte.ts 的 parse()
    → backend.ts 的 parse(url, proxy)
      → Wails 绑定 (bindings_download.go)
        → app/internal/parse.Parse()
          → jsruntime 找 Node / Deno（YouTube 需要）
          → cookie 准备（手动文件 / 浏览器快照 / 无）
          → spawn yt-dlp -J ...
          → formats.go 去重与排序
        ← parse.VideoInfo（JSON 字段与 types.ts 逐字一致）
  ← store 写入 state，界面渲染
```

几个容易踩的点：

- **YouTube 没有 JS 运行时会直接报 runtime-unavailable**，不起 yt-dlp。
- **解析缓存有上限**（条数），只靠 TTL 会让长视频的 info JSON 堆满内存。
- **不要在成功路径上为了版本号再跑一次 `--version`**：只在失败时调用并缓存 5 分钟。

---

## 4. 前后端契约

### 4.1 调用（前端 → Go）

1. 在 `app/bindings_download.go` 或 `app/app.go` 加导出方法。
2. `wails generate module` 生成 `wailsjs/`（不入库）。
3. 前端只在 `app/frontend/src/lib/backend.ts` 里调用绑定，不要在组件里直接 import `wailsjs/...`
   （浏览器里会白屏）。
4. `app/frontend/src/lib/types.ts` 与 Go 结构体的 JSON tag **逐字一致**。数组一侧改了不会有类型错误，
   只会让界面显示空白。

### 4.2 广播事件（Go → 前端）

1. Go 侧 `a.emit("event", data)`。
2. `backend.ts` 里 `onXxx(cb)` 订阅并返回 unsubscribe；组件卸载时必须调用。
3. 事件名与 payload 形状同时写进 `types.ts`。

### 4.3 前端内部的跨组件通信

无路由：`App.svelte` 用条件渲染切换视图；跨视图动作走 store 方法，不要用 `window` 事件。

---

## 5. 常见改动怎么做

### 5.1 新增一个前端能调用的能力

见 §4.1。改完跑：

```bash
pnpm --dir app/frontend check
(cd app && go test ./...)
```

### 5.2 新增一个设置项

1. Go：`app/internal/settings/settings.go`（字段 + 默认值 + 清洗）。
2. 前端：`app/frontend/src/lib/settings.ts` 的默认值与类型。
3. 界面：`app/frontend/src/components/SettingsView.svelte`。
4. **只许新增**（读取时用默认值补齐），删改属于 MAJOR 变更。

`app/frontend/scripts/check-settings-write.mjs` 会拦住「绕过入口直接写设置」。

### 5.3 新增平台解析器

解析优先走 yt-dlp。确实需要专属解析器时，放在 `app/internal/parse` 下新增文件，
返回 `parse.VideoInfo`，并**失败时回落到 yt-dlp**（不要吞掉错误后直接失败）。

### 5.4 改 yt-dlp 参数

改 `app/internal/download/ytdlp_args.go`。它是纯函数：依赖路径与 JS 运行时由调用方传入，
因此可以不起进程直接断言参数列表——**改完补一条参数断言用例**。

### 5.5 改运行依赖（新增种类 / 换下载源 / 加平台）

- 新增种类：`backend/internal/runtime` 的 `Kinds` / `Optional` / 候选路径 +
  `shared/acceleration.ts` 的 `DEP_KINDS`。
- 换下载源或版本：只改 `scripts/gen-deps-manifest.mjs` 的资产表，然后 `pnpm deps:manifest`。
- 加平台：资产表 + `app/scripts/build.sh` 的目标列表 + `release.yml` 构建矩阵。

镜像链在 `backend/internal/fetch/mirror.go`，只改写真的托管在 GitHub release 上的地址。

### 5.6 改界面文案

`app/frontend/src/lib/i18n.svelte.ts`。新增 key 必须中英成对，`pnpm lint:i18n:app` 会双向校验。
`t()` 是响应式的，**不能在模块顶层求值**。

### 5.7 改下载队列行为

队列与并发闸门在 `app/frontend/src/lib/store.svelte.ts`（排队、暂停、重试、进度合并）。
后端保证「同一 taskID 不会并发 Run」，前端负责调度顺序。

### 5.8 加一位贡献者

1. 把 login 加进 `app/frontend/src/components/AboutView.svelte` 的 `CONTRIBUTORS`
   （`pnpm gen:contributors --write` 可从 git 历史自动补）。
2. `tests/about-contributors.test.ts` 的快照与 token 表同步更新。

### 5.9 发布新版本后刷新官网版本号

`release.yml` 在 Release 创建成功后自动跑 `scripts/sync-website-version.mjs` 并提交回 main。
手动补跑：`node scripts/sync-website-version.mjs <版本号>`，然后 `pnpm lint:website`。

### 5.10 改外部链接 / 联系方式

唯一来源是 `shared/app.ts`。改完跑 `pnpm sync:repo` 与 `pnpm lint:website`。

---

## 6. 测试与校验矩阵

### 6.1 三层，各拦一类问题

| 层 | 位置 | 拦什么 |
| --- | --- | --- |
| Go 核心 | `app/internal/*/**_test.go`、`app/e2e_*_test.go` | 参数组装、进度解析、格式去重、进程树、历史、自更新 |
| Go 侧车 | `backend/internal/*/**_test.go` | 候选路径、版本解析、镜像链、校验与安装 |
| 前端纯逻辑 | `app/frontend/src/lib/*.test.ts`、`tests/*.test.ts` | 格式化、去重、设置归一、官网分发、发布脚本 |

依赖 DOM 或需要真的起子进程 / 联网的逻辑**不写单测**，走集成回归或真机验证。

### 6.2 命令清单

```bash
# 类型与静态契约
pnpm --dir app/frontend check
pnpm lint:i18n:app
pnpm lint:icons
pnpm lint:website
pnpm lint:docs
pnpm lint:workflows
pnpm lint:boundaries
pnpm lint:attribution
pnpm audit:provenance
pnpm sync:repo && pnpm sync:toolchain && pnpm sync:changelog
pnpm deps:manifest:check

# 纯逻辑单测
pnpm test
pnpm --dir app/frontend test

# Go
(cd app && go test -shuffle=on ./...)
(cd backend && go test -shuffle=on ./...)

# 端到端（真实 yt-dlp / ffmpeg，缺依赖时明确跳过）
pnpm test:e2e:real

# 端到端构建
bash app/scripts/build.sh
```

### 6.3 写测试的约定

- 针对「曾经出过问题的分支」各留一个用例，不追覆盖率。
- **写完必须做变异验证**：把逻辑改坏，确认用例会失败。
- 跨语言移植要做双跑对拍（同一输入两边结果一致），只让各自的单测变绿不算完成。

### 6.4 新增校验脚本必须挂进 CI

加到 `.github/workflows/ci-linux.yml` / `ci-macos.yml` / `ci-windows.yml` 的 `frontend` job，
或按平台只挂一处并写明理由。`pnpm lint:workflows` 会校验工作流自身的健全性。

---

## 7. 调试手段

### 7.1 边车单独跑

```bash
# 探测（NDJSON，stdout 只放 JSON）
backend/build/<平台>-<架构>/downvid-deps detect --json

# 下载并安装某个依赖
backend/build/<平台>-<架构>/downvid-deps fetch --kind yt-dlp
```

### 7.2 依赖诊断

界面「设置 → 运行依赖」里的 `source` 与 `form` 是关键：

- `source=system` / `managed` / `manual` / `scanned`
- `form=native` 首次执行可能 9~12 秒（PyInstaller 解压开销），不代表文件坏了

### 7.3 开发模式与打包版的差异

| | `wails dev` | `build.sh` 产物 |
| --- | --- | --- |
| 前端 | Vite dev server + 热重载 | `go:embed` 进二进制 |
| 依赖边车 | **没有**（依赖页只剩「探测程序缺失」） | 有（`-tags withsidecar`） |
| 设置 / 历史 | 同一个 `<dataDir>` | 同一个 `<dataDir>` |

验证依赖探测、下载、自更新时**必须用 build.sh 的产物**。

### 7.4 日志

Go 侧日志写到标准错误；Wails 开发模式下直接看终端。
打包后的问题优先复现为「`build.sh` 产物 + 终端启动」再判断。

---

## 8. 数字的唯一来源

| 数字 | 唯一来源 |
| --- | --- |
| 检测总时限 80 秒 | `backend/internal/runtime/find.go` 的 `DetectTimeout` |
| 单候选预算 15 / 5 秒 | `backend/internal/probe/probe.go` |
| 历史条数上限 100 | `app/internal/history` |
| 解析缓存条数上限 | `app/internal/parse` |
| 版本号 / 构建日期 | `package.json` + `app/scripts/build.sh` 注入 |

**不要在多处重复书写这些数字**。要调大调小先想清代价：候选预算低于 15 秒会让刚下载好的
yt-dlp 被判为「执行超时，文件可能损坏」。

---

## 9. 改完代码的检查清单

1. `gofmt -l .` 无输出（`app/` 与 `backend/` 各一次）
2. `go vet ./...` + `go test -shuffle=on ./...` 全绿
3. `pnpm --dir app/frontend check` 无错误
4. `pnpm test` 与 `pnpm --dir app/frontend test` 全绿
5. 相关 lint（i18n / icons / website / docs / workflows / boundaries）全绿
6. 改了依赖或产物名 → `pnpm deps:manifest:check`、`pnpm lint:website`
7. 改了前端可见行为 → 用 `build.sh` 产物真机点一遍
8. 更新 `CHANGELOG.md` 的 `## [Unreleased]`
