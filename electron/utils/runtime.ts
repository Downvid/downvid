import { app } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// ===== 类型 =====

export type { DepKind } from '../../shared/acceleration'
import type { DepKind } from '../../shared/acceleration'

export interface DepStatus {
  kind: DepKind
  found: boolean
  optional?: boolean
  path?: string
  version?: string
  source?: 'system' | 'managed' | 'manual'
  reason?: string
  managed?: boolean
  requiredVersion?: string
  stale?: boolean
  /** 二进制形态（仅 yt-dlp），见 src/types/deps.ts 的说明 */
  form?: 'zipapp' | 'native'
}

export interface RuntimeStatus {
  platform: string
  managedDir: string
  checkedAt: number
  results: DepStatus[]
}

export interface DetectOptions {
  /** 设置里手动指定的可执行文件路径 */
  manualPaths?: Partial<Record<DepKind, string>>
}

export interface DownloadOptions extends DetectOptions {
  /** 只下载指定依赖，缺省为全部 */
  only?: DepKind[]
  proxy?: string
  /** 已存在也重新下载 */
  force?: boolean
  /**
   * 下载源偏好：`auto`（GitHub → 公共镜像依次降级）或钉死某个镜像 ID。
   *
   * 与更新源（`shared/update-sources.ts`）是**同一类设计**：下载通道本身要是
   * 坏了，用户就装不上依赖，而依赖装不上意味着整个应用不可用。区别是这里走
   * Go 边车（它自己实现镜像前缀拼接），所以只透传一个字符串。
   */
  mirror?: string
}

export interface DownloadProgress {
  event: string
  tool?: DepKind
  downloaded?: number
  total?: number
  path?: string
  message?: string
}

// 探测结果缓存：60 秒内不重复 spawn 边车，避免频繁解析拖慢交互
const STATUS_TTL = 60 * 1000

let cachedStatus: RuntimeStatus | null = null
let cachedAt = 0
let inflight: Promise<RuntimeStatus> | null = null
let activeFetch: ReturnType<typeof spawn> | null = null

// ===== 路径 =====

/** 侧车可执行文件名 */
export function sidecarName(): string {
  return process.platform === 'win32' ? 'downvid-deps.exe' : 'downvid-deps'
}

/** 平台-架构标识，与 Go 构建产物目录一致 */
export function platformKey(): string {
  return `${process.platform}-${process.arch}`
}

/**
 * 定位 Go 侧车。
 *
 * - 开发：vite 插件会把它构建到 backend/build/<platform>-<arch>/
 * - 打包：electron-builder 把它放在 resources/downvid-deps/
 */
export function getSidecarPath(): string | null {
  const name = sidecarName()
  const root = process.env.APP_ROOT || process.cwd()
  const candidates = [
    path.join(process.resourcesPath || '', 'downvid-deps', name),
    path.join(root, 'backend', 'build', platformKey(), name),
    path.join(root, 'backend', 'build', name),
    path.join(process.cwd(), 'backend', 'build', platformKey(), name),
  ]

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate
    } catch {}
  }
  return null
}

/** DownVid 自己下载的依赖存放目录 */
export function getManagedDir(): string {
  return path.join(app.getPath('userData'), 'runtime', 'bin')
}

// ===== 探测 =====

function detectArgs(options: DetectOptions): string[] {
  // 不传 --timeout：总时限的**唯一来源**是 Go 侧的 rt.DetectTimeout（80 秒），
  // 边车不带参数时就用它。此前这里硬编码 '70'，把 80 覆盖成了 70，于是
  // 「文档写 80、代码跑 70」静默对不上——正是本项目最怕的那类失同步。
  //
  // 80 秒的余量账：单候选 15 秒（托管副本）/ 5 秒（系统副本），最坏
  // 「托管副本 15 + 保底扫描 18」＝ 33 秒，仍小于 80；Electron 侧
  // runSidecar 的 90 秒再留出 JSON 回传的余量。
  const args = ['detect', '--managed-dir', getManagedDir(), '--json']
  for (const [kind, file] of Object.entries(options.manualPaths || {})) {
    if (file) args.push('--manual', `${kind}=${file}`)
  }
  return args
}

interface SidecarRun {
  code: number | null
  stdout: string
  stderr: string
}

