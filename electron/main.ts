import { app, BrowserWindow, session } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { setMainWindow } from './store'
import { createMenu } from './menu'
import { registerAppIpc } from './ipc/app'
import { registerDepsIpc } from './ipc/deps'
import { registerDownloadIpc } from './ipc/download'
import { registerHistoryIpc } from './ipc/history'
import { registerSystemIpc } from './ipc/system'
import { setupAutoUpdater, stripOwnQuarantine } from './updater'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

// GPU 兼容性修复（macOS Tahoe + Electron 30）
// 只禁用 GPU sandbox 防止闪退，保留硬件加速渲染
app.commandLine.appendSwitch('disable-gpu-sandbox')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

// 日志系统（延迟初始化，确保 app ready 后再获取路径）
let logFile: string | null = null
function initLog() {
  try {
    logFile = path.join(app.getPath('userData'), 'downvid.log')
    fs.mkdirSync(path.dirname(logFile), { recursive: true })
  } catch (e) {
    console.error('Failed to init log:', e)
  }
}

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  console.log(line.trim())
  if (logFile) {
    try { fs.appendFileSync(logFile, line) } catch (e) { console.error('Log write failed:', e) }
  }
}

// 尽早捕获全局错误
process.on('uncaughtException', (err) => {
  log(`[FATAL] uncaughtException: ${err.message}\n${err.stack}`)
})

process.on('unhandledRejection', (reason) => {
  log(`[ERROR] unhandledRejection: ${reason}`)
})

log(`[BOOT] Main process starting, pid=${process.pid}, platform=${process.platform}, arch=${process.arch}`)
log(`[BOOT] APP_ROOT=${process.env.APP_ROOT}`)
log(`[BOOT] VITE_DEV_SERVER_URL=${VITE_DEV_SERVER_URL || 'none (production)'}`)

// 应用代理设置到 Electron session
function applyProxy() {
  // 代理通过 IPC 从渲染进程设置（app:setProxy）
}

// 通过 IPC 设置代理
export function setProxyForSession(proxy: string) {
  const ses = session.defaultSession
  if (proxy) {
    log(`[PROXY] Setting proxy: ${proxy}`)
    ses.setProxy({ proxyRules: proxy })
  } else {
    log(`[PROXY] Clearing proxy`)
    ses.setProxy({ proxyRules: '' })
  }
}

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.mjs')
  log(`[WINDOW] Creating window, preload=${preloadPath}`)

  const win = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 16 } } : {}),
    icon: process.platform !== 'darwin'
      ? path.join(process.env.APP_ROOT || '', 'ldstore.ico')
      : undefined,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })

  setMainWindow(win)

  // 应用代理设置
  applyProxy()

  // 设置自动更新
  setupAutoUpdater()

  win.on('closed', () => {
    log('[WINDOW] Window closed')
  })

  win.webContents.on('render-process-gone', (_e, details) => {
    log(`[WINDOW] render-process-gone: reason=${details.reason}, exitCode=${details.exitCode}`)
    // 自动重载崩溃的 renderer
    if (details.reason === 'crashed' || details.reason === 'killed') {
      setTimeout(() => {
        if (!win.isDestroyed()) {
          log('[WINDOW] Reloading after renderer crash')
          win.reload()
        }
      }, 1000)
    }
  })

  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    log(`[WINDOW] did-fail-load: code=${errorCode}, desc=${errorDescription}, url=${validatedURL}`)
  })

  win.webContents.on('did-finish-load', () => {
    log('[WINDOW] did-finish-load')
  })

  if (VITE_DEV_SERVER_URL) {
    log(`[WINDOW] Loading URL: ${VITE_DEV_SERVER_URL}`)
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    const indexPath = path.join(RENDERER_DIST, 'index.html')
    log(`[WINDOW] Loading file: ${indexPath}`)
    win.loadFile(indexPath)
  }
}

// 注册 IPC
registerAppIpc()
registerDepsIpc()
registerDownloadIpc()
registerHistoryIpc()
registerSystemIpc()

// App 生命周期
app.on('window-all-closed', () => {
  log('[LIFECYCLE] All windows closed')
  if (process.platform !== 'darwin') {
    log('[LIFECYCLE] Quitting app (non-macOS)')
    app.quit()
  }
})

app.on('activate', () => {
  log('[LIFECYCLE] App activate')
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('before-quit', () => {
  log('[LIFECYCLE] before-quit')
})

app.on('will-quit', () => {
  log('[LIFECYCLE] will-quit')
})

app.on('quit', (_e, exitCode) => {
  log(`[LIFECYCLE] quit, exitCode=${exitCode}`)
})

app.whenReady().then(() => {
  initLog()
  log('[LIFECYCLE] app ready')
  setupAutoUpdater()
  stripOwnQuarantine()
  createWindow()
  createMenu()
  log('[LIFECYCLE] Window and menu created')
  // 依赖探测放在窗口创建之后：首次启动即在后台跑 Go 侧车，
  // 用户粘贴链接时通常已拿到结果，不阻塞开窗。
  void warmUpRuntime()
})

/** 后台预热依赖探测，失败只记日志（用户仍可在设置里手动重新检测） */
async function warmUpRuntime() {
  try {
    const { getRuntimeStatus } = await import('./utils/runtime')
    const status = await getRuntimeStatus()
    for (const dep of status.results) {
      log(`[DEPS] ${dep.kind}: ${dep.found ? `${dep.version} @ ${dep.path} (${dep.source})` : `缺失 — ${dep.reason}`}`)
    }
  } catch (e: any) {
    log(`[DEPS] 依赖探测失败：${e?.message || e}`)
  }
}
