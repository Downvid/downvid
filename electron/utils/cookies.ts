import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getInstalledBrowsers } from './browser'

// yt-dlp cookie 策略：
// 直接 --cookies-from-browser 在浏览器运行时常失败（Windows 下 Chrome 锁库 / App-Bound 加密、
// macOS 钥匙串等），且一旦失败整个解析/下载都会报错。这里按顺序尝试多个 cookie 来源，
// 并把成功读取的浏览器 cookie 导出为快照，供后续下载直接复用（也省去每次解密的耗时）。

export interface CookieAttempt {
  label: string
  /** 真正执行这次尝试时才调用，返回 yt-dlp 的 cookie 参数 */
  prepare: () => string[]
  /** yt-dlp 成功结束后调用 */
  onSuccess: () => void
  /** 本次尝试因 cookie 读取失败而放弃时调用 */
  onCookieFailure: () => void
  /** 无论成败都要调用，清理临时文件 */
  cleanup: () => void
}

const SNAPSHOT_FRESH_MS = 30 * 60 * 1000
const BROWSER_FAILURE_TTL_MS = 10 * 60 * 1000

let lastGoodBrowser = ''
const browserFailures = new Map<string, number>()

// 不能命名为 cookies：macOS/Windows 文件系统不区分大小写，会与 Chromium 在 userData 下的
// Cookies 数据库文件冲突（mkdir 报 EEXIST，issue #31）
const COOKIE_DIR_NAME = 'ytdlp-cookies'
let legacyMigrated = false

// v1.2.0 在区分大小写的 Linux 上会创建 userData/cookies 目录，迁移其中的快照后删除。
// 只处理目录：在 macOS/Windows 上该路径指向 Chromium 的 Cookies 文件，绝不能动
function migrateLegacyDir(target: string) {
  if (legacyMigrated) return
  legacyMigrated = true
  const legacy = path.join(app.getPath('userData'), 'cookies')
  try {
    if (!fs.statSync(legacy).isDirectory()) return
    const oldSnapshot = path.join(legacy, 'browser-cookies.txt')
    const newSnapshot = path.join(target, 'browser-cookies.txt')
    if (fs.existsSync(oldSnapshot) && !fs.existsSync(newSnapshot)) fs.renameSync(oldSnapshot, newSnapshot)
    fs.rmSync(legacy, { recursive: true, force: true })
  } catch {}
}

/**
 * 当前 Cookie 的可用状态，供渲染进程判断"要不要提示用户去配置 Cookie"。
 *
 * 此前界面只按 URL 域名就弹出"需要 Cookie"——即使用户已经配好、
 * 甚至上次解析就成功读到了登录态，仍然提示。这里给出真实依据。
 */
export interface CookieStatus {
  /** 用户是否已手动指定 cookies.txt */
  manual: boolean
  /** 已有快照（自动读取成功过），以及它有多旧 */
  hasSnapshot: boolean
  snapshotAgeMs: number | null
  /** 最近一次成功读取到 Cookie 的浏览器 */
  lastGoodBrowser: string
  /** 目前已安装、可供尝试的浏览器 */
  availableBrowsers: string[]
}

export function getCookieStatus(manualFile?: string): CookieStatus {
  const manual = !!manualFile && fs.existsSync(manualFile)
  const age = snapshotAge()
  return {
    manual,
    hasSnapshot: age !== null,
    snapshotAgeMs: age,
    lastGoodBrowser,
    availableBrowsers: getInstalledBrowsers(),
  }
}

/** cookie 工作目录；userData 下不可用时退回系统临时目录，都不可用返回 null（不导出快照） */
function cookieDir(): string | null {
  const candidates = [
    path.join(app.getPath('userData'), COOKIE_DIR_NAME),
    path.join(os.tmpdir(), `downvid-${COOKIE_DIR_NAME}`),
  ]
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true })
      if (!fs.statSync(dir).isDirectory()) continue
      migrateLegacyDir(dir)
      return dir
    } catch {}
  }
  return null
}

function snapshotPath(): string | null {
  const dir = cookieDir()
  return dir && path.join(dir, 'browser-cookies.txt')
}

function tempPath(tag: string): string | null {
  const dir = cookieDir()
  return dir && path.join(dir, `tmp-${tag}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`)
}

function removeQuietly(file: string | null) {
  if (!file) return
  try { fs.rmSync(file, { force: true }) } catch {}
}

function snapshotAge(): number | null {
  const snapshot = snapshotPath()
  if (!snapshot) return null
  try { return Date.now() - fs.statSync(snapshot).mtimeMs } catch { return null }
}

