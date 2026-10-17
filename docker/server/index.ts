import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'

/**
 * DownVid 原生 WebUI 服务（Docker / 无头模式专用适配层）。
 *
 * 位于 docker/server/ 目录下，通过 electron-shim 适配层复用 electron/ 下的核心业务代码，
 * 完全不修改桌面主进程和核心模块的既有实现。
 *
 * 访问控制与安全性：
 *   1. 默认仅监听 127.0.0.1 本地回环地址，避免意外暴露；在容器内由环境变量
 *      DOWNVID_WEB_HOST=0.0.0.0 显式开启容器端口转发。
 *   2. 严格的 WebSocket 跨源（Origin）校验，阻止跨站脚本发起 CSWSH 攻击调用下载接口。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

// ===== 配置 =====
const PORT = Number(process.env.DOWNVID_WEB_PORT || 6080)
// 安全默认值：未配置时严格绑定本地回环地址（127.0.0.1）
const HOST = process.env.DOWNVID_WEB_HOST || '127.0.0.1'
const STATIC_DIR = process.env.DOWNVID_WEB_DIST
  || path.join(ROOT, 'docker', 'dist-web')
const DATA_DIR = process.env.DOWNVID_DATA_DIR
  || path.join(ROOT, 'data', 'userdata')
const DOWNLOADS_DIR = process.env.DOWNVID_DOWNLOADS
  || path.join(ROOT, 'data', 'downloads')

if (!process.env.APP_ROOT) process.env.APP_ROOT = ROOT
if (!process.env.DOWNVID_DATA_DIR) process.env.DOWNVID_DATA_DIR = DATA_DIR

// ===== 引入适配器与既有业务逻辑 =====
import { wsEventBus } from './electron-shim'
import { isAllowedOrigin } from './security'
import { isDouyinUrl, isKuaishouUrl, ensureDownloadDir } from '../../electron/utils/platform'
import { parseDouyinWithAPI, parseDouyinWithPuppeteer } from '../../electron/parsers/douyin'
import { parseKuaishouWithAPI, parseKuaishouWithPuppeteer } from '../../electron/parsers/kuaishou'
import { parseWithYtdlp } from '../../electron/parsers/ytdlp'
import { activeDownloads } from '../../electron/store'
import { downloadDirectFile } from '../../electron/download/direct'
import { runYtdlpDownload, pauseDownload } from '../../electron/download/ytdlp'
import { sendDownloadProgress, throttledProgress, clearProgressThrottle } from '../../electron/download/progress'
import type { DownloadOptions } from '../../electron/download/ytdlp'
import { detectAria2 } from '../../electron/download/aria2'
import {
  getRuntimeStatus, downloadDeps, cancelDownload, isDownloading,
  invalidateStatus, getManagedDir, getSidecarPath, platformKey, cachedStatusSnapshot,
  type DetectOptions, type DepKind,
} from '../../electron/utils/runtime'
import { dedupeHistory, upsertHistory } from '../../electron/history'
import { getCookieStatus } from '../../electron/utils/cookies'
import { checkContainerUpdate, containerInfo } from './update'

const APP_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version

// ===== 历史记录管理（基于纯业务模块实现） =====
const historyFile = path.join(DATA_DIR, 'download-history.json')

function readHistory(): any[] {
  try {
    if (fs.existsSync(historyFile)) {
      const saved = JSON.parse(fs.readFileSync(historyFile, 'utf8'))
      if (!Array.isArray(saved)) return []
      return dedupeHistory(saved).slice(0, 100)
    }
  } catch {}
  return []
}

function writeHistory(history: any[]) {
  fs.mkdirSync(path.dirname(historyFile), { recursive: true })
  fs.writeFileSync(historyFile, JSON.stringify(history, null, 2))
}

function fileExists(filePath: string): boolean {
  try { return fs.statSync(filePath).isFile() } catch { return false }
}

function localHistory(history: any[]): any[] {
  return history.map(record => ({ ...record, fileExists: fileExists(record.filePath) }))
}

function notifyHistoryUpdated(history: any[]) {
  const updated = localHistory(history)
  wsEventBus.emit('history:updated', updated)
}

// ===== 依赖设置清洗 =====
interface DepsSettings extends DetectOptions {
  proxy?: string
  /** 依赖下载源（见 shared/acceleration.ts 的 DEP_MIRROR_IDS） */
  mirror?: string
}

function sanitizeDepsSettings(raw: any): DepsSettings {
  const manualPaths: Partial<Record<DepKind, string>> = {}
  const source = raw?.manualPaths || {}
  for (const kind of ['yt-dlp', 'ffmpeg', 'ffprobe'] as DepKind[]) {
    const value = source[kind]
    if (typeof value === 'string' && value.trim()) manualPaths[kind] = value.trim()
  }
  return {
    manualPaths,
    proxy: typeof raw?.proxy === 'string' ? raw.proxy : undefined,
    // 下载源：与桌面版同一套（Go 边车实现镜像回退）。
    // 容器里尤其重要：镜像一旦漏装依赖，用户只能靠界面里的「下载」救回来。
    mirror: typeof raw?.mirror === 'string' ? raw.mirror : undefined,
  }
}

