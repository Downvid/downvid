#!/usr/bin/env bash
# 构建 Wails 桌面应用，并把**依赖边车内嵌进主二进制**。
#
# ## 为什么需要这个脚本（而不是直接 wails build）
#
# 依赖探测是由一个独立 Go 程序（`backend/cmd/downvid-deps`）做的。Wails
# 没有 electron-builder 的 `extraResources`，所以边车必须由应用自己带上。
# 做法是 `//go:embed` 进主二进制、运行时落到数据目录（见 internal/sidecar）。
#
# 直接 `wails build` 会怎样：边车目录是空的（仓库里不放二进制），
# 于是打出来的应用 **没有依赖探测能力**——依赖页只剩一条「探测程序缺失」。
# 这正是真实发生过的故障，而构建过程没有任何警告。
#
# ## 用法
#
#   bash app/scripts/build.sh                          # 当前平台
#   bash app/scripts/build.sh -platform darwin/arm64   # 指定平台（交叉编译）
#   bash app/scripts/build.sh -dev                     # wails dev（同样带边车）
set -euo pipefail

cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"
REPO_DIR="$(cd .. && pwd)"

WAILS_ARGS=("$@")

# 目标平台：从 -platform 里取；没指定就用当前宿主
TARGET_PLATFORM=""
for ((i = 0; i < ${#WAILS_ARGS[@]}; i++)); do
  if [[ "${WAILS_ARGS[$i]}" == "-platform" ]]; then
    TARGET_PLATFORM="${WAILS_ARGS[$((i + 1))]}"
  fi
done

if [[ -z "${TARGET_PLATFORM}" ]]; then
  GOOS="$(go env GOOS)"
  GOARCH="$(go env GOARCH)"
else
  GOOS="${TARGET_PLATFORM%%/*}"
  GOARCH="${TARGET_PLATFORM##*/}"
fi

# wails 用 `darwin/arm64` 这种写法；Go 的 GOARCH 就是 arm64 / amd64
echo "→ 目标平台：${GOOS}/${GOARCH}"

# ===== 1. 编译边车 =====
#
# 编到 internal/sidecar/bin/<goos>-<goarch>/，与 internal/sidecar 里的
# 路径约定必须逐字一致（改一处就要改另一处）。
SIDECAR_NAME="downvid-deps"
if [[ "${GOOS}" == "windows" ]]; then
  SIDECAR_NAME="downvid-deps.exe"
fi
SIDECAR_DIR="${APP_DIR}/internal/sidecar/bin/${GOOS}-${GOARCH}"
mkdir -p "${SIDECAR_DIR}"

echo "→ 编译依赖边车（${GOOS}/${GOARCH}）"
# 边车源码在**仓库根**的 `backend/cmd/downvid-deps`，不在 app/cmd/ 下。
#
# 这里必须点名到具体包。第一版写的是 `./cmd/...`（在 app/ 目录下执行），
# 于是匹配到了 `app/cmd/downvid-server`——那是**容器端的 Web 服务**，
# 结果把「监听 6080 的 HTTP 服务」当成依赖探测器嵌了进去。
# 症状在运行时才出现：设置页的「重新检测」永远失败，日志里是
# 「服务退出：listen tcp 127.0.0.1:6080: bind: address already in use」。
# 只有「边车文件存在」这一条校验不够——存在不等于**是对的**那个程序。
(
  cd "${REPO_DIR}/backend"
  CGO_ENABLED=0 GOOS="${GOOS}" GOARCH="${GOARCH}" \
    go build -trimpath -ldflags "-s -w" \
    -o "${SIDECAR_DIR}/${SIDECAR_NAME}" ./cmd/downvid-deps
)

if [[ ! -x "${SIDECAR_DIR}/${SIDECAR_NAME}" ]]; then
  echo "✗ 边车编译失败：${SIDECAR_DIR}/${SIDECAR_NAME} 不存在" >&2
  exit 1
fi
SIZE="$(wc -c < "${SIDECAR_DIR}/${SIDECAR_NAME}" | tr -d ' ')"
echo "  ✓ ${SIDECAR_DIR#${APP_DIR}/}/${SIDECAR_NAME}（${SIZE} 字节）"

# 冒烟：边车必须能应答 `detect`，并且输出是 JSON。
#
# 「文件存在且可执行」说明不了任何事——编错程序（比如嵌成了容器端的
# Web 服务）同样满足这两条。这条断言直接问它一句话。
if [[ "${GOOS}" == "$(go env GOOS)" && "${GOARCH}" == "$(go env GOARCH)" ]]; then
  SMOKE_DIR="$(mktemp -d)"
  if ! "${SIDECAR_DIR}/${SIDECAR_NAME}" detect --managed-dir "${SMOKE_DIR}" --json 2>/dev/null | head -c 1 | grep -q '{'; then
    echo "  ✗ 边车冒烟失败：detect 没有输出 JSON（编错程序了？）" >&2
    rm -rf "${SMOKE_DIR}"
    exit 1
  fi
  rm -rf "${SMOKE_DIR}"
  echo "  ✓ 边车能应答 detect"
else
  echo "  · 交叉编译，跳过冒烟（在目标平台上验证）"
fi

# ===== 2. 确保 embed 目录存在（wails generate 需要）=====
bash "${APP_DIR}/scripts/prepare-embed-dir.sh"

# ===== 3. 构建应用（带 withsidecar tag）=====
#
# `-tags "withsidecar"` 让 internal/sidecar 走嵌入分支。
# 不加 tag 时会走 stub，构建能过但**运行时没有依赖探测**——所以这个
# tag 是必须的，不是可选的优化。
# 版本号与架构标识由**构建期注入**：
#   - version：从 package.json 读（与 electron 版同一个来源，不能两边不一致）
#   - arch：**必须是 wails**，否则新版认不出自己是新架构，
#           会去读 electron-updater 的 latest*.yml（那份只描述 Electron 产物）
#
# 写成 `-X main.arch=wails` 而不是在代码里硬编码：Electron 版也有同一份
# 代码路径，靠注入区分两者。
VERSION="$(node -p "require('${REPO_DIR}/package.json').version" 2>/dev/null || echo 0.0.0-dev)"
ARCH_TAG="wails"
if [[ " ${WAILS_ARGS[*]} " == *" --electron "* ]]; then
  ARCH_TAG="electron"
fi
LDFLAGS="-s -w -X main.version=${VERSION}"
# `main.arch` 由 app.go 的 init() 转给 update.CurrentArchitecture
LDFLAGS="${LDFLAGS} -X main.arch=${ARCH_TAG}"

echo "→ wails build -tags withsidecar（version=${VERSION} arch=${ARCH_TAG}）"
cd "${APP_DIR}"
wails build -tags "withsidecar" -ldflags "${LDFLAGS}" "${WAILS_ARGS[@]}"

echo
echo "✓ 完成。验证边车已内嵌："
case "${GOOS}" in
  darwin)
    BIN="${APP_DIR}/build/bin/downvid.app/Contents/MacOS/downvid"
    ;;
  windows)
    BIN="${APP_DIR}/build/bin/downvid.exe"
    ;;
  *)
    BIN="${APP_DIR}/build/bin/downvid"
    ;;
esac

if [[ -f "${BIN}" ]]; then
  TOTAL="$(wc -c < "${BIN}" | tr -d ' ')"
  echo "  ${BIN#${APP_DIR}/}：${TOTAL} 字节"
  # 内嵌的边车字符串会出现在二进制里；找不到说明 tag 没生效。
  #
  # 注意别写成 `strings ... | grep -q`：grep -q 命中就退出，上游 strings
  # 收到 SIGPIPE，在 `set -o pipefail` 下整条管道变成失败——于是**明明找到了
  # 也报"没找到"（这个脚本第一版就是这样，日志里打了 4 处还报 ⚠）。
  MATCHES="$(strings "${BIN}" 2>/dev/null | grep -c "downvid-deps" || true)"
  if [[ "${MATCHES}" -gt 0 ]]; then
    echo "  ✓ 二进制里能找到边车资源（${MATCHES} 处引用）"
  else
    echo "  ⚠ 二进制里找不到 downvid-deps 字样（tags 没生效？）" >&2
    exit 1
  fi
fi
