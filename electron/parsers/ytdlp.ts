import { spawn } from 'node:child_process'
import path from 'node:path'
import { resolveDependency, checkJsRuntime, cachedVersionOf } from '../utils/binary'
import { getCookieAttempts, runWithCookies, cookieFailureHint, isCookieError } from '../utils/cookies'
import { classifyParseError, parseDiagnostic, PARSE_MESSAGES } from '../../shared/parse-error'
import { nextYoutubeRetry, youtubeExtractorArgs, type YoutubeRetryState } from './youtube-retry'
import { isTwitterUrl } from '../utils/platform'
import { LANG_NAMES } from '../constants'
import { buildVideoFormats } from './formats'
import fs from 'node:fs'
import os from 'node:os'

// 解析结果缓存
const PARSE_CACHE_VERSION = 5
const parseCache = new Map<string, { data: any; time: number; ver: number }>()
const PARSE_CACHE_TTL = 30 * 60 * 1000

/**
 * 解析缓存的**条数上限**。
 *
 * 只按 TTL 清理是不够的：每个条目都持有一份完整的 info JSON（YouTube 的长视频
 * 可以到几 MB），而「粘贴一批链接逐个看」是很常见的用法。没有上限时，
 * 30 分钟内解析 200 个链接就会把几百 MB 的 JSON 一直留在主进程内存里——
 * Electron 主进程一旦吃满，整个界面开始卡顿，而用户完全看不出是缓存导致的。
 *
 * 60 条 ≈ 覆盖一次批量浏览，再多就淘汰最旧的。
 */
const PARSE_CACHE_MAX = 60

/**
 * 缓存里条目对应的临时 info JSON 路径，用于进程退出时统一清理。
 *
 * 这些文件写进 `os.tmpdir()`（下载时 `--load-info-json` 要用），
 * 原先只在「缓存过期」时删 —— 但应用退出、或用户解析完不再下载时都不会触发，
 * 于是 `/tmp` 里会慢慢堆积几十上百个 `downvid-*.json`（每个几百 KB）。
 * 系统重启前不会回收，长期运行的机器上是真实占用。
 */
const tempInfoFiles = new Set<string>()

/** 退出/异常时清掉自己写的临时文件（只删本次进程写过的，不碰别人的） */
export function cleanupTempInfoFiles(): void {
  for (const file of tempInfoFiles) {
    try { fs.rmSync(file, { force: true }) } catch {}
  }
  tempInfoFiles.clear()
}

// 解析成功时额外使用的 extractor 参数（如 X/Twitter 回退到 syndication 接口），下载时沿用
const extractorArgsByUrl = new Map<string, string[]>()
export function getExtractorArgs(url: string): string[] {
  return extractorArgsByUrl.get(url) || []
}

function buildBaseArgs(isYoutube: boolean): string[] {
  const args = [
    '--ignore-config', '--no-playlist', '--playlist-items', '1', '--no-check-certificates', '--quiet',
    '--socket-timeout', '10', '--extractor-retries', '1',
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    '--add-header', 'Accept-Language:en-US,en;q=0.9',
  ]
  if (!isYoutube) args.push('--no-warnings')
  return args
}

function applyProxy(args: string[], proxy?: string) {
  if (proxy) args.push('--proxy', proxy)
}

async function runYtdlp(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  // 依赖不随包分发：解析前先确认 yt-dlp 存在，缺失时抛出可引导下载的错误
  const ytdlpPath = await resolveDependency('yt-dlp')
  // resolveDependency 在 required=true 时不会返回 null；这里显式兜一次让类型收敛
  if (!ytdlpPath) throw new Error('未找到可用的 yt-dlp')
  return new Promise((resolve, reject) => {
    const child = spawn(ytdlpPath, args, { cwd: path.dirname(ytdlpPath), windowsHide: true, timeout: args.includes('--version') ? 3000 : 90000 })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    child.on('close', (code, signal) => resolve({ code: code ?? 1, stdout, stderr: signal ? 'Connection timed out' : stderr }))
    child.on('error', () => reject(new Error('无法启动 yt-dlp，请检查运行依赖')))
  })
}

