# 服务端模式（Docker / WebUI）设计

> 状态：**设计稿，尚未实现**。本文只界定范围与风险，不代表已有代码。
> 讨论清楚「做什么 / 不做什么」之后再动手，避免做成「桌面版的劣化复制品」。

## 为什么考虑这件事

桌面版是给**个人机器**用的：双击打开、下完就关。但有一类需求它天然覆盖不了：

- **NAS / 家庭服务器**：7×24 挂着下，配合 Plex / Jellyfin 做媒体库
- **远程触发**：人在外面，想让家里的机器帮忙下
- **无 GUI 环境**：树莓派、VPS、群晖

这类需求在同类项目（qBittorrent、Jellyfin、MeTube、yt-dlp-web）里都很常见，
做得好会带来一批**长期活跃**的用户 —— 他们的使用频率远高于桌面用户。

## 先明确一件事：不要把桌面版塞进容器

有一种「省事」的做法：容器里跑 Electron + Xvfb + x11vnc + noVNC，把桌面界面
通过 VNC 暴露出去。**这条路不该走**：

| 问题 | 后果 |
| --- | --- |
| 需要 Xvfb + x11vnc + noVNC | 镜像 **1.5GB 量级**（Electron 运行时 + 三个 X 组件）；对比服务端模式约 150MB |
| 用户要装 VNC 客户端才能操作 | 体验比直接用桌面版更差 |
| 4 块能力在容器里必然失效 | 见下表，等于带着一堆坏功能发布 |
| 内存占用 | Electron 主进程 + 渲染进程 **数百 MB 量级**，NAS 上很奢侈 |

> 体积与内存都是**量级估算**（依据：Electron 运行时本身约 150MB、
> 三个 X 组件各几十 MB；Electron 空载常驻内存的公开经验值）。
> 真要做这条路，第一步应先实测，而不是拿估算值当论据。

**结论：Docker 版必须是「服务端 + WebUI」，而不是「容器里的桌面版」。**

## 容器里必然失效的能力

桌面版有 4 块能力**依赖宿主操作系统**，容器里没有对应资源。
这不是「实现得不好」，而是物理上不存在：

| 能力 | 代码位置 | 规模 | 容器里的处境 |
| --- | --- | --- | --- |
| 浏览器 Cookie 自动读取 | `electron/utils/cookies.ts` | 296 行 | 容器里没有浏览器，Chrome/Safari 的 Cookie 数据库不存在 |
| Chrome/Edge 驱动解析 | `electron/utils/browser.ts` | 169 行 | 同上，`puppeteer-core` 没有可驱动的浏览器 |
| 自动更新 | `electron/updater.ts` | 416 行 | 容器版本由镜像决定，应用内替换 `.app`/`.exe` 毫无意义 |
| 目录选择 / 打开文件 / 托盘 / 剪贴板 | `electron/ipc/system.ts` | 268 行 | 无 X11 / D-Bus，`dialog`、`shell`、`Tray`、`clipboard` 全部不可用 |

**Cookie 的替代方案只有一条：让用户上传 `cookies.txt`。**
`utils/cookies.ts` 本来就支持手动文件模式（`cookieMode: 'manual'`），
服务端模式只需要把「选择文件」换成「上传文件」，解析与下载链路不用改。

## 可复用的部分（这是乐观的理由）

桌面版有个别的 Electron 项目没有的优势：**核心链路已经和 GUI 解耦了**。

实测（`grep -cE "app\.getPath|shell\.|dialog\.|BrowserWindow|nativeImage"`）：

| 模块 | GUI 依赖 |
| --- | --- |
| `electron/download/direct.ts` | **0 处** |
| `electron/download/ytdlp.ts` | **0 处** |
| `electron/ipc/download.ts` | **0 处** |
| `electron/download/progress.ts` | 2 处（只有进度广播） |
| `electron/ipc/history.ts` | 3 处（只有 `userData` 路径） |

