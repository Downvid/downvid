# AGENTS.md — DownVid 开发速查

面向在本仓库改代码的人（或 AI）。这个仓库的耦合点比文件数量看起来多——很多地方是**手工同步**的，
漏改会静默失败（不报错、功能不生效）。改任何东西之前先看「改动落点清单」一节。

---

## 快速开始

架构：**Go 核心 + Wails 桌面壳 + Svelte 5 前端**，单文件产物。旧 Electron/Vue 架构已整体移除。

```bash
pnpm install
pnpm --dir app/frontend install   # app/frontend 是独立包，不在根 workspace
bash app/scripts/build.sh         # 端到端：前端 + 依赖边车都内嵌进单文件
(cd app && wails dev)             # 只调界面时可用；不带依赖边车
pnpm --dir app/frontend check     # svelte-check（tsc 看不见 .svelte）
(cd app && go test ./...)         # Go 核心单测
```

前置：**Node ≥ 22**、**pnpm ≥ 8**、**Go ≥ 1.25**、Wails CLI v2.16
（`go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0`）。
yt-dlp / ffmpeg **不需要**预先安装（见「运行依赖」一节）。

直接 `cd app && wails dev` 打出来的应用**没有依赖边车**，依赖页只剩「探测程序缺失」，
构建过程不会警告。要在开发时验证依赖/下载链路，用 `build.sh` 出的产物。

---

## 验证命令

改完必须跑对应的一层。CI 覆盖大部分，但注意：CI 的 frontend job 不跑 Go 核心测试，
Go 那层靠 `cd app && go test ./...` 自己跑。

```bash
# Go 核心（app/）
(cd app && gofmt -l . && go vet ./... && go test -shuffle=on ./...)

# Go 侧车（backend/）
cd backend && gofmt -l . && go vet ./... && go test -shuffle=on ./...

# 前端
pnpm --dir app/frontend check        # svelte-check
pnpm lint:i18n:app                   # 中英词条成对 + t() key 存在
pnpm --dir app/frontend test         # 前端纯逻辑单测

# 根目录纯逻辑单测（shared/ 与发布脚本）
pnpm test

# 静态校验
pnpm lint:boundaries                 # G1：app/internal 包之间不得互相 import
pnpm lint:icons                      # 图标名是否有效（写错会静默渲染成文字）
pnpm lint:website                    # 官网词条 / 资源 / 配色 / 产物名
pnpm lint:docs                       # 本文件 ↔ CLAUDE.md 一致 + 引用路径真实存在
pnpm lint:workflows                  # 「用了某工具」与「装该工具」成对
pnpm lint:attribution                # 上游版权声明未归零前不许删 LICENSE
pnpm audit:provenance                # 代码来源审计
pnpm sync:repo && pnpm sync:toolchain && pnpm sync:changelog
pnpm deps:manifest:check             # 依赖清单是否落后上游

# 端到端
pnpm test:e2e:real                   # 真实 yt-dlp / ffmpeg（缺依赖时明确跳过）
bash app/scripts/build.sh            # 单文件产物
```

### 关于测试

三层：**Go 核心**（`app/internal/*/**_test.go`）、**Go 侧车**（`backend/internal/*/**_test.go`）、
**前端纯逻辑**（`app/frontend/src/lib/*.test.ts` 与 `tests/*.test.ts`）。

- 纯逻辑单测只覆盖**纯函数**：格式选择、进度行、参数组装、更新源降级、设置归一化。
- 依赖 DOM 或需要真的起子进程 / 联网的逻辑**不写单测**——它们走集成回归（`app/e2e_*_test.go`、
  `scripts/test-e2e-real.mjs`），或靠 svelte-check 与真机验证拦。
- 新增测试请针对「曾经出过问题的分支」各留一个用例，**不追覆盖率数字**。
- **写完必须做变异验证**：把被测逻辑改坏，确认用例会失败。不会失败的测试等于没有测试。
- `app/frontend` 的单测刻意不引入 jsdom：`environment: 'node'`。