function runSidecar(args: string[], timeoutMs = 90_000): Promise<SidecarRun> {
  return new Promise((resolve, reject) => {
    const bin = getSidecarPath()
    if (!bin) {
      reject(new Error('未找到依赖管理组件 (downvid-deps)，请重新安装 DownVid'))
      return
    }

    const child = spawn(bin, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('依赖检测超时'))
    }, timeoutMs)

    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

/**
 * 探测机器上的运行依赖，结果带 60 秒缓存。
 *
 * 依赖策略是「系统优先，缺失才下载」：探测顺序由侧车决定
 * （手动指定 → 托管目录 → 登录 shell 的 PATH → 各平台常见安装目录）。
 */
export async function getRuntimeStatus(options: DetectOptions & { force?: boolean } = {}): Promise<RuntimeStatus> {
  const fresh = cachedStatus && Date.now() - cachedAt < STATUS_TTL
  if (fresh && !options.force) return cachedStatus!

  // 并发调用共用同一次探测
  if (inflight && !options.force) return inflight

  inflight = (async () => {
    const run = await runSidecar(detectArgs(options))
    const parsed = parseDetectOutput(run)
    cachedStatus = parsed
    cachedAt = Date.now()
    return parsed
  })()

  try {
    return await inflight
  } finally {
    inflight = null
  }
}

function parseDetectOutput(run: SidecarRun): RuntimeStatus {
  // stdout 是 NDJSON，detect 子命令只输出一行汇总事件
  const line = run.stdout.split('\n').map(l => l.trim()).find(l => l.startsWith('{'))
  if (!line) {
    const detail = run.stderr.trim().split('\n').pop() || '依赖检测没有返回结果'
    throw new Error(detail)
  }

  try {
    const payload = JSON.parse(line)
    return {
      platform: payload.platform || platformKey(),
      managedDir: payload.managedDir || getManagedDir(),
      checkedAt: Date.now(),
      results: (payload.results || []) as DepStatus[],
    }
  } catch {
    throw new Error('依赖检测结果解析失败')
  }
}

/** 同步读取缓存中的某个依赖路径；未探测过时返回 null */
export function cachedPathOf(kind: DepKind): string | null {
  const found = cachedStatus?.results.find(r => r.kind === kind && r.found)
  return found?.path || null
}

/**
 * 同步读取缓存中某个依赖的版本号；未探测过时返回空串。
 *
 * ## 为什么需要它
 *
 * 解析 YouTube 时，「页面需要重载」这条错误的回退策略**按版本分支**选客户端
 * （2026.10.10 起用 `default,web_embedded`，更早用 `web_safari`）。
 * 此前那次改动为了避免多跑一次 `--version`，把传给策略的版本号直接写成了 `''`，
 * 于是「新版本」那条分支**永远不可达**——策略静默退化成只走旧客户端，
 * 而我方没有任何报错，只有 CI 的解析集成回归会红。
 *
 * ## 为什么这里取版本不额外 spawn
 *
 * Go 边车在 `detect` 时**已经**执行过 `yt-dlp --version` 并把版本写进结果
 * （`backend/internal/runtime/find.go` 的 `Result.Version`，60 秒缓存）。
 * 所以这里只是读缓存，代价是 0；真正贵的是「为了版本号再 spawn 一次」，
 * 那条路径仍然只在失败诊断时走（`readYtdlpVersion`）。
 */
export function cachedVersionOf(kind: DepKind): string {
  const found = cachedStatus?.results.find(r => r.kind === kind && r.found)
  return found?.version || ''
}

export function cachedStatusSnapshot(): RuntimeStatus | null {
  return cachedStatus
}

/** 供测试或设置变更后清空缓存 */
export function invalidateStatus() {
  cachedStatus = null
  cachedAt = 0
}

// ===== 下载 =====

export interface DownloadResult {
  ok: boolean
  status?: RuntimeStatus
  error?: string
  skipped?: boolean
}

/**
 * 调用侧车下载缺失依赖，逐行把进度事件交给 onProgress。
 *
 * 下载在边车里完成（含 SHA-256 校验、gzip 解压、macOS 去隔离属性与 ad-hoc 签名），
 * 主进程只负责转发进度，因此界面关掉也不会中断。
 */
export function downloadDeps(
  options: DownloadOptions,
  onProgress: (progress: DownloadProgress) => void,
): Promise<DownloadResult> {
  return new Promise((resolve) => {
    const bin = getSidecarPath()
    if (!bin) {
      resolve({ ok: false, error: '未找到依赖管理组件 (downvid-deps)，请重新安装 DownVid' })
      return
    }

    const args = ['fetch', '--managed-dir', getManagedDir()]
    if (options.only?.length) args.push('--only', options.only.join(','))
    if (options.proxy) args.push('--proxy', options.proxy)
    if (options.force) args.push('--force')
    if (options.mirror) args.push('--mirror', options.mirror)
    // 注意：不要给 fetch 传 --manual，它只认托管目录

    const child = spawn(bin, args, { windowsHide: true })
    activeFetch = child

    let pending = ''
    let stderrTail = ''
    let failure: string | null = null
    let finished = false

    const handleLine = (line: string) => {
      if (!line) return
      let payload: DownloadProgress
      try {
        payload = JSON.parse(line)
      } catch {
        return
      }
      if (payload.event === 'error' && payload.message) failure = payload.message
      onProgress(payload)
    }

    child.stdout?.on('data', (data: Buffer) => {
      const lines = (pending + data.toString()).split(/\r?\n/)
      pending = lines.pop() || ''
      lines.forEach(handleLine)
    })
    child.stderr?.on('data', (data: Buffer) => {
      // 保留尾部日志用于失败提示
      stderrTail = (stderrTail + data.toString()).slice(-4000)
    })
    child.on('error', (err) => {
      finished = true
      activeFetch = null
      resolve({ ok: false, error: err.message })
    })
    child.on('close', async (code) => {
      if (finished) return
      finished = true
      activeFetch = null
      if (pending) handleLine(pending)

      if (code !== 0) {
        const detail = failure
          || stderrTail.trim().split('\n').filter(Boolean).pop()?.replace(/^\[deps\]\s*/, '')
          || `依赖下载失败（退出码 ${code}）`
        resolve({ ok: false, error: detail })
        return
      }

      // 下载完成后重新探测，让界面立刻显示新版本
      try {
        invalidateStatus()
        const status = await getRuntimeStatus({ ...options, force: true })
        resolve({ ok: true, status })
      } catch (e: any) {
        resolve({ ok: false, error: e?.message || '依赖下载完成但校验失败' })
      }
    })
  })
}

/** 中止正在进行的依赖下载 */
export function cancelDownload(): boolean {
  if (!activeFetch) return false
  activeFetch.kill()
  activeFetch = null
  return true
}

export function isDownloading(): boolean {
  return activeFetch !== null
}
