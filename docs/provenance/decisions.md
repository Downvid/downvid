# 技术选型决策记录（ADR）

> 记录重构过程中的**关键选型与实测依据**。每条都写「选了什么 / 为什么 / 放弃了什么 / 什么情况下应该推翻」。
> 目的不是追溯，而是：半年后有人问「为什么不用 X」时，这里能给出当时的实测数字。

对应 [issue #74](https://github.com/yxxbc/downvid/issues/74) 的「二、制定目标架构」。
架构本身见 [architecture.md](./architecture.md)，迁移步骤见 [migration-plan.md](./migration-plan.md)。

---

## ADR-001 后端语言：Go

**决定**：把 `electron/` 下的业务逻辑（约 2691 行 TS）移植到 Go，与现有 Go 边车（4368 行）合成一个核心。

**实测依据**

| 项 | 数据 |
| --- | --- |
| 已在 Go 里的能力 | `probe`（版本探测，含 yt-dlp/ffmpeg/aria2 的本地化输出解析）、`runtime`（候选路径解析）、`fetch`（下载 + SHA-256 + 解压 + 镜像回退）、`manifest`（资产清单） |
| 需要新移植 | `parsers` 902 行、`download` 850 行、`update` 868 行、`history` 71 行 |
| 交叉编译实测 | `win32-x64`→PE32+、`darwin-arm64/x64`→Mach-O、`linux-x64/arm64`→静态 ELF，**全部成功** |
| 受影响的测试 | 140 个用例（占全仓 334 的 41%）需在 Go 侧重建 |

**放弃了什么**

- TypeScript 全栈统一（类型在前后端可共享）
- Node 生态：`puppeteer-core`（抖音/快手 headless 兜底）、`ws`、`electron-updater`
- 现有 140 个 vitest 用例（不能在 Go 里直接跑）

**headless 兜底怎么办**（原本是这条 ADR 最大的未知）：

现方案用 `puppeteer-core` 驱动系统 Chrome，给抖音/快手做兜底解析
（`ipc/download.ts` 里平台 API 失败后进 `parseXxxWithPuppeteer`，再失败才落到 yt-dlp）。
Go 里确实没有 puppeteer——但**兜底真正依赖的是 CDP（Chrome DevTools Protocol），不是 puppeteer**。

实测（2026-10-17）：`chrome --headless=new --remote-debugging-port=9333` 启动后，
直接 `GET http://127.0.0.1:9333/json/version` 拿到 `Chrome/155.0.8059.85`，
`/json` 列出 tab。也就是说 Go 侧只要实现这几个 HTTP 端点 + 一条 WebSocket：

| 现在用 puppeteer 做的 | Go 侧对应 |
| --- | --- |
| `puppeteer.launch({ executablePath })` | `exec.Command(chrome, "--headless=new", "--remote-debugging-port=…")` |
| `page.goto(url)` / `page.reload()` | CDP `Page.navigate` |
| `page.setCookie()` | CDP `Network.setCookies` |
| `page.evaluate()` | CDP `Runtime.evaluate` |
| `page.on('response')` 拦 m3u8/视频地址 | CDP `Network.enable` + 事件订阅 |
| `page.setRequestInterception` | CDP `Fetch.enable` |

所以**不需要放弃兜底，也不需要在 Go 里嵌一个浏览器驱动**——换成 CDP 直连即可。
浏览器进程查找逻辑（`utils/browser.ts` 的平台路径表）本来就是纯文件探测，直接照搬。

---

## ADR-002 桌面壳：Wails v2（Electron 验证后删除）

**决定**：桌面端从 Electron 换成 Wails v2；Wails 版本通过三平台验收后删除 `electron/` 与 `electron-builder` 配置。

**实测依据（本机 macOS arm64，Wails v2.16.0）**

| 指标 | Wails | Electron（同项目已发布产物） |
| --- | --- | --- |
| 应用产物 | **8.2 MB**（`.app`，可执行文件 7.9 MB） | **128 MB**（`DownVid-arm64-Mac-1.4.0.dmg`） |
| DOM 就绪 | **~320 ms**（三次实测 345 / 304 / 312） | 未测（捆绑 Chromium 冷启动通常 1s+） |
| 构建耗时 | 12.6 s（含前端） | 数十秒（electron-builder 打包） |
| 运行时 | 系统 WebView | 捆绑 Chromium（`node_modules/electron/dist` = **308 MB**） |

体积差异 **15 倍**，这是选 Wails 的主要理由——它直接对应「轻量化」这个 issue 目标。

**实测中发现的模板质量问题**（都已绕过，值得记录）：

1. `wails init -t svelte-ts` 生成的 `package.json` 里同时有 **Vite 8** 和 `@sveltejs/vite-plugin-svelte@6`
   （后者 peer 只允许 Vite 6/7）→ `npm install` 直接 ERESOLVE 失败。必须钉 Vite 7。
2. 模板仍带 `svelte-preprocess`（Svelte 5 已废弃）→ 换成 `@sveltejs/vite-plugin-svelte` 的 `vitePreprocess()`。
3. 模板的 `App.svelte` 引用 `Greet`，而绑定的 Go 方法一改就构建失败 → 改完 Go 方法必须
   `wails generate module` 重新生成 `frontend/wailsjs/`。

**放弃了什么**

- Electron 已经踩完坑的整套能力：`electron-updater`（差分更新 + macOS 自实现 `.app` 替换）、
  三条安装包链路（NSIS / dmg / AppImage + deb / rpm）、`session.setProxy` 系统代理、
  原生菜单与托盘、`dialog` 原生文件选择、`shell.showItemInFolder`
- 这些在 Wails 侧**都要重做**，是本次重构里最贵的非移植工作

**尚未验证的风险（必须在 G1 阶段收敛）**

| 平台 | WebView | 验证结果 |
| --- | --- | --- |
| macOS | WKWebView（系统自带） | ✅ 实测通过，8.2 MB，DOM 就绪 ~320 ms |
| Windows | WebView2（Win10+ 预装） | ⚠️ 交叉编译可验证，运行时需真机 |
| Linux | WebKitGTK 4.0 / 4.1 | ✅ **已实测通过**（见下） |

**Linux 验证详情**（Docker + `golang:1.25-bookworm`，2026-10-17 实测）：

| 项 | 结果 |
| --- | --- |
| `libwebkit2gtk-4.1-dev` 可安装 | ✅ Debian 12 提供 `2.50.6-1~deb12u2` |
| `libwebkit2gtk-4.0-dev` 可安装 | ✅ 同样提供（老发行版走这条） |
| `-tags webkit2_41` 构建 | ✅ 成功，产物 **4.8 MB** |
| 不带 tag（默认找 4.0）构建 | ✅ 成功，产物 4.8 MB |

**由此确定两条硬要求**：

1. **Go ≥ 1.25**。Wails v2.16.0 明确要求（`go >= 1.25.0`）；仓库当前是 `go 1.24`，
   而 `GOTOOLCHAIN=local` 会直接拒绝。升级 Go 是选 Wails 的前置条件。
2. **构建要带 `-tags webkit2_41`**（Ubuntu 24.04 / Debian 12 及以后），
   老发行版用 `webkit2gtk-4.0` 时不带 tag。两个 tag 不能同时给。

Linux 分发仍需在安装文档里写清运行时依赖：`libwebkit2gtk-4.1-0` + `libgtk-3-0`。
这是 Wails「轻」的代价——它不捆绑运行时，就得依赖系统提供。

---

## ADR-003 前端框架：Svelte 5 + Vite（**不用 SvelteKit**）

**决定**：Svelte 5 + `@sveltejs/vite-plugin-svelte` + Vite，Tailwind v4 原样沿用。

**为什么不用 SvelteKit**

调研结论（完整数据见 §附注）：本项目是**单窗口 SPA**，形态与 Kit 天然冲突：

- Electron/Wails 用 `loadFile(dist/index.html, {hash})` 加载，hash 传参
- 有**两个构建入口**：桌面渲染进程 + `docker/web/`（后者直接 `import '../../src/main'`，
  并在 `bridge.ts` 里注入 `window.electronAPI`）
- Kit 要接管 entry / `index.html` / router / adapter / SSR 默认值

用 Kit 需要 `adapter-static` + `ssr=false` + 把 tab 改成真路由，并重写 `docker/web` 入口，
**多 1~2 周**且没有任何对应收益（本项目不需要 SSR、SEO、路由）。

**为什么是 Svelte 而不是保留 Vue / 换 React**

| 选项 | 前端产物 | 迁移量 | 备注 |
| --- | --- | --- | --- |
| **Svelte 5**（选定） | ~50 KB 运行时 | 4,900 行机械 + 1,190 行重设计 | 编译期响应式，无虚拟 DOM，WebKitGTK 上更稳 |
| 保留 Vue 3 | ~80 KB | 0 | 但 issue 目标是「前端保持轻量」，且与 Svelte 差距不大 |
| React 19 | ~140 KB | 与 Svelte 相近 | 运行时最大，与轻量化目标相反 |

**实测的迁移难点（必须重设计，不能机械翻译）**

1. `src/stores/download.ts` 的 `pauseRequests` / `taskExecutions` / `taskProgressCleanups`
   存 **Promise 与函数**，Svelte 5 `$state` 深代理会破坏 `Map.get(id) === execution` 身份比较
   → 必须用 `$state.raw` 或留在模块级普通 Map
2. `t()` 是「读 ref 的函数」，302 处调用点依赖「必须在响应式上下文里调用」——
   Svelte 侧同构（`$state` + `$derived` 内调用），但 **`.svelte.ts` 文件在 vitest（node 环境）里跑不起来**，
   连带 6 个纯逻辑测试会挂
3. 5 个模态外壳用 `<Teleport>` + `<Transition>` + 174 行手写过渡 CSS；
   `UpdateModal` 有 18 个 `:deep()` 给 `v-html` 用 —— Svelte 不生成过渡类名，`::deep` 要换 `:global`
4. `App.vue` 的 `v-show` 必须保活（History 的 IPC 订阅、UrlInput 的本地状态都依赖常驻）→
   Svelte 里要用 `hidden`，**不能顺手写 `{#if}`**
5. `UrlInput` 是受控 textarea + 自绘右键菜单（操作 `selectionStart`）——
   `bind:value` 会导致光标跳动，必须重新设计

**工具链连带改动**：`vue-tsc`→`svelte-check`、两个 `vite.config.ts` 换插件、
`vitest.config.ts` 加 svelte 插件、`lint-i18n.mjs` / `lint-icons.mjs` 的扩展名过滤加 `.svelte`。

---

## ADR-004 移动端：PWA

**决定**：不单独做原生 App，把 Web UI 做成响应式 + PWA（可添加到主屏幕）。

**依据**：容器端已经证明「用 RPC 复刻 `window.electronAPI`」可行（`docker/web/bridge.ts`，164 行，
现有前端零改动即跑通）。PWA 复用同一份构建产物，零额外工程。

**已知限制（照实写进文档，不要承诺做不到的事）**

- 无法上架应用商店
- **iOS 后台下载受限**：切到后台后 WebView 可能被挂起，长下载会中断
- 无系统级通知

**什么情况下应该推翻**：如果真实用户反馈「手机上下大文件总是中断」，那就需要 Capacitor 套壳
（复用同一份 Svelte 代码，能上架、能访问文件系统），而不是继续加固 PWA。

---

## ADR-005 自动化优先：能生成的不手写

**决定**：仓库里凡是「手工维护、会漂移」的清单，一律改成从唯一来源生成，并挂进 CI。

**已落地**

- `pnpm audit:provenance` —— 上游代码成分从仓库内快照重算，登记表不覆盖就红叉
- `pnpm lint:boundaries` —— 七条架构边界规则（core 不得 import electron 等）
- `pnpm test:e2e:real` —— 用真实 yt-dlp/ffmpeg 跑完整链路

**待落地**（见迁移计划 G5）

| 手艺点 | 唯一来源 | 生成方式 |
| --- | --- | --- |
| 贡献者名单（About 页 + 测试快照） | `git log` 署名 | 脚本按 noreply 邮箱提取 GitHub login，人工确认后写回 |
| i18n 词条完整性 | 现有 286 条中文 | 缺英文时报错并可生成占位 |
| 版本号（package.json / Dockerfile / workflow / 官网） | `package.json` | 一处改，其余同步 |
| Release 正文 | `CHANGELOG.md` + 产物列表 | 已有 `gen-release-notes.mjs` |

**什么不该自动化**：判断类工作——「这个人算不算贡献者」「这个词条该翻译成什么」
「这个 PR 的边界对不对」。脚本只做机械搬运与一致性校验，不做决策。

---

## 附注：Vue → Svelte 迁移的实测规模

由子代理逐文件统计（未修改任何文件）：

| 类别 | 行数 | 折算工时 |
| --- | ---: | --- |
| 可机械翻译（模板 1770 + 脚本 658 + 样式/类型/词条等） | ~4,900 | 8~12 人日 |
| 必须重新设计（9 项，见 ADR-003） | ~1,190 | 8~12 人日 |
| 工程化 + 回归（双 vite、docker/web 入口、vitest、2 个 lint、打包） | — | 3~5 人日 |
| 验证（28 个测试改跑、4 平台打包、UI 比对、手测） | — | 5~8 人日 |
| **合计** | **6,090** | **单人 4~6 周 / 双人 2.5~3 周** |

组件难度分布：**易** 4 个（FormatSelector / VideoInfoCard / MaterialIcon / GitHubIcon）、
**中** 9 个、**难** 4 个（App / DownloadView / SettingsView / UrlInput）。

全仓库**没有** slot、provide/inject、`<component :is>`、defineExpose、mixin —— 这是迁移可行性高的主要原因。