### CI 工作流分工

测试按**平台**拆成三个工作流（`.github/workflows/ci-linux.yml`、
`.github/workflows/ci-macos.yml`、`.github/workflows/ci-windows.yml`），每个工作流内部按职责拆 job：

| job | 内容 |
| --- | --- |
| `backend` | 侧车与核心的 gofmt / vet / `go test -shuffle=on` / 边车交叉编译 |
| `frontend` | 图标 / 官网 / 文档 / 来源审计 / 边界 / 坐标 / 词条 / 工作流 / 根目录单测；外加 `wails generate module` → svelte-check 与前端单测 |
| `integration` / `build` | 仅 Linux：真实依赖端到端；三平台各有 `build` job 编译一次单文件产物 |

发布由 `.github/workflows/release.yml` 负责；`.github/workflows/release-audit.yml` 每天独立核对
「最新 tag ↔ Release 是否对得上」；`.github/workflows/update-deps.yml` 升级运行依赖清单；
`.github/workflows/triage.yml` 做 Issue 分类。

**新增测试脚本必须挂到对应平台的工作流上** —— 曾经 `test:acceleration` 加了脚本却没接进 CI，
加速逻辑长期没有自动化验证。同理，**新增工作流文件时必须先 `git add`**（`scripts/lint-docs.mjs`
会校验文档提到的 workflow 真实存在）。

### 关于格式化

没有 ESLint / Prettier，**不要引入**（格式化差异会污染历史 diff）。
前端靠 svelte-check 与 TypeScript 严格模式，Go 靠 `gofmt` + `go vet`。

---

## 项目结构

| 路径 | 内容 | 输出 |
|------|------|------|
| `app/internal/*` | **Go 核心，16 个包，互相零依赖** | — |
| `app/main.go` / `app/app.go` / `app/bindings_*.go` | Wails 壳：只做「搬运」，不含业务规则 | `app/build/bin/` |
| `app/frontend/` | Svelte 5 + Vite 渲染进程 | 打进二进制（`go:embed`） |
| `app/scripts/build.sh` | **构建入口**：先编依赖边车 → 再带 `-tags withsidecar` 构建 | 单文件约 18 MB |
| `app/cmd/downvid-server` | 无头模式入口（HTTP + WebSocket RPC，`app/internal/server`） | 独立二进制（尚未接前端） |
| `backend/` | Go 依赖边车（探测 + 下载 yt-dlp/ffmpeg/aria2） | 嵌进主二进制 |
| `shared/` | 前端与脚本共用的契约：仓库坐标、更新源、加速配置、解析错误分类 | — |
| `scripts/` | 校验 / 生成 / 发布脚本（零依赖，只用 Node 标准库） | — |
| `tests/` | 根目录纯逻辑单测（shared/ 与脚本） | — |
| `website/` | 产品落地页（无构建，Vercel 发布） | — |
| `docs/` | 安装、构建、发布、维护文档 | — |

`app/internal/*` 的 16 个包：

| 包 | 职责 |
|---|---|
| `changelog` | 解析仓库 `CHANGELOG.md` 的副本（`//go:embed` 不能跨目录，靠 `pnpm sync:changelog` 同步） |
| `clipboard` | 读系统剪贴板（WebView 的 `navigator.clipboard` 会弹权限框） |
| `cookie` | Cookie 策略、浏览器 Cookie 提取与快照 |
| `deps` | 依赖探测与下载：起边车、把 NDJSON 流转成事件，不重复实现候选表 |
| `download` | yt-dlp 参数、进度行、进程树终止、aria2 进度 |
| `fetch` | 直链分块下载与续传检查点 |
| `history` | 下载历史（原子写 + 损坏恢复 + win32 路径归一） |
| `image` | 带 Referer 抓缩略图并转 data URL（防盗链） |
| `jsruntime` | Node / Deno 探测（YouTube 需要真实 JS 运行时） |
| `netx` | 带代理的 HTTP 客户端与代理探活 |
| `parse` | 站点解析、格式去重、错误分类、YouTube 有限回退 |
| `server` | 无头模式的 HTTP + WebSocket RPC |
| `settings` | 用户设置（13 个字段，落盘到数据目录的 settings.json） |
| `shell` | 打开路径 / 在文件夹中显示 / 磁盘剩余空间 |
| `sidecar` | 把依赖边车嵌进主二进制并在运行时落盘 |
| `update` | 更新检查、自更新下载/安装、产物识别 |

