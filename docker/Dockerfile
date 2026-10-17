# DownVid 容器镜像：无头 Web 服务 + 独立 WebUI。
#
# 架构设计：
#   - 容器化完全收敛在 docker/ 目录下，桌面核心代码（electron/ 与 src/）保持 100% 官方原样。
#   - 构建阶段（build）：
#       1. 编译 Go 依赖探测边车（backend/cmd/downvid-deps）
#       2. 编译 WebUI 静态前端（docker/dist-web/，经由 docker/web/vite.config.ts）
#   - 运行阶段（runtime）：基于轻量 Node 环境运行 docker/server/index.ts。
#   - 运行依赖：yt-dlp（nightly 独立版）与 ffmpeg 预装在系统路径，由边车自动识别。

# ===== 构建阶段 =====
FROM node:22-bookworm-slim AS build

# 构建阶段只装 Go/前端构建需要的最小工具，避免把 FFmpeg 等运行依赖
# 也放进构建层，降低 Docker Desktop 构建峰值内存。
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*

# Go 1.24：与仓库 CI 工作流保持严格一致
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
  && test "$(/usr/local/go/bin/go version | grep -o 'go[0-9][0-9.]*' | head -1)" = "go${GO_VERSION}" \
  && /usr/local/go/bin/go version

ENV PATH=/usr/local/go/bin:$PATH
ENV GOTOOLCHAIN=local
ENV CGO_ENABLED=0

ENV PNPM_VERSION=11
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /app

# WebUI 构建不需要 Electron 运行时（那是桌面版的事）。
# 不跳过的话 pnpm install 会额外下载约 100MB 的 Electron 二进制，
# 既拖慢构建，也在 Docker Desktop 上抬高峰值内存。
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

# 安装项目前端构建依赖
# 说明：bufferutil 与 utf-8-validate 的官方 prebuilds 仅包含 linux-x64、darwin-* 和 win32-*，
# 缺少 linux-arm64 预编译包。在 Apple Silicon (Mac M系列) 或 ARM64 Linux 上构建镜像时，
# 不加 --ignore-scripts 会触发 node-gyp 回退编译 C++ 源码并因缺少编译链而报错失败。
# WebUI 静态构建仅使用纯 JS 模块（Vite 8 / Rolldown 原生二进制通过 optionalDependencies 直接分发），
# 因此使用 --ignore-scripts 既能彻底规避跨架构编译失败，又能大幅加快安装速度。
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .

# 1. 独立构建 WebUI 前端到 docker/dist-web（不改变根目录构建配置）
RUN pnpm exec vite build --config docker/web/vite.config.ts

# 2. 构建 Go 依赖边车
RUN bash scripts/build-backend.sh linux

# ===== 运行阶段 =====
FROM node:22-bookworm-slim AS runtime

# 显式依赖 build 阶段：BuildKit 不会在 Go/前端构建和本阶段 apt 安装之间并发，
# 避免 Docker Desktop 内存峰值导致 BuildKit 被系统以 137 杀掉。
COPY --from=build /app/docker/dist-web /tmp/build-complete
RUN rm -rf /tmp/build-complete

ARG YTDLP_VERSION=2026.10.10.233141

# 运行阶段才安装 FFmpeg / tini / Python，避免构建阶段占用内存
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg tini python3 \
  && rm -rf /var/lib/apt/lists/*

# 下载 yt-dlp nightly 独立执行文件
RUN curl -fsSL "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/${YTDLP_VERSION}/yt-dlp" -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp \
  && yt-dlp --version \
  && ffmpeg -version | head -1

WORKDIR /opt/downvid

# 拷贝静态资源与后端代码
COPY --from=build /app/docker/dist-web /opt/downvid/docker/dist-web
COPY --from=build /app/backend/build /opt/downvid/backend/build
COPY package.json /opt/downvid/package.json
COPY electron /opt/downvid/electron
COPY shared /opt/downvid/shared
COPY docker /opt/downvid/docker

# 安装 Docker 专属服务依赖（仅安装 docker/package.json 中的 ws 与 tsx，不污染主项目）
RUN cd /opt/downvid/docker \
  && npm install --omit=dev

ENV APP_ROOT=/opt/downvid
ENV DOWNVID_HOME=/data
ENV DOWNVID_DATA_DIR=/data/userdata
ENV DOWNVID_DOWNLOADS=/data/downloads
ENV DOWNVID_WEB_PORT=6080
ENV DOWNVID_WEB_HOST=0.0.0.0

RUN chmod +x /opt/downvid/docker/entrypoint.sh \
  && ln -s /opt/downvid/docker/entrypoint.sh /usr/local/bin/entrypoint.sh \
  && mkdir -p /data/downloads /data/userdata

EXPOSE 6080
VOLUME ["/data"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
