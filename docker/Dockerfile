# DownVid 容器镜像：无头 Web 服务 + 独立 WebUI。
#
# 架构设计：
#   - 容器化完全收敛在 docker/ 目录下，桌面核心代码（electron/ 与 src/）保持 100% 官方原样。
#   - 构建阶段（build）：
#       1. 编译 Go 依赖探测边车（backend/cmd/downvid-deps，只编目标架构）
#       2. 编译 WebUI 静态前端（docker/dist-web/）
#       3. 把无头服务打成单文件（docker/dist-server/index.js，SSR 构建）
#   - 运行阶段（runtime）：node 直跑单文件服务，不需要 tsx、不需要 node_modules。
#   - 运行依赖：yt-dlp / ffmpeg / ffprobe 的静态二进制，版本与 SHA-256 取自
#     backend/internal/manifest/assets.gen.go（与桌面版用户下载到的那一份逐字节一致）。
#
# ## 关于镜像大小（每一处都是量过的）
#
# | 改法 | 效果 |
# | --- | --- |
# | 用 ffmpeg-static 静态二进制替代 `apt install ffmpeg` | 452MB → ~160MB。apt 的
#   ffmpeg 会拖进 libllvm15(109MB)、libgl1-mesa-dri(23MB)、libicu72(36MB)、
#   libflite1(27MB) 等一整串依赖，而下载合并只用到 ffmpeg 本身 |
# | 服务端用 vite SSR 打包，去掉 tsx | 去掉 37MB 的 node_modules 层，启动不再转译 |
# | 只编目标架构的 Go 边车 | 每个架构少编一个二进制（构建时间减半） |
# | yt-dlp 用 `yt-dlp_linux` 静态包 | 不需要 python3（apt python3 会再带 27MB） |
#
# ## 关于构建缓存
#
# 依赖安装（pnpm install）必须在 COPY 源码**之前**，否则改一行前端代码就会
# 重装全部依赖。反过来，`COPY . .` 之后再跑 build 的层缓存仍然有效——因为
# BuildKit 的缓存键是「输入文件的哈希」，源码没变时这些层直接命中。

# ===== 构建阶段 =====
FROM node:22-bookworm-slim AS build

# 只装构建真正需要的东西：curl 下 Go、git 供 pnpm 取 git 依赖、ca-certificates 走 TLS
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

# 先只拷依赖清单：源码改动不应触发重装依赖（这一层是构建里最慢的一步）
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# 说明：bufferutil 与 utf-8-validate 的官方 prebuilds 仅包含 linux-x64、darwin-* 和 win32-*，
# 缺少 linux-arm64 预编译包。在 Apple Silicon (Mac M系列) 或 ARM64 Linux 上构建镜像时，
# 不加 --ignore-scripts 会触发 node-gyp 回退编译 C++ 源码并因缺少编译链而报错失败。
# WebUI 静态构建仅使用纯 JS 模块（Vite 8 / Rolldown 原生二进制通过 optionalDependencies 直接分发），
# 因此使用 --ignore-scripts 既能彻底规避跨架构编译失败，又能大幅加快安装速度。
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .

# 1. 独立构建 WebUI 前端到 docker/dist-web（不改变根目录构建配置）
RUN pnpm exec vite build --config docker/web/vite.config.ts

# 2. 把无头服务打成单文件（运行期不再需要 tsx / node_modules）
RUN pnpm exec vite build --config docker/server/vite.config.ts

# 3. 构建 Go 依赖边车。
#    这里**不用** scripts/build-backend.sh：那个脚本会把两个架构都编一遍
#    （它在桌面上是必需的，因为 electron-builder 会同时产出 arm64/x64），
#    而对镜像来说另一个架构的产物纯属垃圾，还会让多架构构建慢一倍。
ARG TARGETPLATFORM
RUN set -eu; \
    case "${TARGETPLATFORM#linux/}" in \
      amd64) GOOS_ARCH=amd64; ARCH_DIR=x64 ;; \
      arm64) GOOS_ARCH=arm64; ARCH_DIR=arm64 ;; \
      *) echo "不支持的架构：${TARGETPLATFORM}" >&2; exit 1 ;; \
    esac; \
    OUT="/out/linux-${ARCH_DIR}"; \
    mkdir -p "$OUT"; \
    cd backend; \
    GOOS=linux GOARCH="$GOOS_ARCH" CGO_ENABLED=0 \
      go build -trimpath -ldflags "-s -w" -o "$OUT/downvid-deps" ./cmd/downvid-deps; \
    test -x "$OUT/downvid-deps"; \
    ls -l "$OUT/downvid-deps"

# 4. 校验清单里的资产表能被解析（版本 / 名称 / 哈希三样都要对得上当前平台）。
#    这一步把「清单改了但 Dockerfile 没跟上」从运行期（容器起来才发现
#    yt-dlp 版本不对）提前到构建期。
RUN node scripts/deps-asset.mjs --platform "${TARGETARCH}" > /tmp/deps-asset.tsv \
  && cat /tmp/deps-asset.tsv \
  && [ "$(wc -l < /tmp/deps-asset.tsv)" -eq 3 ]

# ===== 运行阶段 =====
#
# 运行阶段从零开始（不是 build 的延续）：node_modules、Go 工具链、pnpm 全都不进镜像。
# 代价是 apt 要再跑一次，但那条层可以被后续所有构建复用。
FROM node:22-bookworm-slim AS runtime