`app/internal/*` 之间**不得互相 import**（`pnpm lint:boundaries` 规则 G1 校验），
也不得依赖 `cmd`（G2）。这是架构上最值得守住的性质：每个包都能独立测试、独立替换。

---

## 改动落点清单（最容易出错的部分）

### 新增后端能力（前端可调用）

1. 在 `app/bindings_*.go`（下载 / 依赖相关）或 `app/app.go`（窗口 / 更新 / 历史等）加导出方法。
   Wails 会按方法签名生成 `wailsjs`，不需要手写 preload / IPC 注册。
2. 前端**只能**经 `app/frontend/src/lib/backend.ts` 调用，不要在组件里直接 `import wailsjs/...`：
   浏览器里那会直接抛 `Failed to resolve module`，整页白屏；换传输层时也只改这一处。
3. 前后端字段名是**逐字契约**：`app/frontend/src/lib/types.ts` 与 Go 结构体的 JSON tag 必须一致。
   数组一侧改了不会有类型错误，只会让界面显示空白。
4. 验证：`pnpm --dir app/frontend check` + `cd app && go test ./...`。

### 新增广播事件（Go → 前端）

1. Go 侧 `a.emit("event", data)`（`app/app.go` 的 `emit`）。
2. 前端在 `app/frontend/src/lib/backend.ts` 里订阅并**返回 unsubscribe**；组件卸载时必须调用。
3. 事件名与 payload 形状记进 `app/frontend/src/lib/types.ts`，否则只有运行时才发现对不上。

### 改用户设置形状

- 唯一入口是 `app/internal/settings/settings.go`，前端映射在 `app/frontend/src/lib/settings.ts`。
- 只许新增（读取时用默认值补齐）；删改属于 MAJOR 变更。
- `app/frontend/scripts/check-settings-write.mjs` 会扫描「绕过入口直接写设置」的调用。

### 改前端文案

- 词条表在 `app/frontend/src/lib/i18n.svelte.ts`。
- 新增 key 必须中英成对；`pnpm lint:i18n:app` 会双向校验并检查 `t()` 引用的 key 是否存在。
- `t()` 是响应式的，**不能在模块顶层求值**；需要常量时用 `computed` / getter。

### 改运行依赖 / 清单

- 依赖探测由 `backend/` 边车负责；`app/internal/deps` 只起进程、转 NDJSON 事件，
  **不要在这里再写一份候选路径表**（那正是「依赖页说装了、加速页说没装」的来源）。
- **新增依赖种类**：`backend/internal/runtime` 的 `Kinds` / `Optional` / 候选路径，以及
  `shared/acceleration.ts` 的 `DEP_KINDS`。
- **改下载源或版本**：只改 `scripts/gen-deps-manifest.mjs` 的资产表，然后 `pnpm deps:manifest`。
  不要手改 `backend/internal/manifest/assets.gen.go`（生成文件）。
- **新增平台**：清单资产表 + `app/scripts/build.sh` 的目标列表 + `.github/workflows/release.yml`
  构建矩阵，三处都要。

### 改发布产物

产物名以 `DownVid-Wails-` 开头，出现在四处，改一处必须改四处：
`release.yml` 的打包步骤、`app/internal/update/migration.go`、`website/app.js` 的产物模板、
`scripts/gen-release-notes.mjs`。`pnpm lint:website` 会比对官网那一侧。

