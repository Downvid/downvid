import { app, BrowserWindow, session } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { getMainWindow, setMainWindow } from './store'
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

function preloadPath() {
  return path.join(__dirname, 'preload.mjs')
}

/** 主窗口与设置窗口共用的 webPreferences */
function webPreferences() {
  return {
    preload: preloadPath(),
    contextIsolation: true,
    nodeIntegration: false,
    spellcheck: false,
  }
}

/**
 * 按开发/生产环境加载渲染进程页面。
 *
 * query 用哈希传递（`#view=settings`），因为 file:// 下 hash 比 search 可靠，
 * 开发服务器与打包产物行为一致。
 */
function loadRenderer(win: BrowserWindow, query = '') {
  const hash = query.replace(/^\/?\??/, '')
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(hash ? `${VITE_DEV_SERVER_URL}#${hash}` : VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'), hash ? { hash } : undefined)
  }
}

function createWindow() {
  log(`[WINDOW] Creating window, preload=${preloadPath()}`)

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
    webPreferences: webPreferences(),
  })

  setMainWindow(win)

  // 应用代理设置
  applyProxy()

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

  loadRenderer(win)
}

/**
 * 单实例锁。
 *
 * 两个作用：
 *  - 用户重复双击图标（或系统的"打开方式"）不会开出多个窗口
 *  - 兜住被外部程序误启动的情况：yt-dlp 曾把 Electron 二进制当作 deno 运行时执行，
 *    于是又拉起了一整个 DownVid（表现为"点解析后多开一个应用"）。根因已修
 *    （见 utils/binary.ts 的 checkJsRuntime），这把锁保证同类问题不会真的开出窗口。
 *
 * 拿不到锁说明已有实例在跑，把已有窗口带到前台后立即退出。
 */
// 开发模式下跳过：dev 与打包版的 userData 同名（都是 downvid），因此装了打包版
// 且它正开着时，`pnpm dev` 会被自己的锁挡在门外（实测发生）。反过来两者共用
// userData 也会互相污染（历史记录、Cookie 快照、日志）。开发要的是"另起一份"，
// 不是"聚焦已装的正式版"。
const isDev = !app.isPackaged
const gotSingleInstanceLock = isDev || app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  log('[LIFECYCLE] 已有实例在运行，本次启动退出')
  app.quit()
} else {
  app.on('second-instance', () => {
    log('[LIFECYCLE] 检测到重复启动，聚焦已有窗口')
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    } else if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
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
  // 没有窗口才新建；有窗口时还原到前台（可能是被最小化/隐藏了）
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  } else {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
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
