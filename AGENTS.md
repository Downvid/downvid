# AGENTS.md — DownVid 开发速查

面向在本仓库改代码的人（或 AI）。这个项目的耦合点比文件数量看起来多——很多地方是**手工同步**的，
漏改会静默失败（不报错、功能不生效）。改任何东西之前请先读「改动落点清单」一节。

---

## 快速开始

```bash
pnpm install
pnpm dev        # Vite dev server + Electron 热重载；会自动编译 Go 依赖边车
```

前置：**Node ≥ 22**、**pnpm ≥ 8**、**Go ≥ 1.24**。
yt-dlp / ffmpeg **不需要**预先安装（见「运行依赖」一节）。

`electron-builder.json5` 的 `extraResources` 指向 `backend/build/${platform}-${arch}`，
所以 `pnpm dev` / `pnpm build` 都会先跑 `goBackend()` 插件编译边车。没装 Go 时会给出明确报错。

---

## 验证命令

改完必须全跑一遍。CI 跑的是同一套。

```bash
pnpm vue-tsc --noEmit                          # 前端类型检查（strict + noUnusedLocals + noUnusedParameters）
pnpm test                                      # 纯逻辑单测（Vitest，tests/*.test.ts）
pnpm test:runtime:windows                       # Windows 原生 exe 集成回归（需 Go）
pnpm test:download:integration                  # 本地 HTTP / 文件 / Store 下载集成回归
pnpm test:acceleration                          # 加速基准；外部引擎见 docs/download-acceleration.md
pnpm lint:ipc                                  # IPC 契约静态校验（三处同步 + 产物命名 + 仓库坐标一致）
pnpm deps:manifest:check                       # 依赖清单是否落后上游
cd backend && gofmt -l . && go vet ./... && go test ./...   # Go 侧车
pnpm build                                     # 端到端：vue-tsc + vite build + electron-builder
```

### 关于测试

两层：**Go 侧车**（`backend/internal/*/**_test.go`）与**前端纯逻辑**（`tests/*.test.ts`，Vitest）。

- 只覆盖**纯函数**：格式选择、依赖错误识别、yt-dlp 参数组装、解析器共用工具、更新状态机。
- 依赖 DOM 或需要真的起子进程的逻辑**不写单测**——那类问题靠类型检查、`lint:ipc` 与真机验证拦。
- 新增测试请针对「曾经出过问题的分支」各留一个用例，**不追覆盖率数字**。
- **写完必须做变异验证**：把被测逻辑改坏，确认用例会失败。不会失败的测试等于没有测试。
- 前端纯逻辑单测刻意不引入 jsdom：`environment: 'node'`，见 `vitest.config.ts`。

### 关于格式化

没有 ESLint / Prettier，**不要引入**（格式化差异会污染历史 diff）。
前端靠 TypeScript 严格模式，Go 靠 `gofmt` + `go vet`。

TypeScript 固定在 5.x：vue-tsc 无法在 TypeScript 7（Go 重写版，去掉了 `typescript/lib/tsc`）上运行，
Dependabot 已忽略其大版本升级。

---

## 跨平台构建的坑（都已真实踩过）

本地是 macOS 不代表 Windows 上能过。CI 的 windows job 抓到过三类问题：

1. **`process.platform` ≠ `GOOS`**。Node 用 `win32`，Go 用 `windows`。直接透传会报
   `unsupported GOOS/GOARCH pair win32/amd64`。macOS / Linux 只是两个名字恰好一致，
   所以本地和 CI 的 ubuntu / macos job **都发现不了**。映射表在 `vite.config.ts` 的
   `GOOS_BY_PLATFORM` 与 `scripts/build-backend.sh`。
2. **默认 shell 不同**。Windows runner 是 PowerShell：`/tmp` 会解析成 `D:\tmp`，
   `test ! -s` 等 POSIX 断言不成立。需要 POSIX 语义的步骤显式写 `shell: bash`。
