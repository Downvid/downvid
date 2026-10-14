import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { getRuntimeStatus, cachedPathOf, type DepKind } from './runtime'
export { checkJsRuntime, type JsRuntimeInfo, type JsRuntimeKind } from './js-runtime'

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
