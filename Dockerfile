# syntax=docker/dockerfile:1
#
# DownVid 容器镜像。
#
# DownVid 是 Electron 桌面应用，容器里没有物理显示器与真实桌面，
# 因此镜像的职责是**复刻一套「够用的桌面」**：
#
#   1. Xvfb 提供虚拟显示（DISPLAY=:99），Electron 才能创建窗口
#   2. fluxbox 管窗口定位与焦点（没有 WM 时 Chromium 的标题栏点不动）
#   3. x11vnc 把虚拟显示共享为 VNC，用户可自选原生 VNC 客户端
#   4. noVNC 把 VNC 转成浏览器可访问的网页（默认端口 6080），零客户端部署
#   5. openssh-server 提供 SSH / SFTP（默认**关闭**），用于取回下载好的文件
#
# 另有 libdbus-1-3（Chromium 的链接依赖，见下文的运行时库清单）：
# GTK 会尝试连 dbus 会话总线，连不上只是刷警告、不影响功能，
# 因此不额外跑一个 dbus-daemon（那会多一个常驻进程与一个故障点）。
# 除 sshd 自行 daemon 化外，其余服务都由 docker/entrypoint.sh 监督，
# 任一非正常退出都会让容器退出——异常必须显式暴露。
#
# 运行依赖（yt-dlp / ffmpeg / ffprobe）在镜像内预装到 /usr/local/bin：
# DownVid 的 Go 边车本来就按「系统优先，缺失才下载」的顺序探测，而
# /usr/local/bin 与 /usr/bin 都在它的候选目录里，因此开箱即识别为
# 「系统安装」。不预装也能跑——界面会提示一键下载——但那要在容器里再走一次
# 下载与校验，且容器每重建一次都要重来。

# ===== 构建阶段 =====
#
# 单独一个阶段编译前端、主进程与 Go 边车，运行阶段只拷产物：运行镜像里
# 没有 Go、没有 node_modules，也没有构建缓存。
FROM node:22-bookworm-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

# Go：与 .github/workflows/ci-*.yml 的 go-version 保持一致（都是 1.24），
# 否则会出现「CI 用一套、镜像用另一套」的静默偏差。
# 边车只用标准库，从官方 tarball 装，比发行版仓库的版本可控。
#
# 顺带核对下载到的确实是这个版本：`go version` 会打印构建版本，
# 下载被镜像站篡改或串包时这一步会失败，而不是带着一个错的工具链继续跑。
ARG GO_VERSION=1.24.10
ARG TARGETARCH
RUN case "${TARGETARCH}" in \
    amd64) GO_ARCH=amd64 ;; \
    arm64) GO_ARCH=arm64 ;; \
    *) echo "不支持的架构：${TARGETARCH}" >&2; exit 1 ;; \
  esac \
  && curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${GO_ARCH}.tar.gz" -o /tmp/go.tar.gz \
  && tar -C /usr/local -xzf /tmp/go.tar.gz \
  && rm /tmp/go.tar.gz \
  && test "$(go version | grep -o 'go[0-9][0-9.]*' | head -1)" = "go${GO_VERSION}" \
  && go version

ENV PATH=/usr/local/go/bin:$PATH
ENV GOTOOLCHAIN=local
ENV CGO_ENABLED=0

# corepack 自带 pnpm，版本与仓库 CI 保持一致（见 .github/workflows/ci-*.yml）
ENV PNPM_VERSION=11
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /app

# 先只拷依赖清单再 install，让这一层能被 Docker 缓存复用：
# 之后改源码不必重新下载全部依赖。
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm install --frozen-lockfile

COPY . .

# vite build 一次产出三样东西：
#   dist/                       渲染进程
#   dist-electron/              主进程与 preload
#   backend/build/<平台>-<架构>/ Go 依赖边车
RUN pnpm vite build