3. **换行符**。Windows 默认 `core.autocrlf=true`，检出即 CRLF，而 CRLF 不是 `gofmt` 的输出，
   `gofmt -l` 会把**每个** Go 文件都判为未格式化。仓库根部的 `.gitattributes`
   （`* text=auto eol=lf`）统一为 LF，**不要删除该文件**。
4. **路径断言**。测试里不要写死 `/tmp/out/...`，生产代码用 `path.join`，
   Windows 上得到反斜杠。用 `path.join` 计算预期值。

**硬规则**：CI 里新增任何构建/检查步骤，必须先在本地以「非宿主平台语义」复现一遍
（交叉编译到 `win32`、用 `core.autocrlf=true` 检出），不能只核对 YAML 语法。

---

## 项目结构

| 路径 | 内容 | 输出 |
|------|------|------|
| `backend/` | Go 依赖边车（探测 + 下载 yt-dlp/ffmpeg） | `backend/build/<platform>-<arch>/` |
| `electron/` | 主进程 | `dist-electron/` |
| `src/` | Vue 3 渲染进程（`<script setup>`、Tailwind v4、Pinia） | `dist/` |
| `shared/app.ts` | 仓库坐标与外部链接的**唯一来源** | 被三方共同引用 |
| `tests/` | Vitest 纯逻辑单测 | — |
| `scripts/` | 清单生成、构建边车、IPC 校验、Release 正文 | — |

两个 Electron 进程由 `vite-plugin-electron/simple` 从**同一个** `vite.config.ts` 构建；
Go 边车由同文件的 `goBackend()` 插件构建。`vitest.config.ts` 与 `vite.config.ts` **分开**，
因为后者会在 buildStart 时调 `go build`，跑测试不该触发。

规模较大的目录（有注释说明职责）：
`electron/ipc/`（按域拆分）、`electron/download/`（direct / ytdlp / progress）、
`electron/parsers/`（douyin / kuaishou / ytdlp / formats / shared）。

---

## 改动落点清单（最容易出错的部分）

### 1. 新增渲染进程可调用的主进程能力 → 三处必须同步

| # | 文件 | 改动 |
|---|------|------|
| 1 | `electron/ipc/<domain>.ts` | `ipcMain.handle(...)`，并在 `electron/main.ts` 注册 |
| 2 | `electron/preload.ts` | `contextBridge` 暴露入口 |
| 3 | `src/env.d.ts` | `Window.electronAPI` 类型定义 |

漏改任一处会**静默失败**。`pnpm lint:ipc` 会双向比对这三处（主进程注册但没暴露、
暴露了但没实现、env.d.ts 声明了但 preload 没有等等），并检查 API 分组是否双向覆盖。

> `src/env.d.ts` **不能出现顶层 import/export**：那会把它从全局声明脚本变成模块，
> `interface Window` 随即失效。依赖类型一律用内联 `import('./types/deps')`。
> 历史上 `electron/electron-env.d.ts` 就是因为定义了第二份 `Window.electronAPI` 而
> 反过来遮蔽了完整定义，导致多处调用在类型检查下"消失"。该文件已删除，不要恢复。

### 2. 新增广播事件（主进程 → 渲染进程）→ 四处

1. 主进程发送点（`broadcast('...')` / `webContents.send('...')`）
2. `electron/preload.ts` 的 `ipcRenderer.on` + 返回 unsubscribe 闭包
3. `src/env.d.ts` 补类型
4. 订阅方**必须在组件卸载时调用 unsubscribe**（否则热重载会累积监听）

现有事件：`download:progress`、`history:updated`、`update:status`、`menu:showAbout`、`deps:progress`。
广播事件**不得**同时用作 `ipcMain.handle` 通道（`lint:ipc` 会报）。

### 3. 改用户设置形状 → 会让老用户设置静默失效

设置存在 `localStorage['settings']`（**不在** Pinia 中），多个组件直接读。

字段：`downloadDir`、`filenameTemplate`、`preferredQuality`、`cookieMode`、`cookiesFile`、
`proxy`、`depPaths`（运行依赖的手动路径）、`acceleration`（开关、并发上限、可选 aria2c 路径）。

