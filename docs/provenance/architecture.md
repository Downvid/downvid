# DownVid 目标架构

> 阶段二产物，对应 [issue #74](https://github.com/yxxbc/downvid/issues/74) §「二、制定 DownVid 自身的目标架构」。
>
> 这是**目标**，不是现状。现状与差距见 [代码来源审计](./audit.md)，
> 怎么一步步走过去见 [分阶段迁移计划](./migration-plan.md)。

相关文档：[代码来源审计](./audit.md) · [分阶段迁移](./migration-plan.md) · [发布质量与署名](./release-quality.md)

---

## 1. 一句话架构

**一个纯 Node 的核心（core），三个薄适配层（Electron / HTTP+WS / 浏览器），两种传输（IPC / WebSocket），一份契约。**

```
                    ┌──────────────────────────────────────────┐
                    │  core/  —— 纯 Node，不 import 'electron'   │
                    │  ────────────────────────────────────────  │
                    │  dep     依赖探测与下载（调 Go 边车）        │
                    │  parse   站点解析 → VideoInfo               │
                    │  fetch   两条下载路径 + 进度 + 暂停/续传      │
                    │  queue   并发闸门（上限 3）+ 状态机          │
                    │  store   历史 / 设置 / .part 检查点读写      │
                    │  update  更新检查（源降级链）                │
                    │  events  事件总线（发什么，不决定发给谁）      │
                    └──────────────────────────────────────────┘
                         ▲                 ▲                 ▲
              ports（注入）│        ports  │        ports  │
        ┌────────────────┴───┐ ┌───────────┴─────┐ ┌──────┴─────────────┐
        │ Electron 适配层      │ │ HTTP+WS 适配层   │ │ 浏览器适配层        │
        │ main.ts / ipc/*     │ │ docker/server/   │ │ docker/web/bridge  │
        │ preload → IPC       │ │ → WebSocket RPC  │ │ → 同形状 electronAPI│
        └────────────────────┘ └──────────────────┘ └────────────────────┘
                 ▲                      ▲                    ▲
                 └────────── src/ 渲染进程（Vue 3，同一份）───────┘
```

三端共用 `src/`（Vue 界面）与 `core/`（业务逻辑），差别只有**适配层**和**端口实现**。

---

## 2. 为什么是「分层 monorepo」而不是「core 独立包」

| 方案 | 收益 | 代价 | 结论 |
| --- | --- | --- | --- |
| **分层 monorepo**（选定） | 目录清晰、边界可用 lint 强制；改动可分批落地，每步都能跑现有 327 个用例 | 仍在一个仓库，靠静态校验维持边界 | ✅ |
| core 独立 npm 包 | 真正可发布 | 桌面打包要重新处理 workspace 依赖；每次改核心都要发版 | ✗ 过早 |
| 三端各自独立工程 | 彻底解耦 | 一次改动要改三处，与 issue §「避免重复实现业务逻辑」冲突 | ✗ |
| 只标注释不动目录 | 零风险 | 没有机械约束，边界三个月内必腐化 | ✗ 不够 |

关键判断：**这个项目的瓶颈不是仓库边界，是「静默失败」**。所以架构的价值在于
「违反边界时 CI 会红」——这也是本项目已有的做法（`lint:ipc` / `lint:i18n` / `audit:provenance`）。

---

## 3. 模块边界与端口（最核心的一节）

### 3.1 三类端口

core 只声明接口，由适配层注入。三端各自实现，桌面与容器不共享实现。

| 端口 | 接口 | Electron 实现 | 容器实现 |
| --- | --- | --- | --- |
| `DataDirs` | `{ userData: string; downloads: string; managedBin: string }` | `app.getPath('userData')` 等 | `DOWNVID_DATA_DIR` / `DOWNVID_DOWNLOADS` |
| `EventSink` | `(channel: string, payload: unknown) => void` | `BrowserWindow.getAllWindows()…send` | `wsEventBus` → WebSocket 广播 |
| `UserPrompt` | `confirm(opts) → boolean`、`openExternal(url)` | `dialog` / `shell` | 返回「不支持」的降级结果 |

这三类**正好覆盖审计 §6.2 里那 9 个 `app.getPath`、10 个广播点、2 个 `dialog` 调用**。
换掉它们之后，`electron/download/direct.ts`、`download/ytdlp.ts`、`utils/binary.ts`
就再没有理由 import `electron`（目前只是被同级模块拖进去的）。

### 3.2 边界规则（可由 lint 机械校验）

| 规则 | 理由 |
| --- | --- |
| `core/**` 不得 `import 'electron'` | 否则容器端又要 shim |
| `core/**` 不得 import `src/**`（前端） | 核心不能依赖界面 |
| `core/**` 不得 import `docker/**` | 核心不知道部署形态 |
| `src/**` 不得 import `docker/**` | 界面不知道部署形态 |
| `electron/**` 不得 import `docker/**` | 桌面端不能因为镜像改动而受影响（目前已是 0 处） |
| `docker/server/**` 只能 import `core/**`、`shared/**`、`node:*`、第三方 | 容器端不得直接依赖 Electron 适配层 |
| 任何 `import 'electron'` 只允许出现在 `electron/**` | 例外仅 `docker/server/electron-shim.ts`，且迁移完成后应删除 |

**当前状态**：这 7 条里有 2 条已经成立（`electron → docker` 为 0、`src → docker` 为 0），
其余 5 条需要迁移。校验脚本见 [迁移计划](./migration-plan.md) C0。

### 3.3 core 的模块清单与公共接口

只列**对外**的部分。所有函数都是纯 Node，可被容器与测试直接调用。

| 模块 | 公共接口（现状可直接搬） | 迁移难度 |
| --- | --- | --- |
| `core/dep` | `getRuntimeStatus()`、`downloadDeps()`、`cancelDownload()`、`cachedPathOf(kind)`、`resolveDependency(kind)` | 中（`runtime.ts` 只需换掉 `app.getPath`） |
| `core/parse` | `parseDouyin*` / `parseKuaishou*` / `parseWithYtdlp(url)`；`toVideoFormats()`；`[[parse-error:*]]` 标记 | 低（`parsers/douyin.ts`、`kuaishou.ts`、`formats.ts`、`shared.ts` 已是纯的；`parsers/ytdlp.ts` 只需抽走 `prompt*`） |
| `core/fetch` | `downloadDirectFile(params)`、`runYtdlpDownload(options, dir)`、`pauseDownload(taskId)`、`buildYtdlpArgs(options, dir, ctx)`、`throttledProgress()` | 低–中（见 §3.1） |
| `core/queue` | `MAX_CONCURRENT_DOWNLOADS = 3`、`selectStartableTasks()`、`pumpQueue()`、`statusAfterResult()`、`shouldRecordHistory()` | **中高**（目前在前端 `src/stores/download.ts`，见 §6） |
| `core/store` | `readSettings()/updateSettings()`（桌面）；`upsertHistory()`、`dedupeHistory()`（已是纯函数） | 中（见 §4.3） |
| `core/update` | `checkForUpdate(source)`、更新源降级链、`compareVersions()` | 低（`shared/update-*.ts` 已纯） |
| `core/events` | 事件名常量 + `EventSink` 注入点 | 低 |

---

## 4. 三个关键契约（改它们等于改所有端）

### 4.1 事件（主进程 → 界面）

现有 5 个广播事件必须保持**名字与载荷形状**不变，否则桌面端界面静默失效：

| 事件 | 载荷 | 发送点（现状） |
| --- | --- | --- |
| `download:progress` | 任务进度（含 `taskId`） | `electron/download/progress.ts` |
| `history:updated` | 历史记录数组 | `electron/ipc/history.ts` |
| `deps:progress` | 依赖下载进度 | `electron/ipc/deps.ts` |
| `update:status` | 更新状态机快照 | `electron/updater.ts` |
| `menu:showAbout` | 无 | `electron/menu.ts` |

另有 `menu:openSettings`（仅桌面，菜单触发）。

**约定**：广播事件**不得**同时也是 `ipcMain.handle` 通道（`lint:ipc` 已校验）。
core 侧只负责「发什么事」，谁发（窗口 / WebSocket）由 `EventSink` 决定。

### 4.2 IPC / RPC 契约

现状：桌面 **39** 个 `ipcMain.handle` 通道，容器 **40** 个 RPC 方法，**39 个同名**，
容器独有 `app:containerInfo`。`docker/web/bridge.ts` 在浏览器里复刻同形状的 `window.electronAPI`。

目标：**一份契约表**（`shared/ipc-contract.ts`）作为唯一来源，记录
`通道名 → 参数 → 返回 → 各端实现状态`。桌面 `preload.ts`、容器 `docker/server`、
`src/env.d.ts` 三处从它派生或与它比对。

> 现在这四处是**手工同步**的：`lint:ipc` 只比对桌面三处，**不比对容器端**。
> 桌面新增一个通道而容器端没加，不会报错，容器用户点下去没反应。

### 4.3 设置与状态的存储位置（移动端会逼出这个问题）

| 数据 | 现在存在哪 | 多端目标 | 迁移注意 |
| --- | --- | --- | --- |
| 用户设置（13 个字段，见下） | `localStorage['settings']`（**不在 Pinia**） | 桌面保留 `localStorage`；容器与移动端需要能落到服务端 | 删除/重命名字段属 MAJOR |
| 下载历史 | 桌面 `userData/download-history.json`，容器 `DOWNVID_DATA_DIR` | 不变 | 已有 `fileExists` 语义 |
| 下载检查点 | `.part` + `.part.json`（在输出目录） | 不变 | 兼容旧四段布局 |
| Cookie | `userData/cookies/` | 不变 | 不接管用户系统 Cookie |

设置字段（`AppSettings`，13 个）：`downloadDir`、`filenameTemplate`、`preferredQuality`、
`cookieMode`、`cookiesFile`、`proxy`、`depPaths`、`acceleration`、`depMirror`、
`autoCheckUpdate`、`autoDownloadUpdate`、`updateSource`、`language`。

**入口唯一**：`src/stores/settings.ts` 的 `readSettings()` / `updateSettings(patch)`。
`pnpm test:settings:migration` 会静态扫描「不许绕过入口」。

### 4.4 错误约定

既有的两类标记必须保留（它们是跨层协议，改一侧就静默失效）：

- `[[deps-missing:<kind>]]` — `electron/utils/binary.ts` 产生，`src/stores/deps.ts` 的
  `readMissingKinds` 解析 → 界面弹「一键下载」。
- `[[parse-error:<code>]]` — 解析器产生，`shared/parse-error.ts` 归一化 → 界面给可操作提示。

新增错误种类时**两侧同时改**，`tests/deps-error.test.ts` / `tests/parse-error.test.ts` 已有用例钉住。

---

## 5. 各端职责（明确「不做什么」）

| 端 | 必须做 | **不做**（写进文档以防被顺手加进来） |
| --- | --- | --- |
| **桌面**（Win/macOS/Linux） | 打包与签名、自动更新（electron-updater）、系统托盘/菜单、原生文件对话框、系统代理与会话 | 不依赖 Docker 或任何服务端；不因为容器功能改主进程行为；不引入只在 Web 端存在的抽象 |
| **容器**（Docker 自托管） | 单容器、单进程；数据目录持久化；`/healthz`；镜像升级路径（`docker compose pull`）；**可选**的访问边界 | 不做多租户、不做账号系统（访问控制交给前置反向代理）；不做容器内自更新；不要求 K8s / 多容器 |
| **移动端** | 手机屏幕可用（断点、触摸目标、抽屉式队列）；可添加到主屏幕；离线壳 | 第一阶段**不做**原生 App；不复制业务逻辑到另一次实现 |

「桌面端零反向依赖」是硬约束：`electron/**` 与 `src/**` **不得** import `docker/**`。当前已成立，要写进 lint。

---

## 6. 已知的架构缺口（必须在迁移中解决，不是「顺手优化」）

| # | 缺口 | 后果 | 归属 |
| --- | --- | --- | --- |
| G1 | `electron/download/{direct,ytdlp}.ts`、`utils/binary.ts` 本身不用 Electron，却被 `progress.ts`/`store.ts`/`runtime.ts` 拖进去 | 容器端必须带 shim；shim 漏 API 时只有容器炸 | core 端口化 |
| G2 | 并发闸门（上限 3、`pumpQueue`）在**前端** `src/stores/download.ts`，容器端 WebUI 只有单任务限制（`isDownloading()`） | 桌面与容器的并发语义不一致；关掉浏览器标签页后队列不再补位 | `core/queue` |
| G3 | 容器端 RPC 与桌面 IPC 手工对齐，无静态校验 | 桌面新增通道 → 容器静默缺功能 | `shared/ipc-contract.ts` |
| G4 | 设置只在 `localStorage` | 手机换浏览器 / 清缓存即丢设置；容器内多设备不共享 | 服务端设置存储（可选） |
| G5 | 界面无响应式（`w-[65%]` / `w-[45%]`、`minWidth: 1000`、1 处断点类） | 手机不可用 | `src/` 断点改造 |
| G6 | `electron/parsers/{douyin,kuaishou}.ts` 有 54%/68% 上游成分 | 上游 bug 会随代码一起被继承；改动时误以为是自研 | 见迁移计划 P2 |
| G7 | `docker/server/index.ts` 单文件 524 行，混合 HTTP 服务 / RPC 分发 / 历史读写 / 依赖设置清洗 | 无法单测，改动风险集中在一个文件 | 拆为 `http/` + `rpc/` + `store/` |

---

## 7. 依赖策略（「自研」不等于重造）

以下**明确作为外部依赖**，不重新实现：

| 能力 | 采用的依赖 | 为什么不自研 |
| --- | --- | --- |
| 站点解析 | `yt-dlp` + 自写适配 | 上千站点，重写不可能跟上 |
| 音视频合并 | `ffmpeg` / `ffprobe` | 同上 |
| 分块加速 | 可选 `aria2c` | 已有成熟实现，自研只会更差 |
| 无头浏览器兜底 | `puppeteer-core` + 系统 Chrome | 自研浏览器不现实；不打包 Chromium 是为体积 |
| 桌面运行时 | Electron | 换 Tauri 需重写全部主进程与打包链路，收益不足以支撑 |
| 界面 | Vue 3 + Tailwind v4 + Pinia | 已足够轻（前端产物 1.0 MB）；不引入 UI 组件库/路由/状态中间件 |
| WebSocket | `ws` | Node 无内建 WS 服务端 |
| 更新 | `electron-updater`（桌面） | 签名校验、差分与各安装方式分支重写成本极高 |

**引入新依赖的判定标准**（写进 `docs/standards.md` 的既有流程）：

1. 能否用现有依赖 + 50 行以内的代码解决？
2. 是否只在构建期使用（不进产物）？
3. 对 `dist/`（前端 1.0 MB）、`dist-electron/`（4.8 MB）、镜像（约 340 MB）各增加多少？
4. 是否有传染性许可？
5. 没有它，用户能感知到什么损失？

---

## 8. 部署形态与边界

| 形态 | 进程 | 端口 | 数据卷 | 访问边界 |
| --- | --- | --- | --- | --- |
| 桌面 | Electron 主进程 + 渲染进程 | 无 | `userData/` | 本机用户 |
| 容器 | 单个 Node 进程（`node dist-server/index.js`） | 6080（`DOWNVID_WEB_HOST` 默认 `127.0.0.1`，compose 内 `0.0.0.0`） | `./data/downloads`、`./data/userdata` | **无内置鉴权**：WebSocket 有 Origin 校验（防 CSWSH），公网暴露必须靠前置反代 + 认证 |
| 移动（PWA） | 浏览器 | 同容器 | 同容器 | 同容器 |

**安全边界不因加架构层而变**：容器版仍然是「个人自托管工具」，不做多租户。这一条已在
`docs/docker.md`「安全与访问控制」里写明，架构文档不重复承诺更强的能力。

---

## 9. 验收方式（对应 issue §「二」的每一条）

| issue 要求 | 本文落点 | 可机械验证 |
| --- | --- | --- |
| 编写简明的架构说明，明确模块边界、公开接口、错误处理、进度与事件约定、数据持久化、配置、各端职责 | §3、§4、§5 | 文档本身 + C0 边界 lint |
| 将界面与运行环境相关代码同可复用逻辑分离 | §3.1 端口表 | C0（`core/**` 禁 import electron） |
| 外部工具作为明确的依赖管理 | §7 | 依赖清单 `<->` manifest 校验已存在 |
| 定义稳定接口让三端复用核心能力 | §3.3 | C1/C2 迁移后容器端不再 import `electron/*` |
| 移动端先响应式 Web / PWA 还是原生 | §5（阶段一 PWA，不排原生） | M 系列真机验收 |
| 对主要框架/服务/依赖说明理由 | §7 | 本文 |

---

## 10. 术语

- **core**：纯 Node 的业务逻辑，不含任何 Electron/DOM/HTTP 依赖。
- **适配层**：把 core 的端口接到某个运行环境（Electron API / WebSocket / 浏览器）。
- **端口**：core 声明的接口，由适配层注入实现。
- **上游成分**：某文件归一化后逐字命中上游的行占比，口径见 [审计 §2](./audit.md#2-判定方法可复算也可被质疑)。
- **同构前端**：桌面与容器共用同一份 `src/`，通过形状等价的 `window.electronAPI` 抽象传输差异。