# ===== Electron 可执行文件 =====
#
# dist-electron/main.js 里是从 "electron" 的裸导入，因此必须用
# Electron 跑，不能用裸 node。而运行时阶段不带 node_modules
# （那会把开发依赖一起拖进去），所以这里从 Electron 的 GitHub Release
# 解包官方二进制到 /opt/electron。
#
# 为什么不用 `node node_modules/electron/cli.js`：cli.js 会自己
# 下载并校验二进制，多一层网络往返与失败模式；直接解包 zip 更直接。
#
# 版本必须与 package.json 的 devDependency 一致，这里**硬校验**：
# 两者漂移时报错退出，而不是给个 warning 蒙混过去——那种漂移的后果是
# 镜像里的 Electron 主版本与构建产物不匹配，运行期行为难以归因。
#
# 另外注意 Electron 的资产命名是 x64 / arm64，**不是** Docker 的
# amd64 / arm64，下面有显式映射。
ARG ELECTRON_VERSION=44.5.1
RUN set -euo pipefail \
  && case "${TARGETARCH}" in \
    amd64) EARCH=x64 ;; \
    arm64) EARCH=arm64 ;; \
    *) echo "不支持的架构：${TARGETARCH}" >&2; exit 1 ;; \
  esac \
  && PKG_VER="$(node -p "require('./package.json').devDependencies.electron")" \
  && if [ "${PKG_VER}" != "${ELECTRON_VERSION}" ]; then \
    echo "Dockerfile 的 ELECTRON_VERSION=${ELECTRON_VERSION} 与 package.json 的 ${PKG_VER} 不一致，请同步后再构建" >&2; \
    exit 1; \
  fi \
  && curl -fsSL "https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/electron-v${ELECTRON_VERSION}-linux-${EARCH}.zip" -o /tmp/electron.zip \
  && mkdir -p /opt/electron \
  && python3 -c "import zipfile; zipfile.ZipFile('/tmp/electron.zip').extractall('/opt/electron')" \
  && rm /tmp/electron.zip \
  && chmod +x /opt/electron/electron \
  && test "$(/opt/electron/electron --version)" = "v${ELECTRON_VERSION}" \
  && /opt/electron/electron --version

# ===== 运行阶段 =====
FROM debian:bookworm-slim AS runtime

