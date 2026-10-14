#!/usr/bin/env node
/**
 * 打包产物内容校验（按平台运行）。
 *
 * 「本地能跑」不等于「装完能用」：真正的失败都发生在**用户机器上的安装包**里，
 * 而这些失败本地完全看不到——边车没打进去、app-update.yml 指向旧仓库、
 * 更新清单漏了某个产物。这个脚本在 CI 里对**真实的打包目录**逐项核对。
 *
 * 用法：
 *   node scripts/test-package-contents.mjs                  # 自动在 release 下找解包目录
 *   node scripts/test-package-contents.mjs <解包目录>        # 指定目录
 *
 * 需要先跑过一次 electron-builder --dir。找不到目录时**明确报错**而不是静默跳过：
 * 静默跳过会让「打包配置坏了」变成一个绿勾。
 */

import fs from 'node:fs'
import path from 'node:path'
import { createSuite, platform } from './lib/harness.mjs'

const root = process.cwd()
const suite = createSuite('打包产物内容校验')

/** 按平台找 electron-builder 的解包产物目录 */
function findUnpackedDir() {
  const explicit = process.argv[2]
  if (explicit) return explicit

  const releaseRoot = path.join(root, 'release')
  if (!fs.existsSync(releaseRoot)) return null

  const patterns = platform.isMac
    ? [/^mac(-arm64|-x64)?$/]
    : platform.isWindows
      ? [/^win-unpacked$/]
      : [/^linux-unpacked$/, /^linux-arm64-unpacked$/]

  // 产物可能直接放在 release/ 下，也可能在 release/<version>/ 里
  // （electron-builder.json5 的 directories.output 是 "release/${version}"）。
  // 版本目录按**版本号降序**取第一个命中的：本地跑过多次打包时，
  // release 下会残留旧版本目录，按目录顺序取会校验到过期的产物上
  // （实测踩到：明明刚打了 1.3.5，却在校验 1.3.2）。
  const versionDirs = fs.readdirSync(releaseRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d+\.\d+\.\d+/.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => {
      const pa = a.split('.').map(Number)
      const pb = b.split('.').map(Number)
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0)
      }
      return 0
    })
    .map((name) => path.join(releaseRoot, name))
  const candidates = [releaseRoot, ...versionDirs]

  for (const base of candidates) {
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (!patterns.some((p) => p.test(entry.name))) continue
      const dir = path.join(base, entry.name)
      // macOS 的 .app 在解包目录下一层，这里返回解包目录本身即可
      if (fs.existsSync(dir)) return dir
    }
  }
  return null
}

const unpacked = findUnpackedDir()

/**
 * 定位真正的 Resources 目录。
 *
 * 各平台布局不同，写死 `<dir>/resources` 会让 macOS 上所有检查都假失败：
 *   - macOS  ：<解包目录>/DownVid.app/Contents/Resources
 *   - Windows：<解包目录>/resources
 *   - Linux  ：<解包目录>/resources
 */
function resourcesDir() {
  if (!unpacked) return null
  if (platform.isMac) {
    const app = fs.readdirSync(unpacked, { withFileTypes: true })
      .find((e) => e.isDirectory() && e.name.endsWith('.app'))
    if (!app) return null
    return path.join(unpacked, app.name, 'Contents', 'Resources')
  }
  return path.join(unpacked, 'resources')
}

/** 从 electron-builder.json5 里读一个简单字段（避免引入 json5 依赖） */
function readBuilderConfig() {
  return fs.readFileSync(path.join(root, 'electron-builder.json5'), 'utf8')
}

/** 递归找文件；命中即返回 */
function findFile(dir, predicate, depth = 6) {
  if (depth < 0) return null
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const hit = findFile(full, predicate, depth - 1)
      if (hit) return hit
    } else if (predicate(full, entry.name)) {
      return full
    }
  }
  return null
}

suite.case('找到打包产物目录', async (t) => {
  t.ok(unpacked, '必须先跑 electron-builder --dir 生成解包目录（否则本脚本无从校验）')
  if (unpacked) t.note('产物目录', path.relative(root, unpacked))
})

suite.case('依赖边车被打进 resources/downvid-deps/', async (t) => {
  if (!unpacked) return t.fail('没有产物目录')
  const resources = resourcesDir()
  const name = platform.isWindows ? 'downvid-deps.exe' : 'downvid-deps'
  const sidecar = findFile(path.join(resources, 'downvid-deps'), (f) => path.basename(f) === name)
  t.ok(sidecar, `resources/downvid-deps/${name} 必须存在——没有它依赖检测与下载会整体失效`)
  if (sidecar) {
    const stat = fs.statSync(sidecar)
    t.ok(stat.size > 1024 * 1024, `边车体积应 > 1MB（实际 ${stat.size} 字节，可能没编译成功）`)
    if (!platform.isWindows) {
      t.ok((stat.mode & 0o111) !== 0, '边车必须有可执行权限')
    }
  }
})

suite.case('安装包不含 yt-dlp / ffmpeg / ffprobe 二进制', async (t) => {
  // 每架构约 80MB，且会让仓库靠 Git LFS 膨胀；运行依赖改为按需下载
  if (!unpacked) return t.fail('没有产物目录')
  const resources = resourcesDir()
  const banned = platform.isWindows
    ? ['yt-dlp.exe', 'ffmpeg.exe', 'ffprobe.exe']
    : ['yt-dlp', 'ffmpeg', 'ffprobe']
  const hits = []
  const walk = (dir, depth = 6) => {
    if (depth < 0) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, depth - 1)
      // 边车目录里不该出现这三个；但允许路径里带这些词的其他文件
      else if (banned.includes(entry.name)) hits.push(path.relative(unpacked, full))
    }
  }
  walk(resources)
  t.deepEqual(hits, [], '安装包里不得内置这些二进制（体积与授权都靠这条约束守住）')
})