// 完整解析：拿格式列表
export async function parseWithYtdlp(url: string, cookiesFile?: string, proxy?: string): Promise<any> {
  const cacheKey = `${url}|${cookiesFile || ''}|${proxy || ''}`
  const cached = parseCache.get(cacheKey)
  if (cached && cached.ver === PARSE_CACHE_VERSION && Date.now() - cached.time < PARSE_CACHE_TTL) {
    return cached.data
  }

  // 直接使用 CLI（自带 yt-dlp 二进制），不启动常驻 daemon：避免常驻 Python 内存占用与版本不一致
  return parseViaCli(url, cookiesFile, proxy, cacheKey)
}

function cleanupCache() {
  for (const [key, val] of parseCache) {
    if (val.ver !== PARSE_CACHE_VERSION || Date.now() - val.time > PARSE_CACHE_TTL) {
      parseCache.delete(key)
      if (val.data?.cacheFile) {
        tempInfoFiles.delete(val.data.cacheFile)
        fs.rm(val.data.cacheFile, { force: true }, () => {})
      }
    }
  }
}

async function dumpInfo(url: string, cookiesFile: string | undefined, proxy: string | undefined, extraArgs: string[]) {
  const isYoutube = url.includes('youtube.com') || url.includes('youtu.be')
  const base = [...buildBaseArgs(isYoutube), '--dump-json', ...extraArgs]
  applyProxy(base, proxy)
  const runtime = isYoutube ? await checkJsRuntime() : null
  if (runtime && (!runtime.available || !runtime.path || !runtime.kind)) {
    throw new Error('[[parse-error:runtime-unavailable]]' + PARSE_MESSAGES['runtime-unavailable'])
  }
  if (runtime?.path && runtime.kind) base.push('--js-runtimes', `${runtime.kind}:${runtime.path}`)
  // 版本号**不在这里单独跑一次 `--version`**：
  // yt-dlp 的 PyInstaller 构建每次启动要 8~10 秒（解压 72MB 到临时目录），
  // 为了拿一个「诊断里才有用」的版本号多付一次启动，等于把解析时间翻倍。
  //
  // 但版本号**不是可选项**：`nextYoutubeRetry` 用它选兼容客户端
  // （2026.10.10 起 `default,web_embedded`，更早 `web_safari`）。
  // 曾经这里写成 `const version = ''`，于是新版本分支永远不可达、回退静默退化。
  // 现在从**依赖探测缓存**里读 —— 边车的 `detect` 早就执行过 `--version`
  // 并把结果一并返回（`Result.Version`，60 秒缓存），读它是 0 代价。
  //
  // 必须**惰性**读：首次解析时缓存可能还是冷的，而 `runYtdlp` 里的
  // `resolveDependency` 会把它填好。放到重试决策那一刻读，缓存一定已热。
  const versionOf = () => (isYoutube ? cachedVersionOf('yt-dlp') : '')
  let state: YoutubeRetryState = { manifests: false, client: '' }
  let retries = 0
  const run = await runWithCookies(getCookieAttempts(cookiesFile), async (cookieArgs) => {
    let result = await runYtdlp([...base, ...(isYoutube ? youtubeExtractorArgs(state) : []), ...cookieArgs, url])
    // 重试在同一次 Cookie 生命周期内完成；临时快照尚未清理，登录来源不变。
    while (isYoutube && result.code !== 0 && retries < 2 && !isCookieError(result.stderr)) {
      const next = nextYoutubeRetry(result.stderr, state, versionOf())
      if (!next) break
      state = next
      retries++
      result = await runYtdlp([...base, ...youtubeExtractorArgs(state), ...cookieArgs, url])
    }
    return result
  })
  return { ...run, state, version: versionOf(), runtimeVersion: runtime?.version && runtime.kind ? `${runtime.kind}@${runtime.version}` : '' }
}

