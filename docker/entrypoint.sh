#!/usr/bin/env bash
#
# DownVid 容器入口。
#
# DownVid 是 Electron 桌面应用，容器里没有物理显示器。
# 本脚本按顺序把「能用的桌面」拼出来，并监督下面这些服务：
#
#   Xvfb      虚拟显示（DISPLAY=:99）
#   fluxbox   极简窗口管理器，管窗口定位与焦点
#   x11vnc    把虚拟显示共享为 VNC（端口 5900）
#   noVNC     websockify + noVNC 网页客户端（端口 6080）
#   sshd      SSH / SFTP（端口 2222），用于把下载好的文件取出来
#   DownVid   Electron 应用本体
#
# sshd 自己 daemon 化，不进监督集合（它的父进程退出是预期行为，
# 算成崩溃会让容器误停）。其余服务都是本脚本的子进程，由下面的
# 轮询循环照看：每 0.2 秒看一眼存活，发现异常就让整个容器退出。
#
# 为什么「任一服务退出就停容器」而不是留着一个空壳继续跑：
# 应用崩溃或 X 挂掉时，界面已经取不到了，此时容器显示「运行中」
# 只会让人以为服务正常。退出后 docker 的重启策略才有机会介入，
# 异常也才在 `docker ps` 与 `docker logs` 里看得见。
#
# 全部日志走 stdout/stderr，由 `docker logs` 收集——容器内没有 syslog，
# 想诊断只能靠这两个流，另外各服务另有自己的 /var/log/downvid/*.log。

set -euo pipefail

# ===== 可调参数 =====
#
# 走环境变量而不是硬编码，是为了让同一个镜像同时服务
# 「在笔记本上试一下」与「挂在 NAS 上长期跑」两种场景。
#
# 分辨率可以用 DOWNVID_RESOLUTION="1920x1080" 一次设定，
# 也可以用 SCREEN_WIDTH / SCREEN_HEIGHT / SCREEN_DEPTH 分别指定（后者优先）。
: "${DISPLAY_NUM:=99}"
: "${SCREEN_DEPTH:=24}"
: "${VNC_PORT:=5900}"
: "${NOVNC_PORT:=6080}"
: "${SSH_PORT:=2222}"
: "${DOWNVID_HOME:=/data}"
# 应用在容器里的默认下载目录。
# DownVid 默认下载到 ~/Downloads/DownVid；在容器里那藏在用户数据目录中，
# 用户要自己钻进去找。改到 /data/downloads 后，宿主机的挂载点就是下载目录本身。
: "${DOWNVID_DOWNLOADS:=${DOWNVID_HOME}/downloads}"

if [ -n "${DOWNVID_RESOLUTION:-}" ]; then
  IFS='x' read -r _w _h <<<"${DOWNVID_RESOLUTION}"
  [ -n "${SCREEN_WIDTH:-}" ] || SCREEN_WIDTH="${_w:-1280}"
  [ -n "${SCREEN_HEIGHT:-}" ] || SCREEN_HEIGHT="${_h:-800}"
fi
: "${SCREEN_WIDTH:=1280}"
: "${SCREEN_HEIGHT:=800}"

DISPLAY=":${DISPLAY_NUM}"
export DISPLAY

LOG_DIR=/var/log/downvid
mkdir -p "${LOG_DIR}"

log() { echo "[downvid] $(date '+%Y-%m-%d %H:%M:%S') $*"; }
# die 之前先写一次健康状态：启动链中途失败时，外部（CI 冒烟或排障的人）
# 要靠它知道卡在哪一步，而不是只看到一行「致命错误」。
# write_health 本身可能因工具缺失而失败，所以容许它出错。
die() {
  write_health 2>/dev/null || true
  echo "[downvid] 致命错误：$*" >&2
  exit 1
}

# 供监督循环使用：记录 pid
declare -a SUPERVISED_PIDS=()
supervise() { SUPERVISED_PIDS+=("$1"); }

