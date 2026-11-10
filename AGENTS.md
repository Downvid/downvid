# AGENTS.md — DownVid 开发速查

面向在本仓库改代码的人（或 AI）。**这是索引，不是手册**：细节在 `docs/`，这里只放
「不读就会改错」的东西。

写法约定见 [`docs/doc-standards.md`](docs/doc-standards.md)。

## 协作范围

只在本仓库内工作：读代码、改代码、跑校验。不要把任务扩成开放式调研。

需要外部信息时，先说清楚**要查什么、为什么非查不可**，再只查能回答当前问题的最小来源。

## 交付前自检（最重要的一节）

**校验通过 ≠ 做对了。** 改完先回答这三问，再跑命令：

1. **多了什么？** 我有没有加原来没有的元素、按钮、装饰？
2. **少了什么？** 对照原实现逐项比过，还是只看截图像不像？
3. **哪里偷懒了？** 有没有用通用控件顶替自绘、用 emoji 顶替图标、
   用固定值顶替响应式？

投影到界面改动时，验收标准是**逐条对照原实现的每个元素**，不是「截图看着差不多」。

## 快速开始

架构：Go 核心 + Wails 桌面壳 + Svelte 5 前端，单文件产物。

```bash
pnpm install
pnpm --dir app/frontend install   # app/frontend 是独立包，不在根 workspace
bash app/scripts/build.sh         # 端到端构建
(cd app && wails dev)             # 只调界面
```

前置：Node ≥ 22、pnpm ≥ 8、Go ≥ 1.27.3、Wails CLI v2.16。
yt-dlp / ffmpeg **不需要**预装，见 [`docs/dev/runtime-deps.md`](docs/dev/runtime-deps.md)。

`wails dev` 打出的应用**没有依赖边车**，依赖页只会显示「探测程序缺失」，构建过程也不会警告。
要验证依赖/下载链路，必须用 `build.sh` 出的产物。

Wails CLI 安装：`go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0`。

## 验证命令

```bash
(cd app && gofmt -l . && go vet ./... && go test -shuffle=on ./...)
(cd backend && gofmt -l . && go vet ./... && go test -shuffle=on ./...)
pnpm --dir app/frontend check        # svelte-check
pnpm --dir app/frontend test         # 前端纯逻辑单测
pnpm test                            # 根目录单测
pnpm lint:i18n:app
pnpm lint:boundaries                 # G1：internal 包之间不得互相 import
pnpm lint:docs                       # 本文件 ↔ CLAUDE.md ↔ 代码
```

测试分三层：Go 核心、Go 侧车、前端纯逻辑。细节见
[`docs/dev/testing.md`](docs/dev/testing.md)。

**写完测试必须做变异验证**：把被测逻辑改坏，确认用例会失败。
注意只测「中心点」的用例往往拦不住变异——每个分支都要有能失败的输入。

## 项目结构

| 路径 | 内容 |
| --- | --- |
| `app/internal/*` | Go 核心，17 个包，**互相零依赖** |
| `app/*.go` | Wails 壳：只做搬运，不含业务规则 |
| `app/frontend/` | Svelte 5 前端，打进二进制 |
| `backend/` | 依赖边车（探测 + 下载 yt-dlp/ffmpeg/aria2） |
| `shared/` | 前端与脚本共用的契约 |
| `website/` | 产品落地页 |
| `scripts/` | 校验 / 生成 / 发布脚本 |

`app/internal/*` 之间不得互相 import（`pnpm lint:boundaries` 校验）。
这是最值得守住的性质：每个包都能独立测试、独立替换。

## 改动落点清单

最容易静默失败的地方。每条都指向细节文档。

### 新增后端能力 / 广播事件

前端**只能**经 `app/frontend/src/lib/backend.ts` 调用，不要在组件里直接 import `wailsjs`。
字段名是逐字契约：`types.ts` 与 Go 的 JSON tag 必须一致。
详见 [`docs/dev/frontend.md`](docs/dev/frontend.md)。

### 改用户设置 / 前端文案

- 设置唯一入口 `app/internal/settings/settings.go`，落盘在 `userData/settings.json`；
  **只许新增**，删改属于 MAJOR
