import { ipcMain, BrowserWindow, shell } from 'electron'
import fs from 'node:fs'
import {
  getRuntimeStatus, downloadDeps, cancelDownload, isDownloading,
  invalidateStatus, getManagedDir, getSidecarPath, platformKey,
  type DetectOptions, type DownloadProgress, type DepKind,
} from '../utils/runtime'

/** 把手动路径从 settings 形状转换为主进程所需形状 */
export interface DepsSettings extends DetectOptions {
  proxy?: string
}

function broadcastProgress(progress: DownloadProgress) {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) win.webContents.send('deps:progress', progress)
  })
}

function sanitizeSettings(raw: any): DepsSettings {
  const manualPaths: Partial<Record<DepKind, string>> = {}
  const source = raw?.manualPaths || {}
  for (const kind of ['yt-dlp', 'ffmpeg', 'ffprobe'] as DepKind[]) {
    const value = source[kind]
    if (typeof value === 'string' && value.trim()) manualPaths[kind] = value.trim()
  }
  return { manualPaths, proxy: typeof raw?.proxy === 'string' ? raw.proxy : undefined }
}

export function registerDepsIpc() {
  // 读取当前依赖状态（带缓存，force 时强制重新探测）
  ipcMain.handle('deps:status', async (_, settings?: DepsSettings, force?: boolean) => {
    try {
      const status = await getRuntimeStatus({ ...sanitizeSettings(settings), force })
      return { success: true, status }
    } catch (e: any) {
      return { success: false, error: e?.message || '依赖检测失败' }
    }
  })

  // 强制重新探测（设置里点「重新检测」）
  ipcMain.handle('deps:check', async (_, settings?: DepsSettings) => {
    try {
      invalidateStatus()
      const status = await getRuntimeStatus({ ...sanitizeSettings(settings), force: true })
      return { success: true, status }
    } catch (e: any) {
      return { success: false, error: e?.message || '依赖检测失败' }
    }
  })

  // 下载缺失依赖；进度通过 deps:progress 广播
  ipcMain.handle('deps:download', async (_, options: DepsSettings & { only?: DepKind[]; force?: boolean } = {}) => {
    if (isDownloading()) {
      return { success: false, error: '已有下载任务正在进行' }
    }
    try {
      const result = await downloadDeps(
        { ...sanitizeSettings(options), only: options.only, force: options.force },
        broadcastProgress,
      )
      if (!result.ok) return { success: false, error: result.error || '依赖下载失败' }
      return { success: true, status: result.status }
    } catch (e: any) {
      return { success: false, error: e?.message || '依赖下载失败' }
    }
  })

  ipcMain.handle('deps:cancel', () => cancelDownload())

  // 打开托管目录，方便用户查看或手动替换
  ipcMain.handle('deps:openDir', async () => {
    try {
      const dir = getManagedDir()
      fs.mkdirSync(dir, { recursive: true })
      await shell.openPath(dir)
      return { success: true, path: dir }
    } catch (e: any) {
      return { success: false, error: e?.message || '打开目录失败' }
    }
  })

  // 诊断信息：侧车是否就位、平台标识等
  ipcMain.handle('deps:diagnostics', () => ({
    success: true,
    platform: platformKey(),
    sidecar: getSidecarPath(),
    managedDir: getManagedDir(),
  }))
}