# ===== 1. 数据目录 =====
#
# Electron 在 Linux 上把 userData 放在 $XDG_CONFIG_HOME/<name>。
# 把它指到 DOWNVID_HOME 下，下载历史、Cookie 快照、运行依赖与日志
# 才会跟着 /data 卷走——否则容器一重建，用户的手动设置与历史全部消失。
mkdir -p "${DOWNVID_DOWNLOADS}" "${DOWNVID_HOME}"
export XDG_CONFIG_HOME="${DOWNVID_HOME}/userdata"
export XDG_DATA_HOME="${DOWNVID_HOME}/userdata"
export HOME="${HOME:-/root}"
mkdir -p "${XDG_CONFIG_HOME}" "${XDG_DATA_HOME}" "${DOWNVID_DOWNLOADS}/DownVid"

# ===== 2. SSH / SFTP =====
#
# 取值方式：容器里没有桌面文件管理器，下载完的文件要能取出来。
# SFTP 比「再挂一个卷」更通用——Windows / macOS 客户端都自带。
# 默认关闭：容器内跑 SSH 是个攻击面，要么给用户自己的公钥，
# 要么干脆只用卷。需要时显式设 DOWNVID_ENABLE_SSH=1 打开。
setup_ssh() {
  if [ "${DOWNVID_ENABLE_SSH:-0}" != "1" ]; then
    log "未设置 DOWNVID_ENABLE_SSH=1，跳过 SSH 服务（用 -v 挂载目录取文件即可）"
    return 0
  fi
  command -v ssh-keygen >/dev/null 2>&1 || { log "镜像内没有 openssh-server，跳过 SSH 服务"; return 0; }

  local auth_keys="/root/.ssh/authorized_keys"
  mkdir -p /root/.ssh && chmod 700 /root/.ssh
  touch "${auth_keys}" && chmod 600 "${auth_keys}"

  # 外部公钥（docker run -e DOWNVID_SSH_PUBLIC_KEY="ssh-ed25519 AAAA..."）
  if [ -n "${DOWNVID_SSH_PUBLIC_KEY:-}" ] \
     && ! grep -qxF "${DOWNVID_SSH_PUBLIC_KEY}" "${auth_keys}" 2>/dev/null; then
    printf '%s\n' "${DOWNVID_SSH_PUBLIC_KEY}" >> "${auth_keys}"
    log "已注入 DOWNVID_SSH_PUBLIC_KEY"
  fi

  if [ ! -s "${auth_keys}" ]; then
    log "已启用 SSH 但没有可用的授权公钥（挂载 authorized_keys 或设置 DOWNVID_SSH_PUBLIC_KEY），跳过启动"
    return 0
  fi

  ssh-keygen -A >/dev/null 2>&1 || true
  # privilege separation 目录：不存在时 sshd 启动即退出
  mkdir -p /run/sshd && chmod 755 /run/sshd

  # -D 前台跑会被本脚本接管，但 sshd 的 accept 循环在收到连接时会 fork，
  # 这里交给系统默认行为（daemon 化）更稳，重启容器时也不会残留半开的监听。
  /usr/sbin/sshd || die "sshd 启动失败"
  log "sshd 已启动（端口 ${SSH_PORT}，仅公钥认证）"
}

