# DownVid 重构 · 任务清单

> 主线：Go 核心 + Wails 桌面壳 + Svelte 前端 → 迁移到 `Downvid/downvid`。
> 选型依据见 `docs/provenance/decisions.md`，迁移路线见 `docs/provenance/migration-plan.md`。

---

## 已完成

### Go 核心（`app/internal/`）

- [x] `download/ytdlp_args` —— yt-dlp 参数组装（24 用例 + 16 组交叉验证）
- [x] `download/progress_line` —— 进度行解析（含 aria2）
- [x] `download/run` —— 真起进程执行下载（进度、暂停、进程树）
- [x] `download/process_tree` —— 整棵进程树终止（POSIX 进程组 / Windows taskkill）
- [x] `download/aria2_progress` —— aria2 进度解析
- [x] `fetch/direct_state` —— 直链续传检查点（32 组交叉验证）
- [x] `history` —— 历史（原子写 + 损坏恢复 + win32 路径归一）
- [x] `parse/formats` —— 格式去重与编码优先（18 组交叉验证）
- [x] `parse/shared` —— Cookie 解析、码率估算
- [x] `parse/errors` —— 错误分类 + 脱敏诊断 + Issue 名单
- [x] `parse/youtube_retry` —— YouTube 有限回退（228 组交叉验证）
- [x] `parse/parse` —— **真实解析**（调 yt-dlp，带缓存）
- [x] `update` —— 更新源降级链（156 组交叉验证）
- [x] `server` —— HTTP + WebSocket RPC（容器端）

### Wails 壳

- [x] 窗口 + 绑定方法（9.6 MB 产物 vs Electron 128 MB）
- [x] 数据目录与 Electron 一致（用户数据不丢）
- [x] 下载能力（真实 yt-dlp 跑通）
- [x] 解析能力（真实站点跑通）

### 前端

- [x] `src/` —— i18n（572 词条）、视觉基础、3 个组件
- [x] `demo/lib/backend.ts` —— 后端适配层（浏览器退 mock / Wails 走真绑定）

### 基础设施

- [x] `pnpm audit:provenance` —— 代码来源审计（45.8% 上游存活率）
- [x] `pnpm lint:boundaries` —— 七条架构边界规则
- [x] `pnpm lint:attribution` —— 署名合规（上游代码未归零前不许删 LICENSE）
- [x] `pnpm sync:repo` / `sync:doc-numbers` / `sync:toolchain` —— 三处手工同步
- [x] `pnpm crosscheck:port` —— TS ↔ Go 逐字对拍（493 组）
- [x] `pnpm test:e2e:real` —— 真实 yt-dlp/ffmpeg 端到端
- [x] 仓库迁移到 `Downvid/downvid`（301 重定向已验证，9600 用户更新链路完好）

---

## 进行中

### 后端补齐（按 UI 需要排序）—— **全部完成**

- [x] `DepsDownload` —— 依赖下载 + 流式进度（`internal/deps`，12 条测试）
- [x] `OpenPath` / `ShowInFolder` / `OpenExternal` —— 打开文件/目录/链接
      （`internal/shell`，含两个安全边界：只开存在的路径、只开 http(s)）
- [x] `GetDiskSpace` —— 磁盘剩余空间（目录不存在时退到最近祖先）
- [x] `SettingsGet` / `SettingsSet` —— 设置存到后端（`internal/settings`）
      → 与 TS 版字段名/默认值逐字一致，损坏时报错并留备份
- [x] `FetchImage` —— 带 Referer 抓图（`internal/image`，含大小与类型限制）

### UI 迁移 —— **已完成**

- [x] **`demo/` → `src/`**，演示设施全部移除
      （`DemoPanel` / `mock.ts` / DEMO 按钮 / 40 条 `demo.*` 词条 / URL 状态参数）