ARG TARGETARCH
ARG TARGETPLATFORM

# 运行阶段只需要：ca-certificates（HTTPS）、curl（健康检查与入口探测）、tini（PID 1）。
# 刻意不装 ffmpeg / python3 —— 见下面用静态二进制替代的原因。
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/downvid

# ===== 运行依赖：静态二进制，版本与哈希来自清单 =====
#
# 一次性取回三件资产（yt-dlp / ffmpeg / ffprobe），每件都**先校验 SHA-256 再安装**：
# 下载到损坏或被中间人替换的字节串时，构建直接失败，而不是等到用户点了下载才发现
# 视频是坏的。哈希与桌面版边车用的是同一张表（assets.gen.go），所以镜像里的
# ffmpeg 与用户机器上「下载的 ffmpeg」是同一份二进制。
#
# 注意校验目标是 .gz **压缩文件本身**（与 backend/internal/fetch 的行为一致），
# 校验通过后才解压。
COPY --from=build /app/scripts/deps-asset.mjs /tmp/deps-asset.mjs
COPY --from=build /app/backend/internal/manifest/assets.gen.go /tmp/assets.gen.go
RUN set -eux; \
    ASSETS=$(node /tmp/deps-asset.mjs --platform "${TARGETARCH}" --manifest /tmp/assets.gen.go); \
    echo "$ASSETS" | while IFS="$(printf '\t')" read -r kind url sha name gz; do \
      echo "→ ${kind}  ${name}  ${sha}"; \
      curl -fsSL "$url" -o "/tmp/${kind}.download"; \
      echo "${sha}  /tmp/${kind}.download" | sha256sum -c -; \
      if [ "$gz" = "gz" ]; then \
        gunzip -c "/tmp/${kind}.download" > "/usr/local/bin/${kind}"; \
      else \
        mv "/tmp/${kind}.download" "/usr/local/bin/${kind}"; \
      fi; \
      chmod 0755 "/usr/local/bin/${kind}"; \
      rm -f "/tmp/${kind}.download"; \
    done; \
    rm -f /tmp/deps-asset.mjs /tmp/assets.gen.go; \
    yt-dlp --version; ffmpeg -version | head -1; ffprobe -version | head -1

# ===== 应用本体 =====
# 运行期只需要三项产物：静态前端、服务端单文件、Go 边车。
# electron/ 与 src/ 的源码**不进镜像**（服务端已经打包），体积与攻击面都更小。
COPY --from=build /app/docker/dist-web /opt/downvid/docker/dist-web
COPY --from=build /app/docker/dist-server /opt/downvid/docker/dist-server
# 只拷**目标架构**的那一个二进制。
# 早先这里是 `COPY --from=build /app/backend/build`（整个目录），而宿主机的
# `backend/build/` 里有本地 dev 编出来的 darwin-arm64 / darwin-x64 ——
# .dockerignore 没有排除它，于是 Linux 镜像里凭空多出 34MB 的 macOS 二进制。
COPY --from=build /out /opt/downvid/backend/build
COPY package.json /opt/downvid/package.json
COPY docker/entrypoint.sh /opt/downvid/docker/entrypoint.sh

# 构建期把版本号写进环境变量：打包后的服务端是单文件，不能再靠 `../..` 找 package.json
RUN node -e "process.stdout.write(require('/opt/downvid/package.json').version)" > /tmp/version.txt \
  && VERSION="$(cat /tmp/version.txt)" \
  && rm -f /tmp/version.txt \
  && test -n "$VERSION" \
  && printf 'DOWNVID_APP_VERSION=%s\n' "$VERSION" > /etc/downvid-build.env \
  && printf 'DOWNVID_BUILD_VERSION=%s\n' "$VERSION" > /opt/downvid/docker/.build-version \
  && echo "构建版本：${VERSION}"

ENV APP_ROOT=/opt/downvid
ENV DOWNVID_HOME=/data
ENV DOWNVID_DATA_DIR=/data/userdata
ENV DOWNVID_DOWNLOADS=/data/downloads
ENV DOWNVID_WEB_PORT=6080
ENV DOWNVID_WEB_HOST=0.0.0.0
# 容器内默认按链路自动选更新源；用户可在设置里改，或在这里钉死
ENV DOWNVID_UPDATE_SOURCE=auto
ENV NODE_ENV=production

RUN set -eu; \
    chmod +x /opt/downvid/docker/entrypoint.sh; \
    ln -s /opt/downvid/docker/entrypoint.sh /usr/local/bin/entrypoint.sh; \
    mkdir -p /data/downloads /data/userdata; \
    node -e "console.log('node', process.version)"

# 刻意**不**切到非 root 用户。
#
# /data 是宿主机 bind mount，uid/gid 由宿主机决定（NAS、软路由上常见是 root
# 或某个特定 uid）。镜像里固定一个 uid 会让「下载目录没有写权限」成为默认结果，
# 而报错是 yt-dlp 的 EACCES，用户很难归因到自己挂载目录的属主上。
# 需要最小权限部署的用户可以在 compose 里用 `user:` 指定自己的 uid。

EXPOSE 6080
VOLUME ["/data"]

# 健康检查放在镜像里而不是只写 compose：`docker run` 也能有探针，
# 且 compose 的 healthcheck 可以省掉重复定义。
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${DOWNVID_WEB_PORT}/healthz" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
