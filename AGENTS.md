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
pnpm test:parse:integration                     # 解析链路（回退 / 轮次上限 / Cookie 生命周期）
pnpm test:acceleration                          # 加速基准；外部引擎见 docs/download-acceleration.md
pnpm test:updater                               # 更新状态机 / 缓存 / 兜底 / 各安装方式分支
pnpm test:settings:migration                    # 设置默认值与合并写入 + 「不许绕过入口」静态扫描
pnpm test:package                               # 打包产物内容校验（需先跑一次 --dir 打包）
pnpm lint:ipc                                  # IPC 契约静态校验（三处同步 + 产物命名 + 仓库坐标一致）
pnpm lint:docker                               # 容器镜像定义（依赖版本来自清单 / 未退回 tsx / 更新检查未退化）
pnpm test:web                                  # WebUI 服务端回归（跑的是打包产物，与镜像里同一份）
pnpm lint:icons                                # 图标名是否有效（写错会静默渲染成文字）
pnpm lint:website                              # 官网单文件 / 引用资源 / 中英词条 / 配色一致性
pnpm lint:docs                                 # AGENTS.md ↔ CLAUDE.md 一致 + 引用路径与数字真实存在
pnpm audit:provenance                          # 代码来源审计：上游逐字存活率 + 登记表是否覆盖（见 docs/provenance/audit.md）
pnpm deps:manifest:check                       # 依赖清单是否落后上游
cd backend && gofmt -l . && go vet ./... && go test -shuffle=on ./...   # Go 侧车
pnpm build                                     # 端到端：vue-tsc + vite build + electron-builder
```

### 关于测试

两层：**Go 侧车**（`backend/internal/*/**_test.go`）与**前端纯逻辑**（`tests/*.test.ts`，Vitest）。

- 只覆盖**纯函数**：格式选择、依赖错误识别、yt-dlp 参数组装、解析器共用工具、更新状态机。
- 依赖 DOM 或需要真的起子进程的逻辑**不写单测**——那类问题靠类型检查、`lint:ipc` 与真机验证拦。
- 新增测试请针对「曾经出过问题的分支」各留一个用例，**不追覆盖率数字**。
- **写完必须做变异验证**：把被测逻辑改坏，确认用例会失败。不会失败的测试等于没有测试。
- 前端纯逻辑单测刻意不引入 jsdom：`environment: 'node'`，见 `vitest.config.ts`。

### CI 工作流分工

测试按**平台**拆成三个工作流（`.github/workflows/ci-linux.yml`、`.github/workflows/ci-macos.yml`、
`.github/workflows/ci-windows.yml`），每个工作流内部再按职责拆 job，失败时一眼能看出是哪一层：

| job | 内容 |
| --- | --- |
| `backend` | gofmt / vet / `go test -shuffle=on` / 交叉编译（Linux 跑全 5 平台，macOS/Windows 跑本平台） |
| `frontend` | 类型检查 / IPC 契约 / 图标名 / 官网校验 / 文档一致性 / **代码来源审计** / 纯逻辑单测 / 更新流程回归 / 设置迁移 |
| `main-process` | 仅 Linux：更新流程回归 / 设置迁移 / 依赖清单校验 |
| `integration` | 下载集成回归 / 加速基准 / 解析集成回归 |
| `native-runtime` | 仅 Windows：原生 exe 运行依赖回归 |
| `package` / `packaging` | 构建 / 打包到目录 / 产物内容校验 / 清单与 Release 正文脚本自检 |

**新增测试脚本必须挂到对应平台的三个工作流上** —— 曾经 `test:acceleration` 加了脚本却没接进 CI，
加速逻辑长期没有自动化验证。同理，**新增工作流文件时必须先 `git add`**：曾有一次把单一的测试
工作流拆成 `.github/workflows/ci-linux.yml` / `.github/workflows/ci-macos.yml` /
`.github/workflows/ci-windows.yml`，旧文件的删除已 staged 而三个新文件
还是 untracked，一次 `git commit -a` 就会让 main 上不再有任何 CI
（`scripts/lint-docs.mjs` 会校验文档提到的 workflow 真实存在）。

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
| `docker/` | 容器镜像（原生 WebUI，见 `docs/docker.md` 与 `docker/README.md`） | GHCR 多架构镜像 |
| `website/` | 产品落地页（单文件、无构建，由 Vercel 的 Git 集成发布） | — |
| `scripts/` | 清单生成、构建边车、IPC / 官网校验、Release 正文 | — |

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

现有事件：`deps:progress`、`download:progress`、`history:updated`、`update:status`、`menu:openSettings`、`menu:showAbout`。
广播事件**不得**同时用作 `ipcMain.handle` 通道（`lint:ipc` 会报）。

### 3. 改用户设置形状 → 会让老用户设置静默失效

设置存在 `localStorage['settings']`（**不在** Pinia 中），多个组件直接读。

字段：`downloadDir`、`filenameTemplate`、`preferredQuality`、`cookieMode`、`cookiesFile`、
`proxy`、`depPaths`（运行依赖的手动路径）、`acceleration`（开关、并发上限、可选 aria2c 路径）、
`depMirror`（依赖下载源：`'auto'` 沿镜像链降级 / 钉死某个镜像，默认 `'auto'`）、
`autoCheckUpdate`（启动时自动检查更新，默认开）、`autoDownloadUpdate`（发现新版本自动下载，默认关）、
`updateSource`（更新源：`'auto'` 依次降级 / 钉死某个源，见「更新源」一节，默认 `'auto'`）、
`language`（界面语言：`'auto'` 跟随系统 / `'zh-CN'` / `'en-US'`，默认 `'auto'`）。

**唯一入口是 `src/stores/settings.ts` 的 `readSettings()` / `updateSettings()`**：

- 读必须走 `readSettings()`（它会用默认值补齐、清洗 `depPaths` 与 `acceleration`）；
  `grep -rn "localStorage.getItem('settings')"` 应当**只剩 settings.ts 自己**。
  曾经 `deps.ts` / `download.ts` / `DownloadView.vue` 各自复制了一份读法，
  于是 `filenameTemplate` 出现了两个不同的默认值（`%(title)s` 与 `%(title)s.%(ext)s`）。
- 写必须走 `updateSettings(patch)`：直接 `setItem` 是整体覆盖，会把别的组件的字段抹掉
  （历史事故：在设置面板点一次「保存」，`depPaths` 就没了）
- **删除或重命名字段属于 MAJOR 变更**（见 `docs/release.md` 的版本语义）
- 同步更新 `src/components/SettingsView.vue` 与 `src/components/DepPanel.vue`
- `scripts/test-settings-migration.mjs` 覆盖以上约定（含「不许绕过入口」的静态扫描）

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

### 6.5 新增/重写模块 → 会改变上游成分，触发来源审计

`docs/provenance/` 是 [issue #74](https://github.com/yxxbc/downvid/issues/74) 的落地文档
（来源审计 / 目标架构 / 迁移计划 / 发布质量）。它的数字由 `pnpm audit:provenance` 现场重算：

- 新增的文件里有 ≥15%（且 ≥8 行）逐字来自上游 Videdown → **必须登记**在
  `scripts/data/provenance/registry.json`，否则 CI 红叉
- 登记表里的数字与实测不一致 → 同样红叉（先 `node scripts/audit-provenance.mjs --write`）
- `docs/provenance/audit.md` 里的存活行数与实测不一致 → 红叉

上游快照在 `scripts/data/provenance/upstream/`，**不要修改**。改架构边界之前先读
`docs/provenance/architecture.md`——那里有 7 条边界规则和三条端口接口（`DataDirs` / `EventSink` /
`UserPrompt`），迁移计划 C0 之后由 `lint:boundaries` 机械校验。

### 7. 改产品官网（`website/`）

单文件 `website/index.html`，**无构建步骤**，由 Vercel 项目 `downvid` 的 Git 集成在推送 main 后
直接发布（`vercel.json` 指定 `outputDirectory: "website"`，域名 <https://downvid-coral.vercel.app>）。
GitHub Pages **不再使用**：仓库从未在 Settings 里选过 Pages 源，`actions/configure-pages` 只会稳定报
`Get Pages site failed`，那个工作流已删除。校验改由 `pnpm lint:website` 在三个 `ci-*.yml` 的 frontend job 跑。

容易静默失败的几点（`lint:website` 全部覆盖）：

- **引用的仓库资源**（og:image、favicon、logo）走 `raw.githubusercontent.com/<owner>/<repo>/main/...`
  绝对地址，文件改名/删除后线上裂图，本地无提示
- **中英词条双向成对**：`data-i18n` 占位 ↔ `I18N.en` 词条，缺英文会永远显示中文；
  脚本拼装的文案（下载区的 `t('...')`）还要在 `I18N.zh` 里补中文，否则界面直接把 key 显示出来
- **配色是手抄的**：官网 `:root` 的 `--primary` 等必须与 `src/style.css` 的 `@theme` 一致
- **零依赖**：除 Google Fonts 外不得外链脚本/样式（`.vercelignore` 只排除源码目录，不做校验）
- **下载量 / 星标用 shields.io 徽章**：hero 用 README 同款徽章，数字实时，省掉
  「发布后手动刷新」。徽章是 `<img>`，不违反零依赖约定；URL 里的仓库坐标由 `lint:website`
  与 `shared/app.ts` 比对（写错只会静默显示 `no data`）。原先的
  `scripts/gen-website-stats.mjs`（`pnpm website:stats`）已删除
- **版式参考 deepseek.com/harness**：居中 hero + 大预览图、两列卡片网格、代码块 + 复制按钮、
  居中的社区 CTA、极简页脚。配色仍必须取自 `src/style.css` 的 `@theme`，
  取舍与细节写在 `website/README.md`
- **顶栏在两种形态间切换**（`is-stuck`）：贴顶时是通栏细条，下滑超过 12px 才收成浮动圆角胶囊
  并钉在顶部，滑回顶部自动还原；且**不放导航链接**——页面就是一路往下滑，品牌在左、语言切换在右。
  别再加回「功能 / 下载 / FAQ」那排按钮
- **「能做什么」的卡片是可点的**：平台 / 画质 / 浏览器分组单选 `data-pick-set`（画质还带出体积
  `data-pick-out`）、下载加速开始 / 暂停、依赖逐个检测、检查更新用真实最新版本作答。
  全部纯前端、不联网改状态；文案走 `t()`，切语言时由 `syncDemos()` 重刷——
  新增演示按钮时记得把它挂进 `syncDemos`，否则切语言后文案不会更新
- **hero 的预览是应用主界面的可交互复刻**（不是截图）：结构 / 文案 / 配色照
  `src/components/` 里的下载界面组件搬，只把真实解析与下载换成本地动画；画布按应用窗口宽度
  1100px 设计，再用 `transform: scale()` 等比缩放到容器宽度。**默认就是「已粘贴 + 已解析 +
  正在下载」**的样子，一进页面就是完整界面。缩略图是 `src/assets/demo-thumb.jpg`
  （从应用截图里裁的原链接预览图，自带时长角标），失败时退回内置 SVG。改应用界面时要同步
  这一份，`lint:website` 会比对复刻里抄来的那批 `@theme` 颜色 token；切语言的文案重刷挂在
  `syncAppDemo()` 上（新增按钮记得挂进去）
- **平台图标只在 `#osIcons` 里维护一份**：脚本按 `data-os` 克隆给主按钮与下载菜单，
  `lint:website` 会核它和脚本 `PLATFORMS` 双向对得上（键名写错只是没图标，不报错）
- **下载按钮按系统直链产物**：hero 主按钮在浏览器里识别系统与芯片，再按 `index.html`
  里的 `ARTIFACTS` 产物名模板，在 `releases/latest` 的产物列表里挑包，`href` 直接指向
  产物直链——点击即下载，不跳转。结果在 `sessionStorage` 里缓存 30 分钟；离线 / 限流 /
  产物缺失 / 系统未识别一律退回 Releases 页面（不留死链，也不弹错误框）。
  `tests/website-download.test.ts` 用真实产物列表（含 `.blockmap`、`latest*.yml` 等干扰项）
  钉住「哪个系统拿哪个包」
- **产物名模板会静默失效**：`ARTIFACTS` 里的名字必须与 `electron-builder.json5` 的
  `artifactName` 一致（`${arch}` 随 target 变化：AppImage / rpm 用 `x86_64`、deb 用
  `amd64`、tar.gz 用 `x64`）。对不上时不会报错，只是所有平台都挑不到产物；
  `lint:website` 比对配置文件，`tests/website-download.test.ts` 比对真实产物名，两条互补
- **页面脚本里的仓库坐标**：下载按钮在运行时拼 `github.com` / `api.github.com` 地址，
  `REPO` 必须与 `shared/app.ts` 一致——raw 链接那条检查覆盖不到它

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
- 检测总时限 80 秒（Electron 侧 90 秒），每个依赖 45 秒；
  候选执行预算**按来源区分**：托管副本 15 秒、系统副本 5 秒；扫描另有 18 秒预算。
  Windows 目录优先读取实际环境变量，找不到有效副本才下载。
  这些数字各有**唯一来源**，不要在多处重复书写：总时限 `rt.DetectTimeout`、
  单依赖 `probeTimeLimit`、候选 `probe.CandidateTimeout` / `probe.SystemCandidateTimeout`、
  扫描 `scanTimeLimit`（均在 `backend/internal/`）；Electron 侧只有 90 秒的
  `runSidecar` 超时，**不再自己传 `--timeout`**（曾硬编码 70，把 80 静默覆盖成 70）。
  **这几个数字不能随手调小**：yt-dlp 官方 macOS 构建（PyInstaller，约 37MB）`--version`
  本机实测要 8～10 秒、首次执行最慢 12.4 秒，而 Homebrew / uv 装的是 Python zipapp、
  只要 0.2 秒——托管副本预算一旦低于 15 秒，**刚下载好的副本会被判为
  「执行超时，文件可能损坏」**，用户点完「下载」界面仍显示「下载」（曾真实发生）。
  反过来系统副本**不能给长预算**：候选表里可能有十几个路径，每个卡死的都给 15 秒
  会把一次检测拖到几分钟（CI 的 windows job 就是这样抓到的）。
- `probe.run` 的 `cmd.WaitDelay` **不能删**：超时只杀直接子进程，而候选可能是
  shell 脚本或 PyInstaller 启动器，孙进程仍持有 stdout 管道，`cmd.Run()` 会一直等 I/O。
  实测一个 `sleep 300` 的假二进制把 5 秒预算的探测拖成 300 秒。
- `electron/ipc/deps.ts`：`deps:status / check / download / cancel / openDir / diagnostics`。
- `electron/utils/binary.ts` 的 `resolveDependency()` 是**唯一入口**：
  解析失败抛 `MissingDependencyError`，消息带 `[[deps-missing:<kind>]]` 标记，
  渲染进程据此弹「一键下载」引导（与 Cookie 提示的 `\n\n提示：` 标记同一思路）。
- **手动路径只对探测生效**，`fetch` 不接受它：下载永远只写托管目录，
  避免覆盖用户自己装的版本。
- **下载源有镜像回退**（`backend/internal/fetch/mirror.go`）：资产全在
  `github.com/.../releases/download/...`，国内网络下这个域名连不上就等于
  **依赖装不上、整个应用不可用**。链路是
  `GitHub 直连 → gh-proxy.com → ghproxy.net → ghfast.top`，任一成功即停止；
  切换时广播 `mirror` 事件，界面显示「正在切换下载源」（不能与 `retry` 混用：
  一个是「换条路」，一个是「同一路再试一次」）。
  只改写**真的托管在 GitHub release 上的地址**（`isUpstreamGitHub`），
  自建对象存储与测试里的 httptest 必须原样直连——拼上镜像前缀只会拿到 403，
  反而把本来能下的下载弄坏。
  新增镜像前必须实测它对 **release 资产**返回 200 且字节一致（jsDelivr 与 Gitee
  都代理不了 release 资产，所以不在这条链里）；`mirror_test.go` 会校验格式，
  `tests/deps-mirror.test.ts` 会比对前后端两边的镜像 ID 表。
- **非网络错误不重试**（`retryable`）：4xx 与校验失败再要一次还是同样的结果，
  让一份 37MB 的文件在完全连不通时重试三次（每次还要退避 2s、4s），
  只会让用户多等半分钟才看到同一句错误。

### 升级依赖清单

`pnpm deps:manifest`（或手动运行 `Update dependencies manifest` 工作流）。
清单落后 / 哈希失配会让用户端「下载即校验失败」，所以 CI 会跑 `deps:manifest:check`。

ffmpeg 选 ffmpeg-static 而非 BtbN：体积更小、gzip 单文件便于校验，且带
libmp3lame / aac / libx264。**代价**：上游不公布校验值，`deps:manifest` 需把每个 gzip
完整下载后自算（约 130MB 流量）。

---

## 下载架构

### 解析性能（改这里之前先读）

**yt-dlp 的选型直接决定解析速度。** 实测同一台机器、同一个 bilibili 视频：

| 形态 | `--version` | 真实解析 |
| --- | --- | --- |
| `yt-dlp_macos`（PyInstaller 单文件） | 9.5~10.5s | 11.4s |
| `yt-dlp`（Python zipapp） | 0.41s | **2.2s** |

PyInstaller 的单文件包每次启动都要把 ~72MB 解压到临时目录，这 9 秒是**纯开销**：
不随网络、不随站点变化，用户感觉到的就是「点解析要等十几秒」。所以：

- Linux / macOS 主用 **zipapp**（`YTDLP_ASSETS`），并同时记录自包含的
  PyInstaller 包作为回退（`YTDLP_BUNDLED_ASSETS`）；`manifest.HasUsablePython()`
  决定装哪一份。**Windows 不用 zipapp**——那边 python3 不普遍，官方 `.exe` 自带解释器。
- 容器（Docker）**必须用自包含包**：镜像刻意不装 python3，`scripts/deps-asset.mjs`
  因此挑 `Bundled` 那份。
- **不要在成功路径上为了版本号再跑一次 `--version`**：`electron/parsers/ytdlp.ts`
  的 `readYtdlpVersion()` 只在**失败**时调用并缓存 5 分钟。多跑一次等于把解析时间翻倍，
  而版本号只在错误诊断里有意义。
- 依赖探测是**并行**的（`FindAllContext`）：每个候选都要真的执行一次工具，
  串行时总耗时是三者之和。zipapp 之后探测本身只要 0.47s，但这条仍然保留——
  回退到 PyInstaller 的机器上它就是 12s 与 22s 的区别。

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

可选 aria2c（>=1.36）现在是 `DepKind` 的一种（`shared/acceleration.ts` 的 `DEP_KINDS`），
探测由 Go 边车统一负责——**不要在 `electron/download/aria2.ts` 里再写一份候选表**：
那正是之前「依赖页说装了、加速页说没装」的来源。`aria2.ts` 只保留版本解析与
「从探测结果里取 aria2 那一项」。仅接管 yt-dlp 的 HTTP 下载；HLS/DASH 保持原生。
**aria2 的检测与下载入口在「设置 → 运行依赖」**，加速页只留开关与并发数。
**五个平台都能一键下载**（`manifest.TasksFor` 的 aria2 分支），但用的是**三个不同源**：
Linux/Windows 来自 `abcfy2/aria2-static-build`（zip，musl / mingw 静态），
macOS arm64 来自 `ricode-labs/aria2`（tar.gz），macOS x64 来自 `static-build/aria2`（裸 Mach-O）。
所以 `aria2Assets` 是**逐平台记完整 URL**，而不是共用一个 base + tag——三个源的 tag
形式各不相同（`1.37.0` / `aria2-1.37.0` / `latest`），共用会拼出 404。

不要换成 Homebrew bottle：它链接到 `HOMEBREW_PREFIX/opt/openssl@4/...` 下的库，
单独拷出来跑不了（dyld 直接失败）。这正是「macOS 只能装系统包」这个**错误结论**的来源——
当时只找过 bottle，没找社区静态构建。
**版本号的解析必须同时认本地化输出**：`aria2c --version` 的首行随 `LANG` 变化
（`aria2 version 1.37.0` / `aria2 版本 1.37.0` / 日文同理）。原先只匹配英文，
于是**中文 / 日文 / 德文系统上永远检测不到 aria2**——加速开关开着，实际一直单线程，
设置里点「检测」只显示「未找到 aria2c」，没有任何报错。现在由
`parseAria2Version()` 统一解析（Go 侧 `probe.parseAria2Version` 是同一套规则），
执行时固定 `LC_ALL=C` 让输出稳定；`tests/acceleration.test.ts` 按语言各留一条用例。
aria2 临时片段隔离在输出目录 `.downvid-aria2` 中，同一暂停任务固定引擎，避免稀疏片段被顺序下载器误用。

- **`progress.ts`**：两条路径共用的进度广播与节流（每 taskId 最多 200ms 一次 IPC）。
  进度格式化只在这里定义，不要再各写一份。

### 内存相关的两个坑

- **解析缓存必须有条数上限**（`PARSE_CACHE_MAX`）。只按 TTL 清理不够：每条缓存
  持有一份完整 info JSON（长视频可到几 MB），「粘贴一批链接逐个看」30 分钟就能
  攒到几百 MB，全部留在主进程内存里。表现是「用久了越来越卡」，很难归因。
- **临时 info JSON 退出时要清**（`cleanupTempInfoFiles()`，挂在 `will-quit`）。
  它们是下载时 `--load-info-json` 用的，原先只在缓存过期时删除——应用退出或
  只解析不下载时都不触发，`/tmp` 里的 `downvid-*.json` 会一直堆到系统重启。
- 删除/清理任务时**必须同时退订进度监听**（`taskProgressCleanups`）：
  只有「下载进行中」那条路径会自己清理，暂停/完成/失败过再删的都漏，
  而且漏掉的闭包捕获着整个 task 对象、永远不会被 GC。

视频格式由纯函数 `electron/parsers/formats.ts` 生成。四个易错点（都有测试兜底）：
保留无 `vcodec` 的格式（X/Twitter mp4 没有该字段）、m3u8 仅在该清晰度无直链时保留、
都没有分辨率时提供 `bv*+ba/b`「最佳画质」兜底、**同一清晰度只留一条**。

最后一条曾真实出过问题：bilibili 每个清晰度给三种编码（HEVC / AV1 / AVC），而 fps 是
浮点，29.969 与 29.97 其实是同一个 30fps 档位——去重键里带原始 fps 时它们不相等，
界面就显示**两个 1080P**。现在 `normalizeFps()` 把帧率归到常见档位，去重键用
`height + 归一化 fps`，并在同档位内按**编码兼容性**（AVC > HEVC > AV1）挑一个。
按码率挑是错的：bilibili 上 AVC 恰好码率最高所以「碰巧」对，换个站点就会把
兼容性最差的编码推给用户。

暂停（yt-dlp 路径）= **终止整棵进程树**（`electron/download/process-tree.ts` 的
`killProcessTree`），任务从 `electron/store.ts` 的 `activeDownloads` 移除。
恢复 = 重新 spawn，从 `.part` 续传。**无跨重启恢复。**

`child.kill()` 只给直接子进程发信号，而启用 aria2 时进程关系是三级
（Electron → yt-dlp → aria2c）。只杀 yt-dlp 会让 aria2c 变孤儿继续写 `.part`：
暂停后文件大小还在涨、带宽还在被吃满，而且 `.aria2` 控制文件被写坏后**恢复会从零重下
整个文件**（实测 16MB 样本重传 16.8MB）。所以：
`spawn` 时必须带 `detached: true`（成为进程组组长），暂停时对 `-pid` 发信号；
Windows 先 `taskkill /T /F` 再杀父进程（父先死会丢掉子进程关系）。POSIX 上先
`SIGTERM` 给 aria2c 时间把控制文件写完，宽限期后才 `SIGKILL`。
`tests/process-tree.test.ts` 钉住这几点——**删掉 `detached` 会让这个 bug 静默复发**。

### 任务级并发闸门（`src/stores/download-rules.ts`）

**同时最多 3 个任务在跑**（`MAX_CONCURRENT_DOWNLOADS`），其余留在 `pending` 排队。
`pumpQueue()` 是唯一执行点：`startDownload` / `resumeTask` / `retryTask` 都汇到它，
由纯函数 `selectStartableTasks()` 决定谁可以开始，任务结束让出槽位后自动补位。

- **不要绕过 `pumpQueue()` 直接调 `processDownload()`**：那是启动单个任务的底层入口，
  绕过就突破了并发上限。`isDownloading` 拦不住连点——它在 `startDownload` 的同步流程里
  就被置回 `false`。
- 没有这道闸时，连点几次「下载」会同时跑起多个任务，每个再开 8～16 路分块，
  **互相抢带宽**（表现为「每一个都变慢」，很难归因），也更容易触发站点 429。
- `merging` 同样占槽位（ffmpeg 在抢 CPU 与磁盘）；`paused` / `error` / `completed` 不占。
- 调度按 `createdAt` 升序（先进先出），否则用户会觉得队列坏了。
- 失败任务可**重试**（`retryTask`，重置规则在 `retryReset()`）：必须回到 `pending`
  才会被重新调度，停在 `error` 上会让「重试」看起来毫无反应。

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
  `DepsPrompt.vue`。**「更新」按钮必须走 `isOutdated()`（比对 `version` 与
  `requiredVersion`），不能只看 `managed`**：只看 managed 时版本与清单一致也会显示
  「更新」，用户点下去白下 37MB 且下完还是同一个版本。
  `DepsPrompt.vue`（缺依赖时的一键下载引导，挂在 `App.vue`）。
- 无路由。`App.vue` 用 `v-show` 切换视图；跨组件导航用 `window` CustomEvent
  （`tab-changed`、`navigate-to-settings`）。
- 更新流程的状态机在 `src/composables/useUpdater.ts`（从 `UpdateModal.vue` 抽出）。
  两个容易看漏的点已写明：IPC 返回值与 `update:status` 广播**是两个来源都要处理**；
  下载中收到 error 事件必须归类为 download 阶段，否则重试按钮会跳回检查。
- 容器版的更新信息（`container` 字段）同样由这条状态机承载：容器里没有「下载/安装」，
  界面改为展示升级命令 + 复制按钮。桌面版该字段恒为 `null`。

### 更新源（`shared/update-sources.ts`）

检查更新**不再只问 GitHub API**：按一条有序链路依次尝试
`github → jsdelivr → ghproxy → gitee → website`，任一成功即停止。

- 为什么：国内网络下 `api.github.com` 经常连不上，而**「连不上」在更新流程里的表现是
  「已是最新」**——用户什么提示都看不到，永远停在旧版本上。这是唯一一类「修好了也发不出去」的故障，
  因为发出去的通道本身就是坏的。
- 分层：`shared/update-sources.ts` 是**纯数据 + 纯函数**（有哪些源、URL 怎么拼、响应怎么归一化、
  版本比较）；`shared/update-check.ts` 只做「按链路发请求 + 换下一个源」。`fetch` 由调用方注入
  （主进程用 electron-updater 的 session 以便走用户代理，容器用 Node 自带 fetch，测试塞假 fetch）。
- 用户设置里可选 `updateSource`（`'auto'` 或钉死某个源），非法值**一律回退 `auto`**
  （回退到「一个源都不试」会让更新永久失灵）。改源时要清检查缓存，否则会看到上一个源的答案。
- `compareVersions` 只在 `shared/update-sources.ts` 里实现一次。各写一份会让「有没有更新」在
  不同入口给出不同答案，而界面上的表现是「设置说有更新、弹窗说已最新」。
- 新增源要同时改 `UPDATE_SOURCE_IDS`、两份 i18n 词条（`updateSettings.source.<id>` 与
  `SettingsView.vue` 里那张字面量键表）、以及 `tests/update-sources.test.ts`。
- **Gitee 与 jsDelivr 需要维护者在对应平台同步**：Gitee 上没有对应仓库时这条源会一直是 404
  （链路会静默跳过它，不影响其它源）。

### 容器镜像的测试

- `scripts/deps-asset.mjs`（清单 → 资产名/URL/哈希）的单测在 `tests/update-sources.test.ts` 里：
  资产名、gzip 与裸文件、TARGETARCH → 清单键的映射。
- `scripts/test-web-server.mjs` 每次都会**重新构建** `docker/dist-server` 再跑。早先写过
  「产物存在就复用」的捷径，结果本地改完源码跑测试仍然全绿——测的是上一次的旧构建。
  那种绿比红更危险。

---

## 界面约定

- **所有界面文案走 `t('key')`**（`src/i18n/`），不要写中文字面量。
  `pnpm lint:i18n` 会扫 `src/` 并拦住硬编码中文。三个容易踩的点：
  - `t()` 读的是一个响应式 `ref`，**不能在模块顶层调用**（那样切换语言不会更新）。
    需要常量时用 `computed(() => t('...'))`，列表项用 `get label()`。
  - 新增词条必须**同时**补 `zh-CN` 与 `en-US`，且占位符集合一致（`lint:i18n` 双向校验）。
  - 主进程（`electron/`）的报错文案是硬编码中文、拿不到渲染进程的语言设置，
    由 `src/i18n/main-messages.ts` 按「原文 → 词条」映射兜底翻译；认不出的原样透传。
  - 例外的**协议标记**不要翻译（翻译了匹配就失效）：`未找到可用的`（`readMissingKinds`
    的匹配串）、`需要登录`（`friendlyDownloadError` 的关键词）、`\n\n提示：`、`更新内容`。
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

### 发布必须核对「tag ↔ Release」对得上

**tag 推上去不等于发布成功。** 实测发生过：`v1.3.5` 的 tag 已推送、CHANGELOG 也写了，
但 `Build & Release` 运行在 3 分钟后**被取消**，于是没有对应的 GitHub Release，
自动更新通道（`/releases/latest`）仍指向 v1.3.4 —— 该版本的修复**到不了任何用户手里**。
这种失败没有任何提示：tag 在、CHANGELOG 在、`package.json` 也在，
只有 Release 页面少了一条，而那是最不容易被注意到的位置。

- `pnpm verify:release`（`scripts/verify-release.mjs`）：核对某个 tag 是否真有 Release、
  是否带着全部平台的 `latest*.yml`。`release.yml` 末尾会自检一次。
- `.github/workflows/release-audit.yml`：**独立于发布流程**的每日审计，
  只看结果（最新 tag ↔ Release 是否对得上），不一致就开一条带 `release-audit` 标签的 Issue。
- 本地开发时版本号与已发布版本一致是正常的；**不要为了让 `verify:release` 通过而提前升版本**。

### 未发布的改动记在 `[Unreleased]`

没有发布计划时，`package.json` 的版本号**保持在最近一次已发布的版本**，
CHANGELOG 用 `## [Unreleased]` 段落累积改动。发布时再一次性改成 `## [x.y.z] - 日期` 并升版本号。

---

## 容器镜像（Dockerfile 与 docker-compose.yml、入口脚本 docker/entrypoint.sh）

DownVid 在容器中采用**原生 WebUI 方案**运行：通过轻量 Node 服务（`docker/server/index.ts`）托管
前端静态页面与下载引擎，浏览器打开即可操作。用户指南在 `docs/docker.md`。

**前端零重写。** `src/` 中没有任何 Electron 专属导入，所有系统能力均通过全局 `window.electronAPI`
调用。在浏览器环境下，`docker/web/bridge.ts` 通过 WebSocket RPC 动态注入完全相同形状的 API 适配层，
现有 Vue 3 组件及 Pinia 状态管理 100% 同构复用。

**核心逻辑共享与架构隔离。** 下载引擎（`electron/download/`）、解析器及依赖管理核心由
`docker/server/electron-shim.ts` 适配层在无头环境下直接复用执行，桌面端代码（`electron/` 与 `src/`）
零侵入零修改。下载进度与依赖事件在容器版通过 WebSocket 实时推向浏览器。

**运行依赖预装镜像，版本取自清单。** yt-dlp / ffmpeg / ffprobe 三件静态二进制装到 `/usr/local/bin`
（在 Go 边车的系统候选路径内，启动后自动命中并标记为「系统安装」）。三者的**版本与 SHA-256 一律来自
`backend/internal/manifest/assets.gen.go`**，经 `scripts/deps-asset.mjs` 取出并在构建期校验：

- 镜像里的 ffmpeg 因此与桌面版用户点「下载」拿到的是**同一份字节**，编码器 / 合并行为一致；
- `pnpm deps:manifest` 升级清单后，镜像跟着升级，不需要改 Dockerfile；
- **禁止**在 Dockerfile 里手写版本号或哈希（`pnpm lint:docker` 会拦）。

选型上两处与直觉不同，都是量过的：yt-dlp 用 `yt-dlp_linux`（PyInstaller 独立包，**不需要 python3**）
而不是要解释器的 `yt-dlp` zipapp；ffmpeg 用 ffmpeg-static 的静态二进制而不是 `apt install ffmpeg`
（后者会拖进 libllvm15 109MB、libgl1-mesa-dri 23MB、libicu72 36MB 等一整串依赖，镜像多出 290MB）。

**服务端在构建期打成单文件。** `docker/server/vite.config.ts` 把 `docker/server/index.ts` 连同它 import
的 `electron/` 业务代码打成 `docker/dist-server/index.js`，运行期只有 `node` 直跑，**不需要 tsx、
不需要 node_modules**（省 37MB，冷启动也不再转译上百个模块）。SSR 构建默认把 dependencies 全部留成
external，所以配置里显式设了 `ssr.noExternal`；漏了它镜像能构建、容器起不来（`Cannot find package`）。

**容器版更新检查（`docker/server/update.ts`）。** 容器里进程跑在只读镜像层上，**任何自更新都会在下次
`docker run` 时消失**，所以 `app:checkForUpdates` 只回答「有没有新版本」并给出 `docker compose pull`
命令，`manual` 恒为 `true`；前端据此展示命令而不是「下载更新 / 重启安装」。升级方式只有拉镜像这一条，
`docs/docker.md` 与 compose 注释里都写明了这一点。**不要**把它改回 `{ hasUpdate: false }` 常量：
自托管用户一装几个月，yt-dlp 落后会随站点改版逐渐失效，没有提示时用户只会觉得「下载器坏了」。

**镜像发布到 GHCR（`ghcr.io/<owner>/downvid`）。** push 到 main 打 `:latest`，推 `v1.2.3` tag 打
`:1.2.3` 与 `:1.2`。GHCR 的包默认 **private**，首次发布后要手动改成 public，否则用户 `docker pull`
会拿到 denied / not found 混在一起的怪错误。工作流在推送后会用 `imagetools inspect` 核对两个平台都在、
并真跑一次 `yt-dlp --version`——「push 成功」不等于「用户拉得到」。

**数据持久化。** 容器内数据路径由环境变量决定：`DOWNVID_DATA_DIR` 指向 `/data/userdata`，
`DOWNVID_DOWNLOADS` 指向 `/data/downloads`。下载记录与落盘文件均跟随挂载卷持久化。

**镜像构建规范。** Linux 的路径分隔符与换行符必须遵循 POSIX 语义；`docker/entrypoint.sh`
必须保持 LF 换行（`.gitattributes` 保证）。构建产物及本地数据目录已通过 `.dockerignore` 隔离。

`.dockerignore` 里 `backend/build` 这一条**不能删**：宿主机开发的边车产物是宿主平台的（macOS 上就是
`darwin-*`），不排除会被 `COPY --from=build` 连带进 Linux 镜像（实测多出 34MB）。Dockerfile 只拷
`/out/<目标架构>` 那一个二进制。

`/data` 是宿主机 bind mount，属主由 NAS / 软路由决定。**不要在镜像里切到固定 uid**——那会让
「下载目录没有写权限」成为默认结果，而报错是 yt-dlp 的 EACCES，用户很难归因到自己挂载的属主上。
需要最小权限的部署在 compose 里用 `user:` 指定。

改了 Dockerfile / compose / entrypoint 之后，本地必须跑 `pnpm lint:docker` 与 `pnpm test:web`；
后者用的是**打包后的**服务端（与镜像里同一份），源码能跑不等于打包能跑。

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
