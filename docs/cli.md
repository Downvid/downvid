# 命令行下载

`downvid` 是 DownVid 的无头入口：给一个链接就能下载，参数用来指定格式、
清晰度和保存位置。它**复用桌面版的设置与运行依赖**，不是另一套实现。

## 安装

CLI 是纯 Go 程序，每个平台各编一次；同一份源码可以在任意机器交叉编译。
构建脚本会把依赖边车一起嵌进去，所以新机器上装完 CLI 就能直接
`downvid deps install`。

### macOS

```bash
bash app/scripts/build-cli.sh -platform darwin/arm64     # Apple Silicon
# bash app/scripts/build-cli.sh -platform darwin/amd64   # Intel
# bash app/scripts/build-cli.sh -platform darwin/universal  # 通用（需要 macOS 的 lipo）

install -m 755 app/build/cli/darwin-arm64/downvid ~/.local/bin/downvid
```

`~/.local/bin` 不在 `PATH` 里时，把它加进去，或改装到 `/usr/local/bin`。
从网上下载的未签名二进制可能带 quarantine，必要时执行
`xattr -d com.apple.quarantine ~/.local/bin/downvid`。

### Linux

```bash
bash app/scripts/build-cli.sh -platform linux/amd64      # 或 linux/arm64
install -m 755 app/build/cli/linux-amd64/downvid ~/.local/bin/downvid
```

### Windows

在 Git Bash 或 WSL 里构建（产物是原生 exe，不需要运行时）：

```bash
bash app/scripts/build-cli.sh -platform windows/amd64
```

然后在 PowerShell 里把它放进用户 PATH：

```powershell
$bin = "$env:LOCALAPPDATA\Programs\DownVid\bin"
New-Item -ItemType Directory -Force $bin | Out-Null
Copy-Item .\app\build\cli\windows-amd64\downvid.exe $bin
[Environment]::SetEnvironmentVariable("Path", "$env:Path;$bin", "User")
```

重开终端后 `downvid --version` 应该能跑。

### 直接 go install（精简版）

```bash
go install github.com/Downvid/downvid/app/cmd/downvid@latest
```

这样装出来的 CLI **不带内嵌边车**：它优先用桌面版已经解出的
`~/.downvid/runtime/bin/downvid-deps`、`yt-dlp`、`ffmpeg`，找不到时再查
`PATH`。适合已经用过桌面版的机器；新机器请用上面的 `build-cli.sh`。

## 安装运行依赖

带边车的 CLI 可以自己把依赖装进 `~/.downvid/runtime/bin`：

```bash
downvid deps status
downvid deps install
downvid deps install --only yt-dlp,ffmpeg --force
```

没有边车的 `go install` 版本会提示先用 `build-cli.sh` 构建，或打开桌面版一次。

## 用法

```bash
downvid <链接> [选项]

downvid "https://www.bilibili.com/video/BV..."
downvid "https://youtu.be/..." -q 1080
downvid "https://youtu.be/..." --list-formats
downvid "https://youtu.be/..." -f 137+140 -o ~/Videos
downvid "https://youtu.be/..." -a

downvid deps status
downvid deps install
```

| 选项 | 作用 |
| --- | --- |
| `-o, --output 目录` | 保存目录；默认取设置里的下载目录，否则 `~/Downloads` |
| `-f, --format ID` | 指定格式 ID（用 `--list-formats` 查看，也可直接写 yt-dlp 选择器） |
| `-q, --quality 高度` | 最高分辨率：`best`、`2160`、`1440`、`1080`、`720`、`480`、`360` |
| `-a, --audio` | 只下载音频，转成 mp3 |
| `-l, --list-formats` | 列出可用格式后退出 |
| `--json` | 结果以 JSON 输出，便于脚本处理 |
| `--proxy URL` | 覆盖设置里的代理 |
| `--cookies 文件` | 指定 cookies.txt |
| `--no-history` | 不写入 `~/.downvid/download-history.json` |
| `--timeout 时长` | 解析超时，默认 90s |
| `--only 列表` | `deps install`：只装指定依赖，逗号分隔 |
| `--mirror 源` | `deps install`：下载源，默认取设置 |
| `--force` | `deps install`：已存在也重新下载 |

选项可以写在链接前面或后面。

## 复用哪些数据

- 设置：系统 userData 下的 `settings.json`（下载目录、代理、Cookie、加速、
  文件名模板）。
- 运行依赖：`~/.downvid/runtime/bin` 里的 yt-dlp / ffmpeg / ffprobe / aria2。
- 下载历史：`~/.downvid/download-history.json`，与桌面版共用。

**并发提示**：桌面版和 CLI 同时写历史时，后写的会覆盖先写的（两边都是
原子写，但没有跨进程锁）。一边下载一边用 CLI 时建议加 `--no-history`。

## 格式选择

不传 `-f` 时按 `-q` 选：取解析结果里第一个不高于该高度的视频格式；该格式
没有音轨时由 yt-dlp 自动补最佳音轨并合并成 mp4。`-f` 可以是格式 ID，也可以
是 yt-dlp 选择器（例如 `137+140`、`bestvideo[height<=1080]`）。

若解析结果带平台 CDN 直链（历史实现里的抖音/快手路径），CLI 走内置的直链下载：
画质由平台决定，`-f` / `-q` 不生效，`-a` 会提示暂不支持。

注意：当前版本的抖音与快手会被平台拦截（需要请求签名 / 人机验证），
解析阶段即失败，走不到直链下载。详见 [`faq.md`](faq.md#抖音快手为什么解析不了)。

## JSON 输出

```json
{
  "ok": true,
  "title": "Me at the zoo",
  "path": "/Users/me/Downloads/Me at the zoo [144].mp4",
  "formatId": "160",
  "quality": "144P",
  "ext": "mp4",
  "size": 196096
}
```

失败时输出 `{"ok":false,"error":"..."}` 到 stdout，并以非零状态退出。

CLI 目前不在 Release 产物里，先从源码构建；要随版本分发再做新的产物命名与
发布矩阵，那属于单独的 MINOR 变更。