- 词条在 `app/frontend/src/lib/i18n.svelte.ts`，中英必须成对
- `t()` 是响应式的，**不能在模块顶层求值**

### 改运行依赖

探测由 `backend/` 负责，**不要在 `app/internal/deps` 再写一份候选路径表**。
改下载源或版本只改 `scripts/gen-deps-manifest.mjs`，然后 `pnpm deps:manifest`。
详见 [`docs/dev/runtime-deps.md`](docs/dev/runtime-deps.md)。

### 改发布产物

产物名以 `DownVid-Wails-` 开头，出现在**五处**，改一处必须改五处。
`pnpm lint:website` 会比对官网那一侧。

### 改仓库坐标

唯一来源 `shared/app.ts`，`pnpm sync:repo` 校验。

### 新增/重写模块

≥15%（且 ≥8 行）逐字来自上游 Videdown 的文件必须登记在
`scripts/data/provenance/registry.json`，否则 `pnpm audit:provenance` 红叉。

## 界面约定

- `app/frontend` 是**独立包**（不在根 pnpm workspace）：装依赖用 `pnpm --dir app/frontend install`，
  类型检查用 `pnpm --dir app/frontend check`
- 所有界面文案走 `t('key')`，不写中文字面量
- **Tailwind v4**（CSS-first，无 `tailwind.config.js`），语义色 token 在 `app.css` 的 `@theme`
- **用语义 token，不要写 raw hex**
- 图标：通用图标用 `Icon.svelte`（Material Symbols 字体名）；
  **品牌图标用专属 SVG 组件**，不要拿通用图标凑
- 无路由：`App.svelte` 用条件渲染切换视图

## 下载架构要点

- **解析性能取决于 yt-dlp 形态**：zipapp 0.4s vs PyInstaller 10s，Linux/macOS 主用 zipapp
- **两条独立下载路径**：`direct.go`（抖音/快手直链）与 `run.go`（spawn yt-dlp）
- **暂停必须终止整棵进程树**：`detached: true` + 对 `-pid` 发信号
- **解析缓存要有条数上限**：每条持有完整 info JSON

详见 [`docs/dev/download.md`](docs/dev/download.md)。

## 插件系统要点

- **插件只回答「这是什么」**：返回元数据与直链，不碰字节；下载仍由 `internal/fetch` /
  `internal/download` 执行，续传与进度一行不用重写
- **`app/internal/pluginhost` 是唯一 import 第三方插件运行时的包**，目的就是守住
  `internal` 各包零依赖（否则「只想用解析器」的地方会被拖进一个 JS 引擎）
- **`playback` 必须是 `downvid-parser`**：宿主靠它区分本项目的解析插件与其他 MyGo
  生态插件（后者是 `stream`，`resolve` 语义完全不同）
- **插件返回 `null` = 不认领**，是正常路径；抛异常才算该插件出错，不能连累其他插件
- **返回值必须校验**：空标题 / 无格式 / 非 http(s) 直链一律报错，宁可失败也不猜

详见 [`docs/dev/plugins.md`](docs/dev/plugins.md)。

## 跨平台构建的坑

三条最容易踩的：

1. **`process.platform` ≠ `GOOS`**（`win32` vs `windows`）
2. **Windows runner 默认 shell 是 PowerShell**，`/tmp` 会解析成 `D:\tmp`
3. **换行符**：`.gitattributes` 统一为 LF，**不要删除该文件**

详见 [`docs/dev/cross-platform.md`](docs/dev/cross-platform.md)。

## 注意事项

- `wails generate module` 会先编译 Go 包，而 `app/main.go` 有 `//go:embed all:frontend/dist`。
  顺序必须是「准备 embed 目录（`app/scripts/prepare-embed-dir.sh`）→ 构建前端 → 生成绑定」，
  反过来直接 generate 会报 `pattern all:frontend/dist: no matching files found`
- `build.sh` 必须注入 `-X main.arch=wails`，`internal/update` 靠它区分产物形态
- **所有 UI 文案、注释、commit body 一律中文**
- 分支 `feat/…` `fix/…` `docs/…` `chore/…`，Conventional Commits
- **禁止透露本地隐私、敏感信息、网络环境**
- 没有发布计划时，`package.json` 版本保持最近一次已发布版本，改动记在 `[Unreleased]`
