import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

if (process.platform !== 'win32') {
  console.log('原生 Windows 依赖回归仅在 Windows 上运行')
  process.exit(0)
}

const root = process.cwd()
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'downvid-runtime-'))
const fixture = path.join(temp, 'fixture.exe')
const sidecar = path.join(temp, 'downvid-deps.exe')
function build(output, source) {
  const run = spawnSync('go', ['build', '-o', output, source], {
    cwd: path.join(root, 'backend'), encoding: 'utf8', windowsHide: true,
  })
  assert.equal(run.status, 0, run.error?.message || run.stderr)
}
function binary(dir, kind, mode) {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${kind}.exe`)
  fs.copyFileSync(fixture, file)
  if (mode) fs.writeFileSync(path.join(dir, 'mode.txt'), mode)
  return file
}
function check(name, setup, verify) {
  const home = path.join(temp, name)
  fs.mkdirSync(home, { recursive: true })
  const env = {
    ...process.env, USERPROFILE: home, PATH: '',
    LOCALAPPDATA: path.join(home, 'local'),
    ProgramFiles: path.join(home, 'programs'),
    'ProgramFiles(x86)': path.join(home, 'programs-x86'),
    ProgramData: path.join(home, 'data'),
    SCOOP: path.join(home, 'scoop'), SCOOP_GLOBAL: path.join(home, 'scoop-global'),
    ChocolateyInstall: path.join(home, 'choco'),
  }
  const { args = [], expected } = setup(home, env)
  const start = Date.now()
  const run = spawnSync(sidecar, ['detect', '--json', '--managed-dir', path.join(home, 'managed'), ...args], {
    env, encoding: 'utf8', windowsHide: true, timeout: 55000,
  })
  assert.equal(run.status, 0, run.error?.message || run.stderr)
  const results = JSON.parse(run.stdout).results
  verify(results, expected, Date.now() - start)
  console.log(`通过：${name}`)
}
const entry = (results, kind) => results.find(item => item.kind === kind)

try {
  build(fixture, path.join(root, 'scripts', 'fixtures', 'runtime-tool.go'))
  build(sidecar, './cmd/downvid-deps')
  check('managed', home => {
    const expected = binary(path.join(home, 'managed'), 'yt-dlp')
    return { expected }
  }, (results, expected) => {
    assert.equal(entry(results, 'yt-dlp').path, expected)
    assert.equal(entry(results, 'yt-dlp').source, 'managed')
  })
  for (const mode of ['error', 'error-zero', 'version-error']) {
    check(mode, (home, env) => {
      binary(path.join(home, 'managed'), 'ffmpeg', mode)
      const dir = path.join(home, 'valid')
      env.PATH = dir
      return { expected: binary(dir, 'ffmpeg') }
    }, (results, expected) => {
      assert.equal(entry(results, 'ffmpeg').path, expected)
      assert.equal(entry(results, 'ffmpeg').version, '6.0')
    })
  }
  for (const mode of ['broken', 'old']) {
    check(`scan-${mode}`, home => {
      const badDir = path.join(home, 'Downloads', 'a-bad')
      if (mode === 'broken') {
        fs.mkdirSync(badDir, { recursive: true })
        fs.writeFileSync(path.join(badDir, 'ffprobe.exe'), 'not executable')
      } else binary(badDir, 'ffprobe', 'old')
      return { expected: binary(path.join(home, 'Downloads', 'b-valid'), 'ffprobe') }
    }, (results, expected) => assert.equal(entry(results, 'ffprobe').path, expected))
  }
  check('relocated-winget', (home, env) => {
    env.LOCALAPPDATA = path.join(home, 'relocated-local')
    return { expected: binary(path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages', 'yt-dlp.yt-dlp_test'), 'yt-dlp') }
  }, (results, expected) => assert.equal(entry(results, 'yt-dlp').path, expected))
  check('relocated-scoop', (home, env) => {
    env.SCOOP = path.join(home, 'relocated-scoop')
    return { expected: binary(path.join(env.SCOOP, 'apps', 'yt-dlp', 'current'), 'yt-dlp') }
  }, (results, expected) => assert.equal(entry(results, 'yt-dlp').path, expected))
  // 转译实际模块，在独立环境中验证 WinGet Deno 的最终选择。
  const jsHome = path.join(temp, 'js-runtime')
  const jsLocal = path.join(jsHome, 'local')
  const deno = binary(path.join(jsLocal, 'Microsoft', 'WinGet', 'Packages', 'DenoLand.Deno_test'), 'deno')
  const jsCode = ts.transpileModule(fs.readFileSync(path.join(root, 'electron', 'utils', 'js-runtime.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const module = { exports: {} }
  const require = createRequire(import.meta.url)
  vm.runInNewContext(jsCode, {
    exports: module.exports, module,
    process: { platform: 'win32', env: {
      PATH: '', LOCALAPPDATA: jsLocal, ProgramFiles: path.join(jsHome, 'programs'),
      'ProgramFiles(x86)': path.join(jsHome, 'programs-x86'), ProgramData: path.join(jsHome, 'data'),
    } },
    require: name => name === 'node:os' ? { ...os, homedir: () => jsHome } : require(name),
  })
  const runtime = await module.exports.checkJsRuntime()
  assert.equal(runtime.kind, 'deno')
  assert.equal(runtime.path, deno)
  assert.equal(runtime.version, '2.3.0')
  console.log('通过：winget-deno-old-path')
  check('slow-candidates', (home, env) => {
    const manual = binary(path.join(home, 'manual'), 'yt-dlp', 'slow')
    binary(path.join(home, 'managed'), 'yt-dlp', 'slow')
    const dirs = ['path-a', 'path-b', 'path-c'].map(dir => path.join(home, dir))
    binary(dirs[0], 'yt-dlp', 'slow')
    binary(dirs[1], 'yt-dlp', 'slow')
    const expected = binary(dirs[2], 'yt-dlp')
    env.PATH = dirs.join(path.delimiter)
    return { args: ['--manual', `yt-dlp=${manual}`], expected }
  }, (results, expected, elapsed) => {
    assert.equal(entry(results, 'yt-dlp').path, expected)
    assert.ok(elapsed < 20000, `检测耗时 ${elapsed} ms`)
  })
  check('total-timeout', home => {
    const manual = binary(path.join(home, 'manual'), 'yt-dlp', 'slow')
    return { args: ['--manual', `yt-dlp=${manual}`, '--timeout', '1'] }
  }, (results, _, elapsed) => {
    assert.equal(entry(results, 'yt-dlp').found, false)
    assert.match(entry(results, 'yt-dlp').reason, /时限/)
    assert.ok(elapsed < 4000, `总时限没有生效：${elapsed} ms`)
  })
  // 用真实父子进程复现 PyInstaller：先杀父进程会使子进程继续写文件。
  const treeDir = path.join(temp, 'pause-tree')
  const treeFile = binary(treeDir, 'yt-dlp', 'tree')
  const child = spawn(treeFile, [], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const activeDownloads = new Map([['pause-test', { child, setPaused: () => {} }]])
  try {
    const progress = path.join(treeDir, 'progress.txt')
    for (let i = 0; i < 50 && !fs.existsSync(progress); i++) await new Promise(resolve => setTimeout(resolve, 100))
    assert.ok(fs.existsSync(progress), '子进程未开始写入')
    const pauseCode = ts.transpileModule(fs.readFileSync(path.join(root, 'electron', 'download', 'ytdlp.ts'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    const pauseModule = { exports: {} }
    vm.runInNewContext(pauseCode, {
      exports: pauseModule.exports, module: pauseModule, process,
      require: name => name === '../store' ? { activeDownloads } : name.startsWith('.') ? {} : require(name),
    })
    let timer
    try {
      assert.equal(await Promise.race([
        pauseModule.exports.pauseDownload('pause-test'),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('暂停未停止进程树')), 5000) }),
      ]), true)
    } finally { clearTimeout(timer) }
    const stoppedAt = fs.readFileSync(progress, 'utf8')
    await new Promise(resolve => setTimeout(resolve, 500))
    assert.equal(fs.readFileSync(progress, 'utf8'), stoppedAt, '暂停后子进程仍在写入')
    console.log('通过：pause-native-process-tree')
  } finally {
    const pidFile = path.join(treeDir, 'child-pid.txt')
    if (fs.existsSync(pidFile)) {
      const pid = fs.readFileSync(pidFile, 'utf8').trim()
      if (/^\d+$/.test(pid)) spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', pid, '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    }
    if (child.exitCode === null && child.signalCode === null) child.kill()
  }
} finally {
  fs.rmSync(temp, { recursive: true, force: true })
}