# ===== 3. 虚拟显示 =====
start_xvfb() {
  # -noreset：最后一个客户端断开时不重置服务器。
  # 否则用户刷新一次浏览器，VNC 会话会连带应用界面一起消失。
  # +extension GLX / RANDR：Chromium 的 GPU 进程与多分辨率逻辑会探测它们。
  Xvfb "${DISPLAY}" \
    -screen "0" "${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH}" \
    -ac \
    -noreset \
    +extension RANDR \
    +extension GLX \
    +render \
    >"${LOG_DIR}/xvfb.log" 2>&1 &
  supervise "$!"

  # 等 X 真正就绪再往下走。启动失败必须报错——
  # 带着一个坏 DISPLAY 继续跑，后面只会得到一串难懂的 GTK 报错。
  local i
  for i in $(seq 1 100); do
    xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1 && { log "Xvfb 就绪（${DISPLAY} ${SCREEN_WIDTH}x${SCREEN_HEIGHT}）"; return 0; }
    kill -0 "${SUPERVISED_PIDS[-1]}" 2>/dev/null || { cat "${LOG_DIR}/xvfb.log" >&2 || true; die "Xvfb 启动失败"; }
    sleep 0.05
  done
  die "Xvfb 未能在 5 秒内就绪"
}

start_wm() {
  if ! command -v fluxbox >/dev/null 2>&1; then
    log "镜像内没有 fluxbox，跳过（部分程序的窗口定位与焦点可能异常）"
    return 0
  fi
  # 没有窗口管理器时 Chromium 的窗口仍能显示，但缺少重装饰与焦点管理，
  # 表现为「窗口标题栏点不了」。
  DISPLAY="${DISPLAY}" fluxbox >"${LOG_DIR}/fluxbox.log" 2>&1 &
  supervise "$!"
  log "fluxbox 已启动"
}

# ===== 4. VNC 与 noVNC =====
start_vnc() {
  # -forever：客户端断开后不退出，用户刷新浏览器不该让界面消失
  # -shared：允许多个客户端同时连（同一份下载任务，几个人同时看）
  # -nopw：容器内 VNC 只监听容器网络，密码只会添麻烦；要暴露到公网请在
  #        前面套一层反向代理或 VPN，而不是给 VNC 加个弱密码。
  #
  # 前台跑并纳入监督，而不用 -bg：-bg 会 fork 出一个我们拿不到 pid 的
  # 守护进程，启动失败只能靠猜。前台跑 + 端口就绪探测，失败立刻能报出来。
  # （x11vnc 的日志选项是 `-o <file>`，与 -logfile 等价；单个 -logfile 不带值不行。）
  x11vnc \
    -display "${DISPLAY}" \
    -forever \
    -shared \
    -rfbport "${VNC_PORT}" \
    -nopw \
    -xkb \
    -o "${LOG_DIR}/x11vnc.log" \
    >"${LOG_DIR}/x11vnc.out" 2>&1 &
  supervise "$!"

  # 等端口真的在监听。x11vnc 起不来的常见原因是 display 不存在或
  # 端口被占，两种情况都在这里暴露。
  local i
  for i in $(seq 1 100); do
    if (exec 3<>"/dev/tcp/127.0.0.1/${VNC_PORT}") 2>/dev/null; then
      log "x11vnc 已启动（VNC ${VNC_PORT}）"
      return 0
    fi
    kill -0 "${SUPERVISED_PIDS[-1]}" 2>/dev/null || {
      cat "${LOG_DIR}/x11vnc.log" >&2 2>/dev/null || true
      cat "${LOG_DIR}/x11vnc.out" >&2 2>/dev/null || true
      die "x11vnc 启动失败"
    }
    sleep 0.05
  done
  die "x11vnc 未能在 5 秒内监听 ${VNC_PORT}"
}

