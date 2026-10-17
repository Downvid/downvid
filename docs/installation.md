# 安装指南

本文档详细介绍如何在各平台安装 DownVid。

---

## 目录

- [直接下载安装（推荐）](#直接下载安装推荐)
- [macOS 安装](#macos-安装)
- [Windows 安装](#windows-安装)
- [Linux 安装](#linux-安装)
- [Docker 安装](#docker-安装)
- [从源码构建](#从源码构建)

---

## 直接下载安装（推荐）

**这是绝大多数用户应该选择的方式。** 安装包**不内置** yt-dlp 与 ffmpeg：启动时会自动识别机器上已安装的版本并直接复用，识别不到时会在「设置 → 运行依赖」里提示你一键下载（带 SHA-256 校验，装在 DownVid 自己的数据目录里，不污染系统）。

### 下载地址

👉 **[点击这里前往 Releases 页面下载最新版](https://github.com/yxxbc/downvid/releases/latest)**

### 选择正确的文件

| 你的系统 | 应该下载的文件 | 文件名示例 |
|----------|---------------|-----------|
| macOS Apple Silicon (M1/M2/M3/M4) | `DownVid-arm64-Mac-*.dmg` | `DownVid-arm64-Mac-1.0.0.dmg` |
| macOS Intel | `DownVid-x64-Mac-*.dmg` | `DownVid-x64-Mac-1.0.0.dmg` |
| Windows | `DownVid-Setup-*.exe` | `DownVid-Setup-1.0.0.exe` |
| Linux x64 | `DownVid-x64-Linux-*.AppImage` | `DownVid-x64-Linux-1.0.0.AppImage` |
| Linux ARM64 | `DownVid-arm64-Linux-*.AppImage` | `DownVid-arm64-Linux-1.0.0.AppImage` |

> ⚠️ **怎么知道自己是 Apple Silicon 还是 Intel？**
> 点击左上角苹果图标 → "关于本机" → 查看"芯片"一栏。如果显示 Apple M1/M2/M3/M4 就是 Apple Silicon，如果显示 Intel 就是 x64。

---

## macOS 安装

### 方法一：DMG 安装（推荐）

1. 双击下载的 `.dmg` 文件
2. 将 `DownVid` 图标拖到 `Applications` 文件夹
3. 首次打开时，macOS 可能会阻止你运行

### 解决 macOS "无法打开" 警告

macOS 默认只允许运行 App Store 中的应用。首次打开 DownVid 时你会看到类似这样的警告：

> "DownVid" 无法打开，因为无法验证开发者。

**解决方法（任选一种）：**

#### 方法 A：右键打开（最简单）

1. 在"应用程序"文件夹中找到 `DownVid`
2. **右键点击**（或按住 Control 点击）
3. 选择 **"打开"**
4. 在弹出的对话框中再次点击 **"打开"**
5. 之后就可以正常双击打开了

#### 方法 B：系统设置中放行

1. 打开 **"系统设置"**（或"系统偏好设置"）
2. 进入 **"隐私与安全性"**
3. 在"安全性"部分你会看到一条关于 DownVid 被阻止的消息
4. 点击 **"仍要打开"**
5. 输入密码确认

#### 方法 C：终端命令（高级用户）

```bash
# 移除下载标记（让 macOS 不再阻止）
xattr -cr /Applications/DownVid.app
```

> 从 v1.2.0 起，DownVid 首次成功打开后会自动移除自身的隔离属性，应用内更新下载的新版本也会自动去除隔离属性并重新签名，只需在首次安装时处理一次。

### macOS 权限说明

DownVid **不需要**任何特殊权限：
- ❌ 不需要辅助功能权限
- ❌ 不需要屏幕录制权限
- ❌ 不需要完全磁盘访问权限
- ✅ 只需要正常的网络访问和文件读写权限

### 检查 yt-dlp 和 ffmpeg

打开「设置 → 运行依赖」，可以看到每一项的**版本、来源（系统安装 / DownVid 托管 / 手动指定）与完整路径**，以及没找到时的原因。点「重新检测」可刷新。

常见情况：
- **显示「系统安装」**：正在复用你自己装的版本，升级请用对应包管理器（如 `brew upgrade yt-dlp`）
- **显示「DownVid 托管」**：由应用下载，可点「更新」重新下载到清单里的版本
- **显示缺失**：点「下载缺失的依赖」，或按 [从源码构建](./build-from-source.md) 自行安装后重新检测

---

## Windows 安装

### 方法一：EXE 安装程序（推荐）

1. 双击下载的 `DownVid-Setup-*.exe` 文件
2. 按照安装向导提示操作
3. 可以选择安装目录（默认安装到 `C:\Users\你的用户名\AppData\Local\Programs\DownVid`）
4. 安装完成后，桌面和开始菜单都会有快捷方式

### Windows Defender / 杀毒软件警告

由于 DownVid 是开源项目，没有代码签名证书，Windows Defender 或其他杀毒软件可能会弹出警告。

**解决方法：**

1. 当 SmartScreen 弹出"Windows 已保护你的电脑"时：
   - 点击 **"更多信息"**
   - 然后点击 **"仍要运行"**

2. 如果杀毒软件隔离了文件：
   - 打开杀毒软件的"隔离区"或"病毒库"
   - 找到 DownVid 相关文件
   - 选择 **"恢复"** 或 **"添加信任"**

### 便携版

如果你不想安装，可以下载 `DownVid-*-win-x64.zip` 便携版：
1. 解压到任意目录
2. 双击 `DownVid.exe` 运行
3. 便携版不会写入注册表，不会创建开始菜单快捷方式

### Windows 常见路径

| 内容 | 路径 |
|------|------|
| 安装目录 | `C:\Users\用户名\AppData\Local\Programs\DownVid\` |
| 用户数据 | `C:\Users\用户名\AppData\Roaming\DownVid\` |
| 日志文件 | `C:\Users\用户名\AppData\Roaming\DownVid\downvid.log` |

> ⚠️ **重要：** 用户数据目录中的 `download-history.json` 保存了你的下载历史，`settings` 相关配置保存在 localStorage 中。

---

## Linux 安装

### AppImage（所有 Linux 发行版通用）

AppImage 是最通用的格式，不需要安装，下载即可运行。

#### 安装步骤

```bash
# 1. 下载 AppImage（替换为实际版本号）
# 从 https://github.com/yxxbc/downvid/releases/latest 下载

# 2. 添加可执行权限
chmod +x DownVid-*-x64-Linux-*.AppImage

# 3. 运行
./DownVid-*-x64-Linux-*.AppImage
```

#### 集成到桌面环境（可选）

```bash
# 安装 appimaged 工具（如果还没装）
# Ubuntu/Debian:
sudo apt install appimagelauncher

# 或者手动创建桌面入口
mkdir -p ~/.local/share/applications
cat > ~/.local/share/applications/downvid.desktop << 'EOF'
[Desktop Entry]
Name=DownVid
Exec=/path/to/DownVid-x64-Linux-*.AppImage
Icon=downvid
Type=Application
Categories=Utility;
EOF
```

#### AppImage 无法运行？

```bash
# 检查 FUSE 是否安装（AppImage 需要 FUSE）
# Ubuntu/Debian:
sudo apt install fuse libfuse2

# Fedora:
sudo dnf install fuse fuse-libs

# Arch Linux:
sudo pacman -S fuse2
```

### DEB 包（Ubuntu / Debian）

```bash
# 安装
sudo dpkg -i DownVid-*-x64-Linux-*.deb

# 修复依赖（如果安装后提示缺少依赖）
sudo apt install -f

# 卸载
sudo apt remove downvid
```

### RPM 包（Fedora / CentOS / openSUSE）

```bash
# Fedora / CentOS
sudo rpm -i DownVid-*-x64-Linux-*.rpm

# openSUSE
sudo zypper install DownVid-*-x64-Linux-*.rpm

# 卸载
sudo rpm -e downvid
```

### TAR.GZ 包（通用）

```bash
# 解压
tar -xzf DownVid-*-x64-Linux-*.tar.gz

# 进入目录
cd DownVid-*-x64-Linux-*

# 运行
./DownVid
```

### Linux ARM64 用户

如果你使用的是 ARM64 架构（如树莓派 4/5、Apple Silicon 通过虚拟机运行 Linux），请下载 `arm64` 版本。

```bash
# 检查你的架构
uname -m
# 输出 aarch64 或 arm64 = ARM64
# 输出 x86_64 或 amd64 = x64
```

---

## Docker 安装

如果你有一台常开的机器，或者不想在主机上装 Electron 与运行时库，可以用容器跑 DownVid。

DownVid 是桌面应用，容器里没有显示器，因此镜像内置了虚拟显示（Xvfb）并把界面
通过 noVNC 暴露到浏览器——**打开网页就是完整应用**。

### 前置条件

- Docker 24+ 与 Docker Compose v2（`docker compose version` 能输出版本即可）
- amd64 或 arm64 均可

### 启动

```bash
git clone https://github.com/yxxbc/downvid.git
cd downvid
docker compose up -d
```

然后打开 <http://127.0.0.1:6080/vnc.html>，点「连接」即可看到 DownVid 窗口。
从其他设备访问时把 `127.0.0.1` 换成本机 IP。

### 下载文件在哪

默认落在宿主机当前目录的 `data/downloads/` 下，也就是 compose 文件里声明的卷。
可以直接进这个目录取文件，不需要额外工具。

### 已内置运行依赖

镜像里已装好 yt-dlp 与 FFmpeg（Debian 仓库 + pip），DownVid 的依赖边车会识别为
「系统安装」。因此不需要（也不建议）再在界面里点一次下载。

### 更多内容

端口说明、SFTP 取文件、分辨率调整、代理、故障排除见：[Docker 指南](./docker.md)。

---

## 从源码构建

如果你需要修改源码或参与开发，请参考 [从源码构建指南](./build-from-source.md)。

---

## 下一步

- 遇到问题？查看 [故障排除指南](./troubleshooting.md)
- 有疑问？查看 [常见问题](./faq.md)
- 在容器中运行？查看 [Docker 指南](./docker.md)