// ===== 日志与空间 =====
function getLogPath(): string {
  return path.join(DATA_DIR, 'downvid.log')
}

function readLog(): { success: boolean; content?: string; path?: string; totalLines?: number; error?: string } {
  try {
    const logPath = getLogPath()
    if (!fs.existsSync(logPath)) return { success: true, content: '', path: logPath }
    const content = fs.readFileSync(logPath, 'utf8')
    const lines = content.split('\n')
    return { success: true, content: lines.slice(-500).join('\n'), path: logPath, totalLines: lines.length }
  } catch (e: any) {
    return { success: false, error: e?.message || '读取日志失败' }
  }
}

async function getDiskSpace(dir?: string): Promise<{ free: number; total: number; unit: string }> {
  let target = path.resolve(dir || DOWNLOADS_DIR)
  while (!fs.existsSync(target)) {
    const parent = path.dirname(target)
    if (parent === target) break
    target = parent
  }
  try {
    const stats = await fs.promises.statfs(target)
    return {
      free: Number(stats.bavail) * Number(stats.bsize),
      total: Number(stats.blocks) * Number(stats.bsize),
      unit: 'bytes',
    }
  } catch {
    return { free: 0, total: 0, unit: 'bytes' }
  }
}

// ===== 图片代理（绕过防盗链与 CORS） =====
async function fetchImage(url: string, referer: string): Promise<string | null> {
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
}

// ===== 更新源与自动检查开关（由渲染进程同步，与桌面版同一套语义）=====
let updateSource: unknown = process.env.DOWNVID_UPDATE_SOURCE
let autoCheck = true

/** 周期检查间隔：6 小时。自托管服务长期挂着，太频繁只会白耗请求配额 */
const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000

/**
 * 更新可用时主动广播一次。
 *
 * 前端已挂载时如果自己没检查过，这条广播能让界面上出现提示；
 * 检查在服务启动后延迟触发，避免和首屏渲染抢带宽。
 */
async function broadcastUpdateCheck() {
  if (!autoCheck) return
  try {
    const state = await checkContainerUpdate(updateSource)
    if (state.hasUpdate) {
      wsEventBus.emit('update:status', {
        status: 'available',
        version: state.latestVersion || '',
        manual: true,
        manualReason: '容器版通过更新镜像升级',
        container: state,
      })
    }
  } catch (e: any) {
    console.warn(`[web:update] 检查更新失败：${e?.message || e}`)
  }
}

// ===== RPC 通道映射表 =====
type Handler = (args: unknown[]) => unknown

