import { execFile } from 'node:child_process'

/**
 * 与「结束一整棵进程树」相关的工具。
 *
 * ## 为什么必须杀进程树
 *
 * `child.kill()` 只给**直接子进程**发信号。而 yt-dlp 在启用 aria2 时是这样跑的：
 *
 *   Electron ──spawn──▶ yt-dlp ──spawn──▶ aria2c
 *
 * 杀 yt-dlp 之后 aria2c 变成孤儿，**继续把文件下完**。后果不是「多下一个文件」
 * 这么简单：
 *
 *   1. 暂停后 .part 还在被写 → 界面显示的大小继续涨，看起来像没暂停；
 *   2. 恢复时 aria2c 拿到的 .aria2 控制文件已经过时/被写坏 → 判定无法续传，
 *      **从零重下整个文件**（实测 16MB 的样本重传了 16.8MB）；
 *   3. 用户点暂停却吃满带宽，这是最直观的「加速功能坏了」。
 *
 * macOS / Linux 用「进程组」解决：spawn 时 `detached: true` 会让子进程成为新
 * 进程组的组长，于是 `process.kill(-pid)` 一次信号能覆盖整棵树（yt-dlp 与它拉的
 * aria2c / ffmpeg 都在同一组里）——除非 yt-dlp 自己又建了新组，实测它不会。
 *
 * Windows 没有进程组信号，只能 `taskkill /T /F`（`/T` 就是整棵树）。注意**顺序**：
 * 先 taskkill 再杀父进程，否则父进程先死、taskkill 拿不到子进程关系。
 */

/** 终止整棵进程树的选项 */
export interface KillTreeOptions {
  /** 等待落盘的宽限期：aria2c 需要时间把 .aria2 控制文件写完 */
  graceMs?: number
  /** 用于覆盖平台判断（测试用） */
  platform?: NodeJS.Platform
}

/**
 * 结束整棵进程树。
 *
 * 返回 Promise 而不是 fire-and-forget：调用方（`pauseDownload`）必须等 aria2c
 * 真的把控制文件写完再返回，否则恢复时会读到半截文件，前功尽弃。
 */
export function killProcessTree(
  child: { pid?: number; exitCode: number | null; signalCode: NodeJS.Signals | null; kill: (signal?: NodeJS.Signals | number) => boolean },
  options: KillTreeOptions = {},
): Promise<void> {
  const platform = options.platform || process.platform
  const pid = child.pid
  if (!pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()

  return new Promise((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolve()
    }
    // 兜底：信号发出去后进程可能在收尾（写控制文件、清理 socket）。
    // 无论它多久才退出，调用方都不能被无限期卡住。
    const timer = setTimeout(done, options.graceMs ?? 3000)

    const finish = () => {
      clearTimeout(timer)
      done()
    }

    if (platform === 'win32') {
      // Windows：必须**先** taskkill /T，父进程先死会断开子进程关系
      execFile(
        `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\taskkill.exe`,
        ['/PID', String(pid), '/T', '/F'],
        { windowsHide: true, timeout: 5000 },
        (error) => {
          if (error) {
            // taskkill 失败（进程已退出、权限不足）时至少把直接子进程收掉
            try { child.kill('SIGKILL') } catch {}
          }
          finish()
        },
      )
      return
    }

    // POSIX：对该进程所在的**进程组**发信号。
    // 负 pid 是「发给整个组」的写法；失败通常是因为子进程不是组长
    // （没传 detached，或已被系统重新归组），此时退回杀单个进程。
    const signal = (sig: NodeJS.Signals) => {
      try {
        process.kill(-pid, sig)
        return true
      } catch {
        try { child.kill(sig) } catch {}
        return false
      }
    }

    // 先 SIGTERM：给 aria2c 机会把 .aria2 控制文件写完整。
    // 直接 SIGKILL 会让控制文件停留在上一次 auto-save 的状态，
    // 恢复时丢掉最后几秒的进度（实测可丢几 MB）。
    signal('SIGTERM')

    const deadline = Date.now() + (options.graceMs ?? 3000) / 2
    const waitGone = setInterval(() => {
      const alive = isAlive(pid)
      if (!alive || Date.now() > deadline) {
        clearInterval(waitGone)
        // 还没退出就上 SIGKILL：绝不能留下孤儿线程继续吃带宽
        if (alive) signal('SIGKILL')
        finish()
      }
    }, 100)
  })
}

/** 进程是否还活着（signal 0 只探测，不真的发信号） */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: any) {
    // EPERM = 进程存在但没权限（不该发生在我们自己的子进程上，但别误判成已退出）
    return error?.code === 'EPERM'
  }
}

/**
 * spawn 选项：让子进程成为新进程组的组长，从而能被 `killProcessTree` 整组收掉。
 *
 * Windows 上**不要**开 detached：那会弹出新控制台窗口，且 taskkill 已经能处理树。
 */
export function treeSpawnOptions(platform: NodeJS.Platform = process.platform): { detached: boolean } {
  return { detached: platform !== 'win32' }
}
