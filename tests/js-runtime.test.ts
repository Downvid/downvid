import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { looksLikeNode, jsRuntimeCandidates, checkJsRuntime, supportedJsVersion } from '../electron/utils/js-runtime'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))

/**
 * JS 运行时的候选判定。
 *
 * 背景（真实事故）：`checkJsRuntime()` 曾返回 `process.execPath`——也就是 Electron
 * 二进制本身——并靠 `path.includes('node')` 猜测类型。Electron 的路径里没有 "node"，
 * 于是被当成 deno 传给 `yt-dlp --js-runtimes deno:/Applications/DownVid.app/Contents/MacOS/DownVid`。
 * yt-dlp 照常执行它，**拉起了一整个 DownVid**：用户点解析后会多开一个应用。
 * 实测进程数 1 → 3。
 *
 * 所以这里把"哪些路径可以当 node/deno 运行时"这条判定固定下来。
 * 直接调用实际实现，避免测试里复制一份逻辑。
 */
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('JS 运行时候选判定', () => {
  it('排除 macOS 打包应用内的 Electron 二进制（正是事故现场）', () => {
    expect(looksLikeNode('/Applications/DownVid.app/Contents/MacOS/DownVid')).toBe(false)
    expect(looksLikeNode('/Users/mac/Projects/downvid/release/1.3.0/mac-arm64/DownVid.app/Contents/MacOS/DownVid')).toBe(false)
  })

  it('排除其它 Electron 应用（路径可能不含 .app，如开发态）', () => {
    expect(looksLikeNode('/Applications/Visual Studio Code.app/Contents/MacOS/Electron')).toBe(false)
    expect(looksLikeNode('/Users/x/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')).toBe(false)
    expect(looksLikeNode('/usr/local/bin/electron')).toBe(false)
  })

  it('接受真正的 node / deno', () => {
    expect(looksLikeNode('/usr/bin/node')).toBe(true)
    expect(looksLikeNode('/usr/local/bin/node')).toBe(true)
    expect(looksLikeNode('/opt/homebrew/bin/node')).toBe(true)
    expect(looksLikeNode('/opt/homebrew/bin/deno')).toBe(true)
    expect(looksLikeNode('C:\\Program Files\\nodejs\\node.exe')).toBe(true)
  })

  it('大小写不敏感（Windows 路径常见）', () => {
    expect(looksLikeNode('C:\\PROGRAM FILES\\NODEJS\\node.exe')).toBe(true)
    expect(looksLikeNode('C:\\X\\DownVid.APP\\Contents\\MacOS\\DownVid')).toBe(false)
  })
})

describe('Windows JS 运行时目录兜底', () => {
  it('使用实际安装根目录并展开 WinGet 的 Deno 包', () => {
    vi.spyOn(fs, 'readdirSync').mockReturnValue([
      { name: 'DenoLand.Deno_test', isDirectory: () => true },
    ] as unknown as ReturnType<typeof fs.readdirSync>)
    const candidates = jsRuntimeCandidates('win32', {
      PATH: '', LOCALAPPDATA: 'F:\\Local', ProgramFiles: 'D:\\Programs',
      SCOOP: 'E:\\scoop', SCOOP_GLOBAL: 'G:\\scoop',
    }, 'C:\\Users\\tester')
    expect(candidates).toContainEqual({ kind: 'deno', path: 'F:\\Local\\Microsoft\\WinGet\\Packages\\DenoLand.Deno_test\\deno.exe' })
    expect(candidates).toContainEqual({ kind: 'deno', path: 'D:\\Programs\\WinGet\\Links\\deno.exe' })
    expect(candidates).toContainEqual({ kind: 'deno', path: 'E:\\scoop\\apps\\deno\\current\\deno.exe' })
    expect(candidates).toContainEqual({ kind: 'deno', path: 'G:\\scoop\\shims\\deno.exe' })
  })

  it('旧 PATH 下仍能实际选择可运行的 Deno', async () => {
    vi.stubEnv('PATH', '')
    vi.spyOn(fs, 'readdirSync').mockReturnValue([])
    vi.spyOn(fs, 'statSync').mockImplementation(file => {
      if (String(file).replace(/\\/g, '/').endsWith('/.deno/bin/deno' + (process.platform === 'win32' ? '.exe' : ''))) {
        return { isFile: () => true } as ReturnType<typeof fs.statSync>
      }
      throw new Error('不存在')
    })
    vi.mocked(execFile).mockImplementation(((_file: unknown, _args: unknown, _options: unknown, done: Function) => done(null, 'deno 2.3.0\nv8 test')) as typeof execFile)
    expect(await checkJsRuntime()).toMatchObject({ available: true, kind: 'deno', name: 'Deno', version: '2.3.0' })
  })

  it('文件存在但不能运行时不报告可用', async () => {
    vi.spyOn(fs, 'readdirSync').mockReturnValue([])
    vi.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true } as ReturnType<typeof fs.statSync>)
    vi.mocked(execFile).mockImplementation(((_file: unknown, _args: unknown, _options: unknown, done: Function) => done(new Error('不能执行'), '')) as typeof execFile)
    expect((await checkJsRuntime()).available).toBe(false)
  })
  it('跳过过旧的 Node，继续选择受支持的 Deno', async () => {
    vi.spyOn(fs, 'readdirSync').mockReturnValue([])
    vi.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true } as ReturnType<typeof fs.statSync>)
    vi.mocked(execFile).mockImplementation(((file: unknown, _args: unknown, _options: unknown, done: Function) => {
      done(null, /deno(?:\.exe)?$/.test(String(file)) ? 'deno 2.3.0' : 'v21.9.0')
    }) as typeof execFile)
    expect(await checkJsRuntime()).toMatchObject({ available: true, kind: 'deno', version: '2.3.0' })
  })
})

describe('JS 运行时最低版本', () => {
  it('只接受 Node 22+ 的真实版本输出', () => {
    expect(supportedJsVersion('node', 'v21.9.0')).toBeNull()
    expect(supportedJsVersion('node', 'v22.0.0')).toBe('22.0.0')
    expect(supportedJsVersion('node', 'deno 2.3.0')).toBeNull()
  })
  it('只接受 Deno 2.3+，拒绝不匹配的程序输出', () => {
    expect(supportedJsVersion('deno', 'deno 2.2.9')).toBeNull()
    expect(supportedJsVersion('deno', 'deno 2.3.0 (stable)\nv8 test')).toBe('2.3.0')
    expect(supportedJsVersion('deno', 'deno 3.0.0')).toBe('3.0.0')
    expect(supportedJsVersion('deno', 'v22.0.0')).toBeNull()
  })
})
