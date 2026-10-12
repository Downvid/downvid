<div align="center">

<table>
  <tr>
    <td width="110" align="center">
      <img src="src/assets/logo.png" alt="DownVid Logo" width="96" />
    </td>
    <td>
      <h1>DownVid</h1>
      <p><strong>现代化的开源视频下载工具 — 一键下载全网无水印高清视频</strong></p>
      <p>
        <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square&logo=opensourceinitiative&logoColor=white" alt="License" /></a>
        <a href="https://www.electronjs.org/"><img src="https://img.shields.io/badge/Electron-30-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron" /></a>
        <a href="https://vuejs.org/"><img src="https://img.shields.io/badge/Vue-3-4FC08D?style=flat-square&logo=vuedotjs&logoColor=white" alt="Vue" /></a>
        <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" /></a>
        <a href="https://github.com/yt-dlp/yt-dlp"><img src="https://img.shields.io/badge/yt--dlp-powered-FF0000?style=flat-square&logo=youtube&logoColor=white" alt="yt-dlp" /></a>
        <a href="https://linux.do"><img src="https://img.shields.io/badge/LinuxDo-社区-4FC08D?style=flat-square&logo=linux&logoColor=white" alt="LinuxDo" /></a>
        <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-2c3e50?style=flat-square&logo=operating-system&logoColor=white" alt="Platform" />
      </p>
    </td>
  </tr>
</table>

<br />

<a href="https://github.com/yxxbc/downvid/releases"><img src="https://img.shields.io/github/downloads/yxxbc/downvid/total?color=369eff&labelColor=black&logo=github&label=Downloads&style=for-the-badge" alt="Downloads" /></a>
<a href="https://github.com/yxxbc/downvid/releases/latest"><img src="https://img.shields.io/github/v/release/yxxbc/downvid?color=369eff&labelColor=black&logo=github&label=Latest%20Release&style=for-the-badge" alt="Latest Release" /></a>
<a href="https://github.com/yxxbc/downvid/stargazers"><img src="https://img.shields.io/github/stars/yxxbc/downvid?color=ffcb2f&labelColor=black&logo=github&label=Stars&style=for-the-badge" alt="Stars" /></a>

<br />
<br />

<img src="src/assets/screen.png" alt="DownVid Screenshot" width="98%" />

<br />

