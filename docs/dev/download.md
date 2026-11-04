# 下载架构

> 从 `AGENTS.md` 拆出，内容未改动。

## 解析性能

**yt-dlp 的选型直接决定解析速度。** 实测同一台机器、同一个 bilibili 视频：

| 形态 | `--version` | 真实解析 |
| --- | --- | --- |
| `yt-dlp_macos`（PyInstaller 单文件） | 9.5~10.5s | 11.4s |
| `yt-dlp`（Python zipapp） | 0.41s | **2.2s** |

PyInstaller 的单文件包每次启动都要把 ~72MB 解压到临时目录，这 9 秒是**纯开销**。所以：

- Linux / macOS 主用 **zipapp**，并同时记录自包含的 PyInstaller 包作为回退；
  `manifest.HasUsablePython()` 决定装哪一份。**Windows 不用 zipapp**——那边 python3 不普遍。
- **不要在成功路径上为了版本号再跑一次 `--version`**：`readYtdlpVersion()` 只在**失败**时调用并缓存。

## 两条完全独立的下载路径

- **`direct.go`**：`directUrl` 存在（仅抖音/快手——解析器返回 CDN URL）→ 纯 HTTP 分块下载。
  Range 可用时按小块队列调度，默认 8 路、最多 16 路；429/503 降低并发，分段失败从已写入位置重试。
  `.part.json` 保存逐段进度，兼容旧四段布局。
- **`run.go` + `ytdlp_args.go`**：`spawn(yt-dlp)`。解析结果 20 分钟内用 `--load-info-json`
  跳过二次提取。进度来自 `--progress-template` 输出的 `[dvp]` / `[dvpp]` 行，
  最终路径由 `--print after_move` 给出。format selector、audio-only、subtitle-only、
  YouTube 多音轨都在 `buildYtdlpArgs` 里组装。

`buildYtdlpArgs` 是**纯函数**：依赖路径与 JS 运行时由调用方解析后传入，
因此可以不起进程直接断言参数列表。

可选 aria2c（>=1.36）是 `DepKind` 的一种，**探测由边车统一负责**——不要在
`download` 包里再写一份候选表。仅接管 yt-dlp 的 HTTP 下载；HLS/DASH 保持原生。

**版本号的解析必须同时认本地化输出**：`aria2c --version` 的首行随 `LANG` 变化
（`aria2 version 1.37.0` / `aria2 版本 1.37.0`）。原先只匹配英文，于是
**中文 / 日文 / 德文系统上永远检测不到 aria2**。执行时固定 `LC_ALL=C`。

## 暂停 = 终止整棵进程树

`child.kill()` 只给直接子进程发信号，而启用 aria2 时进程关系是三级
（DownVid → yt-dlp → aria2c）。只杀 yt-dlp 会让 aria2c 变孤儿继续写 `.part`：
暂停后文件大小还在涨、带宽还在被吃满，而且 `.aria2` 控制文件被写坏后**恢复会从零重下**。
所以 `spawn` 时必须带 `detached: true`（成为进程组组长），暂停时对 `-pid` 发信号；
Windows 先 `taskkill /T /F` 再杀父进程。POSIX 上先 `SIGTERM` 给 aria2c 时间把控制文件写完，
宽限期后才 `SIGKILL`。

## 内存相关的两个坑

- **解析缓存必须有条数上限**：只按 TTL 清理不够，每条缓存持有一份完整 info JSON
  （长视频可到几 MB），「粘贴一批链接逐个看」30 分钟就能攒到几百 MB。
- **临时 info JSON 退出时要清**：它们是下载时 `--load-info-json` 用的。

## 格式去重（`app/internal/parse/formats.go`）

四个易错点（都有测试兜底）：保留无 `vcodec` 的格式（X/Twitter mp4 没有该字段）、
m3u8 仅在该清晰度无直链时保留、都没有分辨率时提供 `bv*+ba/b` 兜底、
**同一清晰度只留一条**。

最后一条曾真实出过问题：bilibili 每个清晰度给三种编码，而 fps 是浮点，
29.969 与 29.97 其实是同一个 30fps 档位——去重键里带原始 fps 时它们不相等，
界面就显示**两个 1080P**。现在 `normalizeFps()` 把帧率归到常见档位，去重键用
`height + 归一化 fps`，并在同档位内按**编码兼容性**（AVC > HEVC > AV1）挑一个。

## yt-dlp 环境细节

- `--ffmpeg-location` 传**目录**而非文件：yt-dlp 会在该目录里同时找 ffmpeg 与 ffprobe。
- YouTube 需要实际安装的 Node / Deno（`app/internal/jsruntime`，校验 Node >=22 / Deno >=2.3；
  总预算 6 秒）。没有运行时时直接报 runtime-unavailable、不起 yt-dlp。
  绑定层只缓存**找到**的结果（60 秒）：「没找到」不能缓存，否则用户装好 Node 后重试还是失败。
- **字幕模式不需要 ffmpeg**，因此不强制解析它，也不传 `--ffmpeg-location`。
- Cookie 经 `app/internal/cookie`：手动文件 → 无；自动模式依次尝试各已安装浏览器 →
  快照 `userData/ytdlp-cookies/browser-cookies.txt` → 无。仅在 cookie **读取**错误时切换来源。
- **不要在 `userData` 下创建与 Chromium 文件名（`Cookies`、`Network`、`Preferences`、
  `Local Storage` 等）大小写不敏感重名的文件/目录**：macOS/Windows 文件系统不区分大小写
  （issue #31）。

---
