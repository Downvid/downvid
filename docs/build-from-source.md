# 从源码构建

本文档详细介绍如何从源码构建 DownVid。

---

## 目录

- [环境要求](#环境要求)
- [安装步骤](#安装步骤)
- [运行开发模式](#运行开发模式)
- [构建生产版本](#构建生产版本)
- [常见构建问题](#常见构建问题)

---

## 环境要求

| 工具 | 最低版本 | 推荐版本 | 说明 |
|------|---------|---------|------|
| [Node.js](https://nodejs.org/) | >= 18 | 22 LTS | JavaScript 运行时 |
| [pnpm](https://pnpm.io/) | >= 8 | 11 | 包管理器（不要用 npm 或 yarn） |
| [Git](https://git-scm.com/) | 任意 | 最新 | 版本控制 |

### 检查版本

```bash
node --version    # 应显示 v18.x.x 或更高
pnpm --version    # 应显示 8.x.x 或更高
git --version     # 任意版本即可
```

### 安装 pnpm（如果还没装）

```bash
# 方法一：npm 全局安装
npm install -g pnpm

# 方法二：macOS Homebrew
brew install pnpm

# 方法三：官方脚本（Linux/macOS）
curl -fsSL https://get.pnpm.io/install.sh | sh -
```

> ⚠️ **不要用 npm 或 yarn！** 本项目使用 pnpm 的 workspace 功能，用 npm 或 yarn 安装依赖会导致构建失败。

---

## 安装步骤

### 1. 克隆仓库

```bash
git clone https://github.com/yxxbc/downvid.git
cd downvid
```

### 2. 安装项目依赖

```bash
pnpm install
```

> ⚠️ **必须先运行 `pnpm install`，再运行后续命令。**

另外需要 **Go 1.24+**：依赖边车（`backend/cmd/downvid-deps`）在 `pnpm dev` / `pnpm vite build` 时会一起编译。
`goBackend()` 插件会一次性交叉编译当前系统的全部架构，这样在同一台机器上产出多架构安装包时都不会缺文件。

### 3. 运行依赖（yt-dlp / ffmpeg）

**安装包不再内置这两个工具**，所以构建前无需下载任何二进制。运行时会由 Go 边车按「系统优先」的顺序自动查找：

1. 设置里手动指定的路径
2. DownVid 数据目录下的托管版本（`userData/runtime/bin/`，由界面上的下载按钮安装）
3. 登录 shell 的 `PATH` 与各平台常见安装目录（Homebrew、MacPorts、`/usr/local/bin`、scoop、winget、apt 等）
4. 裸命令名交给 `PATH` 兜底

> ⚠️ macOS / Linux 上从桌面或 Finder 启动的应用只能拿到很精简的 `PATH`，
> 因此边车会额外执行一次登录 shell（`$SHELL -l -c 'printf %s "$PATH"'`）来补全
> `~/.local/bin`、`/opt/homebrew/bin` 这类目录——这是"能识别到系统安装"的关键。

#### 如果你更希望自己装一份

```bash
brew install yt-dlp ffmpeg                    # macOS
sudo apt install yt-dlp ffmpeg                # Ubuntu / Debian
winget install yt-dlp.yt-dlp Gyan.FFmpeg      # Windows
```

装了就会被自动识别并复用；没装也能在应用内一键下载，不影响开发。

#### 验证边车能识别到

```bash
# 编译并直接跑一次探测（会打印每个依赖的路径、版本与来源）
cd backend && go build -o /tmp/downvid-deps ./cmd/downvid-deps
/tmp/downvid-deps detect --managed-dir /tmp/downvid-runtime --json
```

#### 关于仓库里的清单文件

`backend/internal/manifest/assets.gen.go` 记录应用内下载时使用的版本与 SHA-256，
由 `pnpm deps:manifest` 生成。要升级依赖跑一次该命令（或手动运行
`Update dependencies manifest` 工作流）即可，不需要把二进制提交进仓库。

---

---

## 运行开发模式

```bash
pnpm dev
```

这会同时启动：
- **Vite 开发服务器**（前端热重载）
- **Electron 主进程**（自动重启）

修改代码后，渲染进程（Vue）会自动热重载，主进程（Electron）会自动重启。

### 开发模式注意事项

- 修改 `src/` 目录下的文件 → 浏览器自动刷新
- 修改 `electron/` 目录下的文件 → Electron 自动重启
- 修改 `electron/preload.ts` → 需要手动重启（因为 preload 只加载一次）
- 修改 `vite.config.ts` → 需要手动重启

---

## 构建生产版本

### 构建当前平台

```bash
pnpm build
```

这会依次执行：
1. `vue-tsc --noEmit` — TypeScript 类型检查
2. `vite build` — 构建渲染进程代码
3. `electron-builder` — 打包 Electron 应用

### 构建指定平台

```bash
# macOS
pnpm build:mac          # 通用（同时构建 ARM64 和 x64）
pnpm build:mac:arm64    # 只构建 Apple Silicon 版本
pnpm build:mac:x64      # 只构建 Intel 版本

# Windows
pnpm build:win          # 只构建 x64 版本

# Linux
pnpm build:linux        # 通用（同时构建 x64 和 ARM64）
pnpm build:linux:x64    # 只构建 x64 版本
pnpm build:linux:arm64  # 只构建 ARM64 版本
```

### Linux x64 并行构建

Linux x64 有 4 种打包格式（AppImage、deb、rpm、tar.gz），可以并行构建加速：

```bash
# 在 4 个终端中分别运行：
pnpm build:linux:x64:appimage
pnpm build:linux:x64:deb
pnpm build:linux:x64:rpm
pnpm build:linux:x64:tar.gz
```

### 构建输出

构建完成后，输出文件在 `release/` 目录下：

```
release/
└── 1.0.0/
    ├── DownVid-arm64-Mac-1.0.0.dmg
    ├── DownVid-arm64-Mac-1.0.0.zip
    ├── DownVid-x64-Mac-1.0.0.dmg
    ├── DownVid-x64-Mac-1.0.0.zip
    ├── DownVid-Setup-1.0.0.exe
    ├── DownVid-x64-Linux-1.0.0.AppImage
    ├── DownVid-x64-Linux-1.0.0.deb
    ├── DownVid-x64-Linux-1.0.0.rpm
    └── DownVid-x64-Linux-1.0.0.tar.gz
```

---

## 常见构建问题

### 问题：`pnpm install` 失败

**错误信息：** `ERR_PNPM_NO_NODE_ENV` 或类似错误

**解决方案：**

```bash
# 清除缓存
rm -rf node_modules
rm -rf ~/.pnpm-store
pnpm store prune

# 重新安装
pnpm install
```

### 问题：`vue-tsc` 类型检查失败

**错误信息：** `TS2339: Property 'xxx' does not exist on type...`

**解决方案：**
- 这通常是 TypeScript 严格模式报错
- 检查你修改的文件中是否有未使用的 import（`noUnusedLocals` 和 `noUnusedParameters` 开启了）
- 删除未使用的 import 即可

### 问题：`electron-builder` 打包失败

**错误信息：** `Error: Cannot find module 'xxx'`

**解决方案：**

```bash
# 清除 electron-builder 缓存
rm -rf ~/Library/Application\ Support/electron-builder/Cache
rm -rf ~/.cache/electron-builder

# 重新构建
pnpm build
```

### 问题：macOS 打包提示 "No identity found"

**错误信息：** `No identity found for signing`

**解决方案：**
这是正常的。项目的 electron-builder 配置中 `identity: null` 表示不做代码签名。如果构建脚本报这个错，可能是配置问题，检查 `electron-builder.json5` 中的 `mac.identity` 是否为 `null`。

### 问题：构建出的应用无法运行

**可能原因：**
1. 依赖没有被识别到（在「设置 → 运行依赖」里点「重新检测」查看具体原因）
2. 边车没有打进包里（`backend/build/<platform>-<arch>/downvid-deps` 缺失）
3. 应用内下载的依赖损坏（校验失败）

**解决方案：**

```bash
# 确认边车构建产物存在；缺失时重新构建
pnpm deps:build
ls backend/build/*/downvid-deps

# 依赖损坏时，在应用内「设置 → 运行依赖」点该依赖的「更新」重新下载
```

### 问题：Windows 上构建很慢

**解决方案：**
Windows 上的 electron-builder 需要下载一些工具（如 NSIS），如果网络不好会很慢。可以设置代理或使用国内镜像。

---

## 下一步

- 遇到问题？查看 [故障排除指南](./troubleshooting.md)
- 有疑问？查看 [常见问题](./faq.md)
