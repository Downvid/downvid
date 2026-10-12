import { ipcMain, dialog, shell, clipboard, app, session, BrowserWindow } from 'electron'
import { getDefaultDownloadDir } from '../utils/platform'
import { getCookieStatus } from '../utils/cookies'
import { setUpdaterProxy } from '../updater'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { exec } from 'node:child_process'

// 下载目录可能尚未创建：向上找到最近一个存在的目录再查询
function nearestExistingDir(dir: string): string {
  let current = path.resolve(dir)
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return current
}

function execText(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: 5000, windowsHide: true }, (err, stdout) => err ? reject(err) : resolve(stdout))
  })
}

// 优先使用 Node 内置 statfs（跨平台，Windows 下为 GetDiskFreeSpaceEx）；
// 旧实现依赖 wmic，而 Windows 11 24H2 起默认已移除 wmic，导致一直显示“未知”
async function getDiskSpace(dir: string): Promise<{ free: number; total: number; unit: string }> {
  const target = nearestExistingDir(dir)
  try {
    const stats = await fs.promises.statfs(target)
    const total = Number(stats.blocks) * Number(stats.bsize)
    if (total > 0) return { free: Number(stats.bavail) * Number(stats.bsize), total, unit: 'bytes' }
  } catch {}

  if (process.platform === 'win32') {
    const drive = path.parse(target).root.replace(/\\$/, '').replace(':', '')
    const out = await execText(`powershell -NoProfile -Command "$d = Get-PSDrive -Name ${drive}; $d.Free; $d.Used"`)
    const [free, used] = out.trim().split(/\s+/).map(Number)
    return { free: free || 0, total: (free || 0) + (used || 0), unit: 'bytes' }
  }
  // -P：POSIX 输出格式，设备名过长时也不会折行
  const lines = (await execText(`df -Pk "${target}"`)).trim().split('\n')
  const parts = lines[lines.length - 1].split(/\s+/)
  return { free: parseInt(parts[3]) * 1024 || 0, total: parseInt(parts[1]) * 1024 || 0, unit: 'bytes' }
}

/** 用于连通性测试的极小资源：返回 204，无正文 */
const PROBE_URL = 'https://www.gstatic.com/generate_204'

/** 把 Chromium 的网络错误码翻译成可执行的建议 */
function friendlyProxyError(error: unknown): string {
  const msg = String((error as any)?.message || error || '')
  if (/ERR_PROXY_CONNECTION_FAILED/i.test(msg)) return '无法连接代理服务器，请确认地址与端口正确且代理正在运行'
  if (/ERR_PROXY_AUTH_REQUESTED|407/i.test(msg)) return '代理需要身份验证（当前尚不支持填写账号密码）'
  if (/ERR_TUNNEL_CONNECTION_FAILED/i.test(msg)) return '无法通过代理建立隧道，代理可能不支持 HTTPS 或已被阻断'
  if (/ERR_NAME_NOT_RESOLVED/i.test(msg)) return '代理无法解析目标域名，请检查代理自身的 DNS 设置'
  if (/ERR_TIMED_OUT|Timeout|aborted/i.test(msg)) return '连接超时，请检查网络或稍后重试'
  if (/ERR_INTERNET_DISCONNECTED/i.test(msg)) return '本机网络未连接'
  return msg.split('\n')[0] || '连接失败'
}

function getLogPath(): string {
  return path.join(app.getPath('userData'), 'downvid.log')
}