发布后必须核对「tag ↔ Release」对得上：

- `pnpm verify:release`：核对某个 tag 是否真有 Release、三个平台的包是否齐全。
- `.github/workflows/release-audit.yml`：**独立于发布流程**的每日审计，不一致就开一条带
  `release-audit` 标签的 Issue。
- 本地开发时版本号与已发布版本一致是正常的；**不要为了让 `verify:release` 通过而提前升版本**。

### 改仓库坐标 / 外部链接

唯一来源是 `shared/app.ts`。`pnpm sync:repo` 会检查流水线、脚本、官网里的坐标是否一致。

### 新增/重写模块 → 会改变上游成分，触发来源审计

`docs/provenance/` 是来源审计 / 目标架构 / 发布质量的落地文档。数字由 `pnpm audit:provenance` 现场重算：

- 新增的文件里有 ≥15%（且 ≥8 行）逐字来自上游 Videdown → **必须登记**在
  `scripts/data/provenance/registry.json`，否则 CI 红叉
- 登记表里的数字与实测不一致 → 同样红叉（先 `node scripts/audit-provenance.mjs --write`）
- `docs/provenance/audit.md` 里的存活行数与实测不一致 → 红叉

上游快照在 `scripts/data/provenance/upstream/`，**不要修改**。

### 改产品官网（`website/`）

无构建的多文件站点（`index.html` / `styles.css` / `app.js`），由 Vercel 项目 `downvid` 的 Git 集成
在推送 main 后直接发布（`vercel.json` 指定 `outputDirectory: "website"`）。
`release.yml` 会显式触发一次 Vercel Deploy Hook，再回读线上页面的 `data-version` 确认部署生效。

容易静默失败、`pnpm lint:website` 全部覆盖的几点：

- **引用的仓库资源**（og:image、favicon、logo）走 `raw.githubusercontent.com/<owner>/<repo>/main/...`
  绝对地址，文件改名/删除后线上裂图，本地无提示
- **中英词条双向成对**：`data-i18n` 占位 ↔ `I18N.en` 词条
- **配色是手抄的**：官网 `:root` 的 `--primary` 等必须与 `app/frontend/src/app.css` 的 `@theme` 一致
- **无构建 / 零依赖**：只允许本地 `styles.css` / `app.js`，除 Google Fonts 外不得外链脚本/样式
- **下载按钮按系统直链产物**：`app.js` 里的 `ARTIFACTS` 产物名模板必须与 `release.yml` 的
  `build-wails` 一致，对不上不会报错，只是所有平台都挑不到产物
- **hero 的预览是应用主界面的可交互复刻**（不是截图）：改应用界面时要同步这一份

---

## 运行依赖（yt-dlp / ffmpeg / aria2）

**安装包不携带这些二进制**。探测**只认两个位置**，三端完全一致：

1. 设置里手动指定的路径（**只对探测生效**）
2. `~/.downvid/runtime/bin/`（DownVid 下载的，可覆盖更新；旧版 `userData/runtime/bin` 会自动搬过来）

**不再扫描系统 PATH / Homebrew / WinGet / 常见安装目录**：混合来源（ffmpeg 来自 Homebrew、
yt-dlp 来自托管）会让三端表现各异、排障时说不清跑的是哪一份。缺了就由边车下载到同一目录。
登录 shell 的 PATH 仍会被合并（`LivePath` / `EnsureChildPath`），但只用于**让托管的 zipapp 找到
合格的 Python 3.11+**，不参与依赖探测。

### 边车（`backend/`）

只有两个子命令：`detect`（探测，输出 NDJSON）与 `fetch`（下载安装）。
**stdout 只放 JSON，日志一律走 stderr**。

- 只用 Go 标准库：它要被交叉编译成 5 个平台的二进制打进主程序，可审计性优先。
- `probe` 解析版本号；`runtime` 决定候选路径与优先级；`fetch` 负责下载、
  SHA-256 校验、解压、原子替换；`manifest` 只读生成的清单；`cli` 负责 NDJSON 输出。