也就是说 **下载引擎（三条链路：direct / ytdlp / progress）可以直接搬走**。

其余可复用：

- `electron/parsers/*`（douyin / kuaishou / ytdlp / formats）—— 平台解析
- `backend/`（Go 边车）—— **零第三方依赖**，`CGO_ENABLED=0` 编出来是静态二进制
- `shared/parse-error.ts` —— 错误分类与脱敏诊断
- `src/i18n/` —— 254 条词条 × 2 语言
- `src/stores/download-rules.ts` —— 并发闸门 / FIFO / 重试（纯函数，已有 16 条用例）

## 必须重写的部分

渲染进程与主进程之间有 **39 个 IPC 通道 + 6 个广播事件**（见 `electron/preload.ts`；
`preload.ts` 里是 41 处 `invoke`，其中 2 处是同一通道的复用）。
这些全是进程内 IPC，容器里没有 IPC 对端：

| API 分组 | 方法数 | 订阅（最终通道） | 服务端对应 |
| --- | --- | --- | --- |
| `app` | 11 | — | 大部分保留（版本、磁盘空间、代理）；`fetchImage` 需服务端代理；`cookieStatus` 语义变化 |
| `deps` | 6 | 2（`deps:progress`） | 保留（边车本来就是进程调用） |
| `history` | 7 | 4（`history:updated` / `update:status` / `menu:openSettings` / `menu:showAbout`） | 保留，存储从文件换成服务端；两个 `menu:*` 删除 |
| `ytdlp` | 4 | 1（`download:progress`） | 保留（`parse` / `download` / `pauseDownload`） |
| `window` | 4 | — | **删除**（无窗口） |
| `dialog` | 2 | — | **改上传/路径输入** |
| `shell` | 3 | — | **降级**为「显示路径」（服务端无法打开用户本机文件） |
| `clipboard` | 2 | — | **删除**（浏览器有原生剪贴板 API） |
| 合计 | **39** | **6 个通道** | |

六个广播事件：`download:progress`、`deps:progress`、`history:updated`、
`update:status`、`menu:openSettings`、`menu:showAbout`。
服务端模式下前三个走 SSE，后三个删除（无菜单、无自动更新）。

> 注意 `deps` 与 `history` 分组里挂着**别域的订阅**（`deps.onDownloadProgress`
> 实际监听的是 `download:progress`，`history.onUpdateStatus` 监听 `update:status`）。
> 这是 preload 的历史结构，改造时按**通道**而非按分组迁移，别被分组名误导。

另外 `localStorage`（用户设置）要换成服务端存储 —— 否则每个浏览器各自一套设置。

## 架构

```
┌─────────────────────────────────────────────────────────┐
│ 浏览器（复用现有 Vue 界面）                                │
│   src/stores/*  ── 通过「适配层」调用 ──┐                  │
└───────────────────────────────────────┼─────────────────┘
                                        │ HTTP + SSE
┌───────────────────────────────────────▼─────────────────┐
│ server/（新增）                                          │
│   REST: /api/parse  /api/download  /api/tasks  /api/deps │
│   SSE:  /api/events  （进度 / 历史 / 依赖进度）            │
│   ├── 复用 electron/download/*（原样搬）                  │
│   ├── 复用 electron/parsers/*（原样搬）                   │
│   └── 调用 backend 边车（进程调用，和桌面版一样）           │
└─────────────────────────────────────────────────────────┘
```

关键设计点：**渲染进程只加一层适配层，Vue 组件基本不动**。

```ts
// 现状
window.electronAPI.ytdlp.download(options)

// 服务端模式：同一个签名，换实现
// src/platform/index.ts
export const api = isServerMode
  ? createHttpApi(baseUrl)     // fetch + SSE
  : window.electronAPI          // 原样
```

63 个调用点里大部分能一对一映射（`ytdlp.download` → `POST /api/download`）。
这样 `src/components/*` 与 `src/stores/*` 几乎不用改，
`src/i18n` 的 254 条词条也直接复用。

