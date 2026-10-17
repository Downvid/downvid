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

/** 与 yt-dlp 的 `MIN_SUPPORTED_VERSION` 一致：低于 Node 22.0.0 / Deno 2.3.0 时 yt-dlp 不会用它 */
function isSupportedVersion(kind: JsRuntimeKind, major: number, minor: number): boolean {
  return kind === 'node' ? major >= 22 : major > 2 || major === 2 && minor >= 3
}

/** 版本管理器的版本目录名：`v22.11.0`（nvm、fnm、nvm-windows）或 `22.11.0`（mise、asdf、Volta） */
const VERSION_DIR = /^v?(\d+)\.(\d+)\.(\d+)$/

/**
 * 列出 `root` 下以版本号命名的安装目录，返回其中受支持版本的可执行文件，从新到旧。
 *
 * 不去猜用户的「默认版本」：只要有一个受支持的版本能跑就够了。
 * 不匹配 `pattern` 的名字一律跳过——mise 的 `22`、`latest` 这类别名只是指向完整版本目录的软链，
 * 不会因此漏掉版本。低于最低版本的目录不执行，免得把探测预算花在注定被拒的旧版本上。
 * 只看名字、不看 `isDirectory()`：Homebrew 的 `opt/node@22` 是软链，Windows 的联接点也被报告成链接，
 * 两者的 `isDirectory()` 都是 false；断掉的链接会在执行前的 `statSync` 那一步被跳过。
 */
function versionedBinaries(kind: JsRuntimeKind, paths: typeof path, root: string, pattern: RegExp, binary: string[]): string[] {
  let names: string[]
  try {
    names = fs.readdirSync(root, { withFileTypes: true }).map(entry => entry.name)
  } catch {
    return []
  }
  const found: { name: string; version: number[] }[] = []
  for (const name of names) {
    const match = pattern.exec(name)
    if (!match) continue
    const version = [1, 2, 3].map(i => Number(match[i] ?? 0))
    if (isSupportedVersion(kind, version[0], version[1])) found.push({ name, version })
  }
  return found
    .sort((a, b) => b.version[0] - a.version[0] || b.version[1] - a.version[1] || b.version[2] - a.version[2])
    .map(({ name }) => paths.join(root, name, ...binary))
}

/**
 * 系统安装目录与版本管理器的兜底候选。
 *
 * macOS 从 Finder / 程序坞启动的应用只有 `/usr/bin:/bin:/usr/sbin:/sbin`，Linux 从桌面启动也不读
 * `.zshrc` / `.bashrc`——而 nvm、fnm、mise、asdf 正是在这些文件里把 node 加进 PATH 的，
 * Homebrew 的 `node@22` 这类 keg-only 版本和 MacPorts 也要用户自己改 PATH。
 * 于是终端里 `node -v` 明明是 v22，应用却报「YouTube 解析需要可运行的 Node.js 22+ 或 Deno 2.3+」。
 * Windows 上 fnm、mise 通常只在 PowerShell profile 里激活；nvm-windows 的 `nvm use` 要管理员权限建软链，
 * 失败时版本已经装好却不在 PATH 里。
 *
 * 这些候选排在原有候选**之后**：原有候选里只要有一个可用，选中的仍是同一个，
 * 新候选只在原来什么都找不到时才会被执行到。
 * 各工具的根目录先看环境变量，再看它不同版本的默认位置（GUI 进程通常没有这些环境变量）。
 */
