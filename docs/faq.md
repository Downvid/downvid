# 常见问题 (FAQ)

---

## 目录

- [基础问题](#基础问题)
- [下载相关](#下载相关)
- [安装和运行](#安装和运行)
- [技术相关](#技术相关)

---

## 基础问题

### DownVid 是免费的吗？

是的，DownVid 是完全免费的开源项目，基于 MIT 协议开源。

---

### DownVid 支持哪些平台？

| 平台 | 架构 | 支持状态 |
|------|------|---------|
| macOS | Apple Silicon (M1/M2/M3/M4) | ✅ 完全支持 |
| macOS | Intel (x64) | ✅ 完全支持 |
| Windows | x64 | ✅ 完全支持 |
| Linux | x64 | ✅ 完全支持 |
| Linux | ARM64 | ✅ 完全支持 |

---

### DownVid 和 yt-dlp 有什么关系？

DownVid 是一个图形界面工具，底层使用 yt-dlp 作为下载引擎。简单来说：
- **yt-dlp** = 命令行工具，功能强大但需要输入命令
- **DownVid** = 图形界面，让你用鼠标点击就能下载视频

DownVid 会自动处理 yt-dlp 的命令行参数，你只需要粘贴链接、选择画质、点击下载。

**DownVid 不内置 yt-dlp 和 ffmpeg**：启动时会自动识别你机器上已经装好的版本并直接复用；
如果没装，「设置 → 运行依赖」里点一下就能自动下载安装（带 SHA-256 校验，放在 DownVid 自己的数据目录里）。
这样安装包更小，也不会重复占用磁盘。

---

### DownVid 安全吗？

DownVid 是开源项目，代码完全公开，任何人都可以审计。DownVid 本身只是一个下载工具，不会：
- ❌ 窃取你的个人信息
- ❌ 植入广告或恶意软件
- ❌ 修改你的系统文件
- ❌ 收集你的下载记录（下载历史只保存在本地）

---

### DownVid 会下载版权内容吗？

DownVid 只是一个工具，就像浏览器一样。用户应该遵守当地法律法规，仅下载自己有权下载的内容。

---

## 下载相关

### 支持下载哪些网站的视频？

DownVid 通过 yt-dlp 支持 **1000+ 个**网站，包括但不限于：

| 分类 | 平台 |
|------|------|
| 国内 | 抖音、B站、小红书、快手、西瓜视频 |
| 国际 | YouTube、Instagram、TikTok、Twitter/X、Facebook |
| 其他 | 几乎所有 yt-dlp 支持的网站 |

完整列表请查看 [yt-dlp 支持网站](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md)。

---

### 最高支持多少画质？

取决于源平台提供的画质选项：

| 平台 | 通常最高画质 |
|------|------------|
| YouTube | 4K / 8K（如果源视频支持） |
| 抖音 | 1080p（无水印） |
| B站 | 1080p / 4K（需要登录） |
| Instagram | 1080p |
| 小红书 | 1080p |

DownVid 会列出所有可用的画质选项供你选择。

---

### 可以只下载音频吗？

可以。在格式选择界面选择"仅音频"模式即可。支持的格式：
- MP3（默认）
- 其他格式取决于源平台

---

### 可以下载字幕吗？

可以。对于支持字幕的视频（如 YouTube），你可以在格式选择界面选择下载字幕。

---

### 下载的视频在哪里？

默认下载到系统的"下载"文件夹：
- macOS: `~/Downloads/`
- Windows: `C:\Users\用户名\Downloads\`
- Linux: `~/Downloads/`

你可以在设置中修改下载目录。

---

### 下载的视频文件名是什么？

默认格式：`视频标题.扩展名`

你可以在设置中自定义文件名模板，支持 yt-dlp 的模板语法：
- `%(title)s` — 视频标题
- `%(uploader)s` — 上传者
- `%(id)s` — 视频 ID
- `%(ext)s` — 扩展名

---

### 可以批量下载吗？

目前 DownVid 每次只能解析一个链接。但你可以：
1. 下载完成后立即解析下一个链接
2. 下载任务会在队列中自动处理

---

### 可以下载播放列表吗？

目前不支持整个播放列表下载。yt-dlp 本身支持播放列表，但 DownVid 的界面目前只处理单个视频。

---

### 可以下载直播吗？

目前不支持直播下载。DownVid 专注于点播视频下载。

---

## 安装和运行

### Releases 下载的版本和从源码构建有什么区别？

| | Releases 版本 | 从源码构建 |
|--|--------------|-----------|
| yt-dlp / ffmpeg | 启动时自动识别系统版本，缺失可一键下载 | 同左（另需 Go 1.24+ 编译依赖边车） |
| 使用难度 | 下载即用 | 需要安装 Node.js 22+ / pnpm / Go |
| 适用人群 | 普通用户 | 开发者 |
| 更新方式 | 自动更新 | 手动构建 |

**99% 的用户应该选择 Releases 版本。**

两者运行时的依赖处理逻辑完全一致：都不内置 yt-dlp / ffmpeg，而是复用机器上已安装的版本。

---

### 从源码构建需要什么技能？

基本的命令行操作能力即可。你不需要懂编程，只需要按照文档中的步骤复制粘贴命令。

---

### 可以同时安装多个版本吗？

不建议。不同版本可能使用相同的用户数据目录，会导致冲突。

---

### 如何更新 DownVid？

**Releases 版本：**
- 内置自动更新功能，有新版本时会提示
- 也可以手动从 [Releases](https://github.com/Downvid/downvid/releases) 下载最新版

**从源码构建：**
```bash
cd downvid
git pull
pnpm install
pnpm build          # 重新构建（会一并编译 Go 依赖边车，需要 Go 1.24+）
```

---

### 如何完全卸载 DownVid？

**macOS：**
1. 将 `DownVid.app` 从"应用程序"移到废纸篓
2. 删除用户数据（可选）：
   ```bash
   rm -rf ~/Library/Application\ Support/DownVid
   rm -rf ~/Library/Caches/DownVid
   ```

**Windows：**
1. 删除解压出来的 DownVid 目录（绿色版不写注册表）
2. 删除用户数据（可选）：
   ```
   删除 C:\Users\用户名\AppData\Roaming\DownVid
   ```

**Linux：**
```bash
# 删除便携包解压出来的文件
rm downvid

# 删除桌面入口（如果创建了）
rm ~/.local/share/applications/downvid.desktop

# 删除用户数据（可选）
rm -rf ~/.config/DownVid
```

---

## 技术相关

### DownVid 用了什么技术栈？

- **Wails v2** — 桌面外壳：调用系统原生 Webview，单文件产物
- **Go** — 核心（16 个零耦合 internal 包）与依赖边车
- **Svelte 5** — 前端框架（Runes 响应式）
- **TypeScript** — 类型安全的 JavaScript
- **Tailwind CSS v4** — CSS-first 的原子化样式
- **Vite** — 前端构建
- **yt-dlp** — 视频下载引擎（运行时解析，不随安装包分发）
- **FFmpeg** — 音视频合并与转码（运行时解析，不随安装包分发）
- **Vitest** — 前端纯逻辑单元测试

---

### 为什么是 Go + Wails，而不是 Electron？

体积与启动速度：旧版 Electron 安装包 100 MB 量级、冷启动数秒；单文件产物约 18 MB，
用系统 Webview，启动几乎即时。核心逻辑用 Go 写也避免了把 Node 运行时一起打包。

---

### 为什么用 pnpm 而不是 npm？

pnpm 更快、更节省磁盘空间，且 workspace 功能更强大。本项目使用 pnpm 管理依赖，用 npm 或 yarn 安装可能导致构建失败。

---

### 如何参与开发？

请参考 [从源码构建](./build-from-source.md) 和 [贡献指南](../CONTRIBUTING.md)。

---

### 项目有测试吗？

有，分三层：

1. `(cd app && go test ./...)` — Go 核心（参数组装、进度解析、格式去重、历史、自更新）
2. `(cd backend && go test ./...)` — 依赖边车（候选路径、镜像链、校验安装）
3. `pnpm test` / `pnpm --dir app/frontend test` — 前端与脚本的纯逻辑单测

另有 `pnpm test:e2e:real` 用真实的 yt-dlp / ffmpeg 跑一次完整链路。

---

### 如何报告 Bug？

请 [提交 Issue](https://github.com/Downvid/downvid/issues/new)，并包含：
1. 操作系统和版本
2. DownVid 版本号
3. 复现步骤
4. 错误信息（开发者工具 Console 中的内容）
5. 截图或录屏（如有）