## 文件落盘：挂载宿主目录

**这是 Docker 版最容易被低估的点。** 视频动辄几百 MB～几 GB，
写容器内部等于「重建镜像就丢」，且会让镜像层无限膨胀。

采用与 qBittorrent / Jellyfin 相同的做法：

```bash
docker run -d \
  -v /volume1/downloads:/downloads \   # 下载目录（必须挂载）
  -v /volume1/downvid-config:/config \ # 设置 / cookies / 历史
  -p 8080:8080 \
  -e PUID=1026 -e PGID=100 \
  downvid/downvid
```

- `/downloads` 与 `/config` 是**约定的挂载点**，不由用户自由指定
- `PUID` / `PGID` 控制写入文件的属主 —— 不处理的话，
  NAS 用户会看到文件属于 `root`，媒体服务器读不到
- 下载目录在界面上**只读展示**（显示容器内路径），不提供目录选择

必须处理的两个坑：

1. **权限**：容器内以 `PUID:PGID` 运行（entrypoint 里 `usermod`/`chown`），
   而不是以 root 写文件
2. **剩余空间**：`app:getDiskSpace` 已经走 `fs.promises.statfs`（`system.ts:29`），
   在容器里对**挂载点**查询会正确反映宿主磁盘 —— 这一点天然没问题。
   但要确保传入的是挂载点路径（`/downloads`）而不是容器内其他目录，
   否则会报容器根文件系统的空间，误导用户

## 安全：默认只监听回环，且必须鉴权

服务端模式把下载能力暴露到了网络上。**默认配置必须是安全的**：

- 默认只监听 `127.0.0.1`，要暴露到局域网必须显式设置 `HOST=0.0.0.0`
- 提供 `AUTH_TOKEN` 环境变量；设置后所有 `/api/*` 要求 `Authorization: Bearer`
- 未设置 `AUTH_TOKEN` 且监听了非回环地址时，**启动时打印醒目警告**
- 不做多用户 / 权限分级（超出范围），但要让「暴露到公网」这件事有摩擦力

不做的事：不做用户注册、不做配额、不做 TLS 终结（交给反向代理）。

## 分三步实施

### 第一步：Dockerfile + 验证边车自举（1～2 天，低风险）

**不改任何现有代码。** 先证伪最大的不确定性：容器里能不能探测并下载依赖。

```dockerfile
FROM golang:1.24 AS build
COPY backend /src
RUN CGO_ENABLED=0 go build -o /out/downvid-deps ./cmd/downvid-deps

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
COPY --from=build /out/downvid-deps /usr/local/bin/
ENTRYPOINT ["downvid-deps"]
```

验证点：
- `linux/x64` 与 `linux/arm64` 的资产**清单里已齐全**（已确认）：
  - `ytdlpAssets` 覆盖 5 个平台，含 `linux/x64`（`yt-dlp_linux`）与 `linux/arm64`（`yt-dlp_linux_aarch64`）
  - `ffmpegAssets` 是 `map[string]map[rt.Kind]asset`，每个平台**同时**带 ffmpeg 与 ffprobe，
    Linux 两个架构都有（容器里两个都需要：合并音视频要用 ffprobe 探测）
- 边车探测 PATH 时会额外跑一次登录 shell（`find.go` 的 `loginShellPath()`：
  `$SHELL` 或回退 `/bin/sh`，执行 `-l -c 'printf %s "$PATH"'`）。
  容器里没有登录 shell 时它会**优雅返回 nil**（不阻塞探测），
  而且容器内 `PATH` 本来就已经由镜像设对，这一步并不需要 —— 但要实测确认不报错
- `Finalize()`（下载后的平台处理）里 `xattr -c` + `codesign` **已被
  `runtime.GOOS != "darwin"` 挡住**，Linux 分支直接返回，容器里不会去调不存在的命令。
  但它同时依赖 `chmod +x`，容器里要确认这一步生效

