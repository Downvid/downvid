#!/usr/bin/env bash
#
# DownVid 容器入口：启动无头 Web 服务并进行存活监督。
#
# 安全设计：
#   - 容器内网络默认由 DOWNVID_WEB_HOST=0.0.0.0 开启端口暴露；
#   - 存活探针仅使用轻量进程状态检查，杜绝高频网络握手造成服务卡顿；
#   - 服务退出时正确向 Docker 返回退出码，触发 restart 策略。

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

log "DownVid WebUI 启动中：http://<宿主机IP>:${DOWNVID_WEB_PORT}/"
log "数据目录：${DOWNVID_DATA_DIR}，下载目录：${DOWNVID_DOWNLOADS}"

./docker/node_modules/.bin/tsx --tsconfig docker/server/tsconfig.json docker/server/index.ts >"${LOG_DIR}/server.log" 2>&1 &
SERVER_PID=$!

# 启动就绪探测：等待 /healthz 探针返回 HTTP 200
ready=0
for i in $(seq 1 60); do
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    echo "----- server.log -----" >&2
    tail -n 40 "${LOG_DIR}/server.log" >&2 || true
    die "Web 服务启动失败"
  fi
  if curl -fsS -o /dev/null "http://127.0.0.1:${DOWNVID_WEB_PORT}/healthz" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 0.5
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
