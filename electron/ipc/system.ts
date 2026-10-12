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
  ipcMain.handle('app:testProxy', async (_, proxy: string) => {
    const start = Date.now()
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      const response = await fetch('https://www.google.com', {
        signal: controller.signal,
        ...(proxy ? { dispatcher: undefined } : {}),
      } as any)
      clearTimeout(timeout)
      const elapsed = Date.now() - start
      if (response.ok) {
        return { success: true, latency: elapsed }
      }
      return { success: false, error: `HTTP ${response.status}` }
    } catch (e: any) {
      return { success: false, error: e.message || '连接失败' }
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
