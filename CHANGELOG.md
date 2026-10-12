# Changelog

本文件记录 DownVid 的所有版本更新。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

## [Unreleased]

### 文档与工程规范
- 新增 [安全政策](./SECURITY.md)（漏洞报告渠道、响应时限、安全边界与已知取舍）、[贡献者行为准则](./CODE_OF_CONDUCT.md)
- 新增 [仓库规范](./docs/standards.md)：分支/提交规范、Issue 与 PR 流程、**改动落点清单**（IPC 三处同步、设置形状、运行依赖、发布产物的同步要求）、废弃流程与依赖引入原则
- 新增 [发布流程](./docs/release.md)：版本语义（哪些改动属于 MAJOR）、发布步骤、**产物命名契约**（改名会让存量用户无法自动更新）、更新清单生成方式、回滚预案
- 新增 `.github/CODEOWNERS`，发布与供应链相关路径（workflows、updater、依赖清单）纳入必需评审
- 修正架构文档：删除了已不存在的 `bin/<platform>/<arch>` 内置二进制描述，改为 Go 依赖边车（探测 + 下载）与 `deps:*` IPC
- 补齐 CI 安全能力：新增 CodeQL 扫描（TypeScript/Vue + Go）与 Dependency Review（高危拦截 + 许可证白名单）；全部 job 补 `timeout-minutes`，GitHub Actions 版本统一并升到最新主版本
- Dependabot 增加 Go 模块与分组提交信息，忽略 Electron 大版本（原生 ABI 变更需人工验证）

### 内部改进（工程规范）
- 仓库坐标与外部链接集中到 `shared/app.ts`（此前散落在 9 处，改仓库需全局搜索且极易漏改），新增 `pnpm lint:ipc` 静态校验 IPC 三处同步、`src/env.d.ts` 的全局脚本约束、以及产物命名契约
- 拆分超长文件：`electron/ipc/download.ts` 445 → 95 行（直链/yt-dlp/进度上报拆到 `electron/download/`）；`douyin.ts` 与 `kuaishou.ts` 抽出共用的 `parsers/shared.ts`；`UpdateModal.vue` 467 → 344 行（更新状态机抽为 `composables/useUpdater.ts`）
- `buildYtdlpArgs` 改为纯函数；顺带修正非 Electron 环境下缺 JS 运行时被静默跳过的问题
- 引入 Vitest 与 47 个纯逻辑单测（格式选择、依赖错误识别、yt-dlp 参数组装、解析器共用工具、更新状态机），已接入 CI

### 变更（破坏性）
- **安装包不再内置 yt-dlp 与 ffmpeg**：启动时由新增的 Go 依赖边车（`backend/cmd/downvid-deps`）按「系统优先」的顺序识别机器上已安装的版本并直接复用——手动指定的路径 → `userData/runtime/bin/` 托管目录 → 登录 shell 的 `PATH` 与各平台常见安装目录（Homebrew / MacPorts / scoop / winget / apt 等）。macOS / Linux 从桌面启动时 `PATH` 很精简，边车会额外执行一次登录 shell 来补全 `~/.local/bin`、`/opt/homebrew/bin` 等目录
- 安装包体积因此大幅下降（此前每个架构约 80 MB，现仅携带约 10 MB 边车）；仓库移除 `bin/` 目录与 Git LFS 追踪，不再把二进制提交进版本库

### 新增
- 依赖检测不到时可一键下载：「设置 → 运行依赖」常驻依赖管理板块（显示来源、版本、路径、缺失原因，支持逐个下载/更新/取消、打开安装目录）；解析或下载因缺依赖失败时也会弹出「下载并继续」引导
- 依赖下载带 SHA-256 校验，先校验后解压安装，写入 `userData/runtime/bin/`，不污染系统；支持 API 代理设置。macOS 上自动去除隔离属性并做 ad-hoc 签名（否则 Apple Silicon 会直接 `killed: 9`）
- 进阶设置可手动指定 yt-dlp / ffmpeg / ffprobe 的绝对路径，自动检测不到或要固定版本时使用
- Go 侧车带有单元测试（版本解析、候选路径优先级、下载校验与重试、进度上报、清单完整性），CI 会运行 `gofmt` / `go vet` / `go test`
- 新增 `pnpm deps:manifest` 与 `Update dependencies manifest` 工作流：从上游抓取版本号与 SHA-256 生成清单，`pnpm deps:manifest:check` 在 CI 中校验清单未落后

### 移除
- `bin/` 目录、`bin/download-deps.sh` 与 `pnpm download-deps*` 系列脚本
- `Update binaries` 工作流（由 `Update dependencies manifest` 取代）
- `.gitattributes` 中的 LFS 追踪规则

---

## [1.2.1] - 2026-09-27

### 修复
- macOS 上解析全部失败，报 `EEXIST: file already exists, mkdir '.../downvid/cookies'`（#31）：macOS/Windows 文件系统不区分大小写，Cookie 快照目录 `cookies` 与 Electron 自身的 `Cookies` 数据库文件冲突。目录改名为 `ytdlp-cookies`；目录不可用时退回系统临时目录，仍不可用则不导出快照；Cookie 准备阶段的任何异常只跳过该来源，不再导致解析失败
- 浏览器 Cookie 读取失败（如 Windows 上 Chrome 运行中报 `Could not copy Chrome cookie database`，#9）时，解析不再整体失败而是继续尝试其他来源；若视频最终仍需要登录，错误弹窗会给出具体解决办法（退出浏览器重试、改用 Firefox 登录、手动导入 cookies.txt）