- gzip 产物的校验针对**压缩文件本身**，校验通过后才解压安装。
- 先写 `.part` 再原子 rename，失败不会留下半个可执行文件。
- macOS 安装后必须 `xattr -c` + `codesign --force --sign -`：
  网络下载的可执行文件带 quarantine，Apple Silicon 会直接 `killed: 9`。
- 错误信息里的 URL 会去掉查询串（GitHub 的签名 JWT 长达数百字符）。

### 探测预算（数字各有唯一来源，不要在多处重复书写）

- 检测总时限 **80 秒**：`rt.DetectTimeout`
- 每个依赖 45 秒；候选执行预算：托管副本与手动路径 15 秒（`probe.CandidateTimeout`）

**这几个数字不能随手调小**：yt-dlp 官方 macOS 构建（PyInstaller，约 37MB）`--version`
本机实测要 8～10 秒、首次执行最慢 12.4 秒，而 zipapp 只要 0.2 秒——托管副本预算一旦低于
15 秒，**刚下载好的副本会被判为「执行超时，文件可能损坏」**。

`probe.run` 的 `cmd.WaitDelay` **不能删**：超时只杀直接子进程，而候选可能是 shell 脚本或
PyInstaller 启动器，孙进程仍持有 stdout 管道，`cmd.Run()` 会一直等 I/O。

### 下载源镜像回退

资产全在 `github.com/.../releases/download/...`，国内网络下这个域名连不上就等于
**依赖装不上、整个应用不可用**。链路是 `GitHub 直连 → gh-proxy.com → ghproxy.net → ghfast.top`，
任一成功即停止（`backend/internal/fetch/mirror.go`）。只改写**真的托管在 GitHub release 上的地址**
（`isUpstreamGitHub`），自建对象存储与测试里的 httptest 必须原样直连。

### Wails 侧打包

- 边车由 `app/scripts/build.sh` 编译到 `app/internal/sidecar/bin/<goos>-<goarch>/`，
  再带 `-tags withsidecar` 用 `//go:embed` 嵌进主二进制；运行时落到
  `~/.downvid/runtime/bin/downvid-deps`。
- 不带 `-tags withsidecar` 的构建（`go test`、普通 `go build`、直接 `wails build`）
  会走 stub：编译能过，但依赖页只剩「探测程序缺失」。这是刻意设计。
- 探测结果里 `Source`（system / managed / manual / scanned）与 `Form`（zipapp / native）
  要在界面上如实展示：`native` 首次执行可能 9~12 秒，不代表文件坏了。

### 升级依赖清单

`pnpm deps:manifest`（或手动运行 `Update dependencies manifest` 工作流）。
清单落后 / 哈希失配会让用户端「下载即校验失败」，所以 CI 会跑 `deps:manifest:check`。

ffmpeg 选 ffmpeg-static 而非 BtbN：体积更小、gzip 单文件便于校验，且带
libmp3lame / aac / libx264。**代价**：上游不公布校验值，`deps:manifest` 需把每个 gzip
完整下载后自算。

---

## 下载架构（`app/internal/download` 与 `app/internal/fetch`）

### 解析性能

**yt-dlp 的选型直接决定解析速度。** 实测同一台机器、同一个 bilibili 视频：

| 形态 | `--version` | 真实解析 |
| --- | --- | --- |
| `yt-dlp_macos`（PyInstaller 单文件） | 9.5~10.5s | 11.4s |
| `yt-dlp`（Python zipapp） | 0.41s | **2.2s** |

PyInstaller 的单文件包每次启动都要把 ~72MB 解压到临时目录，这 9 秒是**纯开销**。所以：

- Linux / macOS 主用 **zipapp**，并同时记录自包含的 PyInstaller 包作为回退；
  `manifest.HasUsablePython()` 决定装哪一份。**Windows 不用 zipapp**——那边 python3 不普遍。