// yt-dlp 退出时会把 cookie 写回 --cookies 指定的文件，并发任务共用同一文件会互相覆盖，
// 所以每次运行都使用快照的独立副本
function snapshotAttempt(label: string): CookieAttempt {
  const copy = tempPath('snap')
  return {
    label,
    prepare: () => {
      const snapshot = snapshotPath()
      if (!snapshot || !copy) return []
      try { fs.copyFileSync(snapshot, copy); return ['--cookies', copy] } catch { return [] }
    },
    onSuccess: () => {},
    onCookieFailure: () => {},
    cleanup: () => removeQuietly(copy),
  }
}

function browserAttempt(browser: string): CookieAttempt {
  // 与 --cookies-from-browser 同时指定一个尚不存在的 --cookies 文件，yt-dlp 退出时会把读到的
  // 浏览器 cookie 写入该文件，成功后原子替换为快照
  // 工作目录不可用时只读取浏览器 cookie，不导出快照
  const exported = tempPath(browser)
  return {
    label: browser,
    prepare: () => exported
      ? ['--cookies-from-browser', browser, '--cookies', exported]
      : ['--cookies-from-browser', browser],
    onSuccess: () => {
      lastGoodBrowser = browser
      browserFailures.delete(browser)
      const snapshot = snapshotPath()
      if (!exported || !snapshot) return
      try {
        if (fs.statSync(exported).size > 0) {
          fs.renameSync(exported, snapshot)
          if (process.platform !== 'win32') fs.chmodSync(snapshot, 0o600)
        }
      } catch {}
    },
    onCookieFailure: () => {
      browserFailures.set(browser, Date.now())
      if (lastGoodBrowser === browser) lastGoodBrowser = ''
    },
    cleanup: () => removeQuietly(exported),
  }
}

const noCookies = (): CookieAttempt => ({
  label: 'none', prepare: () => [], onSuccess: () => {}, onCookieFailure: () => {}, cleanup: () => {},
})

/**
 * 生成按顺序尝试的 cookie 来源。
 * - 手动模式：用户导入的 cookies.txt → 无 cookie
 * - 自动模式（解析）：各浏览器（上次成功的优先）→ 快照 → 无 cookie
 * - 自动模式（下载，preferSnapshot）：新鲜快照 → 各浏览器 → 旧快照 → 无 cookie
 *   解析刚刷新过快照，下载直接复用可保证两者 cookie 一致，并跳过浏览器解密
 */
export function getCookieAttempts(manualFile?: string, preferSnapshot = false): CookieAttempt[] {
  if (manualFile && fs.existsSync(manualFile)) {
    return [{ ...noCookies(), label: 'manual', prepare: () => ['--cookies', manualFile] }, noCookies()]
  }

  const attempts: CookieAttempt[] = []
  const age = snapshotAge()
  const fresh = age !== null && age < SNAPSHOT_FRESH_MS

  if (preferSnapshot && fresh) attempts.push(snapshotAttempt('snapshot'))

  const now = Date.now()
  const browsers = getInstalledBrowsers()
    .filter(b => now - (browserFailures.get(b) || 0) > BROWSER_FAILURE_TTL_MS)
    .sort((a, b) => Number(b === lastGoodBrowser) - Number(a === lastGoodBrowser))
  attempts.push(...browsers.map(browserAttempt))

  if (age !== null && !(preferSnapshot && fresh)) attempts.push(snapshotAttempt('snapshot'))
  attempts.push(noCookies())
  return attempts
}

// 只认 cookie 加载阶段的错误；YouTube 的 "Use --cookies-from-browser or --cookies for the
// authentication" 属于需要登录，不是读取失败，换 cookie 来源没有意义
const COOKIE_ERROR_PATTERNS = [
  /could not (?:find|copy) \S+ cookie/i,
  /failed to (?:decrypt|load cookies)/i,
  /cookies? database/i,
  /keyring|keychain|secretstorage|kwallet/i,
  /unsupported (?:browser|keyring)/i,
  /database is locked|unable to open database/i,
  // 浏览器目录下最新的那个 Cookies 文件不是可读的 Cookie 库（空库、不是 SQLite、拷贝时损坏）时，
  // yt-dlp 只打出 sqlite3 的原始异常，例如 `ERROR: no such table: meta`（issue #53）。
  // 以前没有这条，整个解析就以这句报错告终，后面的浏览器、快照和「不带 Cookie」都轮不到。
  // yt-dlp 只在读浏览器 Cookie 时用 SQLite，这类报错不会来自别处
  /no such table|is not a database|database disk image is malformed/i,
  /netscape format|invalid (?:length|expires)/i,
  // 权限类失败：macOS 上读 Safari 的 cookie 需要「完全磁盘访问」权限，
  // 报错形如 `ERROR: [Errno 1] Operation not permitted: '.../Cookies.binarycookies'`。
  // 以前没有这条，于是整个解析会以"读取失败"告终，而不是退到下一个浏览器来源。
  /operation not permitted/i,
  // yt-dlp 读浏览器 cookie 目录时的其他文件系统错误；命中后同样换来源即可
  /(?:permission denied|access is denied)\b/i,
  // Safari 的 binarycookies 容器在沙箱外不可读，同样属于换来源能解决的问题
  /binarycookies/i,
  /could not (?:find|open|read) (?:the )?\S* ?(?:cookie|profile|browser data)/i,
]

