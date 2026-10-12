import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { getRuntimeStatus, cachedPathOf, type DepKind } from './runtime'

// 依赖解析策略（与 AGENTS.md 的描述保持一致）：
//   手动指定 → userData 托管目录 → 登录 shell 的 PATH → 各平台常见安装目录 → 裸命令名交给 PATH
//
// 以前这里会去 process.resourcesPath/bin 找随包分发的二进制；
// 现在安装包不再携带 yt-dlp / ffmpeg，改由 Go 侧车（electron/utils/runtime.ts）探测与下载。

/** 依赖缺失时抛出的错误，渲染进程会据此弹出「一键下载」引导 */
export class MissingDependencyError extends Error {
  readonly kind: DepKind
  readonly reason: string

  constructor(kind: DepKind, reason: string) {
    super(formatMissingMessage(kind, reason))
    this.name = 'MissingDependencyError'
    this.kind = kind
    this.reason = reason
  }
}

/**
 * 错误信息里的可解析标记，渲染进程据此识别「该引导用户下载依赖」。
 * 与 Cookie 提示的 `\n\n提示：` 标记同理：消息文本既给人看，也留机器可读的锚点。
 */
export const MISSING_DEP_MARKER = '[[deps-missing:'

export function formatMissingMessage(kind: DepKind, reason: string): string {
  const detail = reason ? `（${reason}）` : ''
  return `${MISSING_DEP_MARKER}${kind}]]未找到可用的 ${kind}${detail}，请在「设置 → 运行依赖」中下载后重试`
}

/**
 * 解析依赖的可执行路径，必要时先触发一次探测。
 *
 * @param kind 依赖种类
 * @param required 为 true 时缺失即抛错；为 false 时返回 null（用于可选依赖）
 */
export async function resolveDependency(kind: DepKind, required = true): Promise<string | null> {
  const cached = cachedPathOf(kind)
  if (cached) return cached

  const status = await getRuntimeStatus()
  const entry = status.results.find(r => r.kind === kind)
  if (entry?.found && entry.path) return entry.path

  if (required) throw new MissingDependencyError(kind, entry?.reason || '')
  return null
}

/** 同步取缓存路径；未命中时退回裸命令名（由系统 PATH 兜底） */
export function dependencyNameOf(kind: DepKind): string {
  return process.platform === 'win32' ? `${kind}.exe` : kind
}

/** 同步解析（仅用缓存）：解析或下载前应先 await resolveDependency 完成首次探测 */
export function getYtDlpPath(): string {
  return cachedPathOf('yt-dlp') || dependencyNameOf('yt-dlp')
}

/** ffmpeg 的路径；未探测到时返回裸命令名 */
export function getFfmpegPath(): string {
  return cachedPathOf('ffmpeg') || dependencyNameOf('ffmpeg')
}

export function getFfprobePath(): string | null {
  return cachedPathOf('ffprobe')
}

/**
 * yt-dlp 的 --ffmpeg-location 参数值。
 *
 * 优先传目录：yt-dlp 会在该目录里同时找 ffmpeg 与 ffprobe，
 * 这样从托管目录安装时可以同时命中两者。系统 ffmpeg 与 ffprobe 通常同目录，传目录同样正确。
 */
export function getFfmpegLocation(): string {
  const location = cachedPathOf('ffmpeg') || getFfmpegPath()
  // 裸命令名（如 PATH 兜底）没有目录可言，交给 yt-dlp 自行查找
  if (!location.includes(path.sep) && !location.includes('/')) return ''
  try {
    return fs.statSync(location).isDirectory() ? location : path.dirname(location)
  } catch {
    return path.dirname(location)
  }
}

/** yt-dlp `--js-runtimes` 支持的运行时 */
export type JsRuntimeKind = 'node' | 'deno'

export interface JsRuntimeInfo {
  available: boolean
  /** 可执行文件路径；不可用时为 null */
  path: string | null
  kind: JsRuntimeKind | null
  name: string
}

/**
 * 探测可用的 JS 运行时（YouTube 的签名解密需要）。
 *
 * **不能用 Electron 自身的二进制**：它虽然内嵌 Node，但不是一个可当命令行
 * 运行时使用的 `node`/`deno`——yt-dlp 会照常执行它，于是拉起一整个 Electron 应用
 * （表现为"点解析之后又多开了一个 DownVid"）。实测：进程数从 1 变成 3。
 *
 * 因此这里只认真正的 node / deno 可执行文件。打包应用里如果用户没装，
 * 就返回不可用，由调用方给出明确提示（而不是静默跳过——之前正是静默跳过，
 * 导致 YouTube 下载失败时拿到的是空 stderr，完全看不出原因）。
 */
export function checkJsRuntime(): JsRuntimeInfo {
  const isWin = process.platform === 'win32'
  const nodeCandidates = [
    process.env.DOWNVID_NODE_PATH,
    isWin ? 'C:\\Program Files\\nodejs\\node.exe' : '/usr/bin/node',
    isWin ? 'C:\\Program Files (x86)\\nodejs\\node.exe' : '/usr/local/bin/node',
    isWin ? path.join(process.env.APPDATA || '', 'npm', 'node.exe') : '/opt/homebrew/bin/node',
    isWin ? path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe') : '',
  ]

  // 1) PATH 里的 node / deno（打包应用只拿到精简 PATH，因此仅作其一来源）
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const kind of ['node', 'deno'] as const) {
      const name = isWin ? `${kind}.exe` : kind
      if (isDenoBinary(dir, name, kind)) {
        return { available: true, path: path.join(dir, name), kind, name: kindLabel(kind) }
      }
    }
  }

  // 2) 各平台常见安装位置
  for (const candidate of nodeCandidates) {
    if (candidate && isExecutableFile(candidate) && looksLikeNode(candidate)) {
      return { available: true, path: candidate, kind: 'node', name: 'Node.js' }
    }
  }

  return { available: false, path: null, kind: null, name: '' }
}

function kindLabel(kind: JsRuntimeKind): string {
  return kind === 'node' ? 'Node.js' : 'Deno'
}

function isExecutableFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

/** 文件名即 node / deno 时可信 */
function isDenoBinary(dir: string, name: string, kind: JsRuntimeKind): boolean {
  if (kind === 'deno') return isExecutableFile(path.join(dir, name))
  return isExecutableFile(path.join(dir, name)) && looksLikeNode(path.join(dir, name))
}

/**
 * 排除 Electron 这类"内嵌 Node 但并非 node 运行时"的可执行文件。
 *
 * 判断依据是**文件是否在 .app 包内**（macOS 的 Electron 二进制位于
 * `Xxx.app/Contents/MacOS/`），以及路径里是否含 electron。仅靠路径里有没有
 * "node" 猜测是不够的——Electron 的路径里没有 "node"，会被误判成 deno。
 */
function looksLikeNode(candidate: string): boolean {
  const lower = candidate.toLowerCase()
  // 统一分隔符：Windows 路径用反斜杠，只判 '/' 会漏掉
  const normalized = lower.replace(/\\/g, '/')
  if (normalized.includes('.app/contents/macos/')) return false
  if (normalized.includes('electron')) return false
  return true
}

/** 检查 ffmpeg 是否真的可以执行（用于依赖界面上的自检） */
export async function checkFfmpeg(): Promise<boolean> {
  const resolved = await resolveDependency('ffmpeg', false)
  if (!resolved) return false
  return new Promise((resolve) => {
    const child = spawn(resolved, ['-version'])
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
}