- **不要在成功路径上为了版本号再跑一次 `--version`**：`readYtdlpVersion()` 只在**失败**时调用并缓存。

### 两条完全独立的下载路径

- **`direct.go`**：`directUrl` 存在（仅抖音/快手——解析器返回 CDN URL）→ 纯 HTTP 分块下载。
  Range 可用时按小块队列调度，默认 8 路、最多 16 路；429/503 降低并发，分段失败从已写入位置重试。
  `.part.json` 保存逐段进度，兼容旧四段布局。
- **`run.go` + `ytdlp_args.go`**：`spawn(yt-dlp)`。解析结果 20 分钟内用 `--load-info-json`
  跳过二次提取。进度来自 `--progress-template` 输出的 `[dvp]` / `[dvpp]` 行，
  最终路径由 `--print after_move` 给出。format selector、audio-only、subtitle-only、
  YouTube 多音轨都在 `buildYtdlpArgs` 里组装。

`buildYtdlpArgs` 是**纯函数**：依赖路径与 JS 运行时由调用方解析后传入，
因此可以不起进程直接断言参数列表。

可选 aria2c（>=1.36）是 `DepKind` 的一种，**探测由边车统一负责**——不要在
`download` 包里再写一份候选表。仅接管 yt-dlp 的 HTTP 下载；HLS/DASH 保持原生。

**版本号的解析必须同时认本地化输出**：`aria2c --version` 的首行随 `LANG` 变化
（`aria2 version 1.37.0` / `aria2 版本 1.37.0`）。原先只匹配英文，于是
**中文 / 日文 / 德文系统上永远检测不到 aria2**。执行时固定 `LC_ALL=C`。

### 暂停 = 终止整棵进程树

`child.kill()` 只给直接子进程发信号，而启用 aria2 时进程关系是三级
（DownVid → yt-dlp → aria2c）。只杀 yt-dlp 会让 aria2c 变孤儿继续写 `.part`：
暂停后文件大小还在涨、带宽还在被吃满，而且 `.aria2` 控制文件被写坏后**恢复会从零重下**。
所以 `spawn` 时必须带 `detached: true`（成为进程组组长），暂停时对 `-pid` 发信号；
Windows 先 `taskkill /T /F` 再杀父进程。POSIX 上先 `SIGTERM` 给 aria2c 时间把控制文件写完，
宽限期后才 `SIGKILL`。

### 内存相关的两个坑

- **解析缓存必须有条数上限**：只按 TTL 清理不够，每条缓存持有一份完整 info JSON
  （长视频可到几 MB），「粘贴一批链接逐个看」30 分钟就能攒到几百 MB。
- **临时 info JSON 退出时要清**：它们是下载时 `--load-info-json` 用的。

### 格式去重（`app/internal/parse/formats.go`）

四个易错点（都有测试兜底）：保留无 `vcodec` 的格式（X/Twitter mp4 没有该字段）、
m3u8 仅在该清晰度无直链时保留、都没有分辨率时提供 `bv*+ba/b` 兜底、
**同一清晰度只留一条**。

最后一条曾真实出过问题：bilibili 每个清晰度给三种编码，而 fps 是浮点，
29.969 与 29.97 其实是同一个 30fps 档位——去重键里带原始 fps 时它们不相等，
界面就显示**两个 1080P**。现在 `normalizeFps()` 把帧率归到常见档位，去重键用
`height + 归一化 fps`，并在同档位内按**编码兼容性**（AVC > HEVC > AV1）挑一个。

### yt-dlp 环境细节

- `--ffmpeg-location` 传**目录**而非文件：yt-dlp 会在该目录里同时找 ffmpeg 与 ffprobe。
- YouTube 需要实际安装的 Node / Deno（`app/internal/jsruntime`，校验 Node >=22 / Deno >=2.3；
  总预算 6 秒）。没有运行时时直接报 runtime-unavailable、不起 yt-dlp。
  绑定层只缓存**找到**的结果（60 秒）：「没找到」不能缓存，否则用户装好 Node 后重试还是失败。
