import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'

export type JsRuntimeKind = 'node' | 'deno'

export interface JsRuntimeInfo {
  available: boolean
  path: string | null
  kind: JsRuntimeKind | null
  name: string
  version?: string
}

interface Candidate {
  path: string
  kind: JsRuntimeKind
}

export function looksLikeNode(candidate: string): boolean {
  const normalized = candidate.toLowerCase().replace(/\\/g, '/')
  return !normalized.includes('.app/contents/macos/') && !normalized.includes('electron')
}

/** GUI 进程可能持有旧 PATH，Deno 必须也有安装目录兜底。 */
export function jsRuntimeCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = os.homedir(),
): Candidate[] {
  const isWin = platform === 'win32'
  const paths = isWin ? path.win32 : path.posix
  const candidates: Candidate[] = []
  const add = (kind: JsRuntimeKind, file: string | undefined) => {
    if (file) candidates.push({ kind, path: file })
  }
  for (const dir of (env.PATH || '').split(isWin ? ';' : ':').filter(Boolean)) {
    for (const kind of ['node', 'deno'] as const) {
      add(kind, paths.join(dir, isWin ? `${kind}.exe` : kind))
    }
  }
  add('node', env.DOWNVID_NODE_PATH)
  if (isWin) {
    const local = env.LOCALAPPDATA || paths.join(home, 'AppData', 'Local')
    const programFiles = env.ProgramFiles || 'C:\\Program Files'
    const programData = env.ProgramData || 'C:\\ProgramData'
    for (const dir of [programFiles, env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)']) {
      add('node', paths.join(dir, 'nodejs', 'node.exe'))
    }
    add('node', paths.join(env.APPDATA || paths.join(home, 'AppData', 'Roaming'), 'npm', 'node.exe'))
    add('node', paths.join(local, 'Programs', 'nodejs', 'node.exe'))
    for (const scoop of [env.SCOOP || paths.join(home, 'scoop'), env.SCOOP_GLOBAL || paths.join(programData, 'scoop')]) {
      for (const kind of ['node', 'deno'] as const) {
        add(kind, paths.join(scoop, 'shims', `${kind}.exe`))
      }
      add('deno', paths.join(scoop, 'apps', 'deno', 'current', 'deno.exe'))
    }
    for (const winget of [paths.join(local, 'Microsoft', 'WinGet'), paths.join(programFiles, 'WinGet')]) {
      add('deno', paths.join(winget, 'Links', 'deno.exe'))
      try {
        const packages = paths.join(winget, 'Packages')
        for (const entry of fs.readdirSync(packages, { withFileTypes: true })) {
          if (entry.isDirectory() && entry.name.toLowerCase().startsWith('denoland.deno_')) {
            add('deno', paths.join(packages, entry.name, 'deno.exe'))
          }
        }
      } catch {}
    }
  } else {
    for (const dir of ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin', paths.join(home, '.local', 'bin')]) {
      for (const kind of ['node', 'deno'] as const) add(kind, paths.join(dir, kind))
    }
  }
  add('deno', paths.join(home, '.deno', 'bin', isWin ? 'deno.exe' : 'deno'))
  return candidates
}

export function supportedJsVersion(kind: JsRuntimeKind, output: string): string | null {
  const pattern = kind === 'node' ? /^v(\d+)\.(\d+)\.(\d+)\s*$/ : /^deno (\d+)\.(\d+)\.(\d+)(?:\s|$)/
  const match = pattern.exec(output.trim())
  if (!match) return null
  const [, major, minor, patch] = match
  const supported = kind === 'node' ? Number(major) >= 22 : Number(major) > 2 || Number(major) === 2 && Number(minor) >= 3
  return supported ? `${major}.${minor}.${patch}` : null
}

/** 验证实际执行和版本，不能把 Electron 自身当作 CLI 运行时。 */
export async function checkJsRuntime(): Promise<JsRuntimeInfo> {
  const deadline = Date.now() + 6000
  const checked = new Set<string>()
  for (const candidate of jsRuntimeCandidates()) {
    if (candidate.kind === 'node' && !looksLikeNode(candidate.path)) continue
    if (checked.has(candidate.path)) continue
    checked.add(candidate.path)
    try {
      if (fs.statSync(candidate.path).isFile()) {
        if (Date.now() >= deadline) break
        const version = await new Promise<string | null>(resolve => {
          execFile(candidate.path, ['--version'], { windowsHide: true, timeout: Math.min(1000, deadline - Date.now()), maxBuffer: 16384 }, (error, stdout) => {
            resolve(error ? null : supportedJsVersion(candidate.kind, stdout))
          })
        })
        if (!version) continue
        return {
          available: true,
          path: candidate.path,
          kind: candidate.kind,
          name: candidate.kind === 'node' ? 'Node.js' : 'Deno',
          version,
        }
      }
    } catch {}
  }
  return { available: false, path: null, kind: null, name: '' }
}
