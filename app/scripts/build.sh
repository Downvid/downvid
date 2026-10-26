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

# `universal` 是 **macOS 的 lipo 概念**，不是 Go 的 GOARCH ——
# `go build` 会直接报 `unsupported GOOS/GOARCH pair darwin/universal`。
# Wails 自己处理 universal（分别编 arm64 / amd64 再用 lipo 合并），
# 但边车是我们自己编的，必须在这也处理：**两个架构各编一份**。
# 运行时 GOARCH 只会是 arm64 或 amd64，提取逻辑按那个找，所以两份都要在。
ARCH_LIST=("${GOARCH}")
if [[ "${GOARCH}" == "universal" ]]; then
  ARCH_LIST=("arm64" "amd64")
  echo "→ 目标平台：${GOOS}/universal（将为 arm64 + amd64 各编一份边车）"
else
  echo "→ 目标平台：${GOOS}/${GOARCH}"
fi

# ===== 1. 编译边车 =====
#
# 编到 internal/sidecar/bin/<goos>-<goarch>/，与 internal/sidecar 里的
# 路径约定必须逐字一致（改一处就要改另一处）。
SIDECAR_NAME="downvid-deps"
if [[ "${GOOS}" == "windows" ]]; then
  SIDECAR_NAME="downvid-deps.exe"
fi

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
  local size
  size="$(wc -c < "${dir}/${SIDECAR_NAME}" | tr -d ' ')"
  echo "  ✓ ${dir#${APP_DIR}/}/${SIDECAR_NAME}（${size} 字节）"
}

for arch in "${ARCH_LIST[@]}"; do
  build_sidecar "${arch}"
done
# 冒烟：边车必须能应答 detect 并输出 JSON。
#
# 「文件存在且可执行」说明不了任何事 —— 编错程序（比如嵌成了容器端的
# Web 服务）同样满足这两条。只有本机架构才跑得了。
#
# 注意判据用的是**宿主**架构，不是目标架构：universal 构建在这里
# 会同时编 arm64 与 amd64，只有与宿主一致的那份能执行。
SMOKE_ARCH="$(go env GOARCH)"
if [[ "${GOOS}" == "$(go env GOOS)" && " ${ARCH_LIST[*]} " == *" ${SMOKE_ARCH} "* ]]; then
  SMOKE_BIN="${APP_DIR}/internal/sidecar/bin/${GOOS}-${SMOKE_ARCH}/${SIDECAR_NAME}"
  SMOKE_DIR="$(mktemp -d)"
  if ! "${SMOKE_BIN}" detect --managed-dir "${SMOKE_DIR}" --json 2>/dev/null | head -c 1 | grep -q '{'; then
    echo "  ✗ 边车冒烟失败：detect 没有输出 JSON（编错程序了？）" >&2
    rm -rf "${SMOKE_DIR}"
    exit 1
  fi
  rm -rf "${SMOKE_DIR}"
  echo "  ✓ 边车能应答 detect（${SMOKE_ARCH}）"
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