- **字幕模式不需要 ffmpeg**，因此不强制解析它，也不传 `--ffmpeg-location`。
- Cookie 经 `app/internal/cookie`：手动文件 → 无；自动模式依次尝试各已安装浏览器 →
  快照 `userData/ytdlp-cookies/browser-cookies.txt` → 无。仅在 cookie **读取**错误时切换来源。
- **不要在 `userData` 下创建与 Chromium 文件名（`Cookies`、`Network`、`Preferences`、
  `Local Storage` 等）大小写不敏感重名的文件/目录**：macOS/Windows 文件系统不区分大小写
  （issue #31）。

---

## 状态管理

| 状态 | 位置 |
|------|------|
| 应用状态（解析结果 / 任务队列 / 弹窗） | `app/frontend/src/lib/store.svelte.ts`（Svelte 5 runes 单例） |
| 用户设置 | `userData/settings.json`，入口 `app/internal/settings/settings.go`；前端映射在 `app/frontend/src/lib/settings.ts` |
| 下载历史 | `app/internal/history` → `~/.downvid/download-history.json`（原子写） |
| 运行依赖 | `app/internal/deps`（探测结果缓存 60 秒） |
| 更新 | `app/internal/update`（检查 / 自更新 / 产物识别） |

**所有后端调用必须经 `app/frontend/src/lib/backend.ts`**：浏览器里直接 import `wailsjs` 会白屏，
换传输层时也只需要改这一处。

### 更新源（`shared/update-sources.ts`）

检查更新按一条有序链路依次尝试 `github → jsdelivr → ghproxy → gitee → website`，任一成功即停止。

- 为什么：国内网络下 `api.github.com` 经常连不上，而**「连不上」在更新流程里的表现是
  「已是最新」**——用户什么提示都看不到，永远停在旧版本上。
- 分层：`shared/update-sources.ts` 是**纯数据 + 纯函数**；Go 侧 `app/internal/update` 做「按链路发请求
  + 换下一个源」。
- 用户设置里可选 `updateSource`（`'auto'` 或钉死某个源），非法值**一律回退 `auto`**。
- 新增源要同时改 Go 侧链路、`UPDATE_SOURCE_IDS`、中英词条与前端设置项。

---

## 界面约定

- **所有界面文案走 `t('key')`**，不要写中文字面量；新增词条必须中英成对。
- **Tailwind v4**（CSS-first，**没有** `tailwind.config.js`）：Material-3 风格语义色 token
  定义在 `app/frontend/src/app.css` 的 `@theme`。**用语义 token，不要写 raw hex。**
- `app/frontend/src/design-system.test.ts` 钉住了主色、动效属性与时长。
- 图标：通用图标用 `app/frontend/src/components/Icon.svelte`（Material Symbols 字体名）；
  **品牌图标用专属 SVG 组件**（如 `GitHubIcon.svelte`），不要拿 Material 的通用图标凑
  （此前用 `code` 尖括号当 GitHub 图标）。
- 无路由：`App.svelte` 用条件渲染切换视图。

---

## 构建与发布

```bash
bash app/scripts/build.sh                            # 当前平台
bash app/scripts/build.sh -platform darwin/arm64
bash app/scripts/build.sh -platform darwin/universal  # 边车会为 arm64 + amd64 各编一份
```

发布流程见 `docs/release.md`。要点：

1. `package.json` 升版本 → `CHANGELOG.md` 加 `## [x.y.z]` 段落 → 推 tag `v*`
   （或在 Actions 页面手动运行 `release.yml`，填与 `package.json` 一致的版本号）
2. `release.yml` 先跑发布门禁（Go 测试 + 静态校验 + 单测 + 边车交叉编译），再按
   macos-latest / windows-latest / ubuntu-22.04 三个矩阵构建产物，最后创建 Release、
   自检产物完整性、刷新官网版本号并显式触发 Vercel 部署。
