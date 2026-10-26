# 从源码构建

本文档说明如何从源码构建 DownVid（Go + Wails + Svelte 5 单文件产物）。

---

## 目录

- [环境要求](#环境要求)
- [安装步骤](#安装步骤)
- [运行开发模式](#运行开发模式)
- [构建生产版本](#构建生产版本)
- [常见构建问题](#常见构建问题)

---

## 环境要求

| 工具 | 最低版本 | 说明 |
|------|---------|------|
| [Node.js](https://nodejs.org/) | ≥ 22 | 构建前端与运行校验脚本 |
| [pnpm](https://pnpm.io/) | ≥ 8 | 包管理器（不要用 npm 或 yarn） |
| [Go](https://go.dev/) | ≥ 1.25 | 核心与依赖边车 |
| [Wails CLI](https://wails.io/) | v2.16 | 桌面壳构建 |
| [Git](https://git-scm.com/) | 任意 | 版本控制 |

```bash
node --version    # v22+
pnpm --version    # 8+
go version        # go1.25+
wails version     # v2.16.0

# 没装 Wails CLI 时：
go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0
```

Wails 的系统依赖（Linux 需要 GTK / WebKit 开发包）：

```bash
# Ubuntu / Debian
sudo apt install build-essential pkg-config libgtk-3-dev \
  libwebkit2gtk-4.0-dev libayatana-appindicator3-dev
```

> Wails v2.16 默认找 `webkit2gtk-4.0`。只装 4.1 会以
> 「Package webkit2gtk-4.0 was not found」失败——那不是缺 4.1，而是缺 4.0。

---

## 安装步骤

```bash
git clone https://github.com/Downvid/downvid.git
cd downvid
pnpm install
pnpm --dir app/frontend install   # app/frontend 是独立包，不在根 workspace
```

### 运行依赖（yt-dlp / ffmpeg / aria2c）

**安装包不携带这些工具**，构建前无需下载任何二进制。运行时由 Go 边车按「系统优先」查找：

1. 设置里手动指定的路径（只对探测生效）
2. `~/.downvid/runtime/bin/`（由界面上的下载按钮安装；历史文件 `download-history.json` 也在这个目录下）
3. 登录 shell 的 `PATH` 与各平台常见安装目录
4. 裸命令名交给 `PATH` 兜底

macOS / Linux 上从 Finder 或桌面启动的应用只能拿到很精简的 `PATH`，
因此边车会额外执行一次登录 shell 来补全 `~/.local/bin`、`/opt/homebrew/bin` 这类目录。

自己装一份也行（装了就会被自动识别）：

```bash
brew install yt-dlp ffmpeg                    # macOS
sudo apt install yt-dlp ffmpeg                # Ubuntu / Debian
winget install yt-dlp.yt-dlp Gyan.FFmpeg      # Windows
```

验证边车能识别到：

```bash
cd backend && go build -o /tmp/downvid-deps ./cmd/downvid-deps
/tmp/downvid-deps detect --managed-dir /tmp/downvid-runtime --json
```

### 关于仓库里的清单文件

`backend/internal/manifest/assets.gen.go` 记录应用内下载时使用的版本与 SHA-256，
由 `pnpm deps:manifest` 生成（或手动运行 `Update dependencies manifest` 工作流）。
不需要把二进制提交进仓库。

---

## 运行开发模式

```bash
(cd app && wails dev)
```

前端热重载；Go 侧改动会重新编译并重启应用。只调界面时也可以：

```bash
pnpm --dir app/frontend dev      # 浏览器里跑前端（后端不可用，界面走空状态）
```

### 开发模式注意事项

- `wails dev` **不带依赖边车**：依赖页只会显示「探测程序缺失」。
  要验证依赖探测 / 下载 / 自更新，必须用 `build.sh` 的产物。
- `wailsjs/` 是生成的（`wails generate module`），不入库。没生成时前端会报
  `Cannot find module '../../wailsjs/go/main/App'`。
- 生成绑定的顺序：**准备 embed 目录 → 构建前端 → 生成绑定**。
  `wails generate module` 会先编译 Go 包，而 `app/main.go` 里有
  `//go:embed all:frontend/dist`，`dist` 不存在时编译直接失败。

---

## 构建生产版本

```bash
bash app/scripts/build.sh                          # 当前平台
bash app/scripts/build.sh -platform darwin/arm64
bash app/scripts/build.sh -platform darwin/universal   # 边车会为 arm64 + amd64 各编一份
bash app/scripts/build.sh -platform windows/amd64
bash app/scripts/build.sh -platform linux/amd64
```

`build.sh` 做三件事：

1. 编译依赖边车到 `app/internal/sidecar/bin/<goos>-<goarch>/`
2. 准备 embed 目录并生成 Wails 绑定
3. 带 `-tags withsidecar` 构建，产物在 `app/build/bin/`

> **不要直接 `wails build`**：那样打出来的应用没有边车，用户看到的是「依赖页只剩一条」。
> 这个故障真实发生过。

---

## 常见构建问题

### 问题：`pattern all:frontend/dist: no matching files found`

`wails generate module` 先编译 Go 包，而 `app/main.go` 需要 `frontend/dist` 存在。
先跑 `bash app/scripts/prepare-embed-dir.sh`，再生成绑定。

### 问题：`Package webkit2gtk-4.0 was not found`

Linux 上装的是 4.1 开发包。Wails v2.16 的默认 cgo 指令找 4.0；
要么装 `libwebkit2gtk-4.0-dev`，要么给 Wails 加 `-tags webkit2_41`。

### 问题：`gofmt -l` 列出了一堆文件

Windows 上 `core.autocrlf=true` 会让检出即为 CRLF，而 CRLF 不是 gofmt 的输出。
仓库根部的 `.gitattributes`（`* text=auto eol=lf`）负责统一为 LF，**不要删除**。

### 问题：构建出的应用无法运行 / 依赖页是空的

1. 确认用的是 `build.sh` 的产物，而不是 `wails dev` 或裸 `wails build`
2. 在「设置 → 运行依赖」点「重新检测」，看每个依赖的 `source` 与 `form`
3. 依赖损坏时点该项的「更新」重新下载

### 问题：macOS 首次打开提示「无法验证开发者」

项目没有付费商业证书。右键应用 → 打开，或去「系统设置 → 隐私与安全性」放行。

---

## 下一步

- 遇到问题？查看 [故障排除指南](./troubleshooting.md)
- 有疑问？查看 [常见问题](./faq.md)