产出：能跑 `docker run downvid/downvid detect --json` 并输出正确 NDJSON。

### 第二步：抽出 `server/`（工作量最大）

- HTTP 层：`/api/parse`、`/api/download`、`/api/tasks`、`/api/deps`、`/api/history`
- SSE：进度广播（复用 `download/progress.ts` 的节流逻辑）
- 把 `electron/download/*` 与 `electron/parsers/*` 从 `electron/` 移到一个共享目录
  （建议 `core/`），两边共同引用 —— **不要复制一份**
- 设置存储：`localStorage` → `/config/settings.json`
- Cookie：上传 `cookies.txt` → `/config/cookies.txt`，喂给现有手动文件模式

### 第三步：前端适配层

- `src/platform/` 提供与 `electronAPI` **同签名**的 HTTP client
- 63 个调用点逐个替换为 `api.xxx`（大部分是一对一）
- 删掉服务端模式下无意义的 UI：窗口控制、目录选择、打开文件、自动更新、菜单事件

## 明确不做的事

避免范围蔓延，以下**不在**本设计内：

- ❌ 多用户 / 账号体系 / 权限分级
- ❌ 队列持久化与断点续传（桌面版同样没有，见 AGENTS.md「无跨重启恢复」）
- ❌ 移动端适配（界面按桌面宽度设计，窄屏另开议题）
- ❌ 服务端自动更新（由镜像 tag 决定）
- ❌ 把 Electron 版也改成走 HTTP（桌面版保持进程内调用，延迟更低）

## 已知风险

| 风险 | 说明 | 应对 |
| --- | --- | --- |
| 代码分叉 | `electron/download/*` 搬到 `core/` 后，两处引用同一份；若有人图省事复制一份，立刻分叉 | 第二步必须移动而非复制；`lint` 可加一条「禁止在 `electron/` 下重新出现 download 实现」 |
| 权限问题成为 FAQ 第一名 | PUID/PGID 没配对，用户看到文件是 root 属主 | entrypoint 处理 + 文档前置说明 + 启动时打印实际 uid/gid |
| 默认不安全 | 用户 `-p 8080:8080` 直接暴露到公网 | 默认只监听回环 + 未鉴权时启动警告 |
| 与桌面版行为不一致 | 两个入口共用核心，但 UI 能力不同（无目录选择、无自动更新） | 差异在界面上显式标注，不要静默降级 |
| 维护成本翻倍 | 多一个入口 = 多一套 CI（镜像构建、容器内回归） | 第一步就把它挂进 CI；复用现有的 `test:download:integration` |

## 与现有约定的关系

- **`shared/app.ts` 是仓库坐标的唯一来源** —— 服务端模式的文档链接也要引用它
- **界面文案必须走 `t('key')`** —— WebUI 复用 `src/i18n`，新增文案同样要双语
- **不要新增运行时依赖** —— HTTP 层优先用 Node 内置 `node:http`（与 Go 侧车「只用标准库」同一理由）
- **AGENTS.md / CLAUDE.md 需同步** —— 若本设计落地，两份文档都要加「服务端模式」一节

## 待决定的问题

1. **HTTP 框架**：用 Node 内置 `node:http`（零依赖，但手写路由/SSE 略啰嗦），
   还是引 Fastify / Hono（体验好，但违背「零依赖」的既有倾向）？
2. **核心代码搬到哪**：`core/` 还是保持在 `electron/` 下、由 `server/` 反向引用？
   前者更干净，但会动大量 import 路径（需要一次性的机械重构）。
3. **镜像发布**：跟着 GitHub Release 发（每次发版构建镜像），
   还是单独发（镜像 tag 与 app 版本解耦）？
4. **是否需要「无 WebUI 的纯 API 模式」**：有人可能只想拿它当下载后端，
   用现成的 yt-dlp 前端接。这个模式成本很低（不加适配层即可），要不要一并支持？
