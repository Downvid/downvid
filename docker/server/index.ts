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
}

function sanitizeDepsSettings(raw: any): DepsSettings {
  const manualPaths: Partial<Record<DepKind, string>> = {}
  const source = raw?.manualPaths || {}
  for (const kind of ['yt-dlp', 'ffmpeg', 'ffprobe'] as DepKind[]) {
    const value = source[kind]
    if (typeof value === 'string' && value.trim()) manualPaths[kind] = value.trim()
  }
  return { manualPaths, proxy: typeof raw?.proxy === 'string' ? raw.proxy : undefined }
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
  'app:checkForUpdates': () => ({ hasUpdate: false, currentVersion: APP_VERSION, downloadUrl: '' }),
  'app:setUpdatePrefs': () => true,
  'app:downloadUpdate': () => ({ success: false, error: '容器版请通过更新镜像升级' }),
  'app:installUpdate': () => ({ success: false, error: '容器版请通过更新镜像升级' }),
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
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, version: APP_VERSION }))
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
})

export { server, isAllowedOrigin }
