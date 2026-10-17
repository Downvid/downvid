# 故障排除指南

本文档列出使用 DownVid 时可能遇到的各种问题及其解决方案。

---

## 目录

- [安装和启动问题](#安装和启动问题)
- [下载问题](#下载问题)
- [界面和交互问题](#界面和交互问题)
- [Cookie 和登录问题](#cookie-和登录问题)
- [macOS 专有问题](#macos-专有问题)
- [Windows 专有问题](#windows-专有问题)
- [Linux 专有问题](#linux-专有问题)
- [日志和调试](#日志和调试)

---

## 安装和启动问题

### macOS 提示"无法打开，因为无法验证开发者"

**症状：** 双击应用后弹出警告框，提示无法打开。

**原因：** macOS 默认只允许运行 App Store 中的应用和经过 Apple 公证的应用。DownVid 是开源项目，没有 Apple 开发者证书。

**解决方案：**

**方法一（推荐）：右键打开**
1. 在"应用程序"中找到 DownVid
2. **右键点击** → 选择 **"打开"**
3. 弹出警告后点击 **"打开"**
4. 以后就可以正常双击打开了

**方法二：系统设置放行**
1. 打开"系统设置" → "隐私与安全性"
2. 在"安全性"部分找到被阻止的应用
3. 点击 **"仍要打开"**

**方法三：终端命令（一劳永逸）**
```bash
xattr -cr /Applications/DownVid.app
```

> 💡 这个问题只在第一次打开时出现，打开过一次后就不会再出现了。

---

### Windows 提示"Windows 已保护你的电脑"

**症状：** SmartScreen 弹出蓝色警告框，阻止运行。

**解决方案：**
1. 点击 **"更多信息"**
2. 点击 **"仍要运行"**
3. 之后就不会再弹出了

---

### Windows 杀毒软件误报

**症状：** 杀毒软件将 DownVid 标记为病毒或威胁。

**原因：** DownVid 是开源项目，没有代码签名证书，部分杀毒软件会将其误报。

**解决方案：**
1. 打开杀毒软件的"隔离区"或"信任区"
2. 找到 DownVid 相关文件
3. 选择 **"恢复"** 并 **"添加信任"**
4. 或者临时关闭杀毒软件的实时保护，安装后重新开启

---

### Linux AppImage 无法运行

**错误信息：** `dlopen(): error loading libfuse.so.2` 或 `AppImages require FUSE to run`

**原因：** AppImage 需要 FUSE 库才能运行。

**解决方案：**

```bash
# Ubuntu / Debian
sudo apt install fuse libfuse2

# Fedora
sudo dnf install fuse fuse-libs

# Arch Linux
sudo pacman -S fuse2

# openSUSE
sudo zypper install fuse2
```

安装后可能需要注销并重新登录，或者重启电脑。

---

### 应用启动后白屏或黑屏

**可能原因和解决方案：**

1. **GPU 兼容性问题**
   - DownVid 已内置 GPU 兼容性修复，通常不会出现此问题
   - 如果仍然出现，尝试在终端中运行：
     ```bash
     # macOS
     open -a DownVid --args --disable-gpu
     
     # Windows（在 CMD 中）
     "C:\path\to\DownVid.exe" --disable-gpu
     ```

2. **系统版本过低**
   - macOS 需要 10.15 (Catalina) 或更高
   - Windows 需要 10 或更高
   - Linux 需要支持 AppImage/FUSE 的发行版

3. **内存不足**
   - 关闭其他占用内存的应用
   - 重启电脑后再试

---

## 下载问题

### 提示"yt-dlp 未找到"

**错误信息：** `yt-dlp 未找到` 或 `无法找到 yt-dlp`

**原因：** DownVid 不再内置 yt-dlp，需要从机器上已有的安装中识别，或应用内下载一份。

**解决方案：**

1. 打开「设置 → 运行依赖」，点「重新检测」查看具体原因（会显示探测到的路径、版本与来源）
2. 直接点「下载缺失的依赖」，DownVid 会下载到自己的数据目录（不会污染系统）
3. 想用自己装的那份：按上面「方式二」的命令安装后重新检测即可
4. 自动检测不到时，可在同一页面「手动指定可执行文件（进阶）」里选绝对路径

> 提示：从桌面 / Finder 启动时 `PATH` 很精简，DownVid 会额外执行一次登录 shell
> 来补全 Homebrew、`~/.local/bin` 等目录，因此正常情况下系统装好的版本都能被识别。

---

### 提示"FFmpeg 未找到"

**错误信息：** `FFmpeg 未找到` 或 `ffmpeg: command not found`

**原因和解决方案同上。**

ffmpeg 只在合并音视频与音频转码时需要，因此**字幕下载不受影响**；
音频模式（转 mp3）必须有 ffmpeg，且需要带 libmp3lame 的构建
（应用内下载的版本已包含，系统的 ffmpeg 通常也包含）。

---

### 下载失败：网络连接超时

**错误信息：** `网络连接超时` 或 `Connection timed out`

**解决方案：**

1. **检查网络连接**
   - 确认能正常访问网页
   - 尝试访问 https://www.youtube.com 确认网络正常

2. **使用代理**
   - 如果你在需要代理的网络环境中
   - 在系统设置中配置代理
   - 或在终端中设置环境变量：
     ```bash
     export HTTP_PROXY=http://127.0.0.1:7890
     export HTTPS_PROXY=http://127.0.0.1:7890
     pnpm dev
     ```

3. **YouTube 特殊问题**
   - YouTube 有时会限流，稍后再试
   - 尝试使用 Cookie（参考 [Cookie 配置](#cookie-和登录问题)）

---

### 下载失败：视频不存在或已被删除

**错误信息：** `视频不存在或已被删除` 或 `404 Not Found`

**解决方案：**
1. 确认链接是否正确
2. 在浏览器中打开链接，确认视频确实存在
3. 如果视频需要登录才能查看，需要配置 Cookie

---

### 下载失败：需要登录

**错误信息：** `该视频需要登录才能访问` 或 `Login required`

**解决方案：** 需要导入浏览器 Cookie。参考 [Cookie 和登录问题](#cookie-和登录问题)。

---

### 下载失败：请求过于频繁 (HTTP 429)

**错误信息：** `YouTube 请求过于频繁，请等待几分钟后重试 (HTTP 429)`

**原因：** YouTube 检测到频繁请求，暂时限流。

**解决方案：**
1. 等待 5-10 分钟后重试
2. 使用 Cookie 可以减少被限流的概率
3. 不要同时下载大量 YouTube 视频

---

### 下载速度很慢

**可能原因和解决方案：**

1. **网络带宽限制**
   - 检查你的网络带宽
   - 关闭其他占用带宽的应用

2. **选择较低画质**
   - 在格式选择界面选择 720p 或 480p
   - 较低画质的文件更小，下载更快

3. **YouTube 限流**
   - YouTube 对无 Cookie 的下载有限速
   - 配置 Cookie 可以改善

4. **yt-dlp 版本过旧**
   - 在「设置 → 运行依赖」里能看到当前使用的版本与路径
   - 由 DownVid 托管的那份可在该页面点「更新」重新下载到最新清单版本
   - 系统自带的那份请用对应包管理器升级（如 `brew upgrade yt-dlp`）

---

### 下载的视频没有声音

**可能原因和解决方案：**

1. **视频和音频是分开的流**
   - DownVid 会自动合并视频和音频
   - 如果合并失败，会提示错误
   - 确保 ffmpeg 正常工作

2. **格式选择问题**
   - 尝试选择不同的格式
   - 选择带有音频的格式（而不是纯视频流）

---

### 下载的视频画质不好

**说明：** DownVid 提供的画质取决于源平台提供的选项。如果源平台最高只有 720p，DownVid 无法下载 1080p。

**解决方案：**
1. 在格式选择界面查看所有可用的画质
2. 选择最高画质的选项
3. 某些平台（如抖音）的无水印版本画质可能有限

---

## 界面和交互问题

### 按钮无法点击

**可能原因和解决方案：**

1. **应用还在加载中**
   - 等待启动动画消失后再操作
   - 如果启动动画一直不消失，强制退出重启

2. **界面卡死**
   - 尝试按 `Ctrl+Shift+I`（Windows/Linux）或 `Cmd+Option+I`（macOS）打开开发者工具
   - 查看 Console 中是否有红色错误信息
   - 如果有错误，截图提交 [Issue](https://github.com/Downvid/downvid/issues)

3. **窗口太小**
   - DownVid 最小窗口为 1000x700
   - 如果窗口太小，部分界面可能被裁切
   - 拖动窗口边缘放大

---

### 界面显示异常

**可能原因：**
- 字体加载失败（网络问题）
- 系统不支持某些字体

**解决方案：**
1. 确保网络正常（需要加载 Google Fonts）
2. 重启应用
3. 如果问题持续，提交 [Issue](https://github.com/Downvid/downvid/issues) 并附截图

---

### 下载历史为空

**可能原因：**
1. 从未成功下载过视频
2. 历史记录文件被删除

**说明：** 下载历史保存在用户数据目录中：
- macOS: `~/Library/Application Support/DownVid/download-history.json`
- Windows: `%APPDATA%\DownVid\download-history.json`
- Linux: `~/.config/DownVid/download-history.json`

---

## Cookie 和登录问题

### 什么是 Cookie 模式？

DownVid 支持两种 Cookie 模式：

1. **自动模式（默认）**：自动从你的浏览器读取 Cookie
2. **手动模式**：手动导入 Cookie 文件

---

### 自动模式不工作

**症状：** 设置为自动模式，但下载需要登录的视频仍然失败。

**可能原因：**

1. **浏览器未关闭**
   - 自动模式需要读取浏览器的 Cookie 数据库
   - 某些浏览器在运行时会锁定数据库
   - **关闭浏览器后再试**

2. **浏览器不受支持**
   - 自动模式支持的浏览器：
     - Chrome / Chromium
     - Edge
     - Firefox
     - Safari（macOS）
     - Brave
   - 如果你使用其他浏览器，需要切换到手动模式

3. **Cookie 已过期**
   - 在浏览器中重新登录相关网站
   - 然后重新下载

---

### 手动模式导入 Cookie

**步骤：**

1. **导出 Cookie 文件**
   - 安装浏览器扩展 [Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)（Chrome）或 [cookies.txt](https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/)（Firefox）
   - 访问需要登录的网站
   - 点击扩展图标 → "Export" → 保存为 `cookies.txt`

2. **在 DownVid 中导入**
   - 打开设置页面
   - 切换 Cookie 模式为"手动"
   - 点击"选择文件" → 选择刚才导出的 `cookies.txt`

3. **使用 Cookie 下载**
   - 导入 Cookie 后，下载需要登录的视频即可

---

### Cookie 文件格式

DownVid 使用 yt-dlp 的 cookies.txt 格式（Netscape 格式）。

**正确的格式示例：**
```
# Netscape HTTP Cookie File
.youtube.com	TRUE	/	FALSE	0	CONSENT	PENDING+987
.youtube.com	TRUE	/	TRUE	0	SIDCS	xxxxx
```

**常见错误：**
- ❌ 不是 JSON 格式
- ❌ 不是浏览器导出的原始格式
- ❌ 文件为空或损坏

---

## macOS 专有问题

### M1/M2/M3/M4 Mac 运行 x86 版本很慢

**原因：** 你下载了 Intel 版本，正在通过 Rosetta 2 转译运行。

**解决方案：**
1. 下载 ARM64 版本（文件名中包含 `arm64`）
2. 卸载 Intel 版本
3. 安装 ARM64 版本

---

### macOS 提示"已损坏，无法打开"

**解决方案：**
```bash
xattr -cr /Applications/DownVid.app
```

---

### macOS 隐私权限弹窗

DownVid **不需要**任何特殊权限。如果弹出权限请求，可以拒绝。

---

## Windows 专有问题

### Windows SmartScreen 反复弹出

**解决方案：**
1. 右键点击 exe 文件 → "属性"
2. 底部勾选 **"解除锁定"**
3. 点击"确定"
4. 再双击运行

---

### Windows 路径问题

**症状：** 下载失败，提示路径错误。

**原因：** Windows 路径长度限制或特殊字符。

**解决方案：**
1. 将下载目录设置为简单路径，如 `D:\Downloads`
2. 避免路径中包含中文、空格或特殊字符
3. 不要将下载目录设置在系统盘根目录

---

## Linux 专有问题

### 权限问题

**症状：** 提示 `Permission denied`。

**解决方案：**
```bash
# 如果使用 AppImage，需要先赋予可执行权限
chmod +x DownVid-*.AppImage
```

如果提示的是 yt-dlp / ffmpeg 没有执行权限，说明那份文件本身不可用
（例如解压时丢了权限位）。在「设置 → 运行依赖」里点该项的「更新」
重新下载即可；系统安装的那份请用包管理器重装。

---

### 缺少 GUI 库

**症状：** 提示缺少 `libgtk` 或其他 GUI 库。

**解决方案：**

```bash
# Ubuntu / Debian
sudo apt install libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils libatspi2.0-0 libuuid1 libsecret-1-0

# Fedora
sudo dnf install gtk3 libnotify nss libXScrnSaver libXtst xdg-utils at-spi2-core uuid libsecret

# Arch Linux
sudo pacman -S gtk3 libnotify nss libxss libxtst xdg-utils at-spi2-core libsecret
```

---

### Wayland 兼容性

如果你使用 Wayland（如 GNOME 默认），DownVid 可能有显示问题。

**解决方案：**
```bash
# 强制使用 X11
./DownVid-*.AppImage --ozone-platform-hint=auto
```

---

## 日志和调试

### 查看日志文件

日志文件保存在用户数据目录中：

| 平台 | 路径 |
|------|------|
| macOS | `~/Library/Application Support/DownVid/downvid.log` |
| Windows | `%APPDATA%\DownVid\downvid.log` |
| Linux | `~/.config/DownVid/downvid.log` |

### 打开开发者工具

在 DownVid 中按 `Ctrl+Shift+I`（Windows/Linux）或 `Cmd+Option+I`（macOS）可以打开开发者工具。

在 Console 标签页中可以看到详细的错误信息。

### 提交 Issue

如果以上方法都无法解决问题，请 [提交 Issue](https://github.com/Downvid/downvid/issues)，并包含以下信息：

1. **操作系统和版本**（如 macOS 15.0、Windows 11、Ubuntu 24.04）
2. **DownVid 版本号**（在"关于"页面查看）
3. **错误信息**（开发者工具 Console 中的红色文字）
4. **复现步骤**（你做了什么操作导致了这个问题）
5. **日志文件内容**（如果有）

---

## 还是解决不了？

1. 查看 [常见问题](./faq.md)
2. 搜索 [GitHub Issues](https://github.com/Downvid/downvid/issues) 看看有没有类似问题
3. 如果没有，[提交新 Issue](https://github.com/Downvid/downvid/issues/new)
