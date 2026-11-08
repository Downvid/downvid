#!/usr/bin/env bash
# 构建命令行下载器 `downvid`，并把依赖边车**内嵌**进去。
#
# 为什么不能直接 `go build ./cmd/downvid`：
#   - 没有 `withsidecar` tag 时，CLI 里没有 `downvid-deps`，只能借用桌面版
#     已经解出来的边车（或 PATH 里的工具），新机器上「deps install」用不了。
#   - 边车是另一个 Go 程序，必须先按目标平台编好，再让 CLI 嵌进去。
#
# 用法：
#   bash app/scripts/build-cli.sh                          # 当前平台
#   bash app/scripts/build-cli.sh -platform darwin/arm64
#   bash app/scripts/build-cli.sh -platform darwin/universal
#   bash app/scripts/build-cli.sh -platform windows/amd64
#   bash app/scripts/build-cli.sh -platform linux/amd64
#
# 产物在 `app/build/cli/<goos>-<arch>/downvid[.exe]`。
# 所有平台都能从任意机器交叉编译；只有 macOS 的 universal 需要本机 lipo。
set -euo pipefail

cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"
REPO_DIR="$(cd .. && pwd)"

# 目标平台：从 -platform 里取；没指定就用当前宿主
TARGET_PLATFORM=""
ARGS=("$@")
for ((i = 0; i < ${#ARGS[@]}; i++)); do
  if [[ "${ARGS[$i]}" == "-platform" ]]; then
    TARGET_PLATFORM="${ARGS[$((i + 1))]}"
  fi
done

if [[ -z "${TARGET_PLATFORM}" ]]; then
  GOOS="$(go env GOOS)"
  GOARCH="$(go env GOARCH)"
else
  GOOS="${TARGET_PLATFORM%%/*}"
  GOARCH="${TARGET_PLATFORM##*/}"
fi

ARCH_LIST=("${GOARCH}")
SUFFIX="${GOOS}-${GOARCH}"
if [[ "${GOARCH}" == "universal" ]]; then
  if [[ "${GOOS}" != "darwin" ]]; then
    echo "✗ 只有 darwin 支持 universal" >&2
    exit 1
  fi
  if ! command -v lipo >/dev/null 2>&1; then
    echo "✗ 构建 darwin/universal 需要 macOS 的 lipo；请改用 darwin/arm64 或 darwin/amd64" >&2
    exit 1
  fi
  ARCH_LIST=("arm64" "amd64")
  SUFFIX="darwin-universal"
fi

OUT_DIR="${APP_DIR}/build/cli/${SUFFIX}"
mkdir -p "${OUT_DIR}"

VERSION="${VERSION:-$(grep -m1 '"version":' "${REPO_DIR}/package.json" 2>/dev/null | sed -E 's/.*"version": *"([^"]+)".*/\1/' || true)}"
if [[ -z "${VERSION}" ]]; then
  VERSION="0.0.0-dev"
fi
BUILD_DATE="$(date +%Y.%m.%d)"
LDFLAGS="-s -w -X main.version=${VERSION} -X main.buildDate=${BUILD_DATE}"

SIDECAR_NAME="downvid-deps"
if [[ "${GOOS}" == "windows" ]]; then
  SIDECAR_NAME="downvid-deps.exe"
fi

# internal/sidecar 用 //go:embed all:bin 嵌整个目录；本地连续构建过多个
# 平台后，这里会同时躺着别的平台的边车，CLI 会把它们一起嵌进去（体积翻倍）。
# 每次只留本次目标平台的。
clean_sidecars() {
  find "${APP_DIR}/internal/sidecar/bin" -mindepth 1 -maxdepth 1 -type d -exec rm -rf {} +
}

build_sidecar() {
  local arch="$1"
  local dir="${APP_DIR}/internal/sidecar/bin/${GOOS}-${arch}"
  mkdir -p "${dir}"
  echo "→ 编译依赖边车（${GOOS}/${arch}）"
  (
    cd "${REPO_DIR}/backend"
    CGO_ENABLED=0 GOOS="${GOOS}" GOARCH="${arch}" \
      go build -trimpath -ldflags "-s -w" \
      -o "${dir}/${SIDECAR_NAME}" ./cmd/downvid-deps
  )
  if [[ ! -f "${dir}/${SIDECAR_NAME}" ]]; then
    echo "✗ 边车编译失败：${dir}/${SIDECAR_NAME} 不存在" >&2
    return 1
  fi
}

build_cli() {
  local arch="$1"
  local out="$2"
  echo "→ 编译 downvid（${GOOS}/${arch}）"
  (
    cd "${APP_DIR}"
    CGO_ENABLED=0 GOOS="${GOOS}" GOARCH="${arch}" \
      go build -tags withsidecar -trimpath -ldflags "${LDFLAGS}" \
      -o "${out}" ./cmd/downvid
  )
}

EXE=""
if [[ "${GOOS}" == "windows" ]]; then
  EXE=".exe"
fi

clean_sidecars
if [[ "${GOARCH}" == "universal" ]]; then
  for arch in "${ARCH_LIST[@]}"; do
    build_sidecar "${arch}"
    build_cli "${arch}" "${OUT_DIR}/downvid-${arch}"
    rm -rf "${APP_DIR}/internal/sidecar/bin/${GOOS}-${arch}"
  done
  echo "→ lipo 合并 darwin/universal"
  lipo -create -output "${OUT_DIR}/downvid${EXE}" \
    "${OUT_DIR}/downvid-arm64" "${OUT_DIR}/downvid-amd64"
  rm -f "${OUT_DIR}/downvid-arm64" "${OUT_DIR}/downvid-amd64"
else
  build_sidecar "${GOARCH}"
  build_cli "${GOARCH}" "${OUT_DIR}/downvid${EXE}"
fi

chmod +x "${OUT_DIR}/downvid${EXE}"

BIN="${OUT_DIR}/downvid${EXE}"
TOTAL="$(wc -c < "${BIN}" | tr -d ' ')"
MATCHES="$(strings "${BIN}" 2>/dev/null | grep -c "downvid-deps" || true)"
if [[ "${MATCHES}" -eq 0 ]]; then
  echo "⚠ 二进制里找不到 downvid-deps 字样（withsidecar 没生效？）" >&2
  exit 1
fi
echo
echo "✓ ${BIN#${APP_DIR}/}（${TOTAL} 字节，内嵌边车 ${MATCHES} 处引用）"
echo "  安装：把 downvid${EXE} 放到 PATH 里的目录即可。"