- 改动前先 `grep -rn "localStorage.getItem('settings')"`，逐个确认读取处有默认值兜底
- 读取时用 `{ ...默认值, ...JSON.parse(saved) }` 让旧数据能被补齐
- **删除或重命名字段属于 MAJOR 变更**（见 `docs/release.md` 的版本语义）
- 同步更新 `src/components/SettingsView.vue` 与 `src/components/DepPanel.vue`

### 4. 改运行依赖（yt-dlp / ffmpeg / ffprobe）

- **新增依赖种类**：`backend/internal/runtime` 的 `Kinds` / `Optional` / 候选路径，
  以及 `src/types/deps.ts` 的 `DepKind`
- **改下载源或版本**：只改 `scripts/gen-deps-manifest.mjs` 的资产表，然后 `pnpm deps:manifest`。
  **不要手改** `backend/internal/manifest/assets.gen.go`（生成文件）
- **新增平台**：清单资产表 + `electron-builder.json5` + `release.yml` 构建矩阵，三处都要
- 依赖解析失败的引导依赖错误信息里的 `[[deps-missing:<kind>]]` 标记
  （`electron/utils/binary.ts` 产生，`src/stores/deps.ts` 的 `readMissingKinds` 解析）。
  改任一侧都要同步，`tests/deps-error.test.ts` 覆盖了这对契约

### 5. 改发布产物 → 会切断存量用户的自动更新

产物名被旧版本客户端的 `latest*.yml` 引用。**改名 = 所有老用户无法自动更新。**
不可更改：`DownVid-Setup-*`、`DownVid-Portable-*`、`DownVid-<arch>-Mac-*`、
`DownVid-x86_64-Linux-*`。`pnpm lint:ipc` 会校验 `electron-builder.json5` 里的 `artifactName`。

Linux 用 `amd64`/`x86_64` 而不是 `x64`（与 electron-builder 的 `${arch}` 取值不同，历史约定）。

### 6. 改仓库坐标 / 外部链接

唯一来源是 `shared/app.ts`。主进程经 `electron/constants.ts` re-export，渲染进程直接引用。
`electron-builder.json5` 的 `publish` 是构建期配置、运行时读不到，由 `lint:ipc` 做静态一致性校验。

**换仓库时**：改 `shared/app.ts` + `electron-builder.json5` 的 `publish` + 各 workflow 里的仓库引用，
三处必须一致，否则用户收不到更新。

---

## 运行依赖（yt-dlp / ffmpeg / ffprobe）

**安装包不再携带这三个二进制**（此前每架构约 80MB，且仓库靠 Git LFS 膨胀到 800MB+）。
启动后由 Go 边车按「系统优先，缺失才下载」的顺序解析：

1. 设置里手动指定的路径（`localStorage['settings'].depPaths`，**只对探测生效**）
2. `userData/runtime/bin/`（DownVid 下载的，可覆盖更新）
3. 登录 shell 的 PATH（GUI 应用只有精简 PATH，这一步是关键）＋ 各平台常见安装目录
4. 裸命令名交给 PATH 兜底

### 边车（`backend/`）

只有两个子命令：`detect`（探测，输出 NDJSON）与 `fetch`（下载安装）。
**stdout 只放 JSON，日志一律走 stderr**——Electron 逐行解析 stdout，混入日志会解析失败。

- 只用 Go 标准库：它要被交叉编译成 5 个平台的二进制打进安装包，可审计性优先。
  引入第三方库前先想清楚值不值。
- `probe` 解析版本号；`runtime` 决定候选路径与优先级；`fetch` 负责下载、
  SHA-256 校验、解压、原子替换；`manifest` 只读生成的清单；`cli` 负责 NDJSON 输出。
- gzip 产物的校验针对**压缩文件本身**，校验通过后才解压安装。
- 先写 `.part` 再原子 rename，失败不会留下半个可执行文件。
- macOS 安装后必须 `xattr -c` + `codesign --force --sign -`：
  网络下载的可执行文件带 quarantine，Apple Silicon 会直接 `killed: 9`。