start_novnc() {
  local web="/opt/downvid/novnc"
  if [ ! -f "${web}/vnc.html" ]; then
    log "镜像内没有 noVNC，跳过网页访问（仍可用 VNC 客户端连 ${VNC_PORT}）"
    return 0
  fi

  # noVNC 只提供静态文件，WebSocket 与 HTTP 服务由 websockify 承担。
  # 不用 noVNC 自带的 novnc_proxy：它在找不到本地 websockify 时会 git clone，
  # 容器启动时联网不可靠。镜像里已 pip install websockify。
  #
  # 参数形式是位置参数 `[源地址:]源端口 目标地址:目标端口`，不是 --listen
  # （websockify 0.13 的 usage 就是这样；写 --listen 会直接参数错误退出）。
  python3 -m websockify \
    --web "${web}" \
    "0.0.0.0:${NOVNC_PORT}" \
    "localhost:${VNC_PORT}" \
    >"${LOG_DIR}/novnc.log" 2>&1 &
  supervise "$!"

  local i
  for i in $(seq 1 100); do
    if curl -fsS -o /dev/null "http://127.0.0.1:${NOVNC_PORT}/vnc.html" 2>/dev/null; then
      log "noVNC 就绪（http://<宿主机IP>:${NOVNC_PORT}/vnc.html）"
      return 0
    fi
    kill -0 "${SUPERVISED_PIDS[-1]}" 2>/dev/null || { cat "${LOG_DIR}/novnc.log" >&2 || true; die "noVNC 启动失败"; }
    sleep 0.05
  done
  die "noVNC 未能在 5 秒内就绪"
}

# ===== 5. Electron 本体 =====
start_downvid() {
  local electron_bin="${ELECTRON_BIN:-}"
  if [ -z "${electron_bin}" ] || [ ! -x "${electron_bin}" ]; then
    electron_bin=""
    for candidate in /opt/electron/electron /usr/local/bin/electron; do
      [ -x "${candidate}" ] && { electron_bin="${candidate}"; break; }
    done
  fi
  [ -n "${electron_bin}" ] || die "未找到 Electron 可执行文件"

  local app="/opt/downvid/dist-electron/main.js"
  [ -f "${app}" ] || die "未找到主进程入口 ${app}"

  # 单实例锁：main.ts 里 `const isDev = !app.isPackaged;
  #   const gotSingleInstanceLock = isDev || app.requestSingleInstanceLock()`
  # 这里跑的正是未打包的 dist-electron/main.js，因此 isDev 为真、
  # 根本不请求锁——容器重建或重启都不会被残留实例挡住。
  # 这是「未打包运行」的既成行为，容器只是借了它，不需要额外传参。
  #
  # --disable-dev-shm-usage：/dev/shm 只有 64MB 时 Chromium 的渲染进程会崩，
  #   走磁盘临时目录。（compose 里已把 shm_size 调到 1gb，这是双保险）
  # --no-sandbox：容器内没有可用的沙箱后端
  # --disable-gpu-sandbox：与 main.ts 已有的 appendSwitch 同一目的
  export ELECTRON_DISABLE_SANDBOX=1
  "${electron_bin}" \
    --no-sandbox \
    --disable-dev-shm-usage \
    --disable-gpu-sandbox \
    "${app}" \
    >"${LOG_DIR}/app.log" 2>&1 &
  supervise "$!"
  log "DownVid 已启动（pid ${SUPERVISED_PIDS[-1]}）"
}

# ===== 健康状态文件 =====
#
# 把「服务到底起来没有」写成一个文件，而不是让人去 grep 日志。
# 使用者：CI 冒烟（.github/workflows/docker.yml）与排障时的人。
#
# 四项各就绪才算齐全：X 显示、VNC 端口、noVNC 网页、应用进程。
# 只探测端口是不够的——noVNC 起来了但 Electron 崩了是另一种形态，
# 那时端口全通、界面却是空的。
write_health() {
  local x=0 vnc=0 novnc=0 app_=0
  xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1 && x=1
  # x11vnc 前台运行（拿得到 pid），但健康探测仍然用端口而不是 pid：
  # 端口在监听才说明它真的开始服务了。
  # bash 的 /dev/tcp 在**子 shell** 里试连，fd 随子 shell 退出自动关闭，
  # 不会泄漏到主 shell。
  (exec 3<>"/dev/tcp/127.0.0.1/${VNC_PORT}") 2>/dev/null && vnc=1
  curl -fsS -o /dev/null "http://127.0.0.1:${NOVNC_PORT}/vnc.html" 2>/dev/null && novnc=1
  # 应用：主进程入口存在于某个活进程的命令行里。
  # 不依赖 pgrep —— 那是 procps 包的命令，基础镜像里没有。
  if [ -n "$(latest_app_pid)" ]; then app_=1; fi

  cat > /tmp/downvid-health.json <<EOF
{"display":"${x}","vnc":"${vnc}","novnc":"${novnc}","app":"${app_}","width":${SCREEN_WIDTH},"height":${SCREEN_HEIGHT},"pid":"$(latest_app_pid)"}
EOF
}