- [x] store 全部接后端（解析 / 下载 / 进度 / 暂停 / 历史 / 依赖 / 设置 / 更新 / 系统）
- [x] 加速滑块（bits-ui 负责交互 + 自研能量辐射层）
- [x] 热力图从**真实历史**聚合（原来是 `Math.sin` 生成的假数据）

---

### UI 对接 —— **已完成**

- [x] store 全部接通真实后端（deps / settings / shell / clipboard / update / history / download）
- [x] `app/frontend/src` 正式成为主线渲染进程，移除早期 mock 验证设施
- [x] 加速滑块物理动效优化与 32 节点自适应边界
- [x] 发布 v1.6.0 与 v1.6.1 双架构版本（Wails 单文件免安装 + Electron 存量更新）
- [x] 官网可交互全功能预览（解析/下载体验、设置切换、作者信模态框、深浅色实时预览）

---

## 本轮修复（2026-10-18）

用户报的四个问题，每个都追到了根因；同时补上两条从前没有的 CI 检查。

### 1. 窗口不能调整大小
- 最小尺寸 1000×700 在 13 寸屏分屏（1280×800 的一半）下缩不下去
- 改为 880×560（布局真实可用下限），显式写 `DisableResize: false`
- 880/1024/1200 三档截图验证无横向溢出；860px 补一档侧栏收窄

### 2. 滑块不同步 + 加速不生效（同一根因的两个症状）
- **`updateSetting('maxConnections', value)` 的签名是单参数**，运行时把字符串
  按字符下标展开成 `{0:'m',1:'a',…}`，**一个字段都没改且不报错**
- 48 个 svelte-check 错误长期无人发现（`tsc` 不解析 `.svelte`）
- Go 侧 `accelEnabled`/`accelConnections` 只在 `NewApp()` 初始化，设置永不生效
- `a.proxy` 同样从不从 settings.json 读回（重启后代理「消失」）
- 全部修复；`StartDownload` 原来三次独立探测依赖（最坏 30 秒）改为共享缓存

### 3. aria2 永远显示「未找到」
- 后端 kind 是 `aria2`，设置页按 `aria2c` 查找，永远匹配不到
- `installDep('aria2c')` 传给后端的是非法 kind（静默忽略）
- 新增 `e2e_aria2_test.go`：真实 aria2c 下载 4MB 文件并通过

### 4. 同链接不同清晰度不能继续下载
- 原去重只比 URL → 下过 1080P 就再也下不了 4K
- 判据改为 URL + 清晰度 + 模式，抽成 `lib/dedupe.ts` 纯函数（9 条用例）
- 「已下载」分支保留下载按钮（原来只有一个「打开历史」）
- 文件名补清晰度后缀：否则不同清晰度算出同名文件，yt-dlp 静默跳过并报成功

### CI 已全绿（2026-10-18）

五个工作流全部通过：`CI · Linux` / `CI · macOS` / `CI · Windows` / `Docker image` / `CodeQL`。

之前长期红叉的是七处**互相独立**的问题，都不是「代码写得不对」：

| # | 现象 | 真因 |
| --- | --- | --- |
| 1 | 三个平台的前端 job 都红 | 来源审计数字没跟代码同步（1241 行 / 45.8%） |
| 2 | Windows `scan-broken` 始终失败、单跑必过 | `runtime` 包级扫描预算被并行探测互相 reset（`go test -race` 当场抓到） |
| 3 | Docker 冒烟报「依赖不在 PATH」 | `docker exec <容器> command` —— `command` 是 shell 内建，没有可执行文件，必然 exit 127 |
| 4 | Docker publish 报 invalid tag | GHCR 的 repository 名必须全小写，而 owner 是 `Downvid` |
| 5 | 前端 job 报找不到 `wailsjs` | 那是 `wails generate module` 生成的、被 gitignore 忽略，CI 从没生成过 |
| 6 | `wails generate module` 报 embed 失败 | 鸡生蛋：generate 要编译 Go → 要 `frontend/dist` → 要构建前端 → 要 wailsjs |
| 7 | Windows 集成回归三连红 | Go 侧 `syscall.Kill` 在 Windows 不存在；vm 沙箱缺 `setTimeout`；用例断言了 POSIX 信号语义 |

