# 运行依赖（yt-dlp / ffmpeg / aria2）

> 从 `AGENTS.md` 拆出，内容未改动。

**安装包不携带这些二进制**。探测**只认两个位置**，三端完全一致：

1. 设置里手动指定的路径（**只对探测生效**）
2. `~/.downvid/runtime/bin/`（DownVid 下载的，可覆盖更新；旧版 `userData/runtime/bin` 会自动搬过来）

**不再扫描系统 PATH / Homebrew / WinGet / 常见安装目录**：混合来源（ffmpeg 来自 Homebrew、
yt-dlp 来自托管）会让三端表现各异、排障时说不清跑的是哪一份。缺了就由边车下载到同一目录。
登录 shell 的 PATH 仍会被合并（`LivePath` / `EnsureChildPath`），但只用于**让托管的 zipapp 找到
合格的 Python 3.11+**，不参与依赖探测。

## 边车（`backend/`）

只有两个子命令：`detect`（探测，输出 NDJSON）与 `fetch`（下载安装）。
**stdout 只放 JSON，日志一律走 stderr**。

- 只用 Go 标准库：它要被交叉编译成 5 个平台的二进制打进主程序，可审计性优先。
- `probe` 解析版本号；`runtime` 决定候选路径与优先级；`fetch` 负责下载、
  SHA-256 校验、解压、原子替换；`manifest` 只读生成的清单；`cli` 负责 NDJSON 输出。
- gzip 产物的校验针对**压缩文件本身**，校验通过后才解压安装。
- 先写 `.part` 再原子 rename，失败不会留下半个可执行文件。
- macOS 安装后必须 `xattr -c` + `codesign --force --sign -`：
  网络下载的可执行文件带 quarantine，Apple Silicon 会直接 `killed: 9`。
- 错误信息里的 URL 会去掉查询串（GitHub 的签名 JWT 长达数百字符）。

## 探测预算（数字各有唯一来源，不要在多处重复书写）

- 检测总时限 **80 秒**：`rt.DetectTimeout`
- 每个依赖 45 秒；候选执行预算：托管副本与手动路径 15 秒（`probe.CandidateTimeout`）

**这几个数字不能随手调小**：yt-dlp 官方 macOS 构建（PyInstaller，约 37MB）`--version`
本机实测要 8～10 秒、首次执行最慢 12.4 秒，而 zipapp 只要 0.2 秒——托管副本预算一旦低于
15 秒，**刚下载好的副本会被判为「执行超时，文件可能损坏」**。

`probe.run` 的 `cmd.WaitDelay` **不能删**：超时只杀直接子进程，而候选可能是 shell 脚本或
PyInstaller 启动器，孙进程仍持有 stdout 管道，`cmd.Run()` 会一直等 I/O。

## 下载源镜像回退

资产全在 `github.com/.../releases/download/...`，国内网络下这个域名连不上就等于
**依赖装不上、整个应用不可用**。链路是 `GitHub 直连 → gh-proxy.com → ghproxy.net → ghfast.top`，
任一成功即停止（`backend/internal/fetch/mirror.go`）。只改写**真的托管在 GitHub release 上的地址**
（`isUpstreamGitHub`），自建对象存储与测试里的 httptest 必须原样直连。

## Wails 侧打包

- 边车由 `app/scripts/build.sh` 编译到 `app/internal/sidecar/bin/<goos>-<goarch>/`，
  再带 `-tags withsidecar` 用 `//go:embed` 嵌进主二进制；运行时落到
  `~/.downvid/runtime/bin/downvid-deps`。
- 不带 `-tags withsidecar` 的构建（`go test`、普通 `go build`、直接 `wails build`）
  会走 stub：编译能过，但依赖页只剩「探测程序缺失」。这是刻意设计。
- 探测结果里 `Source`（system / managed / manual / scanned）与 `Form`（zipapp / native）
  要在界面上如实展示：`native` 首次执行可能 9~12 秒，不代表文件坏了。

## 升级依赖清单

`pnpm deps:manifest`（或手动运行 `Update dependencies manifest` 工作流）。
清单落后 / 哈希失配会让用户端「下载即校验失败」，所以 CI 会跑 `deps:manifest:check`。

ffmpeg 选 ffmpeg-static 而非 BtbN：体积更小、gzip 单文件便于校验，且带
libmp3lame / aac / libx264。**代价**：上游不公布校验值，`deps:manifest` 需把每个 gzip
完整下载后自算。

---