function installDirFallbacks(isWin: boolean, paths: typeof path, env: NodeJS.ProcessEnv, home: string): Candidate[] {
  const candidates: Candidate[] = []
  const add = (kind: JsRuntimeKind, ...files: string[]) => {
    for (const file of files) candidates.push({ kind, path: file })
  }
  const versions = (kind: JsRuntimeKind, roots: (string | undefined)[], sub: string[], binary: string[]) => {
    for (const root of roots) {
      if (root) add(kind, ...versionedBinaries(kind, paths, paths.join(root, ...sub), VERSION_DIR, binary))
    }
  }
  if (isWin) {
    const local = env.LOCALAPPDATA || paths.join(home, 'AppData', 'Local')
    const roaming = env.APPDATA || paths.join(home, 'AppData', 'Roaming')
    // nvm-windows 1.2.1 起默认 %LOCALAPPDATA%\nvm，更早是 %APPDATA%\nvm；当前版本链接在 NVM_SYMLINK
    add('node', paths.join(env.NVM_SYMLINK || 'C:\\nvm4w\\nodejs', 'node.exe'))
    versions('node', [env.NVM_HOME, paths.join(local, 'nvm'), paths.join(roaming, 'nvm')], [], ['node.exe'])
    versions('node', [env.FNM_DIR, paths.join(roaming, 'fnm'), paths.join(home, '.fnm')], ['node-versions'], ['installation', 'node.exe'])
    // Volta 的 bin\ 里只有 node.cmd（execFile 不能直接执行），真正的二进制在 tools\image 下
    versions('node', [env.VOLTA_HOME || paths.join(local, 'Volta')], ['tools', 'image', 'node'], ['node.exe'])
    const mise = env.MISE_DATA_DIR || paths.join(local, 'mise')
    versions('node', [mise], ['installs', 'node'], ['node.exe'])
    versions('deno', [mise], ['installs', 'deno'], ['bin', 'deno.exe'])
    return candidates
  }
  // 与运行依赖边车的 commonInstallDirs 对齐：MacPorts、Snap、Linuxbrew、Nix
  for (const dir of [
    '/opt/local/bin', '/snap/bin', '/home/linuxbrew/.linuxbrew/bin',
    paths.join(home, '.nix-profile', 'bin'), '/nix/var/nix/profiles/default/bin', '/run/current-system/sw/bin',
  ]) {
    for (const kind of ['node', 'deno'] as const) add(kind, paths.join(dir, kind))
  }
  // Homebrew 的 node@22、node@24 是 keg-only，不会链接进 bin
  for (const prefix of ['/opt/homebrew', '/usr/local', '/home/linuxbrew/.linuxbrew']) {
    add('node', ...versionedBinaries('node', paths, paths.join(prefix, 'opt'), /^node@(\d+)$/, ['bin', 'node']))
  }
  const data = env.XDG_DATA_HOME || paths.join(home, '.local', 'share')
  const config = env.XDG_CONFIG_HOME || paths.join(home, '.config')
  // nvm 的安装脚本在设置了 XDG_CONFIG_HOME 时装进 $XDG_CONFIG_HOME/nvm，否则 ~/.nvm
  versions('node', [env.NVM_DIR, paths.join(home, '.nvm'), paths.join(config, 'nvm')], ['versions', 'node'], ['bin', 'node'])
  // fnm 在 macOS 上也用 XDG 目录；但官方安装脚本把 fnm 本体放进 ~/Library/Application Support/fnm，
  // 这个目录一旦存在，fnm 就把版本也装在那里
  versions('node', [
    env.FNM_DIR, paths.join(data, 'fnm'), paths.join(home, '.fnm'), paths.join(home, 'Library', 'Application Support', 'fnm'),
  ], ['node-versions'], ['installation', 'bin', 'node'])
  // Volta 的 bin/node 是不依赖 PATH 的 shim（走用户的默认版本），tools/image 下是真正的二进制
  const volta = env.VOLTA_HOME || paths.join(home, '.volta')
  add('node', paths.join(volta, 'bin', 'node'))
  versions('node', [volta], ['tools', 'image', 'node'], ['bin', 'node'])
  // mise / asdf 的 shims 要它们自己在 PATH 里才能工作，所以直接取 installs 下的真实二进制
  for (const kind of ['node', 'deno'] as const) {
    versions(kind, [env.MISE_DATA_DIR || paths.join(data, 'mise')], ['installs', kind], ['bin', kind])
    versions(kind, [env.ASDF_DATA_DIR || paths.join(home, '.asdf')], ['installs', kind === 'node' ? 'nodejs' : 'deno'], ['bin', kind])
  }
  // n 默认装进 /usr/local/bin（原有候选已覆盖）；n-install 的默认前缀是 ~/n
  add('node', paths.join(env.N_PREFIX || paths.join(home, 'n'), 'bin', 'node'))
  return candidates
}

/** GUI 进程可能持有旧 PATH（或根本没有 shell 里配置的 PATH），Node 与 Deno 都要有安装目录兜底。 */
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
  candidates.push(...installDirFallbacks(isWin, paths, env, home))
  return candidates
}

export function supportedJsVersion(kind: JsRuntimeKind, output: string): string | null {
  const pattern = kind === 'node' ? /^v(\d+)\.(\d+)\.(\d+)\s*$/ : /^deno (\d+)\.(\d+)\.(\d+)(?:\s|$)/
  const match = pattern.exec(output.trim())
  if (!match) return null
  const [, major, minor, patch] = match
  return isSupportedVersion(kind, Number(major), Number(minor)) ? `${major}.${minor}.${patch}` : null
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
