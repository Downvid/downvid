import { ipcMain, BrowserWindow } from 'electron'
import { spawn, exec } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { resolveDependency, getFfmpegLocation, checkJsRuntime } from '../utils/binary'
import { getCookieAttempts, runWithCookies, cookieFailureHint } from '../utils/cookies'
import { isDouyinUrl, isKuaishouUrl, ensureDownloadDir } from '../utils/platform'
import { parseDouyinWithAPI, parseDouyinWithPuppeteer } from '../parsers/douyin'
import { parseKuaishouWithAPI, parseKuaishouWithPuppeteer } from '../parsers/kuaishou'
import { parseWithYtdlp, promptNodeDownload, getExtractorArgs } from '../parsers/ytdlp'
import { activeDownloads } from '../store'

function sendDownloadProgress(data: any) {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) win.webContents.send('download:progress', data)
  })
}

// 进度更新节流：每个 taskId 最多每 200ms 发送一次 IPC
const progressThrottles = new Map<string, number>()
function throttledProgress(data: any) {
  const now = Date.now()
  const last = progressThrottles.get(data.taskId) || 0
  if (now - last < 200) return
  progressThrottles.set(data.taskId, now)
  sendDownloadProgress(data)
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`
}

// ===== 直链下载（抖音/快手解析出的 CDN 地址）=====

const DIRECT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const DIRECT_SEGMENTS = 4
const DIRECT_MIN_SEGMENT = 2 * 1024 * 1024
const DIRECT_RETRIES = 3

function directHeaders(pageUrl: string, extra: Record<string, string> = {}) {
  const referer = isKuaishouUrl(pageUrl) ? 'https://www.kuaishou.com/' : 'https://www.douyin.com/'
  return { 'User-Agent': DIRECT_UA, 'Referer': referer, ...extra }
}

// 探测是否支持 Range 以及文件总大小
async function probeDirect(url: string, pageUrl: string, signal: AbortSignal) {
  try {
    const res = await fetch(url, { headers: directHeaders(pageUrl, { Range: 'bytes=0-0' }), signal })
    const total = parseInt(res.headers.get('content-range')?.split('/')[1] || '0')
    await res.body?.cancel()
    return { rangeSupported: res.status === 206 && total > 0, total }
  } catch (e) {
    if (signal.aborted) throw e
    return { rangeSupported: false, total: 0 }
  }
}

async function downloadDirectFile(url: string, pageUrl: string, outputPath: string, taskId: string, signal: AbortSignal): Promise<void> {
  const startTime = Date.now()
  let downloaded = 0
  let total = 0
  let lastSent = 0

  const report = (force = false) => {
    const now = Date.now()
    if (!force && now - lastSent < 500) return
    lastSent = now
    const elapsed = (now - startTime) / 1000
    const speed = elapsed > 0 ? downloaded / elapsed : 0
    sendDownloadProgress({
      taskId, url: pageUrl, status: 'downloading',
      percent: total > 0 ? (downloaded / total) * 100 : 0,
      totalSize: formatBytes(total),
      speed: speed > 0 ? `${formatBytes(speed)}/s` : '',
      eta: speed > 0 && total > 0 ? formatEta((total - downloaded) / speed) : '',
    })
  }

  sendDownloadProgress({ taskId, url: pageUrl, percent: 0, status: 'downloading', speed: '', eta: '计算中...' })

  const probe = await probeDirect(url, pageUrl, signal)
  total = probe.total
  const tempPath = `${outputPath}.part`

  // 单连接流式下载：遵守写入背压，避免大文件把内存撑爆
  async function singleStream() {
    const res = await fetch(url, { headers: directHeaders(pageUrl), signal })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    total = total || parseInt(res.headers.get('content-length') || '0')
    const writer = fs.createWriteStream(tempPath)
    try {
      const reader = res.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        downloaded += value.length
        if (!writer.write(value)) await new Promise(r => writer.once('drain', r))
        report()
      }
    } finally {
      await new Promise<void>((resolve, reject) => writer.end((err?: Error | null) => err ? reject(err) : resolve()))
    }
  }

  // 多连接分段下载：CDN 常对单连接限速，分段并行可成倍提速
  async function segmented() {
    const segmentCount = Math.max(1, Math.min(DIRECT_SEGMENTS, Math.floor(total / DIRECT_MIN_SEGMENT)))
    const segmentSize = Math.ceil(total / segmentCount)
    const handle = await fs.promises.open(tempPath, 'w')
    try {
      await handle.truncate(total)
      await Promise.all(Array.from({ length: segmentCount }, async (_, i) => {
        const start = i * segmentSize
        const end = Math.min(total, start + segmentSize) - 1
        let offset = start
        for (let attempt = 0; ; attempt++) {
          try {
            const res = await fetch(url, { headers: directHeaders(pageUrl, { Range: `bytes=${offset}-${end}` }), signal })
            if (res.status !== 206 || !res.body) throw new Error(`HTTP ${res.status}`)
            const reader = res.body.getReader()
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              await handle.write(value, 0, value.length, offset)
              offset += value.length
              downloaded += value.length
              report()
            }
            if (offset <= end) throw new Error('分段数据不完整')
            return
          } catch (e) {
            // 断点续传：从本段已写入的位置重试
            if (signal.aborted || attempt >= DIRECT_RETRIES) throw e
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
          }
        }
      }))
    } finally {
      await handle.close()
    }
  }

  try {
    if (probe.rangeSupported && total >= DIRECT_MIN_SEGMENT * 2) await segmented()
    else await singleStream()
    fs.renameSync(tempPath, outputPath)
  } catch (e) {
    fs.rmSync(tempPath, { force: true })
    throw e
  }

  report(true)
  sendDownloadProgress({ taskId, url: pageUrl, percent: 100, status: 'completed' })
}

// ===== yt-dlp 下载 =====

// 结构化进度输出，替代对人类可读文本的正则抓取
const PROGRESS_PREFIX = '[dvp]'
const POSTPROCESS_PREFIX = '[dvpp]'
const FILE_PREFIX = '[dvfile]'
const SUBS_PREFIX = '[dvsubs]'
const PROGRESS_TEMPLATE = `download:${PROGRESS_PREFIX}%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress.fragment_index)s|%(progress.fragment_count)s`
const POSTPROCESS_TEMPLATE = `postprocess:${POSTPROCESS_PREFIX}%(progress.postprocessor)s|%(progress.status)s`

// 解析结果缓存的 info JSON 有效期：超过后媒体直链可能已过期，改为重新提取
const INFO_JSON_TTL = 20 * 60 * 1000

const num = (v: string) => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

interface DownloadOptions {
  url: string; formatId: string; outputDir: string; filename?: string; taskId: string
  directUrl?: string; cookiesFile?: string; downloadMode?: 'video' | 'audio' | 'subtitle'
  audioTrack?: any; subtitles?: string[]; filenameTemplate?: string; proxy?: string
  cacheFile?: string; hasAudio?: boolean
}

function buildFormatSelector(options: DownloadOptions): string {
  if (options.downloadMode === 'audio') return options.formatId
  if (options.audioTrack?.isM3u8) return options.audioTrack.formatId
  // 已含音轨的格式直接下载；否则合并最佳音轨，找不到可合并的音轨时退回该格式本身
  // （旧逻辑在无 m4a 音轨时会退化成 `bestaudio`，只下载到纯音频）
  if (options.hasAudio) return `${options.formatId}/bv*+ba/b`
  const audio = options.audioTrack?.language ? `bestaudio[language^=${options.audioTrack.language}]` : 'bestaudio[ext=m4a]'
  return `${options.formatId}+${audio}/${options.formatId}+bestaudio/${options.formatId}/bv*+ba/b`
}

function useInfoJson(cacheFile?: string): boolean {
  if (!cacheFile) return false
  try { return Date.now() - fs.statSync(cacheFile).mtimeMs < INFO_JSON_TTL } catch { return false }
}

function cleanupLeftovers(filePath: string) {
  const dir = path.dirname(filePath)
  const base = path.basename(filePath).replace(/\.[^.]+$/, '')
  try {
    for (const file of fs.readdirSync(dir)) {
      if (file.startsWith(base) && /\.(part|ytdl)$|\.part-Frag\d+$/.test(file)) {
        fs.rmSync(path.join(dir, file), { force: true })
      }
    }
  } catch {}
}

export function registerDownloadIpc() {
  ipcMain.handle('ytdlp:parse', async (_event, ...args) => {
    const url = args[0] as string
    const cookiesFile = args[1] as string | undefined
    const proxy = args[2] as string | undefined

    try {
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
    } catch (e: any) {
      throw new Error(e?.message || '解析失败，请检查链接是否有效')
    }
  })

  ipcMain.handle('ytdlp:download', async (_event, options: DownloadOptions) => {
    const outputDir = ensureDownloadDir(options.outputDir)

    if (options.directUrl) {
      const filename = options.filename || `video_${Date.now()}.mp4`
      const outputPath = path.join(outputDir, filename)
      const controller = new AbortController()
      let paused = false
      activeDownloads.set(options.taskId, { abort: () => { paused = true; controller.abort() }, options, status: 'downloading' })
      try {
        await downloadDirectFile(options.directUrl, options.url, outputPath, options.taskId, controller.signal)
        return { filePath: outputPath }
      } catch {
        if (paused) return { filePath: outputPath, paused: true }
        // 直链失败时回退到 yt-dlp
      } finally {
        activeDownloads.delete(options.taskId)
      }
    }

    // 依赖不再随包分发，下载前先确认 yt-dlp / ffmpeg 可用
    const ytdlpPath = await resolveDependency('yt-dlp')
    const isAudioOnly = options.downloadMode === 'audio'
    const isSubtitleOnly = options.downloadMode === 'subtitle'
    // 字幕模式不需要 ffmpeg；其余模式缺失时给出可引导下载的报错
    const ffmpegLocation = isSubtitleOnly ? '' : getFfmpegLocation()
    if (!isSubtitleOnly && !ffmpegLocation) {
      await resolveDependency('ffmpeg')
    }

    const isYoutube = options.url.includes('youtube.com') || options.url.includes('youtu.be')
    const userTemplate = options.filenameTemplate || '%(title)s'
    const outputTemplate = path.join(outputDir, `${userTemplate}.%(ext)s`)

    const args: string[] = [
      '-o', outputTemplate, '--no-playlist', '--playlist-items', '1', '--encoding', 'utf-8',
      // --print 隐含 --quiet，用 --progress 保留进度输出，最终路径由 after_move 精确给出
      '--newline', '--progress', '--progress-template', PROGRESS_TEMPLATE, '--progress-template', POSTPROCESS_TEMPLATE,
      // 字幕模式没有视频文件，改为输出字幕信息（语言代码可能含 '-'，不能直接写进字段路径）
      '--print', isSubtitleOnly ? `after_move:${SUBS_PREFIX}%(requested_subtitles)j` : `after_move:${FILE_PREFIX}%(filepath)s`,
      // HLS/DASH 分片并发下载
      '--concurrent-fragments', '8',
    ]
    // 传目录而不是文件路径：yt-dlp 会在该目录里同时找 ffmpeg 与 ffprobe
    if (ffmpegLocation) args.push('--ffmpeg-location', ffmpegLocation)

    if (isSubtitleOnly) {
      args.push('--skip-download', '--write-subs', '--sub-langs', options.subtitles?.join(',') || 'all', '--convert-subs', 'srt')
    } else {
      args.unshift('-f', buildFormatSelector(options))
      if (isAudioOnly) {
        args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0', '--postprocessor-args', 'FFmpegMetadata:-write_id3v1 1')
      } else {
        args.push('--merge-output-format', 'mp4')
      }
      if (options.subtitles?.length) {
        args.push('--write-subs', '--sub-langs', options.subtitles.join(','), '--convert-subs', 'srt')
      }
    }
    if (options.proxy) args.push('--proxy', options.proxy)

    if (isYoutube) {
      const runtimeCheck = checkJsRuntime()
      if (!runtimeCheck.available) { await promptNodeDownload(); throw new Error('需要安装 Node.js') }
      if (runtimeCheck.path) {
        const isNode = runtimeCheck.path.includes('node')
        args.push('--js-runtimes', `${isNode ? 'node' : 'deno'}:${runtimeCheck.path}`)
      }
    }
    args.push(...getExtractorArgs(options.url))

    let isPaused = false
    let downloadedFile = ''
    let hasStarted = false

    // 单次运行 yt-dlp；source 为 URL 或 --load-info-json 参数
    const runOnce = (source: string[], cookieArgs: string[]) => new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      const child = spawn(ytdlpPath!, [...args, ...cookieArgs, ...source], { cwd: path.dirname(ytdlpPath!) })
      let stderr = ''

      activeDownloads.set(options.taskId, { child, options, status: 'downloading', setPaused: (v: boolean) => { isPaused = v } })

      const handleLine = (line: string) => {
        if (line.startsWith(PROGRESS_PREFIX)) {
          const [downloadedStr, totalStr, estimateStr, speedStr, etaStr, fragIdxStr, fragCountStr] = line.slice(PROGRESS_PREFIX.length).split('|')
          const done = num(downloadedStr)
          const total = num(totalStr) || num(estimateStr)
          const fragCount = num(fragCountStr)
          const percent = total > 0 ? (done / total) * 100 : fragCount > 0 ? (num(fragIdxStr) / fragCount) * 100 : 0
          const speed = num(speedStr)
          hasStarted = true
          throttledProgress({
            taskId: options.taskId, url: options.url, status: 'downloading',
            percent: Math.min(percent, 100),
            totalSize: formatBytes(total),
            speed: speed > 0 ? `${formatBytes(speed)}/s` : '',
            eta: etaStr && etaStr !== 'NA' ? formatEta(num(etaStr)) : '',
          })
        } else if (line.startsWith(POSTPROCESS_PREFIX)) {
          const [processor, status] = line.slice(POSTPROCESS_PREFIX.length).split('|')
          if (status === 'started' && /Merger/i.test(processor)) {
            sendDownloadProgress({ taskId: options.taskId, url: options.url, percent: 99, status: 'merging', message: '正在合并音视频...' })
          } else if (status === 'started' && /ExtractAudio/i.test(processor)) {
            sendDownloadProgress({ taskId: options.taskId, url: options.url, percent: 99, status: 'merging', message: '正在转换音频...' })
          }
        } else if (line.startsWith(FILE_PREFIX)) {
          downloadedFile = path.resolve(line.slice(FILE_PREFIX.length).trim())
        } else if (line.startsWith(SUBS_PREFIX)) {
          try {
            const subs = JSON.parse(line.slice(SUBS_PREFIX.length)) || {}
            const wanted = options.subtitles?.find(lang => subs[lang]?.filepath)
            const sub = wanted ? subs[wanted] : Object.values<any>(subs).find(s => s?.filepath)
            if (sub?.filepath) downloadedFile = path.resolve(sub.filepath)
          } catch {}
        }
      }

      // download 进度走 stdout；quiet 模式（--print 隐含）下 postprocess 进度走 stderr，两路都按行解析
      const lineReader = () => {
        let pending = ''
        return {
          push: (text: string) => {
            const lines = (pending + text).split(/\r?\n/)
            pending = lines.pop() || ''
            lines.forEach(handleLine)
          },
          flush: () => { if (pending) handleLine(pending); pending = '' },
        }
      }
      const out = lineReader()
      const err = lineReader()

      child.stdout.on('data', (data: Buffer) => out.push(data.toString()))
      child.stderr.on('data', (data: Buffer) => {
        const text = data.toString()
        err.push(text)
        stderr += text
        if (stderr.length > 20000) stderr = stderr.slice(-20000)
      })
      child.on('close', (code) => {
        out.flush()
        err.flush()
        resolve({ code, stderr })
      })
      child.on('error', reject)
    })

    sendDownloadProgress({ taskId: options.taskId, url: options.url, percent: 0, status: 'downloading', speed: '', eta: '' })

    // 复用解析时的 cookie 快照，与解析保持一致且省去浏览器解密
    const cookieAttempts = () => getCookieAttempts(options.cookiesFile, true)
    let result: { code: number | null; stderr: string; failedBrowsers: string[] }
    try {
      if (!isSubtitleOnly && useInfoJson(options.cacheFile)) {
        // 直接使用解析得到的 info JSON，跳过 yt-dlp 二次提取（YouTube 可省 5~15 秒）
        result = await runWithCookies(cookieAttempts(), (cookieArgs) => runOnce(['--load-info-json', options.cacheFile!], cookieArgs))
        // 直链过期等原因失败且尚未开始下载时，回退为重新提取
        if (result.code !== 0 && !isPaused && !hasStarted) {
          result = await runWithCookies(cookieAttempts(), (cookieArgs) => runOnce([options.url], cookieArgs))
        }
      } else {
        result = await runWithCookies(cookieAttempts(), (cookieArgs) => runOnce([options.url], cookieArgs))
      }
    } finally {
      activeDownloads.delete(options.taskId)
      progressThrottles.delete(options.taskId)
    }

    if (isPaused) return { filePath: downloadedFile, paused: true }

    if (result.code !== 0) {
      const errorLines = result.stderr.split('\n').filter((l: string) => l.trim())
      const lastError = [...errorLines].reverse().find(l => l.startsWith('ERROR:'))?.trim() || errorLines[errorLines.length - 1]?.trim() || ''
      if (lastError.includes('429') || lastError.includes('Too Many Requests')) {
        throw new Error('请求过于频繁，请等待几分钟后重试 (HTTP 429)')
      }
      throw new Error((lastError || '下载失败') + cookieFailureHint(result.failedBrowsers))
    }

    if (downloadedFile) cleanupLeftovers(downloadedFile)

    sendDownloadProgress({ taskId: options.taskId, url: options.url, percent: 100, status: 'completed' })
    return { success: true, filePath: downloadedFile }
  })

  ipcMain.handle('ytdlp:pauseDownload', async (_, taskId: string) => {
    const download = activeDownloads.get(taskId)
    if (download?.abort) {
      download.abort()
      return true
    }
    if (download?.child) {
      if (download.setPaused) download.setPaused(true)
      download.child.kill()
      if (process.platform === 'win32' && download.child.pid) {
        exec(`taskkill /pid ${download.child.pid} /T /F`, () => {})
      }
      return true
    }
    return false
  })
}
