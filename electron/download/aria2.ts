import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { app } from 'electron'
import type { AccelerationStatus } from '../../shared/acceleration'
import { getRuntimeStatus, cachedPathOf } from '../utils/runtime'

/**
 * aria2 的检测与版本解析。
 *
 * ## 探测本身已并入依赖体系
 *
 * aria2 现在是 `DepKind` 的一种（`shared/acceleration.ts` 的 `DEP_KINDS`），
 * 探测由 Go 边车负责——Windows 的 Scoop/WinGet/Chocolatey、macOS 的 Homebrew、
 * Linux 的 snap/nix 等路径**只在那里维护一份**。这个文件不再自己枚举路径
 * （原先那套与边车的候选表是两份，改一处漏一处，表现为「设置里说没装、
 * 依赖页说装了」）。
 *
 * 这里只保留两件事：
 *   1. 从边车的探测结果里取出 aria2 那一项（`detectAria2`）；
 *   2. 版本号解析（`parseAria2Version`），供设置页的手动路径预览与单测使用。
 */

/** aria2 版本判定：只认 `主.次.修订` 确切形态 */
export function isSupportedAria2Version(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  return !!match && (Number(match[1]) > 1 || (Number(match[1]) === 1 && Number(match[2]) >= 36))
}

/**
 * 从 `aria2c --version` 的输出里取版本号。
 *
 * ## 为什么不能只匹配英文（真实 bug）
 *
 * 首行是**本地化**的，随 `LANG` / `LC_ALL` 变化：
 *
 *   - `LC_ALL=C`          → `aria2 version 1.37.0`
 *   - `LANG=zh_CN.UTF-8`  → `aria2 版本 1.37.0`
 *   - 日文 / 德文同理
 *
 * 原先的正则写死 `aria2 version (\d+...)`，于是**中文 / 日文 / 德文系统的用户
 * 永远检测不到 aria2**：界面上加速开关开着，实际一直单线程，而设置里点「检测」
 * 只显示「未找到 aria2c」——没有任何报错。这是最容易归因错的一类问题
 * （用户会以为自己的 aria2 装坏了）。
 *
 * 规则：以 `aria2` 开头、行尾是 x.y.z 即接受；首行不是 aria2 时（发行版前置告警）
 * 退而取全文第一个 x.y.z，但仅当文本里确实提到 aria2。
 */
export function parseAria2Version(output: string): string {
  const firstLine = output.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || ''
  const anchored = /^aria2\b.*?(\d+\.\d+\.\d+)\s*$/i.exec(firstLine)
  if (anchored) return anchored[1]
  if (/aria2/i.test(output)) {
    const loose = /(\d+\.\d+\.\d+)/.exec(output)
    if (loose) return loose[1]
  }
  return ''
}

/** 托管目录：与 yt-dlp / ffmpeg 共用（边车也往这里装） */
export function aria2ManagedDir(): string {
  return path.join(app.getPath('userData'), 'runtime', 'bin')
}

/**
 * 执行一次 `--version` 并用固定 C locale 读取。
 *
 * 即使解析器已能处理本地化首行，仍强制 `LC_ALL=C`：输出稳定，便于把日志
 * 贴给别人；也避免翻译质量差的语言把数字插到奇怪的位置。
 */
function readAria2Version(binary: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      binary,
      ['--version'],
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 65536,
        env: { ...process.env, LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C' },
      },
      (error, stdout) => resolve(error ? '' : parseAria2Version(stdout)),
    )
  })
}

/**
 * 探测 aria2。
 *
 * **优先用已有的依赖探测结果**：`getRuntimeStatus()` 带 60 秒缓存，
 * 而设置页原先每次打开都无条件再 spawn 一次 `aria2c --version`——
 * 明明依赖页刚刚识别过位置，却在「加速」页又查一遍，白等 1~3 秒。
 *
 * @param manual 用户手动指定的路径（设置里填的）。给了就直接验它，
 *               不走探测缓存——用户改完路径期待立刻看到结果
 */
export async function detectAria2(manual = ''): Promise<AccelerationStatus> {
  if (manual) {
    const version = await readAria2Version(manual, 2500)
    if (!version) {
      return { found: false, path: null, version: '', reason: '所选文件不是可运行的 aria2c' }
    }
    if (!isSupportedAria2Version(version)) {
      return { found: false, path: null, version, reason: 'aria2 版本过旧，需要 1.36.0 或更新版本' }
    }
    return { found: true, path: manual, version, reason: '' }
  }

  // 先看缓存（`cachedPathOf` 只读上一次探测的结果，不会触发新的 spawn）
  const cached = cachedPathOf('aria2')
  if (cached) {
    const version = await readAria2Version(cached, 2000)
    if (isSupportedAria2Version(version)) return { found: true, path: cached, version, reason: '' }
  }

  // 缓存没有才真正探测；这一步会命中主进程的 60 秒缓存，不会重复 spawn 边车
  const status = await getRuntimeStatus()
  const entry = status.results.find((r) => r.kind === 'aria2')
  if (entry?.found && entry.path) {
    return { found: true, path: entry.path, version: entry.version || '', reason: '' }
  }
  // 边车已经给出了带版本的失败原因（版本过旧 / 未找到），直接透传
  return { found: false, path: null, version: entry?.version || '', reason: entry?.reason || '未找到 aria2c' }
}

/** 供测试与诊断：文件是否存在且可执行 */
export function isExecutableFile(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK)
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

export { os }
