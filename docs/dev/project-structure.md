# 项目结构

> 从 `AGENTS.md` 拆出，内容未改动。

| 路径 | 内容 | 输出 |
|------|------|------|
| `app/internal/*` | **Go 核心，16 个包，互相零依赖** | — |
| `app/main.go` / `app/app.go` / `app/bindings_*.go` | Wails 壳：只做「搬运」，不含业务规则 | `app/build/bin/` |
| `app/frontend/` | Svelte 5 + Vite 渲染进程 | 打进二进制（`go:embed`） |
| `app/scripts/build.sh` | **构建入口**：先编依赖边车 → 再带 `-tags withsidecar` 构建 | 单文件约 18 MB |
| `app/cmd/downvid-server` | 无头模式入口（HTTP + WebSocket RPC，`app/internal/server`） | 独立二进制（尚未接前端） |
| `backend/` | Go 依赖边车（探测 + 下载 yt-dlp/ffmpeg/aria2） | 嵌进主二进制 |
| `shared/` | 前端与脚本共用的契约：仓库坐标、更新源、加速配置、解析错误分类 | — |
| `scripts/` | 校验 / 生成 / 发布脚本（零依赖，只用 Node 标准库） | — |
| `tests/` | 根目录纯逻辑单测（shared/ 与脚本） | — |
| `website/` | 产品落地页（无构建，Vercel 发布） | — |
| `docs/` | 安装、构建、发布、维护文档 | — |

`app/internal/*` 的 16 个包：

| 包 | 职责 |
|---|---|
| `changelog` | 解析仓库 `CHANGELOG.md` 的副本（`//go:embed` 不能跨目录，靠 `pnpm sync:changelog` 同步） |
| `clipboard` | 读系统剪贴板（WebView 的 `navigator.clipboard` 会弹权限框） |
| `cookie` | Cookie 策略、浏览器 Cookie 提取与快照 |
| `deps` | 依赖探测与下载：起边车、把 NDJSON 流转成事件，不重复实现候选表 |
| `download` | yt-dlp 参数、进度行、进程树终止、aria2 进度 |
| `fetch` | 直链分块下载与续传检查点 |
| `history` | 下载历史（原子写 + 损坏恢复 + win32 路径归一） |
| `image` | 带 Referer 抓缩略图并转 data URL（防盗链） |
| `jsruntime` | Node / Deno 探测（YouTube 需要真实 JS 运行时） |
| `netx` | 带代理的 HTTP 客户端与代理探活 |
| `parse` | 站点解析、格式去重、错误分类、YouTube 有限回退 |
| `server` | 无头模式的 HTTP + WebSocket RPC |
| `settings` | 用户设置（14 个字段，落盘到数据目录的 settings.json） |
| `shell` | 打开路径 / 在文件夹中显示 / 磁盘剩余空间 |
| `sidecar` | 把依赖边车嵌进主二进制并在运行时落盘 |
| `update` | 更新发现/下载（wmlUpdate）、原生自更新安装、产物识别 |

`app/internal/*` 之间**不得互相 import**（`pnpm lint:boundaries` 规则 G1 校验），
也不得依赖 `cmd`（G2）。这是架构上最值得守住的性质：每个包都能独立测试、独立替换。

---
