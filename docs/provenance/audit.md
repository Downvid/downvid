# 代码来源审计（Videdown → DownVid）

> 阶段一产物，对应 [issue #74](https://github.com/yxxbc/downvid/issues/74) §「一、审计代码来源与模块耦合情况」。
>
> 本文的**每一个数字**都由 `pnpm audit:provenance` 从仓库内的上游快照现场重算，
> 写错了 CI 会红叉。不要手工改数字——改代码，然后 `node scripts/audit-provenance.mjs --write`
> 重算登记表，再同步本文的表格。

相关文档：[目标架构](./architecture.md) · [分阶段迁移](./migration-plan.md) · [发布质量与署名](./release-quality.md)

---

## 1. 结论先行

| 问题 | 答案 | 依据 |
| --- | --- | --- |
| 上游是谁、停在哪一版 | [Videdown](https://github.com/cshuangyy/videdown) `cshuangyy/videdown@0c620c1`，2026-08-22 | `scripts/data/provenance/upstream/_SOURCE.txt` |
| DownVid 从哪一刻开始 | `1d7b041`（2026-08-23，`refactor: 重命名 Videdown → DownVid`）；它的父提交就是上游 HEAD | `git log --oneline --reverse` |
| 上游代码还剩多少 | 上游 **2707** 条有效源码行中，**1239** 行（**45.8%**）仍逐字存在 | `pnpm audit:provenance` |
| 改动规模 | 分叉后 243 个文件变动，新增 213 / 修改 25 / 删除 5，+48466 / −4763 行 | `git diff --stat 1d7b041^ HEAD` |
| 哪些文件基本是上游原样 | `src/types/index.ts` 94%、`src/style.css` 45%、`electron/preload.ts` 74%（绝对值较高） | 登记表 `scripts/data/provenance/registry.json` |
| 哪些目录完全是自研 | `backend/`（Go 边车 4368 行）、`docker/`（1314 行）、`scripts/`、`tests/`、`website/` 全为分叉后新增 | `git diff --name-status --diff-filter=A 1d7b041^ HEAD` |

**一句话**：DownVid 不是「换个名字的 Videdown」，也远不是「完全重写」。真正的分界不是按目录，
而是按**层次**——界面外壳与上游高度同源，而**依赖边车、下载调度、更新、容器化这四块几乎没有上游成分**。

---

## 2. 判定方法（可复算，也可被质疑）

### 2.1 为什么不用 `git blame` 归因

上游 `electron/main.ts` 是 **2756 行**的单文件，DownVid 把它拆成了 `electron/ipc/`（5 个）、
`electron/download/`（7 个）、`electron/parsers/`（6 个）、`electron/utils/`（6 个）等 20 多个模块。
`git blame` 只会说「这一行来自拆分那次提交」，无法回答「这一行是不是上游写的」。

### 2.2 实际采用的口径：归一化行的逐字存活率

1. 保留一份上游源码的**逐字快照**（`scripts/data/provenance/upstream/`，20 个上游源文件 + 1 个 `_SOURCE.txt`，236 KB）。
2. 把两边都按行切分，做归一化：去掉首尾空白、把内部连续空白压成一个空格 —— **缩进与换行风格不算改动**。
3. 只统计「有效行」：归一化后 ≥ 12 字符，且不是纯括号/标签（`}`、`</template>`、`export default {`）。
   这一步很关键：不做过滤时，上游 `HelloWorld.vue` 能靠一堆模板标签刷出可观的相似度。
4. 对上游每个文件，统计它的有效行有多少能**在仓库任意位置**逐字命中（行被挪到别的文件也算存活）。
5. 反向统计每个当前文件有多少行逐字命中上游 —— 这就是该文件的「上游成分」。

### 2.3 局限（必须照实写）

- **逐字命中 ≠ 抄写**。`import fs from 'node:fs'`、`export default {`、`const res = await fetch(...)`
  这类行任何项目都会出现。阈值只用于**挑出需要人工复核的文件**，不是法律意义上的相似度判定。
- **不算「改写后的表达」**。把上游逻辑重写一遍但保留相同行为，逐字命中率会降到 0，
  这在审计口径里就是「DownVid 自研」——但**功能来源**仍然可能是上游。本文只声明代码文本来源。
- 阈值：某文件上游成分 **≥ 15% 且 ≥ 8 行**才必须登记（`scripts/audit-provenance.mjs` 的
  `DERIVED_THRESHOLD_PCT` / `DERIVED_MIN_LINES`）。比例门槛单用时会把
  `src/vite-env.d.ts`（1 行，Vite 模板固定内容）误判成 100% 上游衍生。
- 上游快照冻结在分叉点。上游之后发布的新版本**不在**本文比较范围内（见 §7）。

### 2.4 怎么自己复核

```bash
pnpm audit:provenance            # CI 跑的就是这条：登记表与实测不一致就红叉
node scripts/audit-provenance.mjs --report   # 打印完整表格，不写文件
```

变异验证（已做过）：删掉 `src/types/index.ts` 一半内容 → 报「upstreamLines 48 → 13」并以退出码 1 失败；
在 `electron/utils/` 放一个新文件、内容直接取自上游 `main.ts` → 报「未登记的上游衍生文件」。

---

## 3. 上游文件存活表

由 `--report` 输出，口径见 §2.2。「活在哪」只列命中数最高的三个去处。

| 上游文件 | 有效行 | 逐字存活 | 比例 | 现在的去向 |
| --- | ---: | ---: | ---: | --- |
| `electron/main.ts` | 1229 | 386 | 31.4% | 同路径 + `parsers/kuaishou.ts`(150)、`parsers/douyin.ts`(90)、`docker/server/index.ts`(27) |
| `electron/preload.ts` | 103 | 101 | **98.1%** | `electron/preload.ts`(101) |
| `electron/electron-env.d.ts` | 34 | 16 | 47.1% | `src/env.d.ts`(15)、`src/types/index.ts`(2) |
| `src/style.css` | 84 | 80 | **95.2%** | `src/style.css`(80) |
| `src/types/index.ts` | 48 | 48 | **100%** | `src/types/index.ts`(48) |
| `src/env.d.ts` | 40 | 37 | **92.5%** | `src/env.d.ts`(37) |
| `vite.config.ts` | 16 | 15 | **93.8%** | `vite.config.ts`(14) |
| `src/components/HistoryView.vue` | 84 | 68 | 81.0% | 同路径(67) |
| `src/App.vue` | 52 | 43 | 82.7% | `src/App.vue`(28)、`src/style.css`(14) |
| `src/components/DownloadView.vue` | 615 | 298 | 48.5% | `src/stores/download.ts`(114)、`src/components/UrlInput.vue`(60)、`DownloadQueue.vue`(53) |
| `src/components/AboutView.vue` | 123 | 41 | 33.3% | 同路径(33) |
| `src/components/SettingsView.vue` | 101 | 38 | 37.6% | 同路径(36) |
| `src/components/icons/MaterialIcon.vue` | 35 | 27 | 77.1% | `src/style.css`(14)、同路径(12) |
| `index.html` | 11 | 8 | 72.7% | 同路径(8) |
| `src/components/Header.vue` | 35 | 23 | 65.7% | 同路径(23) |
| `src/main.ts` | 4 | 3 | 75.0% | 同路径(3) |
| `src/components/HelloWorld.vue` | 17 | 4 | 23.5% | `AboutView`(2)、`CookieGuide`(2)、`DepsPrompt`(2) |
| `postcss.config.js` | 3 | 1 | 33.3% | 同路径(1) |
| `tailwind.config.js` | 72 | 1 | 1.4% | 已迁到 Tailwind v4 的 CSS-first 写法 |
| `src/vite-env.d.ts` | 1 | 1 | 100% | 同路径 |
| **合计** | **2707** | **1239** | **45.8%** | |

> 读这张表的正确姿势：**比例低不代表重写**。`tailwind.config.js` 的 1.4% 是因为 Tailwind v4 把配置
> 搬进了 CSS（`src/style.css` 的 `@theme`），72 行配置对不上是预期的；而 `electron/main.ts` 的
> 31.4% 才是真正值得警惕的部分——它的 150 行进了 `parsers/kuaishou.ts`、90 行进了 `parsers/douyin.ts`，
> 也就是说**两个平台解析器的主体是从上游那段单文件里搬出来的**，不是新写的。

---

## 4. 当前文件的上游成分（登记表）

`scripts/data/provenance/registry.json` 是唯一入口。四类来源：

| origin | 含义 | 判据 |
| --- | --- | --- |
| `upstream-verbatim` | 上游有同名文件，≥90% 的上游有效行原封不动 | 改它等于改上游实现 |
| `upstream-derived` | 上游有同名文件，或本文件 ≥15%（且 ≥8 行）逐字命中上游 | 拿上游代码继续改出来的 |
| `upstream-relocated` | 上游文件本身已不存在，但它的行散落进了别的文件 | 拆分产物 |
| `downvid-original` | 不含上游成分 | 分叉后新写 |

### 4.1 全部登记文件（按上游成分排序）

`registry.json` 共登记 **32** 个文件：下面 **29** 个是仓库里仍存在的文件，另 **3** 个是
`upstream-relocated`（上游文件本身已不存在，行散落进了别的文件，见 §4.2）。

| 文件 | 上游行/有效行 | 比例 | 说明 |
| --- | ---: | ---: | --- |
| `src/vite-env.d.ts` | 1/1 | 100% | Vite 客户端类型引用（单行，全项目通用） |
| `src/types/index.ts` | 48/51 | 94.1% | 几乎是上游原样，只加了 3 行 |
| `src/components/VideoInfoCard.vue` | 26/34 | 76.5% | 上游 `DownloadView.vue` 里的一段被抽成组件 |
| `electron/preload.ts` | 101/137 | 73.7% | IPC 桥面基本沿用上游形状 |
| `electron/parsers/kuaishou.ts` | 150/222 | 67.6% | 快手解析主体来自上游 `main.ts` |
| `src/components/HistoryView.vue` | 69/109 | 63.3% | 上游同名文件的延续 |
| `src/components/UrlInput.vue` | 61/111 | 55% | 上游 `DownloadView.vue` 的输入区 |
| `electron/parsers/douyin.ts` | 90/168 | 53.6% | 抖音解析主体来自上游 `main.ts` |
| `electron/utils/platform.ts` | 8/16 | 50% | 平台判断小工具 |
| `postcss.config.js` | 1/2 | 50% | PostCSS 插件链 |
| `src/components/icons/MaterialIcon.vue` | 12/24 | 50% | 图标组件 |
| `src/style.css` | 82/182 | 45.1% | 主题 token 与上游同源，后加 Tailwind v4 的 `@theme` |
| `src/components/FormatSelector.vue` | 35/79 | 44.3% | 清晰度选择器 |
| `src/components/Header.vue` | 24/59 | 40.7% | 顶栏 |
| `index.html` | 8/20 | 40% | 入口 HTML 骨架 |
| `src/components/DownloadQueue.vue` | 53/143 | 37.1% | 队列区，从上游 `DownloadView.vue` 拆出 |
| `src/env.d.ts` | 40/110 | 36.4% | IPC 类型声明，形状同源 |
| `src/stores/download.ts` | 114/319 | 35.7% | 上游 `DownloadView.vue` 的状态被抽进 store |
| `src/App.vue` | 30/89 | 33.7% | 布局 |
| `electron/utils/browser.ts` | 25/100 | 25% | Chrome 探测 |
| `src/components/DownloadView.vue` | 31/143 | 21.7% | 已从 615 行瘦到 143 行，剩余部分仍同源 |
| `electron/ipc/download.ts` | 15/70 | 21.4% | 通道名与参数形状同源 |
| `electron/ipc/history.ts` | 9/42 | 21.4% | 通道名与参数形状同源 |
| `src/components/AboutView.vue` | 35/196 | 17.9% | 关于页 |
| `vite.config.ts` | 16/97 | 16.5% | 构建骨架 |
| `electron/main.ts` | 26/164 | 15.9% | 2756 → 164 行，已是壳 |
| `electron/ipc/system.ts` | 24/157 | 15.3% | 系统能力 |
| `src/components/SettingsView.vue` | 38/280 | 13.6% | 设置面板，从上游同名文件改造 |
| `src/main.ts` | 3/22 | 13.6% | Vue 挂载入口 |

> 最后两行（`SettingsView.vue` 13.6%、`src/main.ts` 13.6%）低于 15% 门槛，它们进登记表是因为
> **上游存在同名文件** —— 同名文件无论如何都要有人复核一遍「改了什么」，与比例无关。

### 4.2 已消失的上游文件（`upstream-relocated`）

三个上游文件在仓库里已经不存在，但它们的行散落在别处。这一节存在的意义是：下次有人问
「上游那个 `electron-env.d.ts` 到哪去了」，能查到答案，而不是再去翻 git 历史。

| 上游文件 | 有效行 | 逐字存活 | 现在的去处 |
| --- | ---: | ---: | --- |
| `electron/electron-env.d.ts` | 34 | 16（47.1%） | `src/env.d.ts`(15)、`src/types/index.ts`(2)、`docker/server/electron-process.d.ts`(1) |
| `src/components/HelloWorld.vue` | 17 | 4（23.5%） | `AboutView.vue`(2)、`CookieGuide.vue`(2)、`DepsPrompt.vue`(2) |
| `tailwind.config.js` | 72 | 1（1.4%） | `postcss.config.js`(1)；配置本身迁到 `src/style.css` 的 `@theme` |

> `electron/electron-env.d.ts` 是**不要恢复**的文件：它曾经定义第二份 `Window.electronAPI`，
> 反过来遮蔽了 `src/env.d.ts` 的完整定义，导致多处调用在类型检查下「消失」（见 AGENTS.md §1）。

### 4.3 完全自研的部分（无上游成分）

**后端与部署**（分叉后新增，上游根本没有这两层）：

- `backend/` 全部（Go 边车 4368 行，含 `probe` / `runtime` / `fetch` / `manifest` / `cli`）
- `docker/` 全部（Dockerfile、`server/index.ts` 524 行、`web/bridge.ts` 164 行、`security.ts`、`entrypoint.sh`）
- `scripts/`（11744 行：依赖清单生成、IPC/官网/i18n/文档/工作流/来源校验、集成回归）
- `tests/`（3498 行，28 个测试文件 / 334 个用例）
- `website/`（1882 行单文件落地页）
- `shared/` 五个模块（`app.ts` 仓库坐标、`acceleration.ts`、`parse-error.ts`、`update-check.ts`、`update-sources.ts`）
- `electron/` 下的 `download/direct.ts`、`download/direct-state.ts`、`download/process-tree.ts`、
  `download/aria2.ts`、`download/aria2-progress.ts`、`download/progress.ts`（重写）、`parsers/formats.ts`、
  `parsers/ytdlp.ts`（重写）、`parsers/shared.ts`、`parsers/youtube-retry.ts`、`utils/runtime.ts`、
  `utils/binary.ts`、`utils/cookies.ts`、`utils/js-runtime.ts`、`history.ts`、`updater.ts`、
  `ipc/app.ts`（`ipc/download.ts` / `ipc/history.ts` / `ipc/system.ts` 是上游衍生，见 §4.1）
- `src/stores/settings.ts`、`src/stores/deps.ts`、`src/stores/download-rules.ts`、`src/i18n/`、
  `src/composables/`、`src/components/DepPanel.vue`、`DepsPrompt.vue`、`UpdateModal.vue`、
  `CookieGuide.vue`、`ErrorModal.vue`

> 判据是「上游成分 < 15% 或 < 8 行」。注意 `electron/download/progress.ts` 被判为自研，但它和上游的
> `main.ts` 里那段进度推送逻辑**同源**（被重写过），这正是 §2.3 第二条局限的实例。

---

## 5. 第三方组件与许可

### 5.1 上游继承

| 组件 | 许可 | 证据 |
| --- | --- | --- |
| Videdown（继承代码） | MIT，`Copyright (c) 2024 Videdown` / 上游署名 `cshuangyy` | `LICENSE` 第 1–4 行仍保留该声明；上游 `LICENSE` 为纯 MIT |
| DownVid 自有部分 | MIT，`Copyright (c) 2026 DownVid (yxxbc)` | `LICENSE` 第 4 行 |

MIT 的义务是**保留版权声明与许可全文**，已在 `LICENSE` 中满足。删除上游声明会同时违反许可证
与 issue #74 §「四」的验收标准，不要做。

### 5.2 运行时与构建依赖（`package.json`，24 个直接依赖）

| 依赖 | 版本 | 许可 | 用途 |
| --- | --- | --- | --- |
| `electron` | 44.7.2 | MIT | 桌面运行时 |
| `vue` / `pinia` | 3.5.44 / 4.0.3 | MIT | 渲染进程 |
| `electron-updater` | 6.8.9 | MIT | 应用内更新 |
| `puppeteer-core` | 25.13.0 | Apache-2.0 | 复用系统 Chrome 兜底解析 |
| `marked` | 18.1.1 | MIT | 更新说明渲染 |
| `@material-symbols/font-400` | 0.48.0 | Apache-2.0 | 图标字体 |
| `bufferutil` / `utf-8-validate` | 4.1.0 / 6.0.6 | MIT | `ws` 可选加速件 |
| `ws` | 8.22.0 | MIT | WebUI 的 WebSocket |
| `vite` / `electron-builder` / `vitest` / `vue-tsc` / `tsx` / `tailwindcss` 等 | — | MIT | 构建与测试 |
| `typescript` | 5.9.3 | Apache-2.0 | 类型检查 |

无 GPL/AGPL/SSPL 类传染性许可的直接依赖。**间接依赖未逐项审计**（`node_modules` 928 MB，
属后续工作，见 §7）。

### 5.3 外部二进制（不作为依赖打包）

`yt-dlp`（Unlicense）、`ffmpeg`/`ffprobe`（构建为 GPL 或 LGPL，取决于编译选项）、
`aria2c`（GPL-2.0）。它们**通过子进程调用、不链接、不修改**，安装包不携带（见 AGENTS.md
「运行依赖」一节），由用户在运行时获得或由边车下载。这一层是「调用了别的程序」，不是「把 GPL 代码并进来」。

---

## 6. 耦合审计

### 6.1 桌面端 ↔ 容器端的依赖方向

```
docker/server/index.ts  ──import──►  12 个 electron/* 模块
                                     ├─ parsers/{douyin,kuaishou,ytdlp}
                                     ├─ download/{direct,ytdlp,progress,aria2}
                                     ├─ utils/{runtime,cookies,platform}
                                     ├─ store.ts          （activeDownloads）
                                     └─ history.ts
electron/ + src/  ──import──►  docker/*   ：0 处（桌面端完全不知道容器的存在）
```

**好消息**：桌面端零反向依赖，`docker/` 是被动的。坏消息：容器端 import 的 12 个模块里，
**8 个**传递依赖到 `electron` 包本身（`parsers/ytdlp`、`store`、`download/{direct,ytdlp,progress,aria2}`、
`utils/{runtime,cookies}`），靠 `docker/server/electron-shim.ts`（132 行）兜住。
这就是「不同运行环境相互耦合」的具体形态——shim 一旦漏一个 API，容器版才炸，桌面版完全正常。

### 6.2 `electron/` + `shared/` 的 Electron 耦合（36 个非声明式 `.ts`）

| 类别 | 数量 | 文件 |
| --- | ---: | --- |
| 传递依赖**不到** `electron`，可无头复用 | 18 | `shared/` 全部 5 个；`electron/`：`constants.ts`、`history.ts`、`download/{process-tree,direct-state,aria2-progress}.ts`、`parsers/{douyin,kuaishou,formats,shared,youtube-retry}.ts`、`utils/{browser,js-runtime,platform}.ts` |
| **直接** import `electron` | 15 | `main.ts`、`preload.ts`、`menu.ts`、`updater.ts`、`store.ts`、`download/{aria2,progress}.ts`、`parsers/ytdlp.ts`、`ipc/*`(5)、`utils/{cookies,runtime}.ts` |
| **间接**被拖进去 | 3 | `download/direct.ts`（← `progress.ts`）、`download/ytdlp.ts`（← `store.ts`/`cookies`/`parsers/ytdlp`）、`utils/binary.ts`（← `utils/runtime.ts`） |

被拖进去的三个是关键：`direct.ts`、`ytdlp.ts`、`binary.ts` 本身**一行都不用 Electron API**，
只是 import 了一个用了 Electron 的同级模块。它们需要的 `electron` 能力其实只有三样：

| 需要的 API | 调用点 | 真实语义 |
| --- | --- | --- |
| `app.getPath('userData')` | 9 处（`main`/`runtime`/`cookies`/`updater`/`aria2`/`ipc/history`/`ipc/system`） | 「数据目录」 |
| `BrowserWindow.getAllWindows() → webContents.send()` | `store.ts`、`download/progress.ts`、`ipc/{history,deps}.ts` | 「把事件发给界面」 |
| `dialog` / `shell` | `parsers/ytdlp.ts` 的两个 `prompt*`、`ipc/deps.ts` | 「问用户 / 打开链接」 |

**这三样正好是三个可被注入的接口**，也是 [目标架构](./architecture.md) §3 的落点。

### 6.3 前端内部耦合

- `src/stores/settings.ts` 是设置的唯一入口（186 行），但**状态不在 Pinia**——存在
  `localStorage['settings']`，多个组件直接读。桌面与 WebUI 共用 `localStorage`，
  这是目前唯一无需改动的跨端状态来源。
- `src/env.d.ts` 是 `window.electronAPI` 的唯一类型来源（`lint:ipc` 强制三处同步），
  WebUI 的 `docker/web/bridge.ts` 必须**在形状上完全等价**地复刻它。
- 响应式程度：`src/` 下 Tailwind 断点类只有 **1 处**（`AboutView.vue` 的 `sm:grid-cols-3`）；
  `DownloadView` 写死 `w-[65%]`、`DownloadQueue` 写死 `w-[45%]`；桌面窗口 `minWidth: 1000`。
  这与 issue §「二」的移动端目标直接冲突，见 [迁移计划](./migration-plan.md) 的 M 系列。

### 6.4 部署形态之间的耦合

| 耦合 | 现状 | 影响 |
| --- | --- | --- |
| 容器端复用桌面代码要靠 shim | `docker/server/vite.config.ts` 的 `electron` 别名 + `tsconfig.json` 的 `paths`，**两处必须一起维护** | 漏一处构建期或运行期才报 `Cannot find package 'electron'` |
| 前端复用靠 RPC 形状复刻 | `docker/web/bridge.ts`（164 行）手工复刻 `window.electronAPI` | 桌面新增 API 时容器端静默缺失（有 `tests/web-bridge.test.ts` 兜） |
| IPC 通道在两侧各写一遍 | 桌面 39 个 `ipcMain.handle`，容器 40 个 RPC 方法，**39 个同名** + 容器独有 `app:containerInfo` | 目前一致，但没有静态校验强制「桌面新增通道必须同步到容器端」 |

> 最后一条是**当前最危险的一处静默失败点**：`lint:ipc` 只比对桌面三处（主进程 / preload / env.d.ts），
> 不比对 `docker/server/index.ts`。这已在 [迁移计划](./migration-plan.md) 的 C 系列里排期。

---

## 7. 规模与成本基线

| 指标 | 数值 | 测量方式 |
| --- | ---: | --- |
| 源码（不含测试/脚本/官网） | `electron/` 4983 + `shared/` 772 + `src/` 6228 + `backend/` 4368 + `docker/` 1314 = **17665 行** | `wc -l` |
| 测试 + 校验脚本 | `tests/` 3498 行 / 28 文件 / 334 用例（单测 1.2 秒跑完） | `pnpm test` |
| 构建与校验脚本 | `scripts/` 11744 行（含本次新增的来源审计脚本） | `wc -l` |
| 直接依赖 | 运行时 8 + 构建 16 | `package.json` |
| `node_modules` | 928 MB | `du -sh` |
| 前端产物 | `dist/` 1.0 MB（其中 `material-symbols-outlined.woff2` 492 KB） | `du -sh` |
| 主进程产物 | `dist-electron/` 4.8 MB | `du -sh` |
| Go 边车 | `backend/build/` 21 MB（5 平台 × 本机架构） | `du -sh` |
| WebUI 前端 | `docker/dist-web/` 980 KB | `du -sh` |
| WebUI 服务端 | `docker/dist-server/` 2.1 MB（单文件） | `du -sh` |

安装包大小未在本机重新测量（需要一个完整 platform 打包，约 5–10 分钟）。
镜像：GHCR 多架构，压缩后约 340 MB（PR #70 记录，含 yt-dlp/ffmpeg 静态二进制）。

---

## 8. 本次审计未能覆盖的部分

明确列出来，避免读者以为「审计完了 = 一切都清楚了」：

1. **间接依赖的许可证清单**未逐项生成（928 MB `node_modules`）。建议后续用
   `pnpm licenses list` 一次性导出，纳入 CI。
2. **上游之后的新提交**未纳入比较。快照冻结在 `0c620c1`；若上游继续演进，需要主动重新取快照，
   但这**不影响** DownVid 对已继承代码的许可义务（那份义务基于分叉时的状态）。
3. **功能来源**未逐项判定（例如「快手解析这个思路是谁的」）。本文只声明代码文本来源。
4. **实际安装包体积**未重新测量（见 §7）。
5. `tests/` 与 `scripts/` 未做来源审计——它们全部是分叉后新增，`git diff --diff-filter=A` 即可确认。

---

## 9. 维护方式

- 上游快照在 `scripts/data/provenance/upstream/`，**不要修改其中任何文件**；
  需要更新时整体替换，并同时改 `_SOURCE.txt` 与 `registry.json` 的 `upstream.commit`。
- 新增代码后如果 `pnpm audit:provenance` 报「未登记的上游衍生文件」，说明这份新代码有 ≥15% 的行
  和上游相同。两种处理：确认是有意沿用 → `--write` 登记并在 PR 描述里说明来源；
  确认是巧合 → 加注释说明来源，或调整写法。
- 本文 §3 / §4 的表格与 `registry.json` 一起更新，`--write` 会打印现成的新表格。
