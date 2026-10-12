# AGENTS.md — DownVid 开发速查

## 快速开始

```bash
pnpm install
pnpm dev                    # Vite dev server + Electron 热重载（会自动编译 Go 依赖边车）
```

需要 **Go 1.24+**：依赖边车 `backend/cmd/downvid-deps` 在构建时编译。没有 Go 时 `vite build` 会明确报错提示。

## 验证命令

```bash
pnpm vue-tsc --noEmit       # 类型检查（唯一 lint，CI 也跑这个）
pnpm build                  # vue-tsc + vite build + electron-builder（当前平台）
```

```bash
cd backend && go vet ./... && go test ./...   # Go 侧车的检查与测试
pnpm deps:manifest:check                      # 校验依赖清单是否与上游一致（CI 也跑）
pnpm deps:manifest                            # 把依赖清单升到上游最新版本
```

TypeScript 固定在 5.x：vue-tsc 无法在 TypeScript 7（Go 重写版，去掉了 `typescript/lib/tsc`）上运行，Dependabot 已忽略其大版本升级。

没有 ESLint、Prettier。前端没有测试套件；**Go 侧车有测试**（`backend/internal/*/**_test.go`），改动解析版本号、候选路径、下载校验等纯逻辑时请一并补测。

`tsconfig.json` 开启了 `strict` + `noUnusedLocals` + `noUnusedParameters`，未使用的 import 会导致构建失败。

## 项目结构

- `electron/` → 主进程，输出 `dist-electron/`
- `src/` → Vue 3 渲染进程（`<script setup>`、Tailwind、Pinia），输出 `dist/`
- `backend/` → Go 依赖边车（探测机器上的 yt-dlp/ffmpeg，缺失则下载），输出 `backend/build/<platform>-<arch>/`
- 两个 Electron 进程由 `vite-plugin-electron/simple` 从一个 `vite.config.ts` 构建，Go 边车由同文件里的 `goBackend()` 插件构建

## IPC 边界（手动维护，三个地方必须同步）

1. `electron/ipc/<domain>.ts` — `ipcMain.handle(...)`（注册在 `electron/main.ts`）
2. `electron/preload.ts` — `contextBridge` 入口
3. `src/env.d.ts` — `Window.electronAPI` 类型定义

添加渲染进程可调用的主进程功能时，三处都要改，否则静默失败。

### 广播事件（主→渲染）

`download:progress`、`history:updated`、`update:status`、`menu:showAbout`、`deps:progress`。渲染进程订阅者返回 unsubscribe 闭包。

## 运行依赖（yt-dlp / ffmpeg）

**安装包不再携带 yt-dlp 与 ffmpeg**。启动后由 Go 边车按「系统优先，缺失才下载」的顺序解析：

1. 设置里手动指定的路径（`localStorage['settings'].depPaths`）
2. `userData/runtime/bin/`（DownVid 自己下载的，可覆盖更新）
3. 登录 shell 的 PATH（GUI 应用只有精简 PATH，这一步是关键）＋ 各平台常见安装目录
4. 裸命令名交给 PATH 兜底

- 边车 `backend/cmd/downvid-deps` 只有两个子命令：`detect`（探测，输出 NDJSON）与 `fetch`（下载安装）。**stdout 只放 JSON，日志一律走 stderr**，Electron 逐行解析 stdout。
- 主进程侧 `electron/utils/runtime.ts` 负责定位边车（打包后在 `resources/downvid-deps/`）、执行、缓存探测结果 60 秒，并把 `deps:progress` 广播给渲染进程；`electron/ipc/deps.ts` 暴露 `deps:status/check/download/cancel/openDir/diagnostics`。
- `electron/utils/binary.ts` 的 `resolveDependency()` 是唯一入口：解析失败会抛 `MissingDependencyError`，消息里带 `[[deps-missing:<kind>]]` 标记，渲染进程据此弹「一键下载」引导（与 Cookie 提示的 `\n\n提示：` 标记同理）。
- **手动路径只对探测生效**，`fetch` 不接受它：下载永远只写托管目录，避免覆盖用户自己装的版本。
- 版本固定而非取"最新"：`backend/internal/manifest/assets.gen.go` 由 `scripts/gen-deps-manifest.mjs` 生成，记录 tag 与 SHA-256。ffmpeg 选用 ffmpeg-static（体积更小、带 libmp3lame/aac/x264）；gzip 产物的校验针对**压缩文件**，下载校验通过后才解压安装。
- macOS 上安装后必须 `xattr -c` + `codesign --force --sign -`：从网络下载的可执行文件带 quarantine，Apple Silicon 会直接 `killed: 9`。
- 升级依赖：`pnpm deps:manifest`（或手动运行 `Update dependencies manifest` 工作流）。清单落后/哈希失配会让用户端「下载即校验失败」，所以 CI 会跑 `pnpm deps:manifest:check`。