# Electron / Chromium 的运行时系统库。
#
# 这份清单取自 Chromium 官方的运行时依赖定义
# （build/install-build-deps.py 的 lib_list，被 Electron 的
# install-deps.sh 引用），而不是凭经验罗列：Chromium 的链接库
# 随版本变化，手写列表的下场是「本地能跑、容器里缺一个 .so」。
# 裁剪掉的只有本项目确定用不到的项（32 位兼容、容器外的输入设备栈）。
#
# 显示与远程访问：
#   xvfb       虚拟显示，没有物理显示器时 Electron 的唯一出路
#   x11vnc     把虚拟显示共享为 VNC
#   fluxbox    极简窗口管理器；没有 WM 时部分程序的窗口定位与焦点会异常
#   xterm      X 出问题时的兜底交互入口（诊断用）
#   openssh-server /openssh-sftp-server   SSH 与 SFTP，用于取回下载好的文件
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    tini \
    # 显示与远程访问
    xvfb \
    x11vnc \
    fluxbox \
    xterm \
    openssh-server \
    openssh-client \
    # Chromium / Electron 运行时库（源自 install-build-deps.py 的 lib_list）
    libasound2 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libatspi2.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libegl1 \
    libevdev2 \
    libexpat1 \
    libfontconfig1 \
    libfreetype6 \
    libgbm1 \
    libglib2.0-0 \
    libgl1 \
    libgtk-3-0 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libpixman-1-0 \
    libspeechd2 \
    libsqlite3-0 \
    libuuid1 \
    libwayland-egl1 \
    libx11-6 \
    libx11-xcb1 \
    libxau6 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxdmcp6 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxinerama1 \
    libxrandr2 \
    libxrender1 \
    libxtst6 \
    x11-utils \
    x11-xserver-utils \
    xserver-xorg-core \
    xserver-xorg-video-dummy \
    zlib1g \
    libnspr4 \
    libnss3 \
    libpulse0 \
    bzip2 \
    # 中文字体：界面默认中文，缺字体时所有中文渲染成方框
    fonts-liberation \
    fonts-noto-cjk \
    # Python 3：websockify 是纯 Python 的，noVNC 只提供静态文件。
    # python3-pip 必须显式装 —— debian slim 里只有解释器、没有 pip，
    # 而下面装 yt-dlp 与 websockify 都要用它。
    python3 \
    python3-pip \
  && rm -rf /var/lib/apt/lists/*

# ===== 运行依赖（yt-dlp / ffmpeg / ffprobe）=====
#
# ffmpeg / ffprobe 来自 Debian 仓库，装到 /usr/bin；
# yt-dlp 用 pip 装到 /usr/local/bin —— 两者都在 Go 边车的候选目录里
# （backend/internal/runtime 的 Linux 常见目录），探测结果标记为
# 「系统安装」，用户在界面里改设置也不会覆盖它们。
#
# 版本固定在镜像构建时：升级这两个工具 = 升级镜像，不需要
# 应用内再下载一次（那会在每次重建容器后重做一遍）。
#
# Debian 12 起 pip 默认拒绝往系统环境装包（PEP 668），
# 容器里没有 venv 的需求，--break-system-packages 是这里的正解。
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/* \
  && pip3 install --no-cache-dir --break-system-packages yt-dlp \
  && yt-dlp --version \
  && ffmpeg -version | head -1

# ===== 应用产物 =====
#
# 边车按 linux-<arch> 目录存放，与 electron/utils/runtime.ts 的
# getSidecarPath() 查找顺序对应（APP_ROOT/backend/build/<platform>-<arch>/）。
COPY --from=build /app/dist /opt/downvid/dist
COPY --from=build /app/dist-electron /opt/downvid/dist-electron
COPY --from=build /app/backend/build /opt/downvid/backend/build

# 主进程用 import.meta.dirname 定位 dist 与 dist-electron，APP_ROOT 指向 /opt/downvid
ENV APP_ROOT=/opt/downvid
# 应用的数据目录（下载历史、Cookie 快照、托管依赖、日志）。
# entrypoint 会把 XDG_CONFIG_HOME 指到 ${DOWNVID_HOME}/userdata，
# 让这些内容跟着 /data 卷走，而不是留在容器的可写层里。
ENV DOWNVID_HOME=/data
# Electron 的 GPU 进程在容器里没有可用设备，禁用沙箱否则起不来
ENV ELECTRON_DISABLE_SANDBOX=1

# ===== noVNC =====
#
# noVNC 从源码 tarball 装，而不是把几百个静态文件提交进仓库；
# 版本钉死在这里，升级时改这一处即可。
#
# websockify 用 pip 装的那个：noVNC 自带的 novnc_proxy 在找不到本地
# websockify 时会去 `git clone`，而容器启动时联网不可靠。装上系统包后
# entrypoint 里直接 `python3 -m websockify --web ...` 更稳。
ARG NOVNC_VERSION=1.7.0
RUN curl -fsSL "https://github.com/novnc/noVNC/archive/refs/tags/v${NOVNC_VERSION}.tar.gz" -o /tmp/novnc.tar.gz \
  && mkdir -p /opt/downvid/novnc \
  && tar xzf /tmp/novnc.tar.gz -C /opt/downvid/novnc --strip-components=1 \
  && rm /tmp/novnc.tar.gz \
  && test -f /opt/downvid/novnc/vnc.html \
  && pip3 install --no-cache-dir --break-system-packages websockify \
  && python3 -c "import websockify, sys; print('websockify ok')"

# 入口脚本与目录准备
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
  && mkdir -p /data/downloads /data/userdata /run/sshd /var/log/downvid \
  && chmod 755 /run/sshd

EXPOSE 6080 5900 2222

VOLUME ["/data"]

# tini 作为 PID 1：正确转发信号并回收僵尸进程。
# 没有它时容器停止只会杀掉 shell，Xvfb 与 Electron 会残留。
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