/**
 * 读取 yt-dlp 版本号（带 5 分钟缓存）。
 *
 * 只在**出错**与诊断场景调用：每次都 spawn 一次 yt-dlp 要 8~10 秒，
 * 正常解析路径上拿它没有收益。缓存是为了连续解析多次失败时不重复付这个代价。
 */
let ytdlpVersionCache: { value: string; at: number } | null = null
const YTDLP_VERSION_TTL = 5 * 60 * 1000

export async function readYtdlpVersion(): Promise<string> {
  if (ytdlpVersionCache && Date.now() - ytdlpVersionCache.at < YTDLP_VERSION_TTL) {
    return ytdlpVersionCache.value
  }
  const run = await runYtdlp(['--ignore-config', '--version'])
  const value = run.code === 0 ? run.stdout.trim() : ''
  // 失败也缓存：否则一个「yt-dlp 跑不起来」的环境会在每次报错时白等 10 秒
  ytdlpVersionCache = { value, at: Date.now() }
  return value
}

async function parseViaCli(url: string, cookiesFile: string | undefined, proxy: string | undefined, cacheKey: string): Promise<any> {
  const isYoutube = url.includes('youtube.com') || url.includes('youtu.be')

  let extraArgs: string[] = []
  let run = await dumpInfo(url, cookiesFile, proxy, extraArgs)
  // X/Twitter 的 GraphQL 访客接口经常被限流或拒绝，回退到 syndication 接口（免登录）
  if (run.code !== 0 && isTwitterUrl(url)) {
    const fallbackArgs = ['--extractor-args', 'twitter:api=syndication']
    const fallback = await dumpInfo(url, cookiesFile, proxy, fallbackArgs)
    if (fallback.code === 0) { run = fallback; extraArgs = fallbackArgs }
  }
  if (run.code !== 0) {
    const kind = classifyParseError(run.stderr)
    // 失败路径才值得付一次 `--version` 的启动开销：Issue 里带版本号能省掉一轮来回问。
    // 成功路径不需要它（上面 dumpInfo 里刻意不再取）。
    const version = await readYtdlpVersion().catch(() => '')
    throw new Error(`[[parse-error:${kind}]]` + parseDiagnostic(run.stderr, { ytdlp: version, runtime: run.runtimeVersion }) + cookieFailureHint(run.failedBrowsers))
  }
  if (isYoutube && run.state.client) extraArgs = youtubeExtractorArgs(run.state)

  if (extraArgs.length) extractorArgsByUrl.set(url, extraArgs)
  else extractorArgsByUrl.delete(url)

  // 多视频推文等播放列表会逐行输出多个 JSON，只取第一个条目
  const output = run.stdout.split('\n').find(line => line.trim().startsWith('{')) || ''

  try {
    const info = JSON.parse(output)
    const formats = buildVideoFormats(info, isYoutube, run.state.manifests)

    // YouTube 多音轨
    const audioTracks: any[] = []
    if (isYoutube && info.formats) {
      const m3u8Best: Record<string, any> = {}
      for (const f of info.formats.filter((f: any) => f.protocol?.includes('m3u8') && f.language)) {
        const lang = f.language
        if (!lang) continue
        if (!m3u8Best[lang] || (f.height || 0) > (m3u8Best[lang].height || 0)) {
          m3u8Best[lang] = { formatId: f.format_id, lang, height: f.height || 0 }
        }
      }
      if (Object.keys(m3u8Best).length > 1) {
        for (const [lang, best] of Object.entries(m3u8Best)) {
          audioTracks.push({ id: lang, name: LANG_NAMES[lang] || lang.toUpperCase(), language: lang, formatId: best.formatId, isM3u8: true })
        }
      } else {
        const langBest: Record<string, any> = {}
        for (const f of info.formats.filter((f: any) => f.vcodec === 'none' && f.acodec && f.acodec !== 'none')) {
          const lang = f.language
          if (!lang) continue
          if (!langBest[lang] || (f.abr || 0) > (langBest[lang].abr || 0)) langBest[lang] = { formatId: f.format_id, lang, abr: f.abr || 0 }
        }
        for (const [lang, best] of Object.entries(langBest)) {
          audioTracks.push({ id: lang, name: LANG_NAMES[lang] || lang.toUpperCase(), language: lang, formatId: best.formatId })
        }
      }
    }

    const subtitles = Object.keys(info.subtitles || {}).map((lang: string) => {
      const sub = info.subtitles[lang]
      const first = Array.isArray(sub) ? sub[0] : sub
      return { language: lang, name: first?.name || lang, url: first?.url || '' }
    })

    const audioFormats = isYoutube && info.formats ? info.formats
      .filter((f: any) => f.vcodec === 'none' && f.acodec && f.acodec !== 'none')
      .map((f: any) => ({ formatId: f.format_id || '', quality: f.abr ? `${f.abr}kbps` : (f.format_note || '音频'), ext: f.ext || f.audio_ext || 'm4a', filesize: f.filesize || f.filesize_approx || 0, abr: f.abr || 0, acodec: f.acodec || '' }))
      .filter((f: any, i: number, self: any[]) => self.findIndex((t: any) => t.abr === f.abr) === i)
      .sort((a: any, b: any) => (b.abr || 0) - (a.abr || 0)).slice(0, 6) : []

    const result: any = {
      id: info.id || '', title: info.title || '未知标题', description: info.description || '',
      thumbnail: info.thumbnail || '', duration: info.duration || 0, uploader: info.uploader || '',
      webpageUrl: info.webpage_url || url, formats, audioTracks, subtitles, audioFormats, isYoutube,
      parseNotice: isYoutube && (run.state.manifests || run.state.client)
        ? '已通过兼容解析重试恢复；本次重试使用的 Cookie 来源未改变。' : '',
    }
    // 保存原始 info JSON：下载时用 --load-info-json 跳过 yt-dlp 二次提取
    try {
      result.cacheFile = path.join(os.tmpdir(), `downvid-${String(info.id || Date.now()).replace(/[^\w-]/g, '_')}.json`)
      fs.writeFileSync(result.cacheFile, output)
      tempInfoFiles.add(result.cacheFile)
    } catch {}
    parseCache.set(cacheKey, { data: result, time: Date.now(), ver: PARSE_CACHE_VERSION })
    cleanupCache()
    // 超过条数上限时淘汰最旧的。Map 保持插入顺序，所以第一条就是最旧的。
    while (parseCache.size > PARSE_CACHE_MAX) {
      const oldestKey = parseCache.keys().next().value
      if (oldestKey === undefined) break
      const removed = parseCache.get(oldestKey)
      parseCache.delete(oldestKey)
      if (removed?.data?.cacheFile) {
        tempInfoFiles.delete(removed.data.cacheFile)
        fs.rm(removed.data.cacheFile, { force: true }, () => {})
      }
    }
    return result
  } catch {
    throw new Error('[[parse-error:unknown]]解析响应格式无效')
  }
}

import { dialog, shell } from 'electron'

export async function promptNodeDownload(): Promise<void> {
  const result = await dialog.showMessageBox({
    type: 'info',
    title: '需要 Node.js 运行时',
    message: 'YouTube 视频解析需要 Node.js 运行时',
    detail: '点击"确定"将跳转到 Node.js 下载页面，请下载 Windows Installer (.msi) 版本并安装后重试。',
    buttons: ['确定', '取消'],
    defaultId: 0,
  })
  if (result.response === 0) {
    shell.openExternal('https://nodejs.org/zh-cn/download/package-manager')
  }
}

export async function promptChromeDownload(): Promise<void> {
  const result = await dialog.showMessageBox({
    type: 'info',
    title: '需要 Google Chrome 浏览器',
    message: '抖音/快手视频解析需要 Chrome 浏览器支持',
    detail: '点击"确定"将跳转到 Chrome 下载页面，请下载并安装 Chrome 后重试。',
    buttons: ['确定', '取消'],
    defaultId: 0,
  })
  if (result.response === 0) {
    shell.openExternal('https://www.google.com/chrome/')
  }
}