## 下载架构

### 解析分发 (`electron/ipc/download.ts` → `ytdlp:parse`)

抖音/快手有专属解析器 (`electron/parsers/`)：平台 API 优先，headless `puppeteer-core` 驱动系统已安装的 Chrome/Edge (`electron/utils/browser.ts`) 作为 fallback。每次失败都被空 `catch` 吞掉，最终落到 `parseWithYtdlp`。调试解析 bug 时注意哪个分支实际运行了——错误是不可见的。

### 两条完全独立的下载路径

- `directUrl` 存在（仅抖音/快手——解析器返回 CDN URL）→ `downloadDirectFile`，纯 `fetch` + write stream，手动进度。
- 否则 → `spawn(yt-dlp)`：解析结果 20 分钟内用 `--load-info-json` 跳过二次提取（未开始下载即失败则回退为 URL）。进度来自 `--progress-template` 输出的 `[dvp]`（stdout）/ `[dvpp]`（后处理，`--print` 隐含 quiet 时走 **stderr**）行，最终路径由 `--print after_move` 给出。format selector（仅在格式无音轨时合并 bestaudio）、audio-only、subtitle-only、YouTube 多音轨等在这里组装。
- 直链支持 Range 时 4 段并行下载；暂停通过 `activeDownloads` 中的 `AbortController`。
- 视频格式由纯函数 `electron/parsers/formats.ts` 生成：保留无 `vcodec` 的格式（X/Twitter mp4），m3u8 仅在该清晰度无直链时保留，都没有分辨率时提供 `bv*+ba/b`「最佳画质」兜底。

暂停（yt-dlp 路径）= `child.kill()`（Windows 额外 `taskkill /T /F`），任务从 `electron/store.ts` 的 `activeDownloads` 移除。恢复 = 重新 spawn yt-dlp，从 `.part` 文件续传。无跨重启恢复。

### yt-dlp 环境细节

- `yt-dlp`/`ffmpeg` 的路径由 `binary.ts` 的 `resolveDependency()` 从边车探测结果里取（见上一节），不再有随包分发的二进制。
- `--ffmpeg-location` 传**目录**而非文件：yt-dlp 会在该目录里同时找 ffmpeg 与 ffprobe，托管目录安装时两者都能命中。
- YouTube 需要 JS 运行时；`checkJsRuntime()` 返回 `process.execPath`（Electron 二进制）作为 `--js-runtimes node:<path>`，打包应用无需单独安装 Node。
- 字幕模式不需要 ffmpeg，因此不强制解析它。
- Cookie 经 `utils/cookies.ts` 的 `runWithCookies`：手动文件 → 无；自动模式依次尝试各已安装浏览器 → 快照 `userData/ytdlp-cookies/browser-cookies.txt` → 无。仅在 cookie *读取*错误（`isCookieError`）时切换来源，鉴权错误不切换；准备某个来源时出现异常只跳过该来源。下载优先使用 30 分钟内的快照，与解析保持一致。浏览器 Cookie 读取失败时，错误信息在 `\n\n提示：` 标记后附带 `cookieFailureHint`，渲染进程拆分后显示在错误弹窗的 hint 中。
- 不要在 `userData` 下创建与 Chromium 文件名（`Cookies`、`Network`、`Preferences`、`Local Storage` 等）大小写不敏感重名的文件/目录：macOS/Windows 文件系统不区分大小写（issue #31，`userData/cookies` 报 `EEXIST`）。

## 状态管理

