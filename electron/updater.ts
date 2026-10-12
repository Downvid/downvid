import { app, session } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import { spawn, execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { APP, GITHUB_API, HTTP_USER_AGENT, RELEASES_URL } from './constants'
import { broadcast } from './store'

// 更新流程：
// - Windows(NSIS) / Linux(AppImage、deb、rpm)：electron-updater
// - macOS：应用未签名，Squirrel.Mac 校验签名必然失败，改为自行下载 zip → 校验 sha512 →
//   解压 → 去除隔离属性并 ad-hoc 签名 → 退出后由辅助脚本替换 .app 并重启（失败自动回滚）
// - 其他安装方式（tar.gz、Windows 便携版、从 DMG 直接运行等）无法自动安装：
//   通过 GitHub API 检查版本，提示前往发布页手动下载

// electron-updater 内部请求所用的 session 分区名（electronHttpExecutor.NET_SESSION_NAME），
// 参数需与其一致：分区首次创建时的配置会被后续调用复用
const updaterSession = () => session.fromPartition('electron-updater', { cache: false })

const CHECK_TIMEOUT = 20_000

export interface CheckResult {
  hasUpdate: boolean
  version?: string
  currentVersion: string
  releaseNotes?: string
  releaseDate?: string
  downloadUrl: string
  /** 当前安装方式不支持自动安装，只能前往发布页手动下载 */
  manual?: boolean
  manualReason?: string
  error?: string
}

let latestInfo: UpdateInfo | null = null
let macDownloadedApp: string | null = null
let downloading: Promise<{ success: boolean; error?: string }> | null = null
let updaterReady = false

/**
 * 检查结果的缓存有效期。
 *
 * 用户可能反复点「检查更新」（或反复开关弹窗）。每次都发请求既浪费，
 * 也会撞上 GitHub 的限流；但缓存太久又可能错过刚发布的版本。
 * 用「新版本发布后强制刷新」+「窗口期复用结果」两个机制平衡：
 *   - 距上次检查 < 60 秒 → 直接复用，不发请求
 *   - 发现过更新但用户尚未升级 → 复用，避免同一个版本反复弹
 *   - 已是最新版本 → 60 秒后允许再查，这样新版本发布后最多等 1 分钟
 */
const CHECK_CACHE_MS = 60 * 1000
let lastCheckAt = 0
let lastCheckResult: CheckResult | null = null
let inflightCheck: Promise<CheckResult> | null = null

function sendStatus(data: Record<string, unknown>) {
  broadcast('update:status', data)
}

export function friendlyUpdateError(error: unknown): string {
  const msg = String((error as any)?.message || error || '')
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|net::ERR_|socket hang up|timed? ?out/i.test(msg)) {
    return '无法连接 GitHub，请检查网络，或在设置中配置代理后重试'
  }
  if (/sha512|checksum/i.test(msg)) return '安装包校验失败（可能下载不完整），请重试或前往发布页手动下载'
  if (/\b403\b|rate limit/i.test(msg)) return 'GitHub 请求过于频繁，请稍后再试'
  if (/\b404\b|Cannot find .*latest|No published versions|Unable to find latest/i.test(msg)) return '暂未找到可用的发布版本，请稍后再试'
  if (/ENOSPC/i.test(msg)) return '磁盘空间不足，无法下载更新'
  if (/EACCES|EPERM|permission|not permitted/i.test(msg)) return '没有写入权限，请前往发布页手动下载安装'
  return `更新失败：${msg.split('\n')[0].slice(0, 200) || '未知错误'}`
}

function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, '').split(/[.-]/).map(n => parseInt(n) || 0)
  const pa = parse(a), pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}

// ===== macOS =====

/** 当前运行的 .app 路径（非打包、DMG 内运行或被系统随机化转移时返回原因） */
function macAppBundle(): { bundle?: string; reason?: string } {
  const bundle = path.resolve(process.execPath, '..', '..', '..')
  if (!bundle.endsWith('.app')) return { reason: '未找到应用包路径' }
  if (bundle.includes('/AppTranslocation/')) {
    return { reason: '应用正在隔离环境中运行，请先将 DownVid 拖入“应用程序”文件夹后再更新' }
  }
  if (bundle.startsWith('/Volumes/')) return { reason: '请先将 DownVid 从安装镜像拖入“应用程序”文件夹后再更新' }
  return { bundle }
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 120_000 }, (err) => err ? reject(err) : resolve())
  })
}

/** 启动时移除自身 .app 的隔离属性，避免后续启动或更新时被 Gatekeeper 拦截（“已损坏”） */
export function stripOwnQuarantine() {
  if (process.platform !== 'darwin' || !app.isPackaged) return
  const { bundle } = macAppBundle()
  if (!bundle) return
  execFile('xattr', ['-dr', 'com.apple.quarantine', bundle], () => {})
}

