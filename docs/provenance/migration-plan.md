# 分阶段迁移计划

> 阶段三产物，对应 [issue #74](https://github.com/yxxbc/downvid/issues/74) §「三、分阶段迁移，并逐步验证」。
>
> 每一条都写成**可直接开的 PR**：有范围、有验收、有回归测试、有回滚方式。
> 前置阅读：[代码来源审计](./audit.md)（现状）· [目标架构](./architecture.md)（终点）。

---

## 0. 三条纪律

1. **不做一次性整体重写。** 每个 PR 独立可合并、独立可回滚、独立跑绿全量验证。
2. **行为一致性先证明，再删旧实现。** 新模块先与旧实现并存，用「同一输入 → 同一输出」的用例钉住，
   然后才切调用点。
3. **每一步都要让容器端和桌面端同时绿。** 现有 `pnpm test`（327 用例）+ 9 个集成 / 回归脚本
   + `lint:ipc` / `lint:docker` / `test:web` 是这条纪律的执行机制。

### 每个 PR 都必须跑的验证

```bash
pnpm vue-tsc --noEmit
pnpm test
pnpm lint:ipc && pnpm lint:docs && pnpm lint:i18n && pnpm lint:docker && pnpm lint:workflows
pnpm lint:boundaries          # 本计划新增（C0 落地后）
pnpm audit:provenance         # 来源审计（已落地，见 docs/provenance/audit.md）
```

涉及下载 / 解析 / 依赖 / 更新 / 容器的改动再加跑对应集成回归（见 AGENTS.md「验证命令」）。

### 变异验证（硬要求）

新增的每条用例都要做一次「把被测逻辑改坏 → 确认用例失败」。不会失败的测试等于没有测试
（AGENTS.md §「关于测试」）。本计划里每个新模块的验收都包含这一条。

---

## 1. 阶段总览

| 阶段 | 代号 | 目标 | PR 数（估） | 风险 |
| --- | --- | --- | ---: | --- |
| P0 | **C0** | 建 `core/` 骨架 + 边界 lint，**不搬代码** | 1–2 | 极低 |
| P1 | **C1–C3** | 把「本来就不用 Electron」的模块正式搬进 core，容器端停用 shim | 3 | 低 |
| P2 | **C4–C6** | 端口化（数据目录 / 事件 / 用户提示），把 `direct`/`ytdlp`/`binary` 解耦 | 3 | 中 |
| P3 | **C7–C9** | 统一 IPC/RPC 契约、拆 `docker/server`、并发闸门下沉 | 3 | 中高 |
| P4 | **M1–M3** | 响应式界面 + PWA（移动端第一阶段） | 3 | 中（用户可见） |
| P5 | **P1–P4**（provenance） | 逐个重写上游成分最重的模块 | 4+ | 中 |
| P6 | **R1–R3** | 发布质量、打包产物验证、署名与合规收尾 | 3 | 低 |

放置顺序的理由：**先上机制（C0），再搬已经干净的代码（C1–C3），最后才动要重新设计的部分（C4 之后）**。
M 系列（用户可见的移动端）与 C 系列（内部解耦）**可以并行**，互不阻塞——这是本计划刻意设计的：
移动端是需求驱动，架构是债务驱动，两者不该排成一条串行链。

---

## P0 · 建立边界机制（先上闸门，再搬东西）

### C0 `core/` 骨架与边界校验

**范围**

- 新建 `core/` 目录，先只放一个 `core/README.md`（说明职责与三条禁令）和一个 `core/version.ts`
  （导出 `APP_VERSION` 之类的无害常量，用于让 lint 与 tsconfig 有东西可检查）。
- 新建 `scripts/lint-boundaries.mjs` + `pnpm lint:boundaries`，实现
  [架构 §3.2](./architecture.md#32-边界规则可由-lint-机械校验) 的 7 条规则：

  | # | 规则 | 当前是否已成立 |
  | --- | --- | --- |
  | 1 | `core/**` 不得 `import 'electron'` | ✅（空目录，天然成立） |
  | 2 | `core/**` 不得 import `src/**`、`docker/**`、`electron/**` | ✅ |
  | 3 | `src/**` 不得 import `docker/**` | ✅ 已成立 |
  | 4 | `src/**` 不得 import `electron/**`（类型除外，走 `env.d.ts` 内联 import） | 需查 |
  | 5 | `electron/**` 不得 import `docker/**` | ✅ 已成立（审计 §6.1） |
  | 6 | `docker/server/**` 只能 import `core/**`、`shared/**`、`node:*`、第三方 | ❌（现在 import 12 个 `electron/*`，**先设为 warning**） |
  | 7 | `import 'electron'` 只允许在 `electron/**`（例外：`docker/server/electron-shim.ts`） | ❌（先 warning） |

  **规则 6/7 必须先以 warning 形式上线**，否则 C0 一合并 CI 就红。脚本要支持
  《`--strict` 模式》，C3 完成后开启。

- 把 `core` 加进 `tsconfig.json` 的 `include`。
- 在 `.github/workflows/ci-{linux,macos,windows}.yml` 的 `frontend` job 里挂
  `pnpm lint:boundaries`（AGENTS.md 硬规则：新增校验必须挂三个平台）。
- `scripts/lint-docs.mjs` 的 `DOCS` 数组保持 `AGENTS.md`/`CLAUDE.md` 不变；本系列文档
  不加入 lint-docs（它们不是双语对照），只在 `README.md`/`README.zh-CN.md` 的文档索引里登记。

**验收**

- `pnpm lint:boundaries` 在空 `core/` 上通过，并对 `docker/server/index.ts` 输出 12 条 warning。
- **变异验证**：在 `core/version.ts` 里加一行 `import { app } from 'electron'` → 脚本退出码 1；
  在 `electron/main.ts` 里加一行 `import './docker/server/index'` → 退出码 1。
- 三个 CI 工作流都出现该步骤。

**回滚**：删除脚本与 CI 步骤，无生产代码改动。

---

## P1 · 搬走已经干净的模块（零行为变化）

判据来自审计 §6.2：**18 个文件**传递依赖不到 `electron`，它们就是现成的 core。

### C1 `core/shared`（原 `shared/`）

`shared/app.ts`、`acceleration.ts`、`parse-error.ts`、`update-check.ts`、`update-sources.ts`
共 772 行，**完全没有 Electron 或 DOM 依赖**，是纯逻辑。

- 搬到 `core/`，`shared/` 保留转发层（`export * from '../core/...'`）一个版本周期，
  避免一次改动 40+ 处 import。
- `shared/app.ts` 是仓库坐标与外部链接的**唯一来源**，被 `electron/constants.ts`、
  `website/index.html` 的脚本、`scripts/lint-ipc.mjs`、`scripts/lint-website.mjs`、`tests/app-links.test.ts`
  共同引用。**搬运必须同步这 5 处**，否则会出现「网站链接和桌面不一致」这类静默失败。

**验收**：`tests/app-links.test.ts`、`update-sources.test.ts`、`deps-mirror.test.ts`、
`parse-error.test.ts`、`website-download.test.ts` 全绿；`lint:website` 与 `lint:ipc` 仍通过。

### C2 `core/parse`（`electron/parsers` 中已纯净的部分）

`parsers/{douyin,kuaishou,formats,shared,youtube-retry}.ts` —— 5 个文件，全部不依赖 Electron
（`douyin`/`kuaishou` 依赖 `puppeteer-core` 与系统 Chrome 探测 `utils/browser.ts`，两者都是纯 Node）。

- 搬到 `core/parse/`。`electron/parsers/` 保留转发。
- **注意**：`parsers/ytdlp.ts` **不搬**——它尾部有 `dialog`/`shell` 的两个 `prompt*` 函数
  （`promptNodeDownload` / `promptChromeDownload`），留到 C4 端口化时拆开。

**回归**：`pnpm test:parse:integration`（覆盖回退链、轮次上限、Cookie 生命周期）必须与改动前**逐字同输出**。
`tests/formats.test.ts`、`parsers-shared.test.ts` 全绿。

### C3 `core/fetch` 与 `core/dep` 的纯净部分 + 容器端停用 shim（第一阶段）

- `electron/download/process-tree.ts`（132 行，杀进程树）、`direct-state.ts`（分段与检查点）、
  `aria2-progress.ts`、`electron/history.ts`、`utils/platform.ts`、`utils/js-runtime.ts` 搬进 core。
- `docker/server/index.ts` 改为从 `core/*` + `shared/*` 直接 import 这 6 个模块的对应内容
  （`history`、`platform` 已经能替掉 2/12 条 `electron/*` import）。

**验收**：`docker/server` 对 `electron/*` 的 import 从 12 条降到 10 条；
`pnpm test:web` 全绿；`pnpm typecheck:docker` 通过。

**为什么先做这一步**：它证明「core 目录 + 转发层」这条路走得通，而改动量小到可以一眼看完 diff。
先在小改动上验证方法，再动大模块。

---

## P2 · 端口化（真正解耦的开始）

### C4 `DataDirs` 端口：干掉 9 处 `app.getPath('userData')`

现状：`app.getPath` 出现在 `main.ts`、`utils/runtime.ts`、`utils/cookies.ts`、`updater.ts`、
`download/aria2.ts`、`ipc/history.ts`、`ipc/system.ts`（共 9 处）。

- 定义 `core/ports.ts`：`interface DataDirs { userData, downloads, managedBin }`。
- core 各模块改为**接收** `DataDirs`（或从一个模块级 `configurePorts()` 注入，与
  `buildYtdlpArgs` 接收 `BuildArgsContext` 的既有风格一致）。
- 桌面侧在 `electron/main.ts` 启动时注入 `app.getPath('userData')`；
  容器侧注入 `DOWNVID_DATA_DIR`。

**验收**：`grep -rn "app.getPath" electron` 只剩 `main.ts` 一处；
`pnpm test:download:integration`、`test:settings:migration` 全绿；
容器端 `getManagedDir()` 与桌面端返回同形状路径（在 `test:web` 里断言）。

### C5 `EventSink` 端口：干掉 10 处广播

现状：`store.ts` 的 `broadcast`/`sendToRenderer`、`download/progress.ts`、
`ipc/history.ts`、`ipc/deps.ts`、`updater.ts` 直接操作 `webContents`。

- core 侧只调 `sink.emit('download:progress', payload)`。
- 桌面实现 = 现有 `broadcast()`；容器实现 = `wsEventBus.emit()`（`electron-shim.ts` 里已有等价物）。
- **事件名与载荷形状一个字节都不许变**（[架构 §4.1](./architecture.md#41-事件主进程--界面)），
  否则界面静默失效且没有报错。

**验收**：`pnpm test:download:integration`（含进度）与 `pnpm test:web` 全绿；
`docker/server/electron-shim.ts` 删掉 `BrowserWindow` 那一段（约 20 行）。

### C6 `UserPrompt` 端口：让 `direct`/`ytdlp`/`binary` 彻底脱离 Electron

- `core/parse/ytdlp.ts` 的 `promptNodeDownload` / `promptChromeDownload` 改为通过
  `UserPrompt` 端口调用；桌面实现用 `dialog` + `shell`，容器实现返回「不支持」（并在界面提示去装 Chrome/Node）。
- `electron/store.ts` 的 `activeDownloads`（`Map<string, any>`）搬进 `core/fetch/active.ts`。

**验收**（这是 P2 的核心指标）：`docker/server/index.ts` 对 `electron/*` 的 import 降到 **0 条**；
**把 `pnpm lint:boundaries --strict` 打开后全绿**。
`pnpm test:process-tree`、`ytdlp-args`、`aria2-progress`、`download-state` 全绿。

> C6 完成后，`docker/server/electron-shim.ts`（132 行）与 `docker/server/vite.config.ts` 的
> `electron` 别名、`docker/server/tsconfig.json` 的 `paths` 三处可以**一起删除**——
> 「漏一处就 `Cannot find package 'electron'`」这个坑随之消失。

---

## P3 · 契约与编排

### C7 统一 IPC/RPC 契约：`shared/ipc-contract.ts`

现状（审计 §6.4）：桌面 39 个通道、容器 40 个，**39 个同名**但**没有任何静态校验保证一致**。

- 定义契约表：`channel → { args, result, events?, availableOn: ('desktop'|'container')[] }`。
- `scripts/lint-ipc.mjs` 增加第三/第四个比对对象：`docker/server/index.ts` 的 RPC 表
  与 `docker/web/bridge.ts`。
- 容器独有通道（`app:containerInfo`）在契约里显式标 `availableOn: ['container']`。

**验收**：故意删掉容器端一个通道 → `lint:ipc` 报错；
故意加一个桌面通道但不同步容器 → `lint:ipc` 报错（这是当前**最大的静默失败点**）。

### C8 拆 `docker/server/index.ts`（524 行 → 4 个文件）

拆成 `docker/server/http.ts`（静态服务 + `/healthz`）、`rpc.ts`（通道分发）、
`store.ts`（历史 / 日志 / 依赖设置清洗）、`index.ts`（接线）。

**验收**：`pnpm test:web` 覆盖的 HTTP + WS 全链路不变；
新增 `tests/web-rpc.test.ts` 覆盖「依赖设置清洗」与「历史读写」这两个纯逻辑部分
（目前它们在 `index.ts` 里，无法单测）。

### C9 并发闸门下沉（**风险最高的一项，单独 PR**）

现状（架构缺口 G2）：`MAX_CONCURRENT_DOWNLOADS = 3` 与 `pumpQueue()` 在**前端**
`src/stores/download.ts`；容器端只有 `isDownloading()` 的单任务限制。

- 目标：`core/queue` 持有队列规则（纯函数已在 `src/stores/download-rules.ts`），
  由**主进程 / 服务端**调度，前端只订阅状态。
- **为什么不能照搬**：桌面端关掉窗口/重载界面后，前端队列状态会丢失，但主进程的下载还在跑。
  现在靠 `activeDownloads` 兜；一旦队列下沉，需要明确「重启后队列怎么办」——
  与 AGENTS.md 既有的「无跨重启恢复」约定保持一致：**队列不跨重启恢复**，重启后未开始的
  任务回到 `pending` 由前端重新提交。
- 拆成两步：C9a 只把规则函数搬进 `core/queue`（零行为变化）；C9b 才改调度位置。

**验收**：`tests/download-state.test.ts`、`direct-state.test.ts` 全绿；
新增用例覆盖「3 个在跑 + 第 4 个进入 pending + 一个结束后自动补位」；
`pnpm test:download:integration` 与 `pnpm test:web` 全绿。

**回滚**：C9b 可单独 revert，C9a 保留。

---

## P4 · 移动端第一阶段（与 P0–P3 并行）

目标形态按 issue §「二」定调：**响应式 Web + PWA**，不做原生。

### M1 响应式骨架

现状：`src/` 下断点类只有 **1 处**（`AboutView.vue` 的 `sm:grid-cols-3`）；`DownloadView` 写死
`w-[65%]`、`DownloadQueue` 写死 `w-[45%]`；桌面窗口 `minWidth: 1000`。

- 断点：`< 768px` 单列（队列改为抽屉 / 底部面板）、`768–1024px` 两列紧凑、`≥ 1024px` 保持现状。
- 触摸目标 ≥ 44px；去掉所有 `w-[65%]` / `w-[45%]` 固定宽度，改 flex/grid。
- 桌面端 `minWidth: 1000` **保持不变**（桌面体验不该被移动端改造拉低）。

**验收**：在真机（或 DevTools 设备模拟）上跑一遍完整流程：粘贴 → 解析 → 选清晰度 → 下载 →
暂停/继续 → 历史。`pnpm lint:icons` / `lint:i18n` 全绿（新增文案必须走 `t()`）。

### M2 PWA 壳（可选但建议）

- `manifest.webmanifest` + service worker（仅缓存壳，**不缓存下载内容**）。
- 明确不做的：推送通知、后台同步、离线下载（这些要服务端配合，见 P4-M3 的可选性）。

### M3 设置的服务端存储（**可选，需单独评估**）

现状缺口 G4：设置只在 `localStorage`。手机换浏览器或清缓存即丢。若要支持「多设备共享设置」，
需要新增服务端设置读写 API —— 这是 `AppSettings` 形状的扩展，按 `docs/release.md`
的版本语义属 **MINOR**（新增接口，不删字段）。**默认不做**，先在 M1/M2 后收集真实需求。

---

## P5 · 逐个重写上游成分最重的模块

依据审计 §4.1。原则：**不是「为了降低百分比」，而是这些文件里混着上游的坑**。

| PR | 目标文件 | 上游成分 | 做什么 | 为什么值得做 |
| --- | --- | ---: | --- | --- |
| P1 | `electron/parsers/kuaishou.ts` | 67.6% | 按当前接口重写，保留行为 | 429 行里有 150 行来自上游 2756 行的单文件；上游的边界处理从未被独立审查过 |
| P2 | `electron/parsers/douyin.ts` | 53.6% | 同上 | 同上 |
| P3 | `src/components/{VideoInfoCard,UrlInput,FormatSelector,DownloadQueue,Header,HistoryView}.vue` | 40–77% | 随 M1 的响应式改造顺手重写 | 一次改动解决两个问题（移动端 + 上游残留） |
| P4 | `src/types/index.ts`（94.1%）与 `src/env.d.ts`（36.4%） | — | 从 `shared/ipc-contract.ts`（C7）与 `core` 类型派生 | 这两份是**类型的唯一来源**，手工同步必然漂移 |

**验收**：`pnpm audit:provenance` 会要求 `--write` 重算；**登记表的变化必须出现在 PR diff 里**，
并在 PR 描述里说明「这个文件的上游成分从 X% 降到 Y%，行为一致性由哪些用例保证」。

> 这是本计划里唯一「数字会下降」的阶段，也是唯一需要谨慎写 PR 描述的阶段：
> 降低百分比本身不是目标，**能说清「上游代码在这里留下了什么问题、重写后怎么证明没变坏」**才是。

---

## P6 · 发布质量与署名收尾

见 [发布质量与署名](./release-quality.md)。三件事：打包产物验证、真机矩阵、署名与合规收尾。

---

## 2. 依赖关系图

```
C0 ─┬─► C1 ──► C2 ──► C3 ──► C4 ──► C5 ──► C6 ──► C7 ──► C8 ──► C9b
    │                                    │                   ▲
    └────────────────────────────────────┴──► C9a ───────────┘

M1 ──► M2 ──► (M3 可选)
 └────────────► P3（Vue 重写与响应式一起做）

P1, P2（解析器重写）依赖 C2；P4（类型派生）依赖 C7。
```

- **可并行**：M 系列与 C 系列；P1/P2 与 C4–C6。
- **必须串行**：C4 → C5 → C6（同一个端口文件，同时改会冲突）；
  C7 必须在 C9b 之前（队列下沉会新增通道）。

---

## 3. 「行为一致性」怎么证明

每条迁移都不允许只说「我看了没问题」。三种可操作的手段：

1. **双实现比对**（新模块与旧实现并存一个版本周期）
   对纯函数直接写成用例：同一批输入 → 两边的输出必须 `toEqual`。
   适用：格式选择、参数组装、历史去重、版本比较、进度格式化。

2. **集成回归跑同一份夹具**
   `scripts/test-download-integration.mjs` / `test-parse-integration.mjs` / `test-web-server.mjs`
   用的是本地 HTTP 服务与真实文件，输出可比。迁移前后各跑一次，**日志逐行对比**。

3. **契约快照**
   IPC 通道名、事件名与载荷形状、`latest*.yml` 结构、产物名——这些是跨版本承诺，
   用快照用例锁住（`tests/ipc-payload.test.ts` 已有雏形）。

**反例（必须避免）**：「代码看起来一样」不算证明；「我手工点了一遍」不算证明（无法重复）。

---

## 4. 用户数据兼容

| 数据 | 迁移风险 | 处理 |
| --- | --- | --- |
| `localStorage['settings']`（13 字段） | 删/改名 → 老用户设置静默失效（MAJOR） | **只新增，不删除**；读取时用 `readSettings()` 兜默认值；`test:settings:migration` 覆盖 |
| `userData/download-history.json` | 形状变化 → 历史丢失 | `dedupeHistory` 已能容忍脏数据；不改字段名 |
| `.part` + `.part.json` 检查点 | 布局变化 → 暂停进度丢失 | 已兼容旧四段布局；新字段必须可选 |
| `userData/runtime/bin/` 托管依赖 | 路径变化 → 重新下载 80MB | 不改路径 |
| `.downvid-aria2/` 临时片段 | 位置变化 → 稀疏片段被顺序下载器误用 | 不改位置；同一任务固定引擎 |
| 容器 `./data/{downloads,userdata}` | 路径变化 → 用户数据「消失」 | 不改；env 变量名不变 |

**硬规则**：本计划**不包含任何 MAJOR 变更**。所有改动都是「新增 + 并存 + 转发」，
旧数据与旧设置始终可用。

---

## 5. 每个 PR 的模板

```markdown
## 做了什么
<一段话>

## 归属
- 阶段 / 代号：C4
- 对应 issue #74 的条目：二（模块边界）/ 三（分阶段迁移）

## 行为一致性证明
- 新增用例：tests/xxx.test.ts（N 条，含变异验证：把 X 改坏 → 用例失败）
- 集成回归：pnpm test:download:integration 输出与 main 一致

## 数据兼容
- 是否触碰 localStorage['settings'] / 历史 / .part：否

## 回滚
<一句话>
```

---

## 6. 进度追踪

本计划用 issue #74 的四个小节做看板 + 每个 PR 打 `migration/<代号>` 标签（如 `migration/C4`）。
不要在本文里维护勾选状态——文档里的勾选会在三次 PR 之后失效，
**GitHub 的 issue/PR 状态才是唯一真实来源**。