3. Release 正文由 `scripts/gen-release-notes.mjs` 生成：顶部是「点徽章即下载」的引导区，
   下载链接**按实际产物扫描生成**，不会出现死链。

### 未发布的改动记在 `[Unreleased]`

没有发布计划时，`package.json` 的版本号**保持在最近一次已发布的版本**，
CHANGELOG 用 `## [Unreleased]` 段落累积改动。发布时再一次性改成 `## [x.y.z] - 日期` 并升版本号。

---

## 跨平台构建的坑（都已真实踩过）

本地是 macOS 不代表 Windows 上能过。CI 的 windows job 抓到过三类问题：

1. **`process.platform` ≠ `GOOS`**。Node 用 `win32`，Go 用 `windows`。直接透传会报
   `unsupported GOOS/GOARCH pair win32/amd64`。映射表在 `app/scripts/build.sh`。
2. **默认 shell 不同**。Windows runner 是 PowerShell：`/tmp` 会解析成 `D:\tmp`，
   `test -s` 等 POSIX 断言不成立。需要 POSIX 语义的步骤显式写 `shell: bash`。
3. **换行符**。Windows 默认 `core.autocrlf=true`，检出即 CRLF，而 CRLF 不是 `gofmt` 的输出，
   `gofmt -l` 会把**每个** Go 文件都判为未格式化。仓库根部的 `.gitattributes`
   （`* text=auto eol=lf`）统一为 LF，**不要删除该文件**。
4. **路径断言**。测试里不要写死 `/tmp/out/...`，生产代码用 `path.join`。
5. **Wails 的 `universal` 不是 Go 的 `GOARCH`**。`wails build -platform darwin/universal`
   由 Wails 自己 lipo 合并，但边车是我们自己编的：`app/scripts/build.sh` 必须为 arm64 与 amd64
   **各编一份**，否则用户下到 universal 包后依赖探测找不到二进制。
6. **Linux 的 Wails 构建要 webkit2gtk-4.0**。Wails v2.16 的 cgo 指令默认找 `webkit2gtk-4.0`
   开发包；只装 4.1 会编译失败（CI 已踩过）。
7. **Wails 前端不能用绝对资源路径**。`app/frontend/vite.config.ts` 的 `base` 保持 `'./'`；
   改成 `/` 后开发环境正常，打包进 `embed.FS` 就 404（图标变文字，构建不报错）。

**硬规则**：CI 里新增任何构建/检查步骤，必须先在本地以「非宿主平台语义」复现一遍
（交叉编译到 `win32`、用 `core.autocrlf=true` 检出），不能只核对 YAML 语法。

---

## 注意事项

- `wails generate module` 会先编译 Go 包，而 `app/main.go` 有 `//go:embed all:frontend/dist`：
  顺序必须是「准备 embed 目录（`app/scripts/prepare-embed-dir.sh`）→ 构建前端 → 生成绑定」。
  反过来直接 generate 会报 `pattern all:frontend/dist: no matching files found`。
- `app/frontend` 是**独立包**（不在根 pnpm workspace），装依赖要 `pnpm --dir app/frontend install`；
  类型检查用 `pnpm --dir app/frontend check`。
- 新架构的设置落在 `userData/settings.json`；删改字段属于 MAJOR 变更。
- `build.sh` 必须注入 `-X main.arch=wails`：`app/internal/update` 靠它区分产物形态。
- 所有 UI 文案、注释、commit body **一律中文**，匹配现有风格。
- 分支命名 `feat/…` `fix/…` `docs/…` `chore/…`，Conventional Commits。
- 禁止在 PR、Issue、代码、注释、commit 等全部地方透露本地隐私、敏感信息、网络环境。
- `AGENTS.md`（本文件）与 `CLAUDE.md` 是同一份知识的两个语言版本，**改其一时必须同步另一份**。