export function registerSystemIpc() {
  ipcMain.handle('clipboard:readText', () => clipboard.readText())
  ipcMain.handle('clipboard:writeText', (_, text: string) => clipboard.writeText(text))

  ipcMain.handle('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      defaultPath: getDefaultDownloadDir(),
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:selectFile', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Text Files', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('app:getDefaultDownloadDir', () => getDefaultDownloadDir())
  // 主目录路径：渲染进程用它把 /Users/xxx/... 缩写成 ~/...，
  // 界面展示没必要暴露用户名
  ipcMain.handle('app:getHomeDir', () => os.homedir())
  // Cookie 的真实可用状态：界面据此决定是否提示"需要配置 Cookie"，
  // 而不是仅凭 URL 域名就弹提示
  ipcMain.handle('app:cookieStatus', (_, manualFile?: string) => getCookieStatus(manualFile))
  // openPath 会用系统默认程序打开文件（视频就是播放），返回的字符串是错误信息（成功为空）
  ipcMain.handle('shell:openPath', async (_, filePath: string) => {
    const error = await shell.openPath(filePath)
    return { success: !error, error: error || undefined }
  })
  // 在文件管理器里定位文件（macOS 访达、Windows 资源管理器、Linux 文件管理器）
  ipcMain.handle('shell:showItemInFolder', (_, filePath: string) => {
    try {
      shell.showItemInFolder(filePath)
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e?.message || '无法打开所在文件夹' }
    }
  })
  ipcMain.handle('shell:openExternal', async (_, url: string) => shell.openExternal(url))

  // 日志相关
  ipcMain.handle('app:getLog', async () => {
    try {
      const logPath = getLogPath()
      if (!fs.existsSync(logPath)) return { success: true, content: '', path: logPath }
      const content = fs.readFileSync(logPath, 'utf-8')
      // 只返回最后 500 行，避免日志过大
      const lines = content.split('\n')
      const tail = lines.slice(-500).join('\n')
      return { success: true, content: tail, path: logPath, totalLines: lines.length }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : '读取日志失败' }
    }
  })

  ipcMain.handle('app:clearLog', async () => {
    try {
      const logPath = getLogPath()
      if (fs.existsSync(logPath)) {
        fs.writeFileSync(logPath, '', 'utf-8')
      }
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : '清空日志失败' }
    }
  })

  ipcMain.handle('app:openLogDir', async () => {
    try {
      const logPath = getLogPath()
      await shell.showItemInFolder(logPath)
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : '打开日志目录失败' }
    }
  })

  ipcMain.handle('app:fetchImage', async (_, url: string, referer: string) => {
    try {
      const response = await fetch(url, {
        headers: {
          'Referer': referer || 'https://www.bilibili.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const buffer = await response.arrayBuffer()
      const base64 = Buffer.from(buffer).toString('base64')
      const contentType = response.headers.get('content-type') || 'image/jpeg'
      return `data:${contentType};base64,${base64}`
    } catch {
      return null
    }
  })

  // 代理设置
  ipcMain.handle('app:setProxy', async (_, proxy: string) => {
    await session.defaultSession.setProxy({ proxyRules: proxy || '' })
    // 更新检查/下载使用独立 session，需同步代理
    await setUpdaterProxy(proxy)
    return true
  })

  // 测试代理连接
  /**
   * 测试代理是否可用。
   *
   * 要点（都实测过）：
   * - 必须用**独立 session 的 `session.fetch`**：全局 fetch 既不读传入参数、也不读
   *   环境变量代理；`net.fetch(url, { session })` 同样会绕过该 session 的代理。
   *   之前的实现用全局 fetch + `dispatcher: undefined`（空操作），实际只在测
   *   "本机能否直连 google.com"——代理挂掉也会报成功，代理正常但直连被墙则报失败。
   * - 用一次性 session，不要动 defaultSession / electron-updater 的 session，
   *   否则会把正在进行的下载临时切到错误代理。
   * - 目标选 generate_204：返回极小，且能明确区分连通与失败。
   * - 顺带测一次直连作对照：两者都成功说明代理可能没在起作用，如实告知用户。
   */
  ipcMain.handle('app:testProxy', async (_, proxy: string) => {
    const testSession = session.fromPartition('proxy-probe', { cache: false })
    const START = Date.now()
    try {
      await testSession.setProxy(proxy ? { proxyRules: proxy } : { mode: 'direct' })

      const fetch204 = async () => {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 8000)
        try {
          const response = await testSession.fetch(PROBE_URL, { signal: controller.signal })
          return response.status === 204
        } finally {
          clearTimeout(timer)
        }
      }

      let proxiedOk = false
      let proxiedError = ''
      const proxiedAt = Date.now()
      try {
        proxiedOk = await fetch204()
        if (!proxiedOk) proxiedError = '返回状态异常'
      } catch (e: any) {
        proxiedError = friendlyProxyError(e)
      }
      const latency = Date.now() - proxiedAt

      if (!proxiedOk) return { success: false, error: proxiedError || '连接失败' }

      // 直连对照：用来判断"代理是否真的在起作用"
      let directOk = false
      try {
        await testSession.setProxy({ mode: 'direct' })
        directOk = await fetch204()
      } catch {}

      return {
        success: true,
        latency,
        // 代理与直连都通 → 代理可能未生效，提示而不是断言失败
        warning: directOk ? '直连同样可达，代理可能未生效' : undefined,
      }
    } catch (e: any) {
      return { success: false, error: friendlyProxyError(e) }
    } finally {
      // Electron 的 Session 没有 close()；这个分区只用于探测，清掉它的缓存即可
      void testSession.clearStorageData().catch(() => {})
      void START
    }
  })

  // 窗口控制
  ipcMain.handle('window:minimize', () => {
    BrowserWindow.getFocusedWindow()?.minimize()
  })
  ipcMain.handle('window:maximize', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) {
      win.isMaximized() ? win.unmaximize() : win.maximize()
    }
  })
  ipcMain.handle('window:close', () => {
    BrowserWindow.getFocusedWindow()?.close()
  })
  ipcMain.handle('window:isMaximized', () => {
    return BrowserWindow.getFocusedWindow()?.isMaximized() || false
  })

  // 获取磁盘可用空间
  ipcMain.handle('app:getDiskSpace', async (_, dir?: string) => {
    try {
      return await getDiskSpace(dir || getDefaultDownloadDir())
    } catch {
      return { free: 0, total: 0, unit: 'bytes' }
    }
  })
}