---

## [1.2.0] - 2026-09-26

### 新增
- 抖音/快手直链支持多连接分段下载（CDN 限速场景下提速约 4 倍），分段失败自动断点重试，并支持暂停
- HLS/DASH 分片并发下载；下载直接复用解析结果，不再重复解析，开始下载更快
- 下载进度显示速度、剩余时间与文件大小（此前这些字段始终为空）
- 应用内更新：macOS 支持自动下载安装（自动去除隔离属性并重新签名，安装失败自动回滚）；启动时自动移除应用自身的隔离属性
- 便携版、tar.gz 等不支持自动安装的方式，检测到新版本时引导前往下载页
- 关于页完整展示所有贡献者，包含匿名作者、Bot 与 AI 共同作者
- Windows 便携版随版本一同发布（`DownVid-Portable-x.y.z.exe`）

### 修复
- X (Twitter) 视频无法下载：解析时格式被全部过滤；下载时选择器退化为只下载音频；多视频推文解析失败；访客接口失败时自动回退
- 浏览器 Cookie 读取失败（Chrome 运行中锁库、Windows 解密失败、macOS 钥匙串等）导致解析/下载整体失败：现依次尝试各浏览器 → Cookie 快照 → 无 Cookie，并在下载时复用解析时的 Cookie
- Linux 内置 ffmpeg 读取 MPEG-TS 时崩溃，HLS 视频合并全部失败
- macOS Apple Silicon 内置的 ffmpeg 实为 x86_64 版本（需 Rosetta 转译，合并缓慢，无 Rosetta 时失败），替换为原生 arm64
- 存储空间始终显示"未知"（Windows 11 24H2 已移除 wmic；下载目录不存在时查询失败；目录切换后不刷新）
- 应用内更新：下载完成后界面一直停留在"正在下载"；启动自动检查新版本不弹窗；检查时即在后台静默下载；更新请求不走设置的代理
- Windows 自动更新校验失败：安装包被同名便携版覆盖，与更新清单不一致（旧版本升级到本版本起恢复正常）
- Linux deb/rpm 安装无法自动更新：更新清单缺少对应安装包
- 贡献者头像上的 DEV/BOT 标签与悬停名称被裁切不可见
- 依赖升级后构建失败：TypeScript 回退至 5.x（vue-tsc 不支持 TypeScript 7），样式迁移至 Tailwind CSS v4
- 设置面板左侧导航选中项背景色此前未生效

### 变更
- 内置 yt-dlp 更新至 nightly 2026.09.16，ffmpeg 更新至 8.1（Windows/Linux）
- 更新失败时给出具体原因（网络、校验、限流、权限、磁盘空间），并提供重试与"前往下载页手动更新"

### 说明
- macOS 1.1.0 及更早版本的应用内更新依赖代码签名，无法完成，请手动下载安装一次本版本，此后即可应用内自动更新
- Windows 与 Linux (AppImage/deb/rpm) 旧版本可直接通过应用内更新升级

---

## [1.1.0] - 2026-08-24

### 新增
- 自定义错误弹窗：可复制错误信息 + 一键提交 GitHub Issue
- 代理设置：全局代理支持 http/https/socks5，保存即生效，带连接测试
- 启动时自动检查更新，有新版本自动弹窗提醒
- 解析结果缓存：同一 URL 30 分钟内重复解析秒出
- 任务队列实时显示磁盘可用空间
- 贡献者页面显示 Bot 标签和开发者标签
- macOS/Windows/Linux 窗口行为适配：自定义标题栏、拖拽、窗口控制按钮
- 设置页面改为右侧浮层面板 + 左侧栏分类导航（下载/Cookies/代理）
- 解析结果分辨率标签智能清理：自动将 `1080p60`、`hd1080`、`sd480` 等格式转为标准显示
- Puppeteer 浏览器实例复用池，解析速度大幅提升
- GitHub Dependabot 自动依赖更新

### 修复
- 下载任务 status 误设为 downloading 导致 IPC 调用永不执行
- 下载历史"打开文件夹"在 macOS 上路径错误（Windows 路径分隔符问题）
- 进度条超过 100% 的问题
- 进度条动画平滑度优化（指数衰减）
- 文件大小估算逻辑：优先使用平台提供的 quality_label 而非像素推算
- 下载进度实时更新：stderr 进度解析 + 本地速度计算兜底
- 所有 alert() 替换为自定义弹窗
- 解析流程添加顶层 try-catch，防止未捕获异常导致 renderer 崩溃
- Renderer 崩溃后自动重载

### 变更
- 进度更新节流从 500ms 降至 200ms
- yt-dlp 解析添加 `--no-warnings --quiet` 减少开销
- 自动更新不再需要手动点击检查

---

## [1.0.0] - 2026-08-23

### 新增
- 支持抖音无水印视频下载
- 支持快手无水印视频下载
- 支持 B站、YouTube、Instagram 等 1000+ 平台
- 多画质选择 (360p/480p/720p/1080p)
- 实时下载进度显示
- 下载队列管理
- Cookie 支持 (YouTube/B站登录)
- YouTube 多音轨选择
- 字幕下载
- 纯音频下载模式
- 下载历史记录
- 深色/浅色主题
### 修复
- 开启GPU加速