const channels: Record<string, Handler> = {
  // 解析
  'ytdlp:accelerationStatus': args => detectAria2((args[0] as string) || ''),
  'ytdlp:parse': async args => {
    const url = args[0] as string
    const cookiesFile = args[1] as string | undefined
    const proxy = args[2] as string | undefined

    if (isDouyinUrl(url)) {
      try { return await parseDouyinWithAPI(url, cookiesFile) } catch {
        try { return await parseDouyinWithPuppeteer(url, cookiesFile) } catch {}
      }
    }
    if (isKuaishouUrl(url)) {
      try { return await parseKuaishouWithAPI(url) } catch {
        try { return await parseKuaishouWithPuppeteer(url) } catch {}
      }
    }
    return await parseWithYtdlp(url, cookiesFile, proxy)
  },

  // 下载
  'ytdlp:download': async args => {
    const options = args[0] as DownloadOptions
    const outputDir = ensureDownloadDir(options.outputDir || DOWNLOADS_DIR)

    if (options.directUrl) {
      const filename = options.filename || `video_${Date.now()}.mp4`
      const outputPath = path.join(outputDir, filename)
      const controller = new AbortController()
      let paused = false

      let finish!: () => void
      const entry = {
        abort: () => { paused = true; controller.abort() },
        stopped: new Promise<void>(resolve => { finish = resolve }),
        options,
        status: 'downloading',
      }
      activeDownloads.set(options.taskId, entry)

      try {
        await downloadDirectFile({
          url: options.directUrl,
          pageUrl: options.url,
          outputPath,
          signal: controller.signal,
          acceleration: options.acceleration,
          report: (data) => throttledProgress({
            taskId: options.taskId,
            url: options.url,
            status: 'downloading',
            ...data,
          }),
        })
        sendDownloadProgress({ taskId: options.taskId, url: options.url, percent: 100, status: 'completed' })
        return { filePath: outputPath }
      } catch {
        if (paused) return { filePath: outputPath, paused: true }
      } finally {
        if (activeDownloads.get(options.taskId) === entry) {
          activeDownloads.delete(options.taskId)
          clearProgressThrottle(options.taskId)
        }
        finish()
      }
    }

    const result = await runYtdlpDownload(options, outputDir)
    if (result.paused) return { filePath: result.filePath, paused: true }
    return { success: true, filePath: result.filePath }
  },

  'ytdlp:pauseDownload': args => pauseDownload(args[0] as string),

  // 依赖管理
  'deps:status': async args => {
    try {
      const status = await getRuntimeStatus({ ...sanitizeDepsSettings(args[0]), force: args[1] as boolean | undefined })
      return { success: true, status }
    } catch (e: any) {
      return { success: false, error: e?.message || '依赖检测失败' }
    }
  },
  'deps:check': async args => {
    try {
      invalidateStatus()
      const status = await getRuntimeStatus({ ...sanitizeDepsSettings(args[0]), force: true })
      return { success: true, status }
    } catch (e: any) {
      return { success: false, error: e?.message || '依赖检测失败' }
    }
  },
  'deps:download': async args => {
    if (isDownloading()) return { success: false, error: '已有下载任务正在进行' }
    try {
      const result = await downloadDeps(
        { ...sanitizeDepsSettings(args[0]), only: (args[0] as any)?.only, force: (args[0] as any)?.force },
        progress => wsEventBus.emit('deps:progress', progress),
      )
      if (!result.ok) return { success: false, error: result.error || '依赖下载失败' }
      return { success: true, status: result.status }
    } catch (e: any) {
      return { success: false, error: e?.message || '依赖下载失败' }
    }
  },
  'deps:cancel': () => cancelDownload(),
  'deps:openDir': () => ({ success: true, path: getManagedDir() }),
  'deps:diagnostics': () => {
    const cached = cachedStatusSnapshot()
    return {
      success: true,
      platform: platformKey(),
      sidecar: getSidecarPath(),
      managedDir: getManagedDir(),
      deps: cached?.results ?? [],
      checkedAt: cached?.checkedAt ?? null,
    }
  },

  // 历史
  'history:get': () => localHistory(readHistory()),
  'history:add': args => {
    const history = readHistory()
    const record = args[0] as any
    if (typeof record?.filePath !== 'string' || !fileExists(record.filePath)) {
      throw new Error('下载文件不存在，无法加入历史')
    }
    const { id: _id, createdAt: _createdAt, fileExists: _fileExists, ...details } = record
    const trimmed = upsertHistory(history, details, randomUUID(), new Date().toISOString())
    writeHistory(trimmed)
    notifyHistoryUpdated(trimmed)
    return true
  },
  'history:delete': args => {
    const history = readHistory().filter((h: any) => h.id !== args[0])
    writeHistory(history)
    notifyHistoryUpdated(history)
    return true
  },

  // 应用与系统环境
  'app:getVersion': () => APP_VERSION,
  'app:getDefaultDownloadDir': () => DOWNLOADS_DIR,
  'app:getHomeDir': () => os.homedir(),
  'app:cookieStatus': args => getCookieStatus(args[0] as string | undefined),
  'app:fetchImage': args => fetchImage(args[0] as string, args[1] as string),
  'app:getLog': () => readLog(),
  'app:clearLog': () => {
    try {
      const logPath = getLogPath()
      if (fs.existsSync(logPath)) fs.writeFileSync(logPath, '', 'utf8')
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e?.message || '清空日志失败' }
    }
  },
  'app:openLogDir': () => ({ success: true, path: path.dirname(getLogPath()) }),
  'app:getDiskSpace': args => getDiskSpace(args[0] as string | undefined),

  // Web 专属降级处理
  'clipboard:readText': () => null,
  'clipboard:writeText': () => undefined,
  'dialog:selectFolder': () => DOWNLOADS_DIR,
  'dialog:selectFile': () => null,
  'shell:openPath': () => ({ success: false, error: 'web' }),
  'shell:showItemInFolder': () => ({ success: false, error: 'web' }),
  'shell:openExternal': () => undefined,
  'app:setProxy': () => true,
  'app:testProxy': async () => ({ success: true, latency: 10 }),
  // 容器版的更新检查：查最新版本 + 给出「拉镜像并重建」的命令。
  //
  // 桌面版走 electron-updater 下载安装包并静默替换；容器里进程跑在镜像的
  // 只读层上，自更新会在下次 docker run 时消失 —— 所以这里只回答
  // 「有没有新版本」与「怎么升级」，绝不执行任何写操作。
  'app:checkForUpdates': async args => {
    const state = await checkContainerUpdate(args[0])
    return {
      hasUpdate: state.hasUpdate,
      version: state.latestVersion ?? undefined,
      currentVersion: state.currentVersion,
      // 容器版没有「自动安装」这条路（manual 恒为 true）：
      // 前端据此展示升级命令，而不是「下载更新 / 重启安装」按钮
      manual: true,
      manualReason: '容器版通过更新镜像升级，不能在容器内自更新',
      container: state,
      error: state.error ?? undefined,
    }
  },
  // 设置里同步过来的更新源：只记下来，下次检查时用
  'app:setUpdatePrefs': args => {
    const prefs = (args[0] || {}) as { source?: unknown; autoCheck?: unknown }
    if (prefs.source !== undefined) updateSource = prefs.source
    if (typeof prefs.autoCheck === 'boolean') autoCheck = prefs.autoCheck
    return true
  },
  'app:downloadUpdate': () => ({ success: false, error: '容器版请通过更新镜像升级（docker compose pull）' }),
  'app:installUpdate': () => ({ success: false, error: '容器版请通过更新镜像升级（docker compose pull）' }),
  'app:containerInfo': () => containerInfo(),
  'window:minimize': () => undefined,
  'window:maximize': () => undefined,
  'window:close': () => undefined,
  'window:isMaximized': () => false,
}