# 找出跑着 dist-electron/main.js 的 pid。
# 遍历 /proc/*/cmdline，不引入 ps/pgrep（minimal 镜像里没有 procps，
# 为了一次探测装它不值得）。
#
# 按**参数**逐项精确匹配，而不是对整行做包含匹配：后者在少数环境里
# 会被无关进程的命令行误命中（本机实测过一次假阳性）。
latest_app_pid() {
  local d arg
  for d in /proc/[0-9]*; do
    [ -r "${d}/cmdline" ] || continue
    while IFS= read -r -d '' arg; do
      case "${arg}" in
        */dist-electron/main.js|dist-electron/main.js)
          echo "${d#/proc/}"
          return 0
          ;;
      esac
    done < "${d}/cmdline" 2>/dev/null
  done
  return 0
}

# ===== 启动与监督 =====
main() {
  log "DownVid 容器启动"
  log "访问：noVNC http://<宿主机IP>:${NOVNC_PORT}/vnc.html · VNC <宿主机IP>:${VNC_PORT} · SFTP ${SSH_PORT}"
  log "数据目录：${DOWNVID_HOME}（下载目录 ${DOWNVID_DOWNLOADS}）"

  setup_ssh    # 默认不动；见 setup_ssh 内的开关说明
  start_xvfb
  start_wm
  start_vnc
  start_novnc
  start_downvid

  # 监督循环：任一受监督进程退出，就以它的退出码结束容器。
  #
  # 为什么不用 `wait -n`：它在有多个子进程时**返回顺序不可控**。
  # 实测（bash 5.2）一个 sleep 60 与一个 1.2 秒后 exit 42 的进程并列时，
  # `wait -n` 会一直等到那个 60 秒的结束才返回，短命进程（也就是
  # 真正崩掉的那个）的退出被压了整整一分钟——容器迟迟不退出，
  # 重启策略也就迟迟不生效。而这种延迟在现场是最难归因的一类问题。
  #
  # 改成显式轮询：每 0.2 秒检查一次存活，退出码用 `wait <pid>`
  # 向 bash 要（已死的子进程会立刻给出它记住的状态）。
  local status pid dead_pid
  while true; do
    write_health

    dead_pid=""
    for pid in "${SUPERVISED_PIDS[@]}"; do
      if ! kill -0 "${pid}" 2>/dev/null; then
        dead_pid="${pid}"
        break
      fi
    done

    if [ -n "${dead_pid}" ]; then
      # 取真实退出码。0 也要归一成 1：容器非 0 退出，docker 的
      # unless-stopped 才会重启它；静默的成功退出只会让用户看到
      # 一次没有界面、日志也不明显的失败。
      set +e
      wait "${dead_pid}" 2>/dev/null
      status=$?
      set -e
      [ "${status}" -eq 0 ] && status=1

      log "受监督的服务 pid ${dead_pid} 已退出（状态 ${status}），容器随之结束"

      # 再写一次健康状态：上一轮写入时应用可能还活着，
      # 不刷新就会留下一个「看起来正常」的旧文件，把诊断带偏。
      # 同时把崩溃原因落到日志里，docker logs 直接能看到。
      write_health
      if [ -s "${LOG_DIR}/app.log" ]; then
        log "应用日志尾部："
        tail -n 40 "${LOG_DIR}/app.log" >&2 || true
      fi
      exit "${status}"
    fi

    sleep 0.2
  done
}

main "$@"