- 错误信息里的 URL 会去掉查询串（GitHub 的签名 JWT 长达数百字符，直接展示会撑爆界面）。

### 主进程侧

- `electron/utils/runtime.ts`：定位边车（打包后在 `resources/downvid-deps/`）、执行、
  缓存探测结果 60 秒、广播 `deps:progress`。下载在主进程里完成，界面关闭不中断。
- 检测总时限 45 秒，每个依赖 15 秒，每个候选执行 3 秒；扫描另有 3 秒预算，
  同时受剩余检测时限约束。Windows 目录优先读取实际环境变量，找不到有效副本才下载。
- `electron/ipc/deps.ts`：`deps:status / check / download / cancel / openDir / diagnostics`。
- `electron/utils/binary.ts` 的 `resolveDependency()` 是**唯一入口**：
  解析失败抛 `MissingDependencyError`，消息带 `[[deps-missing:<kind>]]` 标记，
  渲染进程据此弹「一键下载」引导（与 Cookie 提示的 `\n\n提示：` 标记同一思路）。
- **手动路径只对探测生效**，`fetch` 不接受它：下载永远只写托管目录，
  避免覆盖用户自己装的版本。

### 升级依赖清单

`pnpm deps:manifest`（或手动运行 `Update dependencies manifest` 工作流）。
清单落后 / 哈希失配会让用户端「下载即校验失败」，所以 CI 会跑 `deps:manifest:check`。

ffmpeg 选 ffmpeg-static 而非 BtbN：体积更小、gzip 单文件便于校验，且带
libmp3lame / aac / libx264。**代价**：上游不公布校验值，`deps:manifest` 需把每个 gzip
完整下载后自算（约 130MB 流量）。

---

## 下载架构

### 解析分发（`electron/ipc/download.ts` → `ytdlp:parse`）

抖音/快手有专属解析器（`electron/parsers/`）：平台 API 优先，headless `puppeteer-core`
驱动系统已安装的 Chrome/Edge（`electron/utils/browser.ts`）作为 fallback。
**每次失败都被空 `catch` 吞掉**，最终落到 `parseWithYtdlp`。
调试解析 bug 时注意哪个分支实际运行了——错误在这里是不可见的。

### 两条完全独立的下载路径

实现已拆到 `electron/download/`，`electron/ipc/download.ts` 只做分发：

- **`direct.ts`**：`directUrl` 存在（仅抖音/快手——解析器返回 CDN URL）→ 纯 `fetch` + write stream。
  Range 可用时按小块队列调度，默认 8 路、最多 16 路；429/503 降低并发，分段失败从已写入位置重试。
  `.part.json` 保存逐段进度，兼容旧四段布局；更换并发设置不丢失暂停进度。
  暂停通过 `activeDownloads` 里的 `AbortController`。
  这条路径存在的理由是那些 CDN 地址有效期很短，走 yt-dlp 会二次请求平台接口、拿不到同一份地址。
- **`ytdlp.ts`**：`spawn(yt-dlp)`。解析结果 20 分钟内用 `--load-info-json` 跳过二次提取
  （尚未开始下载即失败则回退为 URL）。进度来自 `--progress-template` 输出的
  `[dvp]`（stdout）/ `[dvpp]`（后处理，`--print` 隐含 quiet 时走 **stderr**）行，
  最终路径由 `--print after_move` 给出。format selector、audio-only、subtitle-only、
  YouTube 多音轨都在 `buildYtdlpArgs` 里组装。

`buildYtdlpArgs` 是**纯函数**：依赖路径与 JS 运行时由调用方解析后传入（`BuildArgsContext`），
因此可以不起进程直接断言参数列表（`tests/ytdlp-args.test.ts`）。

可选 aria2c（>=1.36）由 `electron/download/aria2.ts` 探测手动路径、PATH、Scoop/WinGet 等位置，
不自动安装、不加入必需依赖清单。仅接管 yt-dlp 的 HTTP 下载；HLS/DASH 保持原生。
aria2 临时片段隔离在输出目录 `.downvid-aria2` 中，同一暂停任务固定引擎，避免稀疏片段被顺序下载器误用。

