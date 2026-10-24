# 开发者指南

面向**在本仓库改代码的人**：一份按「想改 X → 去读哪个文件」组织的代码导读。

本文档回答的是「代码长什么样、一次调用会流过哪些文件」，**不重复**另外两份：

| 想知道 | 去哪看 |
| --- | --- |
| 环境怎么搭、命令怎么跑、CI 怎么分 | [从源码构建](./build-from-source.md) · [AGENTS.md](../AGENTS.md) |
| 某处改动要同步哪几个文件（漏改会静默失败） | [仓库规范 · §5 改动落点清单](./standards.md#5-改动落点清单) |
| 提交、分支、Issue、评审约定 | [贡献指南](../CONTRIBUTING.md) · [仓库规范](./standards.md) |
| 目录树与每个目录的职责 | [项目结构](./project-structure.md) |

> 仓库里还有 `AGENTS.md`（中文速查）与 `CLAUDE.md`（英文对照版），它们是**给 AI 助手用的
> 同一份知识**，由 `pnpm lint:docs` 强制双向同步。本文档是给人读的纵深版本，不与那两份做逐字同步。

---

## 1. 先理解三件事

改代码之前，先接受这三个前提——项目里绝大多数「看起来奇怪」的写法都由它们解释。

### 1.1 安装包不携带 yt-dlp / ffmpeg

安装包只带一个 Go 边车（`downvid-deps`）。运行时由它去机器上**找**已经装好的 yt-dlp / ffmpeg / ffprobe，
找不到才下载到 `userData/runtime/bin/`。因此：

- 「下载失败」可能是依赖问题，不是下载链路问题
- 依赖的解析顺序（手动路径 → 托管目录 → 登录 shell 的 PATH → 常见安装目录 → 裸命令名）
  只写在 Go 侧，Electron 侧不得重复实现

### 1.2 两条下载路径完全独立

抖音/快手的解析器能拿到 CDN 直链，走 `direct.ts`（纯 `fetch` + 分段）；
其余站点走 `ytdlp.ts`（`spawn(yt-dlp)`）。两者的进度、暂停、续传机制各不相同，
**改动前先确认自己改的是哪一条**——它们的公共部分只有 `progress.ts`。

### 1.3 界面文案与设置都有「唯一入口」

- 文案：全部走 `t('key')`（`src/i18n/index.ts`），主进程的硬编码中文由
  `src/i18n/main-messages.ts` 按「原文 → 词条」兜底翻译
- 设置：`localStorage['settings']`，读必须 `readSettings()`、写必须 `updateSettings(patch)`

这两处都有静态校验（`lint:i18n` / `test:settings:migration`）拦漏改。

---

## 2. 模块地图

```
┌─ 渲染进程 src/ ────────────────┐   ┌─ 主进程 electron/ ──────────────┐
│ components/  视图与浮窗        │   │ main.ts      窗口 / 生命周期 / 日志│
│ stores/      Pinia + 纯逻辑规则│IPC│ ipc/         按域注册 ipcMain     │
│ i18n/        词条与 t()        │◄─►│ download/    两条下载实现         │
│ composables/ 错误弹窗 / 更新机 │   │ parsers/     平台解析 + 格式生成   │
└───────────────────────────────┘   │ utils/       依赖 / Cookie / 浏览器│
        ▲                           │ updater.ts   应用内更新            │
        │ preload.ts（contextBridge）│ store.ts     窗口引用 + 广播       │
        └───────────────────────────┴──────────────────────────────────┘
                                    │ spawn
                                    ▼
                       backend/   Go 边车 downvid-deps（detect / fetch）
```

| 区域 | 入口 | 职责 | 关键约束 |
| --- | --- | --- | --- |
| 主进程骨架 | `electron/main.ts` | 窗口、生命周期、日志、IPC 注册、启动预热 | `disable-gpu-sandbox` 不能删；日志是排障唯一途径 |
| IPC | `electron/ipc/{app,deps,download,history,system}.ts` | 只做「收参数 → 调实现 → 返回」 | 新增能力必须三处同步，见 §5.1 |
| 桥 | `electron/preload.ts` | `contextBridge` 暴露 `window.electronAPI` | 广播事件必须返回 unsubscribe 闭包 |
| 类型 | `src/env.d.ts` | `Window.electronAPI` 声明 | **不能有顶层 import/export** |
| 下载 | `electron/download/` | `direct.ts` / `ytdlp.ts` / `progress.ts` / `aria2.ts` | 进度格式化只在 `progress.ts` 定义 |
| 解析 | `electron/parsers/` | `douyin` / `kuaishou` / `ytdlp` / `formats` / `shared` | 每次失败都被空 catch 吞掉，最终落到 yt-dlp |
| 依赖 | `electron/utils/runtime.ts`、`binary.ts` | 跑边车、缓存探测、解析路径 | `resolveDependency()` 是唯一入口 |
| 更新 | `electron/updater.ts` | Windows/Linux 走 electron-updater；macOS 自实现替换 `.app` | 广播 `update:status` |
| 队列 | `src/stores/download.ts` + `download-rules.ts` | 任务状态、并发闸门、错误翻译 | 启动任务只能经 `pumpQueue()` |
| 设置 | `src/stores/settings.ts` | 读写与清洗 `localStorage['settings']` | 合并写入，不许整体覆盖 |
| 官网 | `website/index.html` + `styles.css` + `app.js` | 无构建落地页，Vercel 直接发布 | 无构建步骤，靠 `lint:website` 兜底 |

**跨进程共享的纯逻辑**放在 `shared/`（主进程与渲染进程都直接相对路径引用）：

| 文件 | 内容 | 为什么单独放 |
| --- | --- | --- |
| `shared/app.ts` | 仓库坐标、Releases / Issues 链接 | 主进程、preload、渲染进程与构建配置共用一份 |
| `shared/acceleration.ts` | 加速设置归一化、并发数推导 | 直链与 yt-dlp 两条路径共用 |
| `shared/parse-error.ts` | 解析错误分类、脱敏诊断、Issue 文案 | 主进程抛错、渲染进程展示、Issue 模板三处共用 |

---

## 3. 一次下载请求流过哪些文件

```
① 粘贴链接  src/components/UrlInput.vue → DownloadView.vue 的 handleParse()
              └─ readSettings() → cookiesFile（仅 manual 模式）/ proxy

② 解析      electronAPI.ytdlp.parse(url, cookiesFile, proxy)
            └─ electron/ipc/download.ts  'ytdlp:parse'
               ├─ 抖音：parsers/douyin.ts    API → puppeteer-core 兜底
               ├─ 快手：parsers/kuaishou.ts  API → puppeteer-core 兜底
               └─ 其余：parsers/ytdlp.ts     spawn yt-dlp --dump-json
                  ├─ utils/cookies.ts  getCookieAttempts / runWithCookies
                  ├─ utils/binary.ts   resolveDependency('yt-dlp')
                  ├─ parsers/youtube-retry.ts  YouTube 有限回退（最多三轮）
                  └─ parsers/formats.ts         info JSON → 界面格式列表
            ← VideoInfo{ formats, audioTracks, subtitles, audioFormats, cacheFile }

③ 选格式    src/components/FormatSelector.vue 触发
            store.selectVideoFormat / selectAudioFormat / selectAudioTrack / selectSubtitle

④ 入队      store.startDownload()  →  downloadTasks.unshift({ status:'pending' })
            └─ pumpQueue()  ← 并发闸门的唯一执行点（download-rules.ts）

⑤ 执行      store.executeDownload(task)
            ├─ 订阅 download:progress（卸载 / 结束时 unsubscribe）
            ├─ toPlainData(downloadOptions)   ← Proxy 不能过 structured clone
            └─ electronAPI.ytdlp.download(options)
               └─ electron/ipc/download.ts  'ytdlp:download'
                  ├─ options.directUrl ? download/direct.ts  :  download/ytdlp.ts
                  └─ download/progress.ts  节流广播（每 taskId 200ms）

⑥ 落盘      直链：<name>.part + <name>.part.json（逐段检查点）→ rename
            yt-dlp：--print after_move 给出最终路径，随后清理 .part/.ytdl

⑦ 收尾      历史写入 store.executeDownload → history:add（仅真正拿到文件时）
            进度事件 status='completed' → 任务状态置 completed → pumpQueue() 补位
```

### 几个容易踩的点

- **解析失败是不可见的**：`ytdlp:parse` 里抖音/快手的每个分支都被空 `catch` 吞掉。
  调试解析问题时先确认**哪个分支实际运行了**，别对着 `parseWithYtdlp` 调半天。
- **暂停不是「取消」**：`ytdlp:pauseDownload` 杀子进程（Windows 额外 `taskkill /T /F`），
  任务从 `activeDownloads` 移除；恢复 = 重新 spawn，从 `.part` 续传。**没有跨重启恢复。**
- **暂停后必须忽略 `completed` 事件**：kill 时可能残留一条结束事件，
  照单全收会把任务标成已完成（`shouldIgnoreProgress` 就是为这个 bug 写的）。
- **`toPlainData` 不能省**：Vue 的 reactive/ref 是 Proxy，structured clone 会直接抛
  `An object could not be cloned`。逐字段展开漏过一次（`subtitles`），所以整体深拷贝。

---

## 4. IPC 契约

### 4.1 调用通道（渲染进程 → 主进程，`ipcMain.handle` ↔ `ipcRenderer.invoke`）

`pnpm lint:ipc` 会双向比对主进程注册、preload 暴露与 `src/env.d.ts` 声明三处。
当前共 **39 个调用通道 / 6 个广播事件 / 16 个 API 分组**。

| 分组 | 通道 | 实现文件 |
| --- | --- | --- |
| `clipboard` | `clipboard:readText`、`clipboard:writeText` | `electron/ipc/system.ts` |
| `dialog` | `dialog:selectFolder`、`dialog:selectFile` | `electron/ipc/system.ts` |
| `app` | `app:getVersion`、`app:getDefaultDownloadDir`、`app:getHomeDir`、`app:cookieStatus`、`app:fetchImage`、`app:getLog`、`app:clearLog`、`app:openLogDir`、`app:setProxy`、`app:testProxy`、`app:getDiskSpace` | `electron/ipc/system.ts`（`getVersion` 在 `electron/ipc/app.ts`） |
| `app`（更新） | `app:checkForUpdates`、`app:setUpdatePrefs`、`app:downloadUpdate`、`app:installUpdate` | `electron/ipc/app.ts` → `electron/updater.ts` |
| `shell` | `shell:openPath`、`shell:showItemInFolder`、`shell:openExternal` | `electron/ipc/system.ts` |
| `ytdlp` | `ytdlp:parse`、`ytdlp:download`、`ytdlp:pauseDownload`、`ytdlp:accelerationStatus` | `electron/ipc/download.ts` |
| `deps` | `deps:status`、`deps:check`、`deps:download`、`deps:cancel`、`deps:openDir`、`deps:diagnostics` | `electron/ipc/deps.ts` |
| `history` | `history:get`、`history:add`、`history:delete` | `electron/ipc/history.ts` |
| `window` | `window:minimize`、`window:maximize`、`window:close`、`window:isMaximized` | `electron/ipc/system.ts` |

**返回值约定**：`deps:*` 与部分 `app:*` 返回 `{ success, error? }` 形状而不是抛错
（它们的失败是预期内的）；`ytdlp:*` 与 `history:add` 直接抛，渲染进程用 `try/catch` 接。

### 4.2 广播事件（主进程 → 渲染进程）

| 事件 | 发送点 | 载荷 | 订阅方 |
| --- | --- | --- | --- |
| `download:progress` | `electron/download/progress.ts` | `{ taskId, percent, status, speed, eta, ... }` | `src/stores/download.ts` |
| `deps:progress` | `electron/ipc/deps.ts` | `DepsProgress`（`start` / `progress` / `retry` / `installed` / `warn` / `error`） | `src/stores/deps.ts` |
| `history:updated` | `electron/ipc/history.ts` | 完整历史数组（含 `fileExists`） | `src/components/HistoryView.vue` |
| `update:status` | `electron/updater.ts` | 更新状态机事件 | `src/composables/useUpdater.ts` 与 `src/App.vue` |
| `menu:showAbout` | `electron/menu.ts` | 无 | `src/App.vue` |
| `menu:openSettings` | `electron/menu.ts` | 无 | `src/App.vue` |

- 事件名里的 `:` 是**真实字符**，别写成空格
- 广播事件**不得**同时作为 `ipcMain.handle` 通道（`lint:ipc` 会报）
- 订阅方必须在卸载时调用 preload 返回的 unsubscribe 闭包，否则热重载会累积监听

### 4.3 渲染进程内部的跨组件通信

没有路由：`App.vue` 用 `v-show` 切换视图，跨组件导航走 `window` CustomEvent。

| 事件 | 发送方 | 接收方 | 用途 |
| --- | --- | --- | --- |
| `tab-changed` | `src/App.vue` | `DownloadView.vue`、`HistoryView.vue` | 切标签后刷新（历史重新读文件是否还在） |
| `navigate-to-settings` | `UrlInput.vue`、`CookieGuide.vue` | `src/App.vue` | 打开设置浮窗 |

---

## 5. 常见改动怎么做

### 5.1 新增一个渲染进程能调用的能力

三处必须同步（`lint:ipc` 双向比对，漏改会静默失败）：

| # | 文件 | 改动 |
| --- | --- | --- |
| 1 | `electron/ipc/<domain>.ts` | `ipcMain.handle('域:动作', ...)`，并在 `electron/main.ts` 里注册（新文件才需要） |
| 2 | `electron/preload.ts` | 在对应分组下加 `ipcRenderer.invoke` |
| 3 | `src/env.d.ts` | 补类型；**不能引入顶层 import/export**，依赖类型用内联 `import('./types/deps')` |

若它是「主进程主动通知」，则改四处：发送点、preload 的 `ipcRenderer.on` + unsubscribe 闭包、
`src/env.d.ts`、订阅方的卸载清理。

### 5.2 新增一个设置项

1. `src/stores/settings.ts`：加进 `AppSettings` 与 `DEFAULT_SETTINGS`；
   若值可能来自旧数据或未来版本，再加一个 `normalizeXxx()` 清洗函数
2. `src/components/SettingsView.vue`（或 `DepPanel.vue`）：写必须走 `updateSettings({ ... })`
3. `scripts/test-settings-migration.mjs`：补一条「老数据没有该字段时被补齐」的用例
4. 文档：`README.md` 的 FAQ / `docs/faq.md` 视情况补

**删除或重命名字段属于 MAJOR 变更**（老用户设置静默失效），见[发布流程](./release.md#版本语义)。

### 5.3 新增一个平台解析器

1. `electron/parsers/<site>.ts`：导出 `parseXxxWithAPI` 与 `parseXxxWithPuppeteer`
2. `electron/ipc/download.ts` 的 `ytdlp:parse`：加一条分发分支，**保留空 catch 兜底到 yt-dlp**
3. `electron/utils/platform.ts`：加 `isXxxUrl()`
4. `src/stores/download.ts` 的 `executeDownload`：如果该平台返回 `directUrl`，
   加入 `useDirectDownload` 的判断（否则会走 yt-dlp 二次请求平台接口）
5. 若平台需要 Cookie：`electron/parsers/shared.ts` 里补域名列表

### 5.4 改 yt-dlp 参数

只改 `electron/download/ytdlp.ts` 的 `buildYtdlpArgs`。它是**纯函数**：
依赖路径与 JS 运行时由调用方解析后经 `BuildArgsContext` 传入，因此可以不起进程直接断言参数列表。

```bash
pnpm test tests/ytdlp-args.test.ts
```

新增参数请同时在 `tests/ytdlp-args.test.ts` 留一个用例——那里每个断言都对应过一次真实事故
（`--ffmpeg-location` 传目录而非文件、`--http-chunk-size` 的 30 倍提速、字幕模式不传 ffmpeg 等）。

### 5.5 改运行依赖（新增种类 / 换下载源 / 加平台）

见[仓库规范 · §5](./standards.md#改运行依赖yt-dlp--ffmpeg--ffprobe)与 [AGENTS.md](../AGENTS.md) 的
「运行依赖」一节。三条硬规则：

- **改下载源或版本**只改 `scripts/gen-deps-manifest.mjs` 的资产表，然后 `pnpm deps:manifest`；
  `backend/internal/manifest/assets.gen.go` 是生成文件，**不要手改**
- **新增平台**要同时改：清单资产表 + `electron-builder.json5` + `release.yml` 构建矩阵
- Go 侧车**只用标准库**——它要交叉编译成 5 个平台打进安装包，可审计性优先

### 5.6 改界面文案

1. `src/i18n/index.ts`：**同时**补 `zh-CN` 与 `en-US`，占位符集合必须一致
2. 组件里用 `t('key')`；需要常量时用 `computed(() => t('...'))`，**不能在模块顶层调用**
3. 列表项用 `get label()`，不要提前算好存进数组

例外：**协议标记不要翻译**（翻译了匹配就失效）——`未找到可用的`、`需要登录`、`\n\n提示：`、`更新内容`。

```bash
pnpm lint:i18n   # 键双向一致 / 占位符一致 / t() 键真实存在 / src 下无硬编码中文
```

### 5.7 改下载队列行为

规则集中在 `src/stores/download-rules.ts`（纯函数），`src/stores/download.ts` 引用同一份实现。
每个函数都对应过一次真实事故：

| 函数 | 它防的是什么 |
| --- | --- |
| `shouldIgnoreProgress` | 暂停后残留的 `completed` 事件把任务标成已完成 |
| `statusAfterResult` | 暂停被标成 100% |
| `shouldRecordHistory` | 暂停/失败也写历史 |
| `selectStartableTasks` | 连点「下载」突破并发上限，任务互相抢带宽 |
| `retryReset` | 重试后停在 `error` 不被调度，看起来毫无反应 |

改这里请跑 `pnpm test tests/download-state.test.ts`，并做一次**变异验证**：
把被测逻辑改坏，确认用例真的会失败。

### 5.8 加一位贡献者

三处记录同一批人，**没有一处会自动同步**：

| 位置 | 形态 | 由什么守着 |
| --- | --- | --- |
| `src/components/AboutView.vue` 的 `CONTRIBUTORS` | 界面上的固定名单（不请求 API） | `tests/about-contributors.test.ts` |
| `CHANGELOG.md` 的「致谢」段落 | 发布时记录谁修了什么 | 同上（名单必须覆盖被致谢的人） |
| `README.md` / `README.zh-CN.md` 的 contributors 徽章 | 指向 GitHub 的名单页，自动 | — |

加人时按这个顺序做：

1. 先确认这个 login 真的在仓库历史里留过署名（`git log --format='%an|%ae' | sort -u`）
2. 加进 `AboutView.vue` 的 `CONTRIBUTORS`（`role: 'CONTRIBUTOR'`）
3. 同步 `tests/about-contributors.test.ts` 的 `EXPECTED_LOGINS` 与 `HUMAN_IDENTITY_TOKENS`
   —— 快照刻意要手动改：**删掉一位贡献者也应当是一次显式决定**，而不是顺手改模板时被带走
4. 在 `CHANGELOG.md` 的 `[Unreleased]` 里用 `**[@login](https://github.com/login)**` 署名

机器人（dependabot / github-actions）与 AI 助手不列进界面名单：前者是自动化，
后者在 README 的致谢里单独说明。`tests/about-contributors.test.ts` 会拦住它们。

> 名单是手写的代价就是「漏人不会报错」——所以才有那份快照。别把快照删掉换成
> 只断言「非空」，那样删掉任何人测试都还是绿的。

### 5.9 发布新版本后刷新官网版本号

官网无构建，版本号占位在 `index.html` 中，只能是硬编码的（脚本拉到 `releases/latest`
会覆盖成真实 tag，拉不到就退回写死的值）。**不需要手动做**：`release.yml` 在 Release
创建成功并自检通过后会自动刷新并提交回 `main`。本地想核对时：

```bash
pnpm website:version --check   # 落后则退出码 1
pnpm website:version           # 用 package.json 的版本刷新
```

细节与「为什么放在发布之后」见[发布流程 · 官网版本号](./release.md#官网版本号为什么需要自动刷新)
与 `website/README.md`。

### 5.10 改外部链接 / 联系方式

`shared/app.ts` 是**唯一来源**：仓库坐标、Releases / Issues、官网域名、商务合作邮箱都在那里。
它同时被主进程、preload 与渲染进程引用，所以放在 `src/` 与 `electron/` 之外。

改一处要同步的落点：

| 常量 | 同步落点 | 谁守着 |
| --- | --- | --- |
| `APP.owner` / `APP.repo` | `electron-builder.json5` 的 `publish`、各 workflow、README 徽章 | `pnpm lint:ipc` |
| `WEBSITE_URL` | `website/README.md`、两个 README 的导航行 | `tests/app-links.test.ts` |
| `CONTACT_EMAIL` | 关于页、两个 README、官网的 `mailto:` | `pnpm lint:website` + `tests/app-links.test.ts` |

这几处**都不会因为写错而报错**：域名写错是 404、邮箱写错是信寄不到，都要等用户反馈才发现。
邮箱另有两个细节：`mailto:` 的主题必须 URL 编码（裸的空格与方括号会被邮件客户端截断），
官网的主题要随语言切换（`data-i18n-subject`），否则英文用户点开是一封中文主题的邮件。

---

## 6. 测试与校验矩阵

### 6.1 三层，各拦一类问题

| 层 | 命令 | 范围 | 特点 |
| --- | --- | --- | --- |
| 纯逻辑单测 | `pnpm test` | `tests/*.test.ts`（Vitest，`environment: 'node'`） | 只测纯函数，**刻意不引入 jsdom** |
| 静态契约校验 | `pnpm lint:*` | 跨文件一致性 | 拦「不报错但功能不生效」的漏改 |
| 集成回归 | `pnpm test:*` | 真实进程 / 真实文件 IO / 真实 HTTP | 用 `scripts/lib/` 的公共骨架 |

### 6.2 命令清单

```bash
# 类型与静态契约
pnpm vue-tsc --noEmit        # strict + noUnusedLocals + noUnusedParameters
pnpm lint:ipc                # IPC 三处同步 + env.d.ts 约束 + 产物命名 + 仓库坐标
pnpm lint:i18n               # 词条双向一致 + 占位符 + 无硬编码中文
pnpm lint:icons              # 图标名是否有效（写错会静默渲染成文字）
pnpm lint:website            # 官网多文件 / 引用资源 / 中英词条 / 配色 / 产物名模板
pnpm lint:docs               # AGENTS.md ↔ CLAUDE.md 一致 + 引用路径与数字真实存在
pnpm lint:workflows          # 工作流里「用了某工具」与「装了该工具」是否成对
pnpm deps:manifest:check     # 依赖清单是否落后上游

# 纯逻辑单测
pnpm test                    # 28 个文件 / 340 个用例
pnpm test tests/formats.test.ts   # 单文件
pnpm test:watch

# 集成回归（需要真实进程 / 网络 / 文件 IO）
pnpm test:download:integration   # 本地 HTTP 服务：分块、续传、429、检查点兼容
pnpm test:parse:integration      # 解析回退、轮次上限、Cookie 生命周期
pnpm test:acceleration           # 加速基准；外部引擎用环境变量指定路径
pnpm test:updater                # 更新状态机 / 缓存 / 兜底 / 各安装方式分支
pnpm test:settings:migration     # 设置默认值与合并写入 + 「不许绕过入口」静态扫描
pnpm test:issue:triage           # Issue 自动分类（用例取自仓库里真实出现过的 Issue）
pnpm test:package                # 打包产物内容校验（需先跑一次 --dir 打包）
pnpm test:runtime:windows        # Windows 原生 exe 运行依赖回归（需 Go）

# Go 侧车
cd backend && gofmt -l . && go vet ./... && go test -shuffle=on ./...
```

### 6.3 写测试的约定

- **只覆盖纯函数**。依赖 DOM 或需要真的起子进程的逻辑不写单测——那类问题靠类型检查、
  契约校验与真机验证来拦
- **针对曾经出过问题的分支各留一个用例**，不追覆盖率数字
- **写完必须做变异验证**：把被测逻辑改坏，确认用例会失败。不会失败的测试等于没有测试
- 需要读生产源码时用 `scripts/lib/load-source.mjs`（把 TS 转成 CJS 跑在 `vm` 里，
  并替换平台边界）；需要「起真实东西」时用 `scripts/lib/harness.mjs`
  （命名用例、失败不中断、`--filter <子串>` 只跑部分）
- 集成脚本的断言要**用 `path.join` 计算预期值**，不要写死 `/tmp/out/...`（Windows 上是反斜杠）
- 路径断言与 `\n` 处理在 Windows 上最容易翻车，参考 [仓库规范 · §5.1](./standards.md#51-跨平台构建的三个坑)

### 6.4 新增校验脚本必须挂进 CI

新增 `pnpm` 脚本后，要挂到 `.github/workflows/ci-linux.yml` / `ci-macos.yml` / `ci-windows.yml`
对应 job 上。历史上 `test:acceleration` 加了脚本却没接进 CI，加速逻辑长期没有自动化验证。

另外：**新增工作流文件时必须先 `git add`**——一次拆分工作流时旧文件的删除已 staged 而新文件
还是 untracked，一次 `git commit -a` 就会让 main 上不再有任何 CI（`lint:docs` 会校验文档提到的
工作流真实存在）。

---

## 7. 调试手段

### 7.1 主进程日志（最有用）

主进程日志写到 `userData/downvid.log`，设置页通过 `app:getLog` 读最后 500 行。

```bash
# macOS
tail -f ~/Library/Application\ Support/downvid/downvid.log
# Windows
Get-Content "$env:APPDATA\downvid\downvid.log" -Wait
# Linux
tail -f ~/.config/downvid/downvid.log
```

日志里带前缀，便于定位阶段：`[BOOT]` `[LIFECYCLE]` `[WINDOW]` `[PROXY]` `[DEPS]` `[FATAL]` `[ERROR]`。

### 7.2 依赖诊断

`deps:diagnostics` 返回边车位置、平台标识、托管目录，以及**每个依赖的版本 / 来源 / 路径**。
用户报「解析失败」时第一个要问的就是「你的 yt-dlp 是哪一版」——yt-dlp 的站点修复以周为单位发布。

界面上的入口是「设置 → 运行依赖」（`src/components/DepPanel.vue`）。

### 7.3 开发模式与打包版的差异

- `pnpm dev` **跳过单实例锁**：dev 与打包版共用同一个 `userData/downvid`，
  否则装了打包版且它正开着时 dev 会被自己的锁挡在门外
- dev 下 Go 边车由 vite 插件构建到 `backend/build/<platform>-<arch>/`；
  打包后由 `extraResources` 放进 `resources/downvid-deps/`
- 渲染进程与主进程都从**同一个** `vite.config.ts` 构建；`vitest.config.ts` 刻意分开，
  因为前者在 `buildStart` 时会调 `go build`

### 7.4 边车单独跑

边车是纯 CLI，可以脱离 Electron 直接验证（这也是排查依赖问题的第一步）：

```bash
cd backend && go run ./cmd/downvid-deps detect --managed-dir /tmp/dv-runtime --json
cd backend && go run ./cmd/downvid-deps fetch  --managed-dir /tmp/dv-runtime --only yt-dlp
```

**stdout 只放 JSON，日志一律走 stderr**——Electron 逐行解析 stdout，混入日志会解析失败。

---

## 8. 数字的唯一来源

这些数字各有**唯一来源**，改的时候不要在多处重复书写。`lint:docs` 会校验其中一部分与文档一致。

| 数字 | 值 | 唯一来源 | 为什么是这个值 |
| --- | --- | --- | --- |
| 检测总时限 | 80 秒 | `rt.DetectTimeout`（`backend/internal/runtime/find.go`） | 单候选 15s + 保底扫描 18s 的最坏情况仍有余量；Electron 侧 `runSidecar` 90s 再留 JSON 回传余量 |
| 单依赖候选总预算 | 45 秒 | `probeTimeLimit` | 一个依赖内所有候选共享 |
| 托管副本执行预算 | 15 秒 | `probe.CandidateTimeout` | yt-dlp 官方 macOS 构建首次执行实测最慢 12.4 秒 |
| 系统副本执行预算 | 5 秒 | `probe.SystemCandidateTimeout` | 候选表里可能有十几个路径，都给 15 秒会把检测拖成几分钟 |
| 保底扫描预算 | 18 秒 | `scanTimeLimit` | 必须大于 `CandidateTimeout`，否则扫到的第一个候选会被掐断 |
| JS 运行时探测预算 | 6 秒 | `electron/utils/js-runtime.ts` | 每个候选至多 1 秒；Node ≥22 / Deno ≥2.3 |
| 进度节流 | 200ms / taskId | `electron/download/progress.ts` | yt-dlp 进度行可能非常密集 |
| 任务级并发上限 | 3 | `MAX_CONCURRENT_DOWNLOADS`（`src/stores/download-rules.ts`） | 单个任务常受单站点限速，再多则并发分块相乘 |
| 加速默认并发 | 8（1–16） | `shared/acceleration.ts` | 直链小块队列；aria2 用同一个数 |
| 解析缓存有效期 | 30 分钟 | `PARSE_CACHE_TTL`（`electron/parsers/ytdlp.ts`） | 缓存版本号变了会失效 |
| info JSON 有效期 | 20 分钟 | `INFO_JSON_TTL`（`electron/download/ytdlp.ts`） | 超过后媒体直链可能已过期 |
| Cookie 快照新鲜度 | 30 分钟 | `SNAPSHOT_FRESH_MS`（`electron/utils/cookies.ts`） | 解析与下载共用同一快照 |
| 浏览器读取失败冷却 | 10 分钟 | `BROWSER_FAILURE_TTL_MS` | 失败的浏览器短期内不再尝试 |
| 下载历史上限 | 100 条 | `electron/history.ts` / `electron/ipc/history.ts` | 按本地文件路径去重合并 |
| HTTP 分块大小 | 10M | `HTTP_CHUNK_SIZE`（`electron/download/ytdlp.ts`） | 打断限速节奏；同一文件实测 0.16 MB/s → 5 MB/s |

---

## 9. 改完代码的检查清单

```bash
pnpm vue-tsc --noEmit
pnpm test
pnpm lint:ipc && pnpm lint:i18n && pnpm lint:icons && pnpm lint:website && pnpm lint:docs && pnpm lint:workflows
cd backend && gofmt -l . && go vet ./... && go test -shuffle=on ./...
```

再对照三件事：

- [ ] 是否碰到 [§5 改动落点清单](./standards.md#5-改动落点清单) 里的「多处必须同步」？
- [ ] 是否改变了用户可见行为？需要的话更新 `CHANGELOG.md` 的 `## [Unreleased]` 与相关文档
- [ ] 是否影响已发布客户端的升级能力？（产物命名、清单格式、仓库地址 —— 这三样改了会让存量用户收不到更新）

完整清单与判定标准见[仓库规范 · §3 评审要点](./standards.md#评审要点)与
[发布流程](./release.md#发布后哪些东西能改哪些不能)。