> 基于 [Videdown](https://github.com/cshuangyy/videdown) by cshuangyy (MIT License) 二次开发

---

**⚠️ 免责声明**

本项目是 [yt-dlp](https://github.com/yt-dlp/yt-dlp) 的 GUI 套壳封装，仅提供图形界面，不包含任何破解或绕过技术保护措施的代码。

本工具仅供学习研究，请勿用于商业用途。下载内容需遵守当地法律法规，用户需自行承担使用责任。

</div>

---

## 📑 目录

- [项目简介](#-项目简介)
- [功能特性](#-功能特性)
- [支持的网站](#-支持的网站)
- [快速开始](#-快速开始)
  - [下载安装](#下载安装)
  - [从源码构建](#从源码构建)
- [文档](#-文档)
- [技术栈](#-技术栈)
- [架构图](#-架构图)
- [项目结构](#-项目结构)
- [贡献指南](#-贡献指南)
- [常见问题](#-常见问题)
- [更新日志](#-更新日志)
- [支持项目](#-支持项目)
- [开源协议](#-开源协议)
- [致谢](#-致谢)

---

## 📖 项目简介

**DownVid** 是一款现代化的开源视频下载工具，让你可以从抖音、小红书、B站、YouTube、Instagram 等网站下载无水印高清视频。

基于 **Electron** 构建跨平台桌面应用，使用 **yt-dlp** 作为下载引擎，DownVid 提供了简洁直观的界面和强大的功能，满足你的所有下载需求。

> ⚠️ DownVid 目前正在积极开发中，欢迎反馈任何 [问题](https://github.com/yxxbc/downvid/issues)。

---

## ✨ 功能特性

### 🌍 全球视频下载支持
通过强大的 yt-dlp 引擎，可以从全球几乎所有网站下载视频。支持 **1000+ 个网站**，包括 YouTube、抖音、B站、小红书、Instagram 等。

### 🎨 一流的界面体验
现代化、简洁的界面，操作直观。一键暂停 / 恢复 / 重试，实时进度追踪，全面的下载队列管理。支持深色 / 浅色主题切换。

### ⚡ 实时下载进度
显示下载进度、下载速度、预计剩余时间，让你随时掌握下载状态。

### 🍪 Cookie 支持
支持导入浏览器 Cookie，可以下载需要登录的视频内容（如 YouTube 会员视频、B站登录态内容）。

### 🎛️ 多格式选择
支持选择不同的视频质量和格式（360p / 480p / 720p / 1080p），包括仅下载音频模式。支持 YouTube 多音轨选择和字幕下载。

### 📥 下载历史记录
自动保存下载历史，方便随时回顾和重新下载。

### 🔄 自动更新
内置 electron-updater 自动更新系统，第一时间获取最新版本。

---

## 🌐 支持的网站

DownVid 通过 yt-dlp 支持 **1000+ 个**视频和音频平台。主要支持：

| 分类 | 平台 |
|------|------|
| 🇨🇳 **国内平台** | 抖音、B站（哔哩哔哩）、小红书、快手、西瓜视频 |
| 🌍 **国际平台** | YouTube、Instagram、TikTok、Twitter/X、Facebook |
| 📦 **其他** | 支持几乎所有 yt-dlp 支持的网站 |

完整支持列表请访问 [yt-dlp 支持网站](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md)。

---

## 🚀 快速开始

### 下载安装

1. 访问 [Releases](https://github.com/yxxbc/downvid/releases) 页面
2. 下载对应平台的最新版本安装程序
   - **macOS**: `.dmg` (ARM64 / x64)
   - **Windows**: `.exe` (x64)
   - **Linux**: `.AppImage` / `.deb` (x64 / ARM64)
3. 运行安装程序，按提示完成安装
4. 安装完成后即可使用

> 📖 详细的安装说明请查看 [安装指南](./docs/installation.md)

### 从源码构建

#### 环境要求

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 8
- [Git](https://git-scm.com/)

#### 1. 克隆仓库

```bash
git clone https://github.com/yxxbc/downvid.git
cd downvid
```

#### 2. 下载依赖工具

本项目需要 **yt-dlp** 和 **ffmpeg** 才能正常运行。
但是releases下载的已经封装依赖了，下载即用

**macOS（Homebrew）：**
```bash
brew install yt-dlp ffmpeg
```

**Ubuntu / Debian：**
```bash
sudo apt update
sudo apt install yt-dlp ffmpeg
```

**Windows：**
```bash
# 使用 winget
winget install yt-dlp.yt-dlp Gyan.FFmpeg
```

> **这些依赖是可选的。** DownVid 会优先复用你机器上已安装的版本，找不到时可以在「设置 → 运行依赖」里一键下载，**无需**为了用 DownVid 而单独安装。上面的命令只是"自己装一份更省事"的替代方案。

#### 3. 安装项目依赖

```bash
pnpm install
```

#### 4. 运行和构建

```bash
# 开发模式运行
pnpm dev

# 构建生产版本（当前平台）
pnpm build

# 构建指定平台
pnpm build:mac      # macOS 通用
pnpm build:mac:arm64  # macOS Apple Silicon
pnpm build:mac:x64    # macOS Intel
pnpm build:win      # Windows
pnpm build:linux    # Linux
```

> 📖 详细的构建说明请查看 [从源码构建指南](./docs/build-from-source.md)

---

## 📚 文档

| 文档 | 说明 |
|------|------|
| [安装指南](./docs/installation.md) | 各平台安装详解，包括 macOS/Windows/Linux 的安装步骤和常见问题 |
| [从源码构建](./docs/build-from-source.md) | 开发环境搭建、依赖下载、构建生产版本 |
| [故障排除指南](./docs/troubleshooting.md) | 各种问题的详细排查步骤和解决方案 |
| [常见问题 (FAQ)](./docs/faq.md) | 使用中的常见疑问解答 |
| [架构说明](./docs/architecture.html) | 进程结构、IPC 边界、下载与依赖解析流程 |
| [仓库规范](./docs/standards.md) | 分支/提交规范、Issue 与 PR 流程、改动落点清单 |
| [发布流程](./docs/release.md) | 版本语义、发布步骤、产物命名契约与回滚 |
| [贡献指南](./CONTRIBUTING.md) | 如何参与项目开发 |
| [安全政策](./SECURITY.md) | 如何报告漏洞、支持范围与安全边界 |
| [贡献者行为准则](./CODE_OF_CONDUCT.md) | 社区行为规范 |

---

## 🛠️ 技术栈

| 技术 | 用途 |
|------|------|
| [![Electron](https://img.shields.io/badge/Electron-30-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/) | 跨平台桌面应用框架 |
| [![Vue 3](https://img.shields.io/badge/Vue-3.4-4FC08D?style=flat-square&logo=vuedotjs&logoColor=white)](https://vuejs.org/) | 渐进式 JavaScript 框架 |
| [![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/) | 类型安全的 JavaScript 超集 |
| [![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38B2AC?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/) | 实用优先的 CSS 框架 |
| [![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev/) | 下一代前端构建工具 |
| [![Pinia](https://img.shields.io/badge/Pinia-4-FFD859?style=flat-square&logo=pinia&logoColor=white)](https://pinia.vuejs.org/) | Vue 状态管理 |
| [![yt-dlp](https://img.shields.io/badge/yt--dlp-latest-FF0000?style=flat-square&logo=youtube&logoColor=white)](https://github.com/yt-dlp/yt-dlp) | 强大的视频下载引擎 |
| [![FFmpeg](https://img.shields.io/badge/FFmpeg-latest-007808?style=flat-square&logo=ffmpeg&logoColor=white)](https://ffmpeg.org/) | 音视频处理工具 |
| [![electron-builder](https://img.shields.io/badge/electron--builder-24-000000?style=flat-square&logo=electron&logoColor=white)](https://www.electron.build/) | 应用打包与发布 |

---

## 📐 架构图

<details>
<summary>点击展开完整架构图（也可直接查看 <a href="docs/architecture.html">交互式版本</a>）</summary>
<br />

<img src="docs/architecture.svg" alt="DownVid Architecture" width="100%" />

</details>

---

## 📁 项目结构

```
videdown/
├── bin/                    # 依赖下载脚本
├── electron/               # Electron 主进程代码
│   ├── main.ts            # 主进程入口
│   └── ...                # 模块化拆分
├── src/                    # 渲染进程（Vue 3）
│   ├── assets/            # 静态资源
│   ├── components/        # 组件
│   ├── stores/            # Pinia 状态管理
│   └── ...
├── public/                 # 公共资源
├── dist/                   # Vite 构建输出
├── dist-electron/          # Electron 主进程构建输出
├── release/                # electron-builder 打包输出
├── .github/                # GitHub Actions CI/CD
├── electron-builder.json5  # electron-builder 配置
├── vite.config.ts         # Vite 配置
├── postcss.config.js      # PostCSS 配置（Tailwind 主题在 src/style.css 的 @theme 中）
├── tsconfig.json          # TypeScript 配置
├── package.json           # 项目依赖与脚本
├── CHANGELOG.md           # 更新日志
├── LICENSE                # 开源协议
└── README.md              # 项目说明
```

---

## 🤝 贡献指南

欢迎贡献！请遵循以下步骤：

1. **Fork** 本仓库
2. 创建你的特性分支：`git checkout -b feature/AmazingFeature`
3. 提交你的更改：`git commit -m 'Add some AmazingFeature'`
4. 推送到分支：`git push origin feature/AmazingFeature`
5. 开启一个 **Pull Request**

### 开发规范

- 代码遵循 TypeScript 严格模式（前端）与 `gofmt` / `go vet`（Go 侧车）
- 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范
- 新增功能请同步更新文档和 CHANGELOG

---

## ❓ 常见问题

### Q: 下载提示缺少 yt-dlp / ffmpeg？
A: DownVid 不再内置这两个工具，启动时会自动查找系统里已安装的版本；找不到就会弹出提示，点「下载并继续」即可自动装好（会校验 SHA-256，并放在 DownVid 自己的数据目录里，不污染系统）。也可以在「设置 → 运行依赖」里查看当前用的是哪个版本、来自哪里，并手动指定路径。

### Q: 为什么有些视频下载失败？
A: 部分平台需要登录才能访问，请在设置中导入浏览器 Cookie。也可能是 yt-dlp 版本过旧，尝试更新到最新版本。

### Q: 支持哪些视频画质？
A: 支持 360p / 480p / 720p / 1080p，具体取决于源平台提供的画质选项。也支持纯音频下载模式。

### Q: macOS 提示"无法打开，因为无法验证开发者"？
A: 首次安装时右键点击应用，选择"打开"，或在"系统设置 → 隐私与安全性"中点击"仍要打开"；若提示"已损坏"，在终端执行 `xattr -cr /Applications/DownVid.app`。首次成功打开后，DownVid 会自动移除自身的隔离属性，之后的应用内更新也会自动处理，无需重复操作。

> 📖 更多常见问题请查看 [常见问题 (FAQ)](./docs/faq.md)
> 
> 📖 遇到问题？查看 [故障排除指南](./docs/troubleshooting.md)

---

## 📝 更新日志

详细的版本更新记录请查看 [CHANGELOG.md](./CHANGELOG.md)。


### Unreleased
- 🚧 跨平台支持：macOS (ARM64/x64)、Windows (x64)、Linux (x64/ARM64)
- 🚧 自动更新系统 (electron-updater + GitHub Releases)
- 🚧 一键下载依赖脚本 & GitHub Actions CI/CD 自动构建
- 🚧 项目模块化重构

---

## 💖 支持项目

如果 DownVid 对你有帮助，欢迎请作者喝杯咖啡 ☕

<div align="center">
  <img src="src/assets/donate.jpg" alt="微信赞赏码" width="260" />
  <p><em>微信扫码赞赏 — 给 Black Cat 赞赏</em></p>
</div>

---

## 📄 开源协议

本项目基于 [MIT License](./LICENSE) 协议开源。

安全问题请按 [安全政策](./SECURITY.md) 私下报告，不要开公开 Issue。

基于 [Videdown](https://github.com/cshuangyy/videdown) (MIT License) 修改。

---

## 🙏 致谢

- [Videdown](https://github.com/cshuangyy/videdown) — 原始项目
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — 强大的视频下载引擎
- [FFmpeg](https://ffmpeg.org/) — 音视频处理解决方案
- [Electron](https://www.electronjs.org/) — 跨平台桌面应用框架
- [Vue.js](https://vuejs.org/) — 渐进式 JavaScript 框架
- [Tailwind CSS](https://tailwindcss.com/) — 实用优先的 CSS 框架
- [Claude Code](https://www.anthropic.com/claude) — AI 编程助手

---

## 🔗 友链

- [LinuxDo](https://linux.do) — 高质量的 Linux 中文社区

---

<div align="center">

如果这个项目对你有帮助，欢迎给个 ⭐ Star 支持一下！

Made with ❤️ by yxxbc

</div>
