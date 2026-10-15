# 用 Docker 运行 DownVid

DownVid 是桌面应用，容器里没有显示器。这份文档说明镜像怎么把「桌面」补回来，
以及在实际使用中会碰到的几个坑。

---

## 目录

- [它能做什么](#它能做什么)
- [快速开始](#快速开始)
- [打开界面](#打开界面)
- [取回下载的文件](#取回下载的文件)
- [配置项](#配置项)
- [运行依赖](#运行依赖)
- [故障排除](#故障排除)
- [自己构建镜像](#自己构建镜像)
- [设计说明](#设计说明)

---

## 它能做什么

容器里的 DownVid 与桌面版功能一致：解析链接、下载、格式选择、Cookie、代理、
下载历史都能用。差别只在**怎么看到界面**：

- 界面由 [noVNC](https://github.com/novnc/noVNC) 在浏览器里呈现，因此任何能开网页的设备
  （手机、平板、另一台电脑）都能操作
- 下载目录是挂载进容器的目录，文件直接落在宿主机上

适合的场景：想在一个常开的机器上挂着下载、通过网页远程使用、
或者不想在主机上装 Electron 与一堆运行时库。

不适合的场景：需要它操作你本机的浏览器 Cookie（容器里看不到你的 Chrome）、
或者需要 GPU 硬解（容器里没有可用显卡）。

## 快速开始

```bash
git clone https://github.com/yxxbc/downvid.git
cd downvid
docker compose up -d
```

然后打开 <http://127.0.0.1:6080/vnc.html>。

> 从别的设备访问时，把 `127.0.0.1` 换成这台机器的 IP。
> `docker compose ps` 也会打印端口映射。

不想克隆仓库、只需要 compose 文件的话，可以直接下载 `docker-compose.yml` 与 `Dockerfile`
两个文件再执行上面的命令。

## 打开界面

镜像暴露三个端口：

| 端口 | 用途 | 默认 |
| --- | --- | --- |
| 6080 | noVNC 网页端，浏览器直接打开 | 开 |
| 5900 | 原生 VNC 客户端（RealVNC、TigerVNC、系统自带客户端） | 开 |
| 2222 | SSH / SFTP，取回文件用 | **默认关**，见下文 |

noVNC 页面打开后点「连接」即可看到 DownVid 窗口。它是无密码的，
所以**不要把 5900/6080 直接暴露到公网**。需要远程访问时建议走 VPN，
或者在前面套一层带认证的反向代理。

### 用原生 VNC 客户端

```bash
# 地址填 <宿主机IP>:5900，无密码
vncviewer 192.168.1.10:5900
```

原生客户端的鼠标与键盘响应通常比浏览器里的 noVNC 更跟手。

## 取回下载的文件

默认布局下文件落在 `./data/downloads/`（宿主机上的相对目录），
也就是 compose 文件里声明的卷。直接进这个目录即可，不需要额外工具。

需要 SFTP 时（比如从手机取文件），显式打开它并提供一个公钥：

```bash
# 1. 生成一对密钥（如果还没有）
ssh-keygen -t ed25519 -f ~/.ssh/downvid_key

# 2. 启动时注入公钥
DOWNVID_ENABLE_SSH=1 \
DOWNVID_SSH_PUBLIC_KEY="$(cat ~/.ssh/downvid_key.pub)" \
  docker compose up -d
```

然后：

```bash
sftp -P 2222 -i ~/.ssh/downvid_key root@<宿主机IP>
# 或者
scp -P 2222 -i ~/.ssh/downvid_key -r root@<宿主机IP>:/data/downloads ./
```

容器内的用户是 `root`（容器是隔离环境，不需要额外建用户），
但只接受公钥认证，不接受密码。没有公钥时服务不会启动，端口保持关闭。

## 配置项

全部通过环境变量设置，写在 compose 的 `environment:` 段或 `docker run -e`：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DOWNVID_RESOLUTION` | `1280x800` | 虚拟显示分辨率，格式 `宽x高` |
| `DOWNVID_HTTP_PORT` | `6080` | noVNC 端口（compose 侧，影响宿主机映射） |
| `DOWNVID_VNC_PORT` | `5900` | VNC 端口（compose 侧） |
| `DOWNVID_SSH_PORT` | `2222` | SSH 端口（compose 侧） |
| `DOWNVID_HOME` | `/data` | 容器内数据根目录 |
| `DOWNVID_DOWNLOADS` | `/data/downloads` | 应用默认下载目录 |
| `DOWNVID_ENABLE_SSH` | `0` | 设为 `1` 启用 SSH/SFTP |
| `DOWNVID_SSH_PUBLIC_KEY` | 空 | 授权登录的公钥（启用 SSH 时必填） |
| `TZ` | 跟随宿主机 | 时区，影响日志时间戳 |

`SCREEN_WIDTH` / `SCREEN_HEIGHT` / `SCREEN_DEPTH` 也可以单独设置，
设了会覆盖 `DOWNVID_RESOLUTION` 里的对应项。一般用不到。

### 分辨率怎么选

应用自己的窗口最小尺寸是 1000x700（`electron/main.ts` 里的 `minWidth`/`minHeight`），
低于这个值界面元素会被裁掉、点到边界外。默认给 1280x800 就是留了余量。

调大分辨率会让界面更舒展，但 noVNC 传输的像素更多，弱网下会更卡。

### 代理

应用内「设置 → 代理」填的地址在容器里同样有效。若要访问宿主机上的代理服务，
把 compose 里 `extra_hosts` 那段注释打开，然后代理填 `http://host.docker.internal:端口`。

## 运行依赖

镜像里**已经装好** yt-dlp 与 ffmpeg，从 Debian 仓库和 pip 安装到
`/usr/bin`、`/usr/local/bin`。DownVid 的 Go 边车按「系统优先，缺失才下载」的顺序探测，
这两个目录都在它的候选路径里，所以启动后「设置 → 运行依赖」会显示为「系统安装」。

想升级时重建镜像即可，不需要在界面里点下载：

```bash
docker compose build --no-cache --pull
docker compose up -d
```

也可以在界面里像桌面版那样一键下载——那是 DownVid 自己管理的副本，
装在 `/data/userdata/runtime/bin`，跟着数据卷走，不会覆盖镜像内的版本。

## 故障排除

### 能连上 noVNC，但只有空白的桌面

按顺序看这几处：

```bash
# 1. 应用进程还活着吗（日志里有启动记录吗）
docker compose logs downvid | tail -50

# 2. 进容器看应用自己的日志
docker compose exec downvid tail -50 /var/log/downvid/app.log

# 3. Xvfb 起来了没
docker compose exec downvid xdpyinfo -display :99 | head
```

`app.log` 是最可能有信息的地方，Electron 启动失败的原因一般都写在那里。

### 界面很卡

三个可能：分辨率太高（调低 `DOWNVID_RESOLUTION`）、noVNC 画质设置、
或者网络带宽不够。noVNC 左下角有画质/压缩选项，调成「低画质」会明显变流畅。

### 容器起来几秒后就退出

有服务启动即失败。`docker compose logs` 会打印是哪个进程、退出码多少，
以及应用日志的尾部。绝大多数情况下是 `app.log` 里的 Electron 报错。

### YouTube 解析失败，提示需要 Node/Deno

YouTube 的部分提取环节需要一个 JS 运行时。镜像里带了 Node 22（构建阶段那个
`node:22` 基础镜像只在构建层），**运行阶段没有**。两种解法：

1. 自己在镜像里装：改 Dockerfile 的运行时 `apt-get` 段加上 `nodejs`
2. 用 Deno：同理装 `deno` 二进制

装好后边车会自动探测到（它查 `/usr/bin`、`/usr/local/bin`）。

### 下载目录里没有文件

看看应用内「设置 → 下载目录」是不是被改过。容器把它默认设成 `/data/downloads`，
但如果用户手动指定过，就以用户设置为准。另外暂停中的任务不会落盘。

## 自己构建镜像

```bash
# 当前架构
docker build -t downvid:dev .

# 指定平台（在 x86 机器上构建 arm64 镜像需要 QEMU，较慢）
docker build --platform linux/arm64 -t downvid:dev .
```

构建分两阶段：第一阶段装 pnpm 依赖、跑 `pnpm vite build`（同时产出渲染进程、
主进程与 Go 边车）、解包 Electron 二进制；第二阶段只拷产物并装运行时库。
因此最终镜像里没有 Go、没有 node_modules，也没有构建缓存。

## 设计说明

几个看起来可以更简单、但那样会出问题的地方：

**为什么是 Xvfb 而不是 headless 模式。** Electron 的 `BrowserWindow` 需要一个真实的
X display。`--headless` 只在少数场景可用，且会丢掉窗口管理、输入法、
以及本项目用到的 `puppeteer-core` 驱动系统 Chrome 这条解析路径。

**为什么要 fluxbox。** 没有窗口管理器时 Chromium 的窗口仍能显示，但装饰、
焦点与定位会异常，表现为「标题栏点不动」。fluxbox 是这件事上最轻的选择。

**为什么要监督所有服务。** 应用崩掉时如果容器继续显示「运行中」，
用户看到的是一次没反应的连接，而不是一个明确的错误。退出后
`docker compose restart`/`--restart unless-stopped` 才有机会介入。

**为什么 SSH 默认关闭。** 容器里跑 SSH 是个攻击面。多数情况下挂载卷就够了，
需要的人显式开，并且必须给公钥——容器不接受密码登录。
