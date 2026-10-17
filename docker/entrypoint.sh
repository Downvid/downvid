#!/usr/bin/env bash
#
# DownVid 容器入口：启动无头 Web 服务并进行存活监督。
#
# 安全设计：
#   - 容器内网络默认由 DOWNVID_WEB_HOST=0.0.0.0 开启端口暴露；
#   - 存活探针仅使用轻量进程状态检查，杜绝高频网络握手造成服务卡顿；
#   - 服务退出时正确向 Docker 返回退出码，触发 restart 策略。
#
# 性能设计：
#   - 服务端在构建期已打包成单文件（docker/dist-server/index.js），
#     这里直接 `node` 启动，不再经过 tsx 转译 —— 少一次全量编译，
#     冷启动从「转译上百个模块」降到「读一个文件」。
#   - 就绪探测直接问 /healthz，而不是 `sleep N`：等待时间随机器快慢自适应。

set -euo pipefail

: "${DOWNVID_WEB_PORT:=6080}"
: "${DOWNVID_DATA_DIR:=/data/userdata}"
: "${DOWNVID_DOWNLOADS:=${DOWNVID_DATA_DIR%/userdata}/downloads}"
: "${DOWNVID_HOME:=/data}"

LOG_DIR="${DOWNVID_HOME}/logs"
mkdir -p "${LOG_DIR}" "${DOWNVID_DATA_DIR}" "${DOWNVID_DOWNLOADS}"

log() { echo "[downvid] $(date '+%Y-%m-%d %H:%M:%S') $*"; }
die() { echo "[downvid] 致命错误：$*" >&2; exit 1; }

cd /opt/downvid

# 构建期写下的版本号：服务端单文件拿不到 package.json，靠这个环境变量回答版本
if [ -f /etc/downvid-build.env ]; then
  # shellcheck disable=SC1091
  . /etc/downvid-build.env
  export DOWNVID_APP_VERSION
fi

SERVER_ENTRY="docker/dist-server/index.js"
[ -f "${SERVER_ENTRY}" ] || die "找不到服务端构建产物 ${SERVER_ENTRY}（镜像构建不完整）"

log "DownVid ${DOWNVID_APP_VERSION:-?} WebUI 启动中：http://<宿主机IP>:${DOWNVID_WEB_PORT}/"
log "数据目录：${DOWNVID_DATA_DIR}，下载目录：${DOWNVID_DOWNLOADS}"
[ -n "${DOWNVID_IMAGE:-}" ] && log "镜像：${DOWNVID_IMAGE}（升级方式：docker compose pull && up -d）"

# 直接 node 跑打包产物。日志同时写文件（界面里的「查看日志」读它）与 stderr（docker logs）
node "${SERVER_ENTRY}" > >(tee -a "${LOG_DIR}/server.log") 2>&1 &
SERVER_PID=$!

# 启动就绪探测：等待 /healthz 探针返回 HTTP 200
ready=0
for _ in $(seq 1 120); do
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    echo "----- server.log -----" >&2
    tail -n 40 "${LOG_DIR}/server.log" >&2 || true
    die "Web 服务启动失败"
  fi
  if curl -fsS -o /dev/null "http://127.0.0.1:${DOWNVID_WEB_PORT}/healthz" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 0.25
done

if [ "${ready}" != "1" ]; then
  tail -n 40 "${LOG_DIR}/server.log" >&2 || true
  die "Web 服务未能在 30 秒内就绪"
fi

log "Web 服务已就绪（http://127.0.0.1:${DOWNVID_WEB_PORT}/healthz）"

# 运行期轻量监督（零网络开销）：服务进程异常退出时随之结束容器
while true; do
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    set +e
    wait "${SERVER_PID}" 2>/dev/null
    status=$?
    set -e
    [ "${status}" -eq 0 ] && status=1
    log "Web 服务已退出（状态 ${status}），容器随之结束"
    echo "----- server.log -----" >&2
    tail -n 40 "${LOG_DIR}/server.log" >&2 || true
    exit "${status}"
  fi
  sleep 1
done
