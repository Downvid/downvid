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

/** 按目录返回假的目录项；表里没有的目录按「不存在」抛错，和真实的 readdirSync 一样 */
function mockDirs(tree: Record<string, string[]>) {
  vi.spyOn(fs, 'readdirSync').mockImplementation(((dir: fs.PathLike) => {
    const names = tree[String(dir)]
    if (!names) throw new Error(`ENOENT: ${String(dir)}`)
    return names.map(name => ({ name, isDirectory: () => true }))
  }) as unknown as typeof fs.readdirSync)
}

/**
 * 背景（反复出现的报告：#62、#64、#65、#66、#67、#71、#75、#80）：从 Finder / 程序坞 / 桌面启动的
 * 应用只有精简 PATH，也不读 `.zshrc` / `.bashrc`。只装在 nvm、fnm、mise、asdf、Volta 或
 * Homebrew `node@22` 里的 Node 一个都找不到，YouTube 解析直接报「需要可运行的 Node.js 22+」——
 * 而用户在终端里 `node -v` 明明是 v22。
 */
describe('版本管理器兜底（GUI 进程拿不到 shell 里配置的 PATH）', () => {
  const GUI_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
  const home = '/Users/tester'
  const pathsOf = (env: NodeJS.ProcessEnv) => jsRuntimeCandidates('darwin', env, home).map(c => c.path)

  it('nvm 的版本按数值从新到旧排列，跳过过旧版本与非版本目录', () => {
    mockDirs({ '/Users/tester/.nvm/versions/node': ['v20.11.0', 'v22.2.0', 'v24.1.0', 'v22.11.0', 'lts', '.DS_Store'] })
    expect(pathsOf({ PATH: GUI_PATH }).filter(p => p.includes('/.nvm/'))).toEqual([
      '/Users/tester/.nvm/versions/node/v24.1.0/bin/node',
      '/Users/tester/.nvm/versions/node/v22.11.0/bin/node',
      '/Users/tester/.nvm/versions/node/v22.2.0/bin/node',
    ])
  })

  it('覆盖 fnm、mise、asdf、Volta、n、Homebrew keg-only 与 MacPorts 的实际布局', () => {
    mockDirs({
      '/Users/tester/.config/nvm/versions/node': ['v22.11.0'],
      '/Users/tester/Library/Application Support/fnm/node-versions': ['v22.11.0'],
      '/Users/tester/.local/share/mise/installs/node': ['22.11.0', '22', 'latest'],
      '/Users/tester/.local/share/mise/installs/deno': ['2.2.9', '2.3.1'],
      '/Users/tester/.asdf/installs/nodejs': ['22.11.0'],
      '/Users/tester/.volta/tools/image/node': ['22.11.0'],
      '/opt/homebrew/opt': ['node@20', 'node@22', 'node@24', 'node', 'deno', 'openssl@3'],
    })
    const candidates = jsRuntimeCandidates('darwin', { PATH: GUI_PATH }, home)
    expect(candidates).toEqual(expect.arrayContaining([
      { kind: 'node', path: '/Users/tester/.config/nvm/versions/node/v22.11.0/bin/node' },
      { kind: 'node', path: '/Users/tester/Library/Application Support/fnm/node-versions/v22.11.0/installation/bin/node' },
      { kind: 'node', path: '/Users/tester/.local/share/mise/installs/node/22.11.0/bin/node' },
      { kind: 'deno', path: '/Users/tester/.local/share/mise/installs/deno/2.3.1/bin/deno' },
      { kind: 'node', path: '/Users/tester/.asdf/installs/nodejs/22.11.0/bin/node' },
      { kind: 'node', path: '/Users/tester/.volta/bin/node' },
      { kind: 'node', path: '/Users/tester/.volta/tools/image/node/22.11.0/bin/node' },
      { kind: 'node', path: '/Users/tester/n/bin/node' },
      { kind: 'node', path: '/opt/local/bin/node' },
    ]))
    const paths = candidates.map(c => c.path)
    expect(paths.filter(p => p.startsWith('/opt/homebrew/opt/'))).toEqual([
      '/opt/homebrew/opt/node@24/bin/node',
      '/opt/homebrew/opt/node@22/bin/node',
    ])
    // mise 的 `22` / `latest` 只是指向完整版本目录的别名；Deno 2.2 低于最低版本
    expect(paths).not.toContain('/Users/tester/.local/share/mise/installs/node/22/bin/node')
    expect(paths).not.toContain('/Users/tester/.local/share/mise/installs/deno/2.2.9/bin/deno')
  })

  it('尊重用户改过的根目录（NVM_DIR、FNM_DIR、MISE_DATA_DIR、ASDF_DATA_DIR、VOLTA_HOME、N_PREFIX）', () => {
    mockDirs({
      '/data/nvm/versions/node': ['v22.11.0'],
      '/data/fnm/node-versions': ['v22.11.0'],
      '/data/mise/installs/node': ['22.11.0'],
      '/data/asdf/installs/nodejs': ['22.11.0'],
    })
    expect(pathsOf({
      PATH: GUI_PATH, NVM_DIR: '/data/nvm', FNM_DIR: '/data/fnm', MISE_DATA_DIR: '/data/mise',
      ASDF_DATA_DIR: '/data/asdf', VOLTA_HOME: '/data/volta', N_PREFIX: '/data/n',
    })).toEqual(expect.arrayContaining([
      '/data/nvm/versions/node/v22.11.0/bin/node',
      '/data/fnm/node-versions/v22.11.0/installation/bin/node',
      '/data/mise/installs/node/22.11.0/bin/node',
      '/data/asdf/installs/nodejs/22.11.0/bin/node',
      '/data/volta/bin/node',
      '/data/n/bin/node',
    ]))
  })

  it('兜底候选排在原有候选之后：原来能找到的运行时，选中的仍是同一个', () => {
    mockDirs({ '/Users/tester/.nvm/versions/node': ['v22.11.0'] })
    const paths = pathsOf({ PATH: '/custom/bin' })
    const nvm = paths.indexOf('/Users/tester/.nvm/versions/node/v22.11.0/bin/node')
    for (const original of ['/custom/bin/node', '/usr/local/bin/node', '/opt/homebrew/bin/node', '/Users/tester/.deno/bin/deno']) {
      expect(paths.indexOf(original)).toBeGreaterThanOrEqual(0)
      expect(paths.indexOf(original)).toBeLessThan(nvm)
    }
  })

  it('Windows：nvm-windows、fnm、Volta、mise 的版本目录（GUI 进程的 PATH 里没有它们）', () => {
    mockDirs({
      'D:\\nvm': ['v20.11.0', 'v22.11.0', 'elevate.cmd', 'settings.txt'],
      'C:\\Users\\tester\\AppData\\Local\\nvm': ['v24.1.0'],
      'C:\\Users\\tester\\AppData\\Roaming\\fnm\\node-versions': ['v24.1.0'],
      'C:\\Users\\tester\\AppData\\Local\\Volta\\tools\\image\\node': ['22.11.0'],
      'C:\\Users\\tester\\AppData\\Local\\mise\\installs\\node': ['22.11.0', '22', 'latest'],
      'C:\\Users\\tester\\AppData\\Local\\mise\\installs\\deno': ['2.3.1'],
    })
    const home = 'C:\\Users\\tester'
    const candidates = jsRuntimeCandidates('win32', { PATH: '', NVM_HOME: 'D:\\nvm', NVM_SYMLINK: 'E:\\node-current' }, home)
    expect(candidates).toEqual(expect.arrayContaining([
      { kind: 'node', path: 'E:\\node-current\\node.exe' },
      { kind: 'node', path: 'D:\\nvm\\v22.11.0\\node.exe' },
      { kind: 'node', path: 'C:\\Users\\tester\\AppData\\Local\\nvm\\v24.1.0\\node.exe' },
      { kind: 'node', path: 'C:\\Users\\tester\\AppData\\Roaming\\fnm\\node-versions\\v24.1.0\\installation\\node.exe' },
      { kind: 'node', path: 'C:\\Users\\tester\\AppData\\Local\\Volta\\tools\\image\\node\\22.11.0\\node.exe' },
      { kind: 'node', path: 'C:\\Users\\tester\\AppData\\Local\\mise\\installs\\node\\22.11.0\\node.exe' },
      { kind: 'deno', path: 'C:\\Users\\tester\\AppData\\Local\\mise\\installs\\deno\\2.3.1\\bin\\deno.exe' },
    ]))
    const paths = candidates.map(c => c.path)
    expect(paths).not.toContain('D:\\nvm\\v20.11.0\\node.exe')
    expect(paths).not.toContain('C:\\Users\\tester\\AppData\\Local\\mise\\installs\\node\\22\\node.exe')
    // 没有 NVM_SYMLINK 时（应用早于 nvm-windows 启动、继承的是旧环境）用安装程序的默认位置
    expect(jsRuntimeCandidates('win32', { PATH: '' }, home)).toContainEqual({ kind: 'node', path: 'C:\\nvm4w\\nodejs\\node.exe' })
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
