#!/usr/bin/env bash
# 为当前操作系统上全部目标架构构建依赖边车（downvid-deps）。
#
# 安装包不再携带 yt-dlp / ffmpeg：边车负责在运行时识别机器上已装好的版本，
# 缺失时才下载到 userData。因此所有架构都必须有对应边车，否则该架构的安装包会缺文件。
#
# 用法：
#   bash scripts/build-backend.sh            # 当前 OS 的全部架构
#   bash scripts/build-backend.sh linux       # 指定 GOOS（交叉构建，需 Go 1.24+）
#
# 交叉编译纯 Go 代码无需 CGO，因此不依赖目标平台的编译环境。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT/backend"
OUT_DIR="$BACKEND_DIR/build"

GOOS_TARGET="${1:-$(go env GOOS)}"

case "$GOOS_TARGET" in
  darwin) ARCHES=("arm64:arm64" "x64:amd64") ;;
  linux)  ARCHES=("x64:amd64" "arm64:arm64") ;;
  win32)  ARCHES=("x64:amd64") ;;
  *)
    echo "[✗] 不支持的平台：$GOOS_TARGET（可用：darwin / linux / win32）" >&2
    exit 1
    ;;
esac

BIN_NAME="downvid-deps"
[ "$GOOS_TARGET" = "win32" ] && BIN_NAME="downvid-deps.exe"

if ! command -v go >/dev/null 2>&1; then
  echo "[✗] 未找到 go，请安装 Go 1.24+ 后重试" >&2
  exit 1
fi

for entry in "${ARCHES[@]}"; do
  arch_dir="${entry%%:*}"
  goarch="${entry##*:}"
  out_dir="$OUT_DIR/${GOOS_TARGET}-${arch_dir}"
  mkdir -p "$out_dir"

  echo "[·] 构建 ${GOOS_TARGET}/${arch_dir}..."
  ( cd "$BACKEND_DIR" && GOOS="$GOOS_TARGET" GOARCH="$goarch" CGO_ENABLED=0 \
      go build -trimpath -ldflags "-s -w" -o "$out_dir/$BIN_NAME" ./cmd/downvid-deps )
  echo "[✓] $out_dir/$BIN_NAME"
done

echo "[✓] 依赖边车构建完成"