export function isCookieError(stderr: string): boolean {
  return stderr.split('\n').some(line =>
    line.startsWith('ERROR:')
    && !line.includes('--cookies-from-browser or --cookies')
    && COOKIE_ERROR_PATTERNS.some(p => p.test(line)))
}

const BROWSER_NAMES: Record<string, string> = {
  chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', safari: 'Safari', brave: 'Brave', chromium: 'Chromium',
}

/** 错误信息与提示之间的分隔标记，渲染进程据此拆分，避免提示文字干扰错误分类 */
export const COOKIE_HINT_MARKER = '\n\n提示：'

/**
 * 浏览器 Cookie 读取失败时给用户的解决建议（issue #9）。
 * Windows 上 Chrome/Edge 运行时数据库被锁定，且 Chrome 127 起启用 App-Bound 加密，基本无法读取
 */
export function cookieFailureHint(failedBrowsers: string[]): string {
  if (failedBrowsers.length === 0) return ''
  const names = failedBrowsers.map(b => BROWSER_NAMES[b] || b).join('、')
  const chromiumOnWindows = process.platform === 'win32'
    && failedBrowsers.some(b => ['chrome', 'edge', 'brave', 'chromium'].includes(b))
  return `${COOKIE_HINT_MARKER}未能读取 ${names} 的 Cookie，本次未携带登录信息。`
    + (chromiumOnWindows ? 'Windows 上 Chrome/Edge 运行时 Cookie 数据库被锁定且加密，无法读取。' : '')
    + '若视频需要登录才能访问：① 完全退出该浏览器后重试；'
    + (failedBrowsers.includes('firefox') ? '② 或改用其他浏览器登录该网站；' : '② 或使用 Firefox 登录该网站（其 Cookie 可随时读取）；')
    + '③ 或在“设置 → Cookies”中手动导入 cookies.txt。'
}

/**
 * 按 cookie 策略依次执行 yt-dlp，只有 cookie 读取失败才换下一个来源；
 * 其他错误（包括暂停导致的中断）直接返回，交给调用方处理。
 * 返回值附带本次 cookie 读取失败的浏览器，供生成错误提示
 */
export async function runWithCookies<R extends { code: number | null; stderr: string }>(
  attempts: CookieAttempt[],
  run: (cookieArgs: string[], attempt: CookieAttempt) => Promise<R>,
): Promise<R & { failedBrowsers: string[] }> {
  const failedBrowsers: string[] = []
  /**
   * 收尾并附带"哪些浏览器的 Cookie 没读到"。
   *
   * 只在**失败**时附带：Cookie 提示的用途是解释失败原因。此前成功时也附带，
   * 于是明明用其它来源（或 Cookie 快照）读到了登录态、解析也成功了，
   * 界面上仍会显示"未能读取 XX 的 Cookie"——给用户的感觉是自动读取坏了。
   */
  const finish = (r: R, succeeded: boolean) => {
    if (succeeded) return Object.assign(r, { failedBrowsers: [] as string[] })
    // 近期读取失败而被本次跳过的浏览器同样没有携带 Cookie，一并计入提示
    const now = Date.now()
    for (const [browser, time] of browserFailures) {
      if (now - time <= BROWSER_FAILURE_TTL_MS && !failedBrowsers.includes(browser)) failedBrowsers.push(browser)
    }
    return Object.assign(r, { failedBrowsers })
  }
  let result: R | undefined
  for (const attempt of attempts) {
    // cookie 准备阶段的任何异常只跳过该来源，绝不能让整个解析/下载失败
    let cookieArgs: string[]
    try {
      cookieArgs = attempt.prepare()
    } catch {
      attempt.cleanup()
      continue
    }
    try {
      result = await run(cookieArgs, attempt)
      if (result.code === 0) { attempt.onSuccess(); return finish(result, true) }
      if (!isCookieError(result.stderr)) return finish(result, false)
      attempt.onCookieFailure()
      if (BROWSER_NAMES[attempt.label]) failedBrowsers.push(attempt.label)
    } finally {
      attempt.cleanup()
    }
  }
  return finish(result ?? await run([], attempts[attempts.length - 1]), false)
}