suite.case('主进程与渲染进程产物都在', async (t) => {
  if (!unpacked) return t.fail('没有产物目录')
  const resources = resourcesDir()
  const asar = findFile(resources, (f) => path.basename(f) === 'app.asar')
  t.ok(asar, 'resources/app.asar 必须存在（前端与主进程代码都打在里面）')
  if (asar) {
    const size = fs.statSync(asar).size
    // 太小通常意味着 vite 构建没跑或 files 配置把 dist 排除了
    t.ok(size > 200 * 1024, `app.asar 体积 ${size} 字节偏小，dist/dist-electron 可能没打进去`)
  }
})

suite.case('app-update.yml 指向正确仓库（写错用户永远收不到更新）', async (t) => {
  if (!unpacked) return t.fail('没有产物目录')
  const resources = resourcesDir()
  const yml = path.join(resources, 'app-update.yml')

  // 注意：`electron-builder --dir`（未打包成安装包）**不会**写入 app-update.yml，
  // 它只在真实安装包里出现。所以在解包目录上跑时不能断言它存在——
  // 否则本地与 CI 的 dir 检查会稳定假失败。要真校验它，请用
  // `--require-app-update-yml`（发布流程里对真实产物跑）。
  if (!fs.existsSync(yml)) {
    if (!process.argv.includes('--require-app-update-yml')) {
      t.note('app-update.yml', '解包目录不含（仅安装包携带），跳过；发布流程用 --require-app-update-yml 校验')
      return
    }
    t.fail('app-update.yml 必须存在（electron-updater 靠它找发布源，缺失会导致「检查不到更新」）')
    return
  }

  const body = fs.readFileSync(yml, 'utf8')
  const shared = fs.readFileSync(path.join(root, 'shared/app.ts'), 'utf8')
  const owner = shared.match(/owner:\s*'([^']+)'/)?.[1]
  const repo = shared.match(/repo:\s*'([^']+)'/)?.[1]

  t.match(body, new RegExp(`^owner: ${owner}$`, 'm'), `owner 必须是 shared/app.ts 里的 ${owner}`)
  t.match(body, new RegExp(`^repo: ${repo}$`, 'm'), `repo 必须是 shared/app.ts 里的 ${repo}`)
  t.match(body, /^provider: github$/m, 'provider 必须是 github')
  t.match(body, /^releaseType: release$/m, 'releaseType 必须是 release')
})

suite.case('版本号与 package.json 一致', async (t) => {
  if (!unpacked) return t.fail('没有产物目录')
  const expected = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version

  if (platform.isMac) {
    const plist = findFile(unpacked, (f) => f.endsWith('.app/Contents/Info.plist') || path.basename(f) === 'Info.plist')
    t.ok(plist, '应能找到 Info.plist')
    if (plist) {
      const body = fs.readFileSync(plist, 'utf8')
      t.ok(body.includes(`<string>${expected}</string>`), `Info.plist 里应含版本 ${expected}`)
    }
  } else if (platform.isWindows) {
    // Windows 版本号在 exe 资源里，不便静态解析；改校验产物名
    const exe = findFile(unpacked, (f) => /DownVid\.exe$/i.test(f))
    t.ok(exe, '应能找到 DownVid.exe')
  } else {
    const pkgType = path.join(resourcesDir(), 'package-type')
    if (fs.existsSync(pkgType)) {
      const type = fs.readFileSync(pkgType, 'utf8').trim()
      t.ok(['deb', 'rpm', 'AppImage'].includes(type), `package-type 应为已知格式，实际 ${type}`)
      t.note('package-type', type)
    }
  }
  t.note('期望版本', expected)
})

suite.case('Linux 的 package-type 决定能否自动更新', async (t) => {
  if (!unpacked) return t.fail('没有产物目录')
  if (!platform.isLinux) return
  // updater 的 unsupportedReason() 依赖它：deb/rpm 走自动更新，
  // 缺了这个文件就会被判成 tar.gz → 只能手动下载
  const pkgType = path.join(resourcesDir(), 'package-type')
  t.ok(fs.existsSync(pkgType), 'resources/package-type 必须存在（否则 deb/rpm 会被误判为 tar.gz）')
})

suite.case('打包配置里声明了边车与产物名契约', async (t) => {
  const cfg = readBuilderConfig()
  t.match(cfg, /"from": "backend\/build\/\$\{platform\}-\$\{arch\}"/, 'extraResources 必须指向边车构建产物')
  t.match(cfg, /"to": "downvid-deps"/, '边车必须放到 resources/downvid-deps')
  // 主进程与渲染进程的依赖都被 vite 内联了，node_modules 属于纯冗余
  t.match(cfg, /"!node_modules"/, 'files 必须排除 node_modules（否则安装包会胖约 40MB）')
  t.match(cfg, /"asar": true/, 'asar 必须开启')
})

suite.case('打包产物里没有源码与开发文件', async (t) => {
  if (!unpacked) return t.fail('没有产物目录')
  const resources = resourcesDir()
  const leaks = []
  const walk = (dir, depth = 5) => {
    if (depth < 0) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (['node_modules', 'src', 'backend', 'tests', '.github'].includes(entry.name)) {
          leaks.push(path.relative(unpacked, full))
          continue
        }
        walk(full, depth - 1)
      }
    }
  }
  walk(resources)
  t.deepEqual(leaks, [], '这些目录不该出现在安装包里（体积与信息泄露）')
})

await suite.run()
