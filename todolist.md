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

### UI 迁移（你负责）

- [x] **`demo/` → `src/`**（正式前端），旧验证页已删除
- [ ] store 接后端（3 处：`finishParse` / 进度订阅 / `togglePause`）
- [x] 加速滑块接入能量辐射层（辐射效果自研 + **bits-ui 负责交互**）

---

### UI 对接（下一步）

- [ ] 你的 store 接后端（`demo/lib/backend.ts` 已就绪，需扩到 deps / settings / shell）
- [ ] 把 `demo/` 定为正式 `src/`，删掉早期验证页

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
