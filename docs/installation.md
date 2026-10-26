# 安装指南

本文档详细介绍如何在各平台安装 DownVid。

---

## 目录

- [直接下载安装（推荐）](#直接下载安装推荐)
- [macOS 安装](#macos-安装)
- [Windows 安装](#windows-安装)
- [Linux 安装](#linux-安装)
- [从源码构建](#从源码构建)

---

## 直接下载安装（推荐）

**这是绝大多数用户应该选择的方式。** 安装包**不内置** yt-dlp 与 ffmpeg：启动时会自动识别机器上已安装的版本并直接复用，识别不到时会在「设置 → 运行依赖」里提示你一键下载（带 SHA-256 校验，装在 DownVid 自己的数据目录里，不污染系统）。

### 下载地址

👉 **[点击这里前往 Releases 页面下载最新版](https://github.com/Downvid/downvid/releases/latest)**

### 选择正确的文件

产物是单文件（约 18 MB，原生 Webview 渲染，启动快，待机内存低），依赖边车已内嵌：

| 你的系统 | 下载 |
|----------|------|
| macOS（Apple 芯片 / Intel 通用） | `DownVid-Wails-mac-universal-<版本>.zip` |
| Windows x64 | `DownVid-Wails-windows-x64-<版本>.zip` |
| Linux x64 | `DownVid-Wails-linux-x64-<版本>.tar.gz` |

> 💡 **提示**：macOS 包解压即得 `DownVid.app`，直接拖入「应用程序」即可运行；
> Windows / Linux 包解压后直接运行目录里的可执行文件，无需安装。

> ⚠️ **怎么知道自己是 Apple Silicon 还是 Intel？**
> 点击左上角苹果图标 → "关于本机" → 查看"芯片"一栏。如果显示 Apple M1/M2/M3/M4 就是 Apple Silicon，如果显示 Intel 就是 x64。

---

## macOS 安装

1. 解压下载的 `DownVid-Wails-mac-universal-<版本>.zip`
2. 把解压出的 `DownVid.app` 拖到「应用程序」文件夹
3. 首次打开时，macOS 可能会阻止你运行（见下）

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

产物是绿色版 `DownVid-Wails-windows-x64-<版本>.zip`：

1. 解压到任意目录
2. 双击目录里的 `downvid.exe` 运行
3. 不写注册表、不创建快捷方式；要常驻可以自己建一个快捷方式

### Windows Defender / 杀毒软件警告

开源项目没有代码签名证书，Defender 可能弹出警告：

1. SmartScreen 提示「Windows 已保护你的电脑」时 → **更多信息** → **仍要运行**
2. 若被隔离 → 在杀毒软件的隔离区恢复，并添加信任

### Windows 常见路径

| 内容 | 路径 |
|------|------|
| 用户数据 | `C:\Users\用户名\AppData\Roaming\DownVid\` |
| 下载历史 | 同上目录下的 `download-history.json` |
| 设置 | 同上目录下的 `settings.json` |

---

## Linux 安装

产物是便携包 `DownVid-Wails-linux-x64-<版本>.tar.gz`（x64）。

```bash
# 解压
tar -xzf DownVid-Wails-linux-x64-*.tar.gz

# 运行
chmod +x downvid
./downvid
```

### 集成到桌面环境（可选）

```bash
mkdir -p ~/.local/share/applications
cat > ~/.local/share/applications/downvid.desktop << 'EOF'
[Desktop Entry]
Name=DownVid
Exec=/path/to/downvid
Icon=downvid
Type=Application
Categories=Utility;
EOF
```

### 运行期依赖

Linux 上没有 GTK / WebKit 运行库时应用起不来：

```bash
# Ubuntu / Debian
sudo apt install libgtk-3-0 libwebkit2gtk-4.0-37

# Arch Linux
sudo pacman -S gtk3 webkit2gtk-4.1
```

### ARM64 用户

当前只发布 x64 产物。ARM64 设备（树莓派、ARM 服务器）需要自行从源码构建：

```bash
bash app/scripts/build.sh -platform linux/arm64
```

---

## 从源码构建

如果你需要修改源码或参与开发，请参考 [从源码构建指南](./build-from-source.md)。

---

## 下一步

- 遇到问题？查看 [故障排除指南](./troubleshooting.md)
- 有疑问？查看 [常见问题](./faq.md)
