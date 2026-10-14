import { spawn, execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { resolveDependency, getFfmpegLocation, checkJsRuntime } from '../utils/binary'
import { getCookieAttempts, runWithCookies, cookieFailureHint } from '../utils/cookies'
import { getExtractorArgs, promptNodeDownload } from '../parsers/ytdlp'
import { activeDownloads } from '../store'
import { sendDownloadProgress, throttledProgress, clearProgressThrottle, formatBytes, formatEta } from './progress'
import { accelerationConnections, normalizeAcceleration, type AccelerationSettings } from '../../shared/acceleration'
import { detectAria2 } from './aria2'
import { parseAria2Progress } from './aria2-progress'

/**
 * yt-dlp 下载路径。
 *
 * 与直链路径（./direct.ts）完全独立：这里把 UI 的选择翻译成 yt-dlp 参数，
 * 再从 yt-dlp 的结构化进度输出里解析进度与最终文件路径。
 */

/** 结构化进度输出，替代对人类可读文本的正则抓取 */
const PROGRESS_PREFIX = '[dvp]'
const POSTPROCESS_PREFIX = '[dvpp]'
const FILE_PREFIX = '[dvfile]'
const SUBS_PREFIX = '[dvsubs]'

const PROGRESS_TEMPLATE = `download:${PROGRESS_PREFIX}%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress.fragment_index)s|%(progress.fragment_count)s`
const POSTPROCESS_TEMPLATE = `postprocess:${POSTPROCESS_PREFIX}%(progress.postprocessor)s|%(progress.status)s`

/**
 * 分块请求的大小。
 *
 * 与 10M / 25M 都实测过，两者都远快于不分块（0.16 MB/s → 5 MB/s 量级），
 * 区间内的差异主要是网络波动。取 10M：足以打断限速节奏，又不会因为分块过多
 * 而在慢速站点上增加额外往返。
 */
const HTTP_CHUNK_SIZE = '10M'

/** 解析结果缓存的 info JSON 有效期：超过后媒体直链可能已过期，改为重新提取 */
const INFO_JSON_TTL = 20 * 60 * 1000

const num = (v: string) => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

export interface DownloadOptions {
  url: string; formatId: string; outputDir: string; filename?: string; taskId: string
  directUrl?: string; cookiesFile?: string; downloadMode?: 'video' | 'audio' | 'subtitle'
  audioTrack?: any; subtitles?: string[]; filenameTemplate?: string; proxy?: string
  cacheFile?: string; hasAudio?: boolean
  acceleration?: AccelerationSettings
}

/**
 * 组装 format selector。
 *
 * 已含音轨的格式直接下载；否则合并最佳音轨，找不到可合并的音轨时退回该格式本身
 * （旧逻辑在无 m4a 音轨时会退化成 `bestaudio`，只下载到纯音频）。
 */
export function buildFormatSelector(options: DownloadOptions): string {
  if (options.downloadMode === 'audio') return options.formatId
  if (options.audioTrack?.isM3u8) return options.audioTrack.formatId
  if (options.hasAudio) return `${options.formatId}/bv*+ba/b`
  const audio = options.audioTrack?.language ? `bestaudio[language^=${options.audioTrack.language}]` : 'bestaudio[ext=m4a]'
  return `${options.formatId}+${audio}/${options.formatId}+bestaudio/${options.formatId}/bv*+ba/b`
}

/** 缓存的 info JSON 是否还新鲜 */
function useInfoJson(cacheFile?: string): boolean {
  if (!cacheFile) return false
  try { return Date.now() - fs.statSync(cacheFile).mtimeMs < INFO_JSON_TTL } catch { return false }
}

/** 清理 yt-dlp 中断留下的分片/临时文件 */
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

/**
 * 组装 yt-dlp 参数。
 *
 * 单独导出是为了可测试：格式选择、字幕模式、音频转换的差异都只体现在这里，
 * 而不必真的起一个进程去验证。
 */
export interface JsRuntime {
  path: string
  kind: 'node' | 'deno'
  name: string
}

/**
 * 组装参数时用到的外部状态。
 *
 * 依赖工具的路径与 JS 运行时都由调用方解析好再传进来：
 * buildYtdlpArgs 保持纯函数，便于直接断言参数列表，不必真的起进程。
 */
export interface BuildArgsContext {
  aria2Path?: string | null
  /** yt-dlp 的 --ffmpeg-location，空字符串表示不需要（字幕模式或未解析到） */
  ffmpegLocation: string
  /** YouTube 需要的 JS 运行时；null 表示非 YouTube 或无需指定 */
  jsRuntime: JsRuntime | null
}

export function buildYtdlpArgs(options: DownloadOptions, outputDir: string, ctx: BuildArgsContext): string[] {
  const isSubtitleOnly = options.downloadMode === 'subtitle'
  const isAudioOnly = options.downloadMode === 'audio'
  const isYoutube = options.url.includes('youtube.com') || options.url.includes('youtu.be')
  const connections = accelerationConnections(options.acceleration)
  const userTemplate = options.filenameTemplate || '%(title)s'
  const completeTemplate = userTemplate.includes('%(ext)') ? userTemplate : `${userTemplate}.%(ext)s`
  const useAria2 = !isSubtitleOnly && connections > 1 && !!ctx.aria2Path
  const outputTemplate = useAria2 ? completeTemplate : path.join(outputDir, completeTemplate)

  const args: string[] = [
    '-o', outputTemplate, '--no-playlist', '--playlist-items', '1', '--encoding', 'utf-8',
    // --print 隐含 --quiet，用 --progress 保留进度输出，最终路径由 after_move 精确给出
    '--newline', '--progress', '--progress-template', PROGRESS_TEMPLATE, '--progress-template', POSTPROCESS_TEMPLATE,
    // 字幕模式没有视频文件，改为输出字幕信息（语言代码可能含 '-'，不能直接写进字段路径）
    '--print', isSubtitleOnly ? `after_move:${SUBS_PREFIX}%(requested_subtitles)j` : `after_move:${FILE_PREFIX}%(filepath)s`,
    // HLS/DASH 分片并发下载（仅对分片流生效，对单个 mp4 直链无效）
    '--concurrent-fragments', String(connections),
    // 分块请求：规避"单连接被限速"。
    //
    // 这一步是下载速度的关键。YouTube 等站点的 CDN 会对长连接限速，同一个
    // 17.6MB 文件实测：单连接 109 秒（0.16 MB/s），加上本参数后 3~5 秒
    // （约 5 MB/s），**快 30 倍以上**。原理是把一个长请求拆成多个短请求。
    //
    // 注意 --concurrent-fragments 解决不了这个问题：它只作用于 HLS/DASH 分片，
    // 而那些站点给的往往是单个 mp4 直链，走的是单连接。
    //
    // 对不支持 Range 的服务器会自动退化为普通下载（已实测），因此不需要按站点开关。
    '--http-chunk-size', HTTP_CHUNK_SIZE,
  ]

  // 传目录而不是文件路径：yt-dlp 会在该目录里同时找 ffmpeg 与 ffprobe
  if (ctx.ffmpegLocation) args.push('--ffmpeg-location', ctx.ffmpegLocation)

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

  if (useAria2) {
    // 仅 HTTP 使用 aria2；直播/HLS/DASH 仍由 yt-dlp 处理鉴权、分片和合并。
    args.push('--downloader', `http:${ctx.aria2Path}`, '--downloader', 'dash,m3u8:native',
      '--downloader-args', `aria2c:--no-conf=true --max-connection-per-server=${connections} --split=${connections} --min-split-size=1M --file-allocation=none --max-tries=3 --retry-wait=2 --connect-timeout=15 --timeout=30 --auto-save-interval=1 --check-certificate=true --enable-color=false --human-readable=false --truncate-console-readout=false --summary-interval=1`)
    // 隔离 aria2 稀疏片段；更换引擎时不能被原生顺序下载器误认为连续数据。
    args.push('--paths', `home:${outputDir}`, '--paths', `temp:${path.join(outputDir, '.downvid-aria2')}`)
  }

  if (isYoutube && ctx.jsRuntime) {
    // 用显式的 kind 而不是从路径猜：Electron 的路径里没有 "node"，
    // 靠 includes('node') 会把它误标成 deno（实测会拉起一整个应用）
    args.push('--js-runtimes', `${ctx.jsRuntime.kind}:${ctx.jsRuntime.path}`)
  }

  args.push(...getExtractorArgs(options.url))
  return args
}

/** 从 yt-dlp 的一行输出里解析进度/事件，喂给 UI */
function handleLine(line: string, options: DownloadOptions, state: { downloadedFile: string; hasStarted: boolean }) {
  const aria2 = parseAria2Progress(line)
  if (aria2) {
    state.hasStarted = true
    throttledProgress({ taskId: options.taskId, url: options.url, status: 'downloading',
      percent: aria2.total > 0 ? Math.min(99, aria2.downloaded / aria2.total * 100) : 0,
      totalSize: formatBytes(aria2.total), speed: aria2.speed > 0 ? `${formatBytes(aria2.speed)}/s` : '',
      eta: aria2.speed > 0 ? formatEta((aria2.total - aria2.downloaded) / aria2.speed) : '' })
  } else if (line.startsWith(PROGRESS_PREFIX)) {
    const [downloadedStr, totalStr, estimateStr, speedStr, etaStr, fragIdxStr, fragCountStr] = line.slice(PROGRESS_PREFIX.length).split('|')
    const done = num(downloadedStr)
    const total = num(totalStr) || num(estimateStr)
    const fragCount = num(fragCountStr)
    const percent = total > 0 ? (done / total) * 100 : fragCount > 0 ? (num(fragIdxStr) / fragCount) * 100 : 0
    const speed = num(speedStr)
    state.hasStarted = true
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
    state.downloadedFile = path.resolve(line.slice(FILE_PREFIX.length).trim())
  } else if (line.startsWith(SUBS_PREFIX)) {
    try {
      const subs = JSON.parse(line.slice(SUBS_PREFIX.length)) || {}
      const wanted = options.subtitles?.find(lang => subs[lang]?.filepath)
      const sub = wanted ? subs[wanted] : Object.values<any>(subs).find(s => s?.filepath)
      if (sub?.filepath) state.downloadedFile = path.resolve(sub.filepath)
    } catch {}
  }
}

export interface YtdlpRunResult {
  code: number | null
  stderr: string
  failedBrowsers: string[]
  filePath: string
  paused: boolean
}

/**
 * 执行一次 yt-dlp 下载。
 *
 * 进度同时来自 stdout（download）与 stderr（quiet 模式下 postprocess），两路都按行解析。
 * 优先用解析阶段缓存下来的 info JSON 跳过二次提取；若在尚未开始下载时失败
 * （如直链过期），回退为按 URL 重新提取。
 */
const taskAria2Paths = new Map<string, string | null>()

export async function runYtdlpDownload(options: DownloadOptions, outputDir: string): Promise<YtdlpRunResult> {
  let paused = false
  let finish!: () => void
  const preparing = { options, status: 'pending', abort: () => { paused = true }, stopped: new Promise<void>(resolve => { finish = resolve }) }
  activeDownloads.set(options.taskId, preparing)
  try {
    return await executeYtdlpDownload(options, outputDir, () => paused)
  } catch (e) {
    if (paused) return pausedYtdlpResult()
    throw e
  } finally {
    if (activeDownloads.get(options.taskId) === preparing) activeDownloads.delete(options.taskId)
    finish()
  }
}

function pausedYtdlpResult(): YtdlpRunResult {
  return { code: null, stderr: '', failedBrowsers: [], filePath: '', paused: true }
}

async function executeYtdlpDownload(options: DownloadOptions, outputDir: string, preparationPaused: () => boolean): Promise<YtdlpRunResult> {
  const ytdlpPath = await resolveDependency('yt-dlp')
  if (preparationPaused()) return pausedYtdlpResult()
  if (!ytdlpPath) throw new Error('未找到可用的 yt-dlp')

  const isSubtitleOnly = options.downloadMode === 'subtitle'
  const isYoutube = options.url.includes('youtube.com') || options.url.includes('youtu.be')

  // 打包应用也必须使用独立且受支持的 Node/Deno，不能把 Electron 当成 CLI。
  let jsRuntime: JsRuntime | null = null
  if (isYoutube) {
    const runtime = await checkJsRuntime()
    if (preparationPaused()) return pausedYtdlpResult()
    if (!runtime.available) {
      await promptNodeDownload()
      throw new Error('需要可运行的 Node.js 22+ 或 Deno 2.3+')
    }
    if (runtime.path && runtime.kind) jsRuntime = { path: runtime.path, kind: runtime.kind, name: runtime.name }
  }

  const acceleration = normalizeAcceleration(options.acceleration)
  if (!taskAria2Paths.has(options.taskId)) {
    const status = acceleration.enabled && acceleration.maxConnections > 1 && !isSubtitleOnly
      ? await detectAria2(acceleration.aria2Path) : null
    taskAria2Paths.set(options.taskId, status?.path || null)
  }
  const aria2Path = taskAria2Paths.get(options.taskId)
  if (preparationPaused()) return pausedYtdlpResult()
  // 同一任务暂停期间不切换引擎：aria2 的稀疏 .part 不能交给顺序下载器续传。
  if (aria2Path && !fs.existsSync(aria2Path)) throw new Error('续传需要原 aria2c，请恢复该程序后重试')

  const args = buildYtdlpArgs(options, outputDir, {
    ffmpegLocation: isSubtitleOnly ? '' : getFfmpegLocation(),
    jsRuntime,
    aria2Path,
  })
  const state = { downloadedFile: '', hasStarted: false }
  let isPaused = false

  const runOnce = (source: string[], cookieArgs: string[]) => new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    if (preparationPaused() || isPaused) { isPaused = true; resolve({ code: null, stderr: '' }); return }
    const child = spawn(ytdlpPath, [...args, ...cookieArgs, ...source], { cwd: path.dirname(ytdlpPath) })
    let stderr = ''

    activeDownloads.set(options.taskId, { child, options, status: 'downloading', setPaused: (v: boolean) => { isPaused = v } })

    const lineReader = () => {
      let pending = ''
      return {
        push: (text: string) => {
          const lines = (pending + text).split(/\r\n|\r|\n/)
          pending = lines.pop() || ''
          lines.forEach(l => handleLine(l, options, state))
          if (parseAria2Progress(pending)) { handleLine(pending, options, state); pending = '' }
        },
        flush: () => { if (pending) handleLine(pending, options, state); pending = '' },
      }
    }
    const out = lineReader()
    const err = lineReader()

    child.stdout.on('data', (data: Buffer) => out.push(data.toString()))
    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString()
      err.push(text)
      stderr += text
      // 只留尾部：失败时用于提取 ERROR 行，无需保留全部输出
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
      result = await runWithCookies(cookieAttempts(), (cookieArgs) => runOnce(['--load-info-json', options.cacheFile!], cookieArgs))
      if (result.code !== 0 && !isPaused && !state.hasStarted) {
        result = await runWithCookies(cookieAttempts(), (cookieArgs) => runOnce([options.url], cookieArgs))
      }
    } else {
      result = await runWithCookies(cookieAttempts(), (cookieArgs) => runOnce([options.url], cookieArgs))
    }
  } finally {
    activeDownloads.delete(options.taskId)
    clearProgressThrottle(options.taskId)
    if (!isPaused) taskAria2Paths.delete(options.taskId)
  }

  const { code, stderr, failedBrowsers } = result

  if (isPaused) {
    return { code, stderr, failedBrowsers, filePath: state.downloadedFile, paused: true }
  }

  if (code !== 0) {
    const errorLines = stderr.split('\n').filter((l: string) => l.trim())
    const lastError = [...errorLines].reverse().find(l => l.startsWith('ERROR:'))?.trim()
      || errorLines[errorLines.length - 1]?.trim() || ''
    if (lastError.includes('429') || lastError.includes('Too Many Requests')) {
      throw new Error('请求过于频繁，请等待几分钟后重试 (HTTP 429)')
    }
    // 去掉 yt-dlp 自己的前缀，只保留原因——完整的那串对用户没有信息量
    // （形如 `ERROR: unable to download video data: HTTP Error 403: Forbidden`）
    const reason = lastError
      .replace(/^ERROR:\s*/i, '')
      .replace(/^unable to download video data:\s*/i, '')
      .trim()
    throw new Error((reason || '下载失败') + cookieFailureHint(failedBrowsers))
  }

  if (state.downloadedFile) cleanupLeftovers(state.downloadedFile)
  sendDownloadProgress({ taskId: options.taskId, url: options.url, percent: 100, status: 'completed' })

  return { code, stderr, failedBrowsers, filePath: state.downloadedFile, paused: false }
}

/** 暂停：杀掉子进程（Windows 需连带子进程树），任务从活动表移除 */
export async function pauseDownload(taskId: string): Promise<boolean> {
  const download = activeDownloads.get(taskId)
  if (download?.abort) {
    download.abort()
    await download.stopped
    return true
  }
  if (download?.child) {
    if (download.setPaused) download.setPaused(true)
    const child = download.child
    if (child.exitCode !== null || child.signalCode !== null) return true
    // Windows 必须先杀整个树：先杀父进程会让 taskkill 丢失 PyInstaller 子进程。
    const stopped = new Promise<boolean>(resolve => {
      child.once('close', () => resolve(true))
      child.once('error', () => resolve(false))
    })
    if (process.platform === 'win32' && child.pid) {
      execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
        ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, (error) => {
          if (error && child.exitCode === null) child.kill()
        })
    } else child.kill()
    return stopped
  }
  return false
}