第 7 条里的 **Go 编译失败是发布级问题**：`process_tree.go` 用了
`syscall.Kill` 与 `SysProcAttr.Setpgid`，这两个在 Windows 上根本不存在，
意味着 `app` 在 Windows 上完全无法构建。本机是 macOS，`go build ./...`
永远看不到它——已拆成 `process_tree.go` / `process_tree_posix.go` /
`process_tree_windows.go` 三个文件，五个目标全部交叉编译通过。

第 3 条也补了机械校验：`lint:workflows` 现在会拒绝
`docker exec <容器> command|test` 这种写法，防止同样的错再犯。

### 新增的两条 CI 检查
| 检查 | 拦什么 |
|---|---|
| `pnpm --dir app/frontend check`（svelte-check） | `.svelte` 里的类型错误，`tsc` 完全看不见 |
| `pnpm lint:i18n:app` | 中英词条不成对、演示文案残留、`t()` 引用了不存在的 key |

两条都做了变异验证（改坏后确认会红）。`lint:workflows` 新增一条规则：
`docker exec <容器> command` 必然 exit 127（`command` 是 shell 内建命令），
docker 工作流的冒烟曾因此长期红。

### 去演示化收尾
- 删掉 40+ 条演示词条（`toast.demoHint`、`hero.sample`、`（演示）` 后缀等）
- 补上 14 个**代码在用但词表里不存在**的 key（原来界面会直接显示 `error.parseFailed` 这种原始 key）
- `打开目录` 三处从「弹演示提示」改成真的调 `openPath` / `showInFolder`

---

## 待办（暂缓）

- [ ] 抖音/快手解析器移植（现用 puppeteer-core，Go 侧要换 CDP 直连）
      → 可行性已验证（CDP HTTP 端点可用），但工作量大，等主流程稳了再做
- [ ] Cookie 读取（从浏览器导出快照）
- [ ] 代理设置（现在只有 yt-dlp 走 `--proxy`，直链下载不走）
      → 已知缺陷，见迁移计划 §5.5

---

## 用户原有诉求（`todolist.md` 旧内容，逐条对照）

- 设置页更新源选择（gitee / 官网 / GitHub / gh-proxy，自动降级）
      → **后端已实现**（`internal/update` 的 `AutoChain`），UI 待接
- 依赖下载加速源 + 依次降级
      → **Go 边车已实现**（`backend/internal/fetch/mirror.go`），UI 待接
- 更新日志读 CHANGELOG 而非 Release Notes
      → 未做
- 飞牛专属格式安装包
      → 未做

---

## 纪律（每步都要守）

1. **`electron/` 一个字节不动**，现有 `pnpm build` 继续可用
2. 每步 `go test -count=1 ./...` + `pnpm vitest run` + `tsc --noEmit` 全绿
3. 新增逻辑必须有测试；**变异验证**（改坏后确认用例会失败）
4. 跨语言逻辑用 `pnpm crosscheck:port` 与 TS 对拍
5. 不删 LICENSE 里的上游版权声明（`pnpm lint:attribution` 会拦）

---

## 前端依赖策略

只加**解决了真实问题**的依赖。目前仅一个：

| 依赖 | 版本 | 为什么加 | 体积代价 |
|---|---|---|---|
| `bits-ui` | 2.19.5 | 滑块的手搓版本在「拖拽捕获 / 键盘 / 无障碍」上反复出问题（指针捕获在 WebView 里不稳、方向键没处理、`aria-valuetext` 与实际值不符）。这是 shadcn-svelte 的官方底座，Svelte 5 原生 runes 实现 | JS +34 KB（gzip +11 KB） |

其余一律不引：没有 UI 组件库、没有状态管理库、没有动画库、没有 `vue-i18n` 式的
i18n 库（只有两种语言，`Record` + `$state` 就够）。