async function downloadMacUpdate(info: UpdateInfo): Promise<void> {
  const isArm = process.arch === 'arm64'
  const file = info.files.find(f => f.url.endsWith('.zip') && f.url.includes('arm64') === isArm)
  if (!file) throw new Error(`发布版本中缺少 ${process.arch} 架构的安装包`)

  const workDir = path.join(app.getPath('userData'), 'pending-update')
  fs.rmSync(workDir, { recursive: true, force: true })
  fs.mkdirSync(workDir, { recursive: true })
  const zipPath = path.join(workDir, path.basename(file.url))

  const url = `${RELEASES_URL}/download/v${info.version}/${encodeURIComponent(file.url)}`
  // 与 electron-updater 使用同一 session，保证代理设置生效
  const response = await updaterSession().fetch(url)
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)

  const total = file.size || parseInt(response.headers.get('content-length') || '0')
  const hash = crypto.createHash('sha512')
  const writer = fs.createWriteStream(zipPath)
  const start = Date.now()
  let received = 0
  let lastSent = 0
  try {
    const reader = response.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
      received += value.length
      if (!writer.write(value)) await new Promise(r => writer.once('drain', r))
      const now = Date.now()
      if (now - lastSent > 300) {
        lastSent = now
        sendStatus({
          status: 'downloading',
          percent: total ? (received / total) * 100 : 0,
          speed: received / Math.max((now - start) / 1000, 0.001),
        })
      }
    }
  } finally {
    await new Promise<void>(resolve => writer.end(() => resolve()))
  }

  if (file.sha512 && hash.digest('base64') !== file.sha512) throw new Error('sha512 checksum mismatch')

  const extractDir = path.join(workDir, 'app')
  await run('ditto', ['-x', '-k', zipPath, extractDir])
  fs.rmSync(zipPath, { force: true })
  const appName = fs.readdirSync(extractDir).find(n => n.endsWith('.app'))
  if (!appName) throw new Error('安装包中未找到应用')
  const newApp = path.join(extractDir, appName)

  // 去除隔离属性；重新 ad-hoc 签名，保证 Apple Silicon 上可以启动（失败不影响安装）
  await run('xattr', ['-dr', 'com.apple.quarantine', newApp]).catch(() => {})
  await run('codesign', ['--force', '--deep', '--sign', '-', newApp]).catch(() => {})
  macDownloadedApp = newApp
}