- **`progress.ts`**：两条路径共用的进度广播与节流（每 taskId 最多 200ms 一次 IPC）。
  进度格式化只在这里定义，不要再各写一份。

视频格式由纯函数 `electron/parsers/formats.ts` 生成。三个易错点（都有测试兜底）：
保留无 `vcodec` 的格式（X/Twitter mp4 没有该字段）、m3u8 仅在该清晰度无直链时保留、
都没有分辨率时提供 `bv*+ba/b`「最佳画质」兜底。

暂停（yt-dlp 路径）= `child.kill()`（Windows 额外 `taskkill /T /F`），任务从
`electron/store.ts` 的 `activeDownloads` 移除。恢复 = 重新 spawn，从 `.part` 续传。
**无跨重启恢复。**

### yt-dlp 环境细节

- `--ffmpeg-location` 传**目录**而非文件：yt-dlp 会在该目录里同时找 ffmpeg 与 ffprobe，
  托管目录安装时两者都能命中。
- YouTube 需要实际安装的 Node / Deno；`utils/js-runtime.ts` 的 `checkJsRuntime()`
  是异步执行探测，校验 Node >=22 / Deno >=2.3；总预算 6 秒，每个候选至多 1 秒。
  不得返回 Electron 二进制。除 PATH 外也查 WinGet、Scoop、用户 `.deno/bin` 等目录，
  避免 GUI 应用继承旧 PATH 时漏检；运行依赖侧车不会自动安装 JS 运行时。
- YouTube 解析默认沿用 yt-dlp 客户端；格式/页面重载错误各允许一次回退，至多三轮。
  回退在同一次 Cookie 生命周期内执行，下载沿用成功的客户端参数，界面显示恢复提示。
  `shared/parse-error.ts` 仅输出类别和验证过的版本；Issue 草稿不包含原始输出或环境信息。
- **字幕模式不需要 ffmpeg**，因此不强制解析它，也不传 `--ffmpeg-location`。
- Cookie 经 `utils/cookies.ts` 的 `runWithCookies`：手动文件 → 无；自动模式依次尝试各已安装
  浏览器 → 快照 `userData/ytdlp-cookies/browser-cookies.txt` → 无。仅在 cookie **读取**错误
  （`isCookieError`）时切换来源，鉴权错误不切换；准备某个来源时出现异常只跳过该来源。
  下载优先使用 30 分钟内的快照，与解析保持一致。浏览器 Cookie 读取失败时，错误信息在
  `\n\n提示：` 标记后附带 `cookieFailureHint`，渲染进程拆分后显示在错误弹窗的 hint 中。
- **不要在 `userData` 下创建与 Chromium 文件名（`Cookies`、`Network`、`Preferences`、
  `Local Storage` 等）大小写不敏感重名的文件/目录**：macOS/Windows 文件系统不区分大小写
  （issue #31，`userData/cookies` 报 `EEXIST`）。

---

## 状态管理

| 状态 | 位置 |
|------|------|
| 下载队列、选择、编排 | Pinia `src/stores/download.ts` |
| 用户设置 | **不在 Pinia**：`localStorage['settings']` |
| 下载历史 | 主进程 `userData/download-history.json`，按本地文件路径合并、上限 100 条，变更即广播 |
| 运行依赖 | Pinia `src/stores/deps.ts` |

- 运行依赖的界面是 `src/components/DepPanel.vue`（设置里的「运行依赖」板块）与
  `DepsPrompt.vue`（缺依赖时的一键下载引导，挂在 `App.vue`）。
- 无路由。`App.vue` 用 `v-show` 切换视图；跨组件导航用 `window` CustomEvent
  （`tab-changed`、`navigate-to-settings`）。