- 一个 Pinia store：`src/stores/download.ts` — 队列、选择、下载编排。
- 用户设置 **不在** Pinia 中：直接读 `localStorage['settings']` JSON（`downloadDir`、`filenameTemplate`、`preferredQuality`、`cookieMode`、`cookiesFile`），store 和多个组件直接读取。改形状需全局 grep。
- 下载历史由主进程管理：`userData/download-history.json`，上限 100 条，每次变更重新广播。
- 运行依赖用独立 store `src/stores/deps.ts`，界面是 `src/components/DepPanel.vue`（设置里的「运行依赖」板块）与 `DepsPrompt.vue`（缺依赖时的一键下载引导，挂在 `App.vue`）。
- 无路由。`App.vue` 用 `v-show` 切换四个视图；跨组件导航用 `window` CustomEvent（`tab-changed`、`navigate-to-settings`）。

## 构建平台

```bash
pnpm build:mac:arm64       # 也可 :mac:x64 :win :linux:x64 :linux:arm64
```

Linux x64 有独立格式脚本可并行：`build:linux:x64:appimage`、`:deb`、`:rpm`、`:tar.gz`。

## 发布

1. `package.json` 升版本
2. `CHANGELOG.md` 加 `## [x.y.z]` 段落
3. 推 tag `v*`（或在 Actions 页面手动运行 `release.yml` 并填写与 `package.json` 一致的版本号，由工作流创建 tag）→ `release.yml` 自动构建 5 个架构目标并发布（每个 job 只需装好 Go 与 Node；`scripts/gen-update-manifests.mjs` 按最终产物重新生成全部 `latest*.yml`）

产物文件名是旧版本客户端更新清单所引用的，不要改 `DownVid-Setup-*`、`DownVid-<arch>-Mac-*`、`DownVid-x86_64-Linux-*` 等命名。

更新运行依赖清单：手动运行 `Update dependencies manifest` 工作流（`update-deps.yml`），它执行 `scripts/gen-deps-manifest.mjs` 抓取上游版本与 SHA-256 并提交 `assets.gen.go`；本地为 `pnpm deps:manifest`。不再有二进制入库，因此仓库与安装包都不再随版本膨胀。

Release notes 从 CHANGELOG.md 按版本 header 提取。

## 注意事项

- `electron/main.ts` 中 `app.commandLine.appendSwitch('disable-gpu-sandbox')` — macOS Tahoe + Electron 30 崩溃修复，不要删
- `src/env.d.ts` 不能出现顶层 import/export：那会把它从全局声明脚本变成模块，`interface Window` 随即失效（旧的 `electron/electron-env.d.ts` 就是这样反而胜出的）。依赖类型一律用内联 `import('./types/deps')` 引用。
- 所有 UI 字符、注释、commit body 使用中文，匹配此风格
- 分支命名：`feat/…` `fix/…` `docs/…` `chore/…`，Conventional Commits
- `localStorage['settings']` 存用户设置，改形状需全局搜索
- yt-dlp 的 JS 运行时用 Electron 自身（`process.execPath`），不需要单独安装 Node
- Tailwind v4（CSS-first，无 `tailwind.config.js`）：Material-3 风格语义色 token（`bg-surface`、`text-on-surface-variant`、`surface-container-high` 等）定义在 `src/style.css` 的 `@theme` 中，用这些而非 raw hex。同文件 `@layer base` 兼容块保留了 v3 默认值（gray-200 边框、按钮 pointer 光标）。`@custom-variant dark` 已声明但从未切换 class。
- 主进程日志写到 `userData/downvid.log`（含 5s 心跳），Settings 视图通过 `app:getLog` 读最后 500 行——这是诊断打包应用崩溃的最快方式
- GitHub API 和 updater 的 owner/name 硬编码在 `electron/constants.ts` 和 `electron-builder.json5` 中
- 更新逻辑在 `electron/updater.ts`：Windows/Linux 用 electron-updater（`autoDownload = false`）；macOS 未签名无法用 Squirrel，自行下载对应架构 zip、校验 sha512、去除隔离属性并 ad-hoc 签名，退出后由脚本替换 `.app`（失败回滚）；tar.gz/便携版/DMG 内运行走 GitHub API 检查 + 前往下载页。electron-updater 使用独立 session 分区，`app:setProxy` 会同步代理
