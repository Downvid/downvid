import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { killProcessTree, treeSpawnOptions } from '../electron/download/process-tree'

/**
 * 这两条用例断言的是 POSIX 语义（负数 pid 发给进程组、SIGTERM→SIGKILL 升级）。
 *
 * Windows 上**没有进程组信号**：`process.kill(-pid)` 会抛错，收树靠
 * `taskkill /T /F`。在 Windows 上跑它们必然是红的——而且那不是代码坏了，
 * 是断言写错了平台（CI 的 windows job 抓到的就是这个）。
 *
 * 用一个常量而不是 `it.skipIf`：后者在 vitest 的写法会随版本变，
 * 而 `if (!POSIX) return` 在任何版本上都只是「什么也不做」。
 */
const POSIX = process.platform !== 'win32'

/**
 * 结束整棵进程树。
 *
 * ## 回归背景（真实 bug，用户能直接感觉到）
 *
 * 启用 aria2 时进程关系是三级：Electron → yt-dlp → aria2c。而 `child.kill()`
 * 只给**直接子进程**发信号，于是：
 *
 *   1. 暂停后 aria2c 变成孤儿，**继续把文件下完**——用户点了暂停，带宽还在被吃满；
 *   2. 恢复时 aria2c 读到的 .aria2 控制文件已经过时/被写坏，判定无法续传，
 *      **从零重下整个文件**（实测 16MB 样本重传 16.8MB）。
 *
 * 注意第一点正是「看起来像没暂停」的直接原因，而第二点让「加速」在暂停场景下
 * 反而比单线程更慢。两件事都不会抛错，只会让用户觉得「加速是坏的」。
 */
describe('spawn 选项', () => {
  it(' POSIX 上必须 detached，否则拿不到进程组、杀不掉孙进程', () => {
    expect(treeSpawnOptions('darwin')).toEqual({ detached: true })
    expect(treeSpawnOptions('linux')).toEqual({ detached: true })
  })

  it('Windows 不开 detached（会弹新控制台窗口，且 taskkill /T 已能处理树）', () => {
    expect(treeSpawnOptions('win32')).toEqual({ detached: false })
  })
})

describe('killProcessTree', () => {
  it('进程已退出时立即完成，不发任何信号', async () => {
    const kill = vi.fn()
    await killProcessTree({ pid: 4242, exitCode: 0, signalCode: null, kill })
    expect(kill).not.toHaveBeenCalled()
  })

  it('没有 pid 时安全返回（不要让调用方永久挂起）', async () => {
    const kill = vi.fn()
    await expect(
      killProcessTree({ pid: undefined, exitCode: null, signalCode: null, kill }),
    ).resolves.toBeUndefined()
    expect(kill).not.toHaveBeenCalled()
  })

  it('POSIX：对进程组发信号（负 pid），而不是只杀直接子进程', async () => {
    if (!POSIX) return // 见文件顶部 POSIX 的说明
    // 用一个真实存在但会立刻退出的子进程，验证走的是 -pid 分支
    const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 500)'], { detached: true, stdio: 'ignore' })
    await new Promise(r => setTimeout(r, 50))
    const groupKill = vi.spyOn(process, 'kill')
    await killProcessTree(child)
    const usedNegative = groupKill.mock.calls.some(([pid]) => typeof pid === 'number' && pid < 0)
    groupKill.mockRestore()
    expect(usedNegative).toBe(true)
    try { process.kill(-child.pid!, 'SIGKILL') } catch {}
  })

  it('POSIX：先 SIGTERM 再（必要时）SIGKILL——要给 aria2c 时间写控制文件', async () => {
    if (!POSIX) return // 见文件顶部 POSIX 的说明
    // 忽略 SIGTERM 的子进程：验证宽限期结束后会升级为 SIGKILL
    const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); setInterval(()=>{},1000)'], {
      detached: true,
      stdio: 'ignore',
    })
    await new Promise(r => setTimeout(r, 100))
    const sent: string[] = []
    const groupKill = vi.spyOn(process, 'kill').mockImplementation(((pid: number, sig?: any) => {
      sent.push(String(sig))
      return true
    }) as any)
    await killProcessTree(child, { graceMs: 400 })
    groupKill.mockRestore()
    expect(sent[0]).toBe('SIGTERM')
    expect(sent).toContain('SIGKILL')
    try { process.kill(-child.pid!, 'SIGKILL') } catch {}
  })

  it('进程组信号失败时退回杀直接子进程（不要静默放弃）', async () => {
    if (!POSIX) return // Windows 走 taskkill 分支，不存在「进程组信号失败」这条路
    const fallbackKill = vi.fn()
    const groupKill = vi.spyOn(process, 'kill').mockImplementation((() => {
      throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
    }) as any)
    await killProcessTree({ pid: 999999, exitCode: null, signalCode: null, kill: fallbackKill }, { graceMs: 100 })
    groupKill.mockRestore()
    expect(fallbackKill).toHaveBeenCalled()
  })

  it('宽限期后必定 resolve（不能把暂停流程卡死）', async () => {
    const start = Date.now()
    await killProcessTree(
      { pid: 999998, exitCode: null, signalCode: null, kill: () => true },
      { graceMs: 200 },
    )
    expect(Date.now() - start).toBeLessThan(2000)
  })
})