// ===== 静态文件服务 =====
const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  let filePath = path.join(STATIC_DIR, path.normalize(url.pathname).replace(/^([.][.][/\\])+/, ''))
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(STATIC_DIR, 'index.html')
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404).end('DownVid WebUI 静态构建产物不存在，请先执行构建')
    return
  }
  const ext = path.extname(filePath).toLowerCase()
  res.writeHead(200, {
    'Content-Type': mimeTypes[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
  })
  fs.createReadStream(filePath).pipe(res)
}

// ===== HTTP 与 WebSocket 实例 =====
const server = http.createServer((req, res) => {
  if (req.url === '/healthz' || req.url?.startsWith('/healthz?')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    // 带上镜像名与仓库坐标：用户排障时把这一行贴出来就够了，
    // 不用再去问「你装的是哪个镜像、什么版本」
    res.end(JSON.stringify({ ok: true, ...containerInfo() }))
    return
  }
  serveStatic(req, res)
})

const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: (info, callback) => {
    const origin = info.req.headers.origin
    const host = info.req.headers.host
    if (!isAllowedOrigin(origin, host)) {
      console.warn(`[web:security] 拦截到来自跨站的未经授权 WebSocket 连接请求: Origin=${origin}`)
      callback(false, 403, 'Forbidden: Cross-origin WebSocket connection rejected')
      return
    }
    callback(true)
  },
})

const sockets = new Set<WebSocket>()

// 将业务事件总线广播推向所有在线 Web 客户端
for (const channel of ['download:progress', 'deps:progress', 'history:updated'] as const) {
  wsEventBus.on(channel, data => {
    const message = JSON.stringify({ event: channel, data })
    for (const ws of sockets) {
      if (ws.readyState === ws.OPEN) ws.send(message)
    }
  })
}

wss.on('connection', ws => {
  sockets.add(ws)
  ws.on('close', () => sockets.delete(ws))
  ws.on('message', async raw => {
    let request: { id?: number; channel?: string; args?: unknown[] }
    try {
      request = JSON.parse(String(raw))
    } catch {
      ws.send(JSON.stringify({ id: null, error: '消息不是合法 JSON' }))
      return
    }
    const { id, channel } = request
    const handler = channel ? channels[channel] : undefined
    if (!handler) {
      ws.send(JSON.stringify({ id, error: `未知通道：${channel}` }))
      return
    }
    try {
      const result = await handler(request.args || [])
      ws.send(JSON.stringify({ id, result }))
    } catch (e: any) {
      ws.send(JSON.stringify({ id, error: e?.message || String(e) }))
    }
  })
})

fs.mkdirSync(DOWNLOADS_DIR, { recursive: true })
fs.mkdirSync(DATA_DIR, { recursive: true })

server.listen(PORT, HOST, () => {
  console.log(`[web] DownVid ${APP_VERSION} WebUI 服务已启动：http://${HOST}:${PORT}/`)
  console.log(`[web] 下载保存目录：${DOWNLOADS_DIR}`)

  // 启动 5 秒后检查一次更新：容器版用户往往一装就是几个月，
  // 而 yt-dlp 落后会随站点改版逐渐失效 —— 没有提示时用户只会觉得「下载器坏了」。
  // 延迟是为了不和首屏、以及并发的依赖探测抢带宽。
  // 用 setInterval 而不是只在启动时查：长期运行的容器同样需要知道有新版本。
  if (autoCheck) {
    setTimeout(() => { void broadcastUpdateCheck() }, 5000)
    setInterval(() => { void broadcastUpdateCheck() }, UPDATE_CHECK_INTERVAL)
  }
})

export { server, isAllowedOrigin }