function shellQuote(s: string) {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

function installMacUpdate() {
  const { bundle, reason } = macAppBundle()
  if (!bundle) throw new Error(reason)
  if (!macDownloadedApp || !fs.existsSync(macDownloadedApp)) throw new Error('更新文件不存在，请重新下载')

  const logFile = path.join(app.getPath('userData'), 'update-install.log')
  const script = path.join(os.tmpdir(), `downvid-update-${Date.now()}.sh`)
  // 等待应用退出 → 备份旧版本 → 复制新版本 → 去除隔离属性 → 重启；复制失败则回滚
  fs.writeFileSync(script, `#!/bin/bash
PID="$1"; NEW_APP="$2"; TARGET="$3"; BACKUP="$3.downvid-old"
for _ in $(seq 1 240); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
echo "[$(date)] installing $NEW_APP -> $TARGET"
rm -rf "$BACKUP"
if mv "$TARGET" "$BACKUP" && ditto "$NEW_APP" "$TARGET"; then
  xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
  rm -rf "$BACKUP" "$(dirname "$NEW_APP")"
  echo "installed"
else
  echo "install failed, rolling back"
  rm -rf "$TARGET"
  mv "$BACKUP" "$TARGET"
fi
open "$TARGET"
rm -f "$0"
`, { mode: 0o755 })

  const command = `/bin/bash ${[script, String(process.pid), macDownloadedApp, bundle].map(shellQuote).join(' ')} >> ${shellQuote(logFile)} 2>&1`
  let writable = true
  try { fs.accessSync(path.dirname(bundle), fs.constants.W_OK); fs.accessSync(bundle, fs.constants.W_OK) } catch { writable = false }

  const child = writable
    ? spawn('/bin/bash', ['-c', command], { detached: true, stdio: 'ignore' })
    // 应用目录不可写（如由其他管理员账户安装）时请求管理员权限
    : spawn('osascript', ['-e', `do shell script ${JSON.stringify(command)} with administrator privileges`], { detached: true, stdio: 'ignore' })
  child.unref()
  setTimeout(() => app.quit(), 300)
}

// ===== 通用 =====

/** 当前安装方式不支持自动安装的原因；支持则返回 undefined */
function unsupportedReason(): string | undefined {
  if (!app.isPackaged) return '开发模式不支持自动更新'
  if (process.platform === 'darwin') return macAppBundle().reason
  if (process.platform === 'win32' && process.env.PORTABLE_EXECUTABLE_DIR) return '便携版不支持自动更新，请前往发布页下载新版本'
  if (process.platform === 'linux') {
    const packageType = (() => {
      try { return fs.readFileSync(path.join(process.resourcesPath, 'package-type'), 'utf8').trim() } catch { return '' }
    })()
    if (!process.env.APPIMAGE && !['deb', 'rpm'].includes(packageType)) return '当前安装方式（tar.gz）不支持自动更新，请前往发布页下载新版本'
  }
  return undefined
}

async function checkViaGitHubApi(): Promise<{ version: string; releaseNotes: string; releaseDate: string }> {
  const response = await updaterSession().fetch(
    `${GITHUB_API}/repos/${APP.owner}/${APP.repo}/releases/latest`,
    { headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': HTTP_USER_AGENT } },
  )
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json()
  return { version: String(data.tag_name || '').replace(/^v/, ''), releaseNotes: data.body || '', releaseDate: data.published_at || '' }
}

export async function checkForUpdates(): Promise<CheckResult> {
  const currentVersion = app.getVersion()
  const base = { currentVersion, downloadUrl: RELEASES_URL }
  const reason = unsupportedReason()

  // 短时间内重复点击「检查更新」时复用结果，不再发包：
  // 既避免 GitHub 限流，也避免同一个新版本反复弹窗。
  if (lastCheckResult && Date.now() - lastCheckAt < CHECK_CACHE_MS) {
    return { ...lastCheckResult, currentVersion }
  }

  // 并发调用（弹窗打开 + 关于页按钮同时触发）合并为一次请求
  if (inflightCheck) return inflightCheck

  inflightCheck = (async (): Promise<CheckResult> => {
  try {
    if (reason) {
      if (!app.isPackaged) return { ...base, hasUpdate: false }
      const latest = await withTimeout(checkViaGitHubApi(), CHECK_TIMEOUT)
      const hasUpdate = compareVersions(latest.version, currentVersion) > 0
      if (hasUpdate) sendStatus({ status: 'available', version: latest.version, releaseNotes: latest.releaseNotes, manual: true, manualReason: reason })
      return { ...base, hasUpdate, ...latest, manual: true, manualReason: reason }
    }

    const result = await withTimeout(autoUpdater.checkForUpdates(), CHECK_TIMEOUT)
    if (!result) return { ...base, hasUpdate: false }
    latestInfo = result.updateInfo
    const hasUpdate = result.isUpdateAvailable ?? compareVersions(result.updateInfo.version, currentVersion) > 0
    return {
      ...base,
      hasUpdate,
      version: result.updateInfo.version,
      releaseNotes: typeof result.updateInfo.releaseNotes === 'string' ? result.updateInfo.releaseNotes : '',
      releaseDate: result.updateInfo.releaseDate,
    }
  } catch (error) {
    return { ...base, hasUpdate: false, error: friendlyUpdateError(error) }
  }
  })()

  try {
    const result = await inflightCheck
    lastCheckAt = Date.now()
    lastCheckResult = result
    return result
  } finally {
    inflightCheck = null
  }
}

export function downloadUpdate(): Promise<{ success: boolean; error?: string }> {
  // 防止重复点击触发并行下载
  if (downloading) return downloading
  downloading = (async () => {
    try {
      if (process.platform === 'darwin') {
        if (!latestInfo) throw new Error('请先检查更新')
        await downloadMacUpdate(latestInfo)
        sendStatus({ status: 'downloaded', version: latestInfo.version })
      } else {
        await autoUpdater.downloadUpdate()
      }
      // 下载成功后清掉检查缓存：否则短时间内再点「检查更新」会按旧结果
      // 继续提示有新版本，而这版其实已经下载好了
      lastCheckResult = null
      lastCheckAt = 0
      return { success: true }
    } catch (error) {
      const message = friendlyUpdateError(error)
      sendStatus({ status: 'error', message })
      return { success: false, error: message }
    } finally {
      downloading = null
    }
  })()
  return downloading
}

export function installUpdate(): { success: boolean; error?: string } {
  try {
    if (process.platform === 'darwin') installMacUpdate()
    // 静默安装并在完成后自动重启
    else autoUpdater.quitAndInstall(true, true)
    return { success: true }
  } catch (error) {
    return { success: false, error: friendlyUpdateError(error) }
  }
}

export function setupAutoUpdater() {
  // 幂等：main.ts 在多个时机可能调用它，重复注册会累积监听器
  if (updaterReady) return
  updaterReady = true

  // 由用户确认后再下载；Windows/Linux 已下载的更新在退出时自动安装
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    sendStatus({ status: 'available', version: info.version, releaseNotes: info.releaseNotes || '' })
  })
  autoUpdater.on('download-progress', (progress) => {
    sendStatus({ status: 'downloading', percent: progress.percent, speed: progress.bytesPerSecond })
  })
  autoUpdater.on('update-downloaded', (info) => {
    sendStatus({ status: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    // 检查阶段的错误由 checkForUpdates 的返回值处理，这里只转发下载阶段的错误
    if (downloading) sendStatus({ status: 'error', message: friendlyUpdateError(err) })
  })
}

/** 与默认 session 同步代理设置（electron-updater 使用独立分区，默认不走用户配置的代理） */
export async function setUpdaterProxy(proxy: string) {
  await updaterSession().setProxy({ proxyRules: proxy || '' })
}