- 更新流程的状态机在 `src/composables/useUpdater.ts`（从 `UpdateModal.vue` 抽出）。
  两个容易看漏的点已写明：IPC 返回值与 `update:status` 广播**是两个来源都要处理**；
  下载中收到 error 事件必须归类为 download 阶段，否则重试按钮会跳回检查。

---

## 界面约定

- **Tailwind v4**（CSS-first，**没有** `tailwind.config.js`）：Material-3 风格语义色 token
  （`bg-surface`、`text-on-surface-variant`、`surface-container-high` 等）定义在
  `src/style.css` 的 `@theme` 中。**用语义 token，不要写 raw hex。**
- 同文件的 `@layer base` 兼容块保留了 v3 默认值（gray-200 边框、按钮 pointer 光标）。
- `@custom-variant dark` 已声明但**从未切换 class**——目前没有深色模式开关，
  文档里不要声称支持深色主题。
- 图标：通用图标用 `src/components/icons/MaterialIcon.vue`（Material Symbols 字体名）；
  **品牌图标用专属 SVG 组件**（如 `GitHubIcon.vue`），不要拿 Material 的通用图标凑
  （此前用 `code` 尖括号当 GitHub 图标）。
- `window.electronAPI` 的调用点大多写了可选链（`?.`），因为模块级调用会早于 preload 完成。
  新增调用保持这个习惯。

---

## 构建与发布

```bash
pnpm build:mac:arm64   # 另有 :mac:x64 :win :linux:x64 :linux:arm64
```

Linux x64 有独立格式脚本可并行：`build:linux:x64:appimage`、`:deb`、`:rpm`、`:tar.gz`。

发布流程见 `docs/release.md`。要点：

1. `package.json` 升版本 → `CHANGELOG.md` 加 `## [x.y.z]` 段落 → 推 tag `v*`
   （或在 Actions 页面手动运行 `release.yml`，填与 `package.json` 一致的版本号）
2. `release.yml` 构建 5 个架构目标，最后统一由 `scripts/gen-update-manifests.mjs`
   按**最终产物**重新生成全部 `latest*.yml`（各 job 自己生成的那份会互相覆盖，不能用）
3. Release 正文由 `scripts/gen-release-notes.mjs` 生成：顶部是「点徽章即下载」的引导区，
   下载链接**按实际产物扫描生成**，不会出现死链。改模板后记得用假产物本地跑一遍

---

## 注意事项

- `electron/main.ts` 中 `app.commandLine.appendSwitch('disable-gpu-sandbox')` —
  macOS Tahoe + Electron 30 崩溃修复，**不要删**
- 应用菜单（`electron/menu.ts`）**只在 macOS 注册**：Windows/Linux 的 Electron 会把它渲染成
  窗口内的一条菜单栏，而标题栏已由界面内的 Header 承担（`titleBarStyle: 'hidden'`），
  于是会多出一个用户用不到的标签栏
- 主进程日志写到 `userData/downvid.log`（含 5s 心跳），Settings 通过 `app:getLog` 读最后 500 行
  ——**这是诊断打包应用崩溃的最快方式**
- 更新逻辑在 `electron/updater.ts`：Windows/Linux 用 electron-updater（`autoDownload = false`）；
  macOS 未签名无法用 Squirrel，自行下载对应架构 zip、校验 sha512、去除隔离属性并 ad-hoc 签名，
  退出后由脚本替换 `.app`（失败回滚）；tar.gz / 便携版 / DMG 内运行走 GitHub API 检查 + 前往下载页。
  electron-updater 使用独立 session 分区，`app:setProxy` 会同步代理
- 所有 UI 文案、注释、commit body **一律中文**，匹配现有风格
- 分支命名 `feat/…` `fix/…` `docs/…` `chore/…`，Conventional Commits。
  `main` 未开启分支保护，维护者可直接推送；分支与 PR 流程是对外部贡献者的建议
- 禁止在pr、issue、代码中、注释、commit等全部地方透露或上传本地隐私，敏感信息，开发者的网路环境等
- `AGENTS.md`（本文件）与 `CLAUDE.md` 是同一份知识的两个语言版本，**改其一时必须同步另一份**
