#!/usr/bin/env node
/**
 * TS ↔ Go 移植的交叉验证。
 *
 * ## 为什么需要它
 *
 * 把 `electron/` 的逻辑搬到 Go 时，「行为是否还是原来那个」是唯一重要的验收标准，
 * 而它最容易验证错——单测两边各自通过，不代表两边对同一输入给出**相同输出**。
 *
 * 实测已经抓到一个真实案例：TS 的 `accelerationConnections()` 在未配置加速度时
 * 默认 **8 连接**（`enabled !== false` + 默认 8），而 Go 侧把「未设置」当成「关闭」
 * 返回 1。两边各自的单测都通过，但同一份设置拼出的 yt-dlp 参数不同——
 * 表现是「下载悄悄退回单连接」，没有任何报错。
 *
 * 第二例：TS 的 `buildYtdlpArgs` **不含 URL**（URL 由调用方在 spawn 时拼在
 * cookie 参数之后），Go 第一版把 URL 拼在末尾。边界变了，后续加 cookie 的处理
 * 会静默出错。
 *
 * ## 做法
 *
 * 1. 在**宿主（Node）**里加载 TS 生产源码，对一批输入跑出结果
 * 2. 把输入与结果写进临时 JSON
 * 3. 让 Go 的测试读同一份输入、重算、逐字比对
 *
 * 这样两边用的是**同一份用例**，不是两份「意思差不多」的用例。
 *
 * ## 用法
 *
 *   node scripts/crosscheck-port.mjs            # 只跑已有模块
 *   node scripts/crosscheck-port.mjs --module ytdlp-args
 *
 * 前置：Go ≥ 1.25；宿主能加载 TS（用 scripts/lib/load-source.mjs 的 loader）。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { loader } from './lib/load-source.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const onlyModule = process.argv.find((a) => a.startsWith('--module='))?.split('=')[1]

/**
 * 每个模块的用例集。
 *
 * 用例要覆盖**分支组合**而不只是「正常路径」：分支差异正是移植最常丢的东西。
 * 每加一组，就同时被 TS 实现与 Go 实现消费。
 */
const MODULES = {
  'ytdlp-args': {
    tsFile: 'electron/download/ytdlp.ts',
    goDir: 'app/internal/download',
    goTest: 'TestCrossCheckWithTS',
    // 加载 TS 模块时需要替身的依赖（它们会拉进 Electron / 真实进程）
    mocks: {
      'electron/utils/binary.ts': {
        resolveDependency: async () => '/x',
        getFfmpegLocation: () => '',
        checkJsRuntime: async () => null,
      },
      'electron/utils/cookies.ts': {
        getCookieAttempts: () => [],
        runWithCookies: async (_a, run) => run([]),
        cookieFailureHint: () => '',
        isCookieError: () => false,
      },
      'electron/store.ts': { activeDownloads: new Map(), broadcast: () => {} },
      'electron/download/progress.ts': {
        sendDownloadProgress: () => {}, throttledProgress: () => {},
        clearProgressThrottle: () => {}, formatBytes: () => '', formatEta: () => '',
      },
      'electron/download/aria2.ts': { detectAria2: async () => null },
      'electron/download/process-tree.ts': {
        killProcessTree: async () => {}, treeSpawnOptions: () => ({}),
      },
      'electron/download/aria2-progress.ts': { parseAria2Progress: () => null },
      'electron/parsers/ytdlp.ts': { getExtractorArgs: () => [], promptNodeDownload: async () => {} },
      electron: { dialog: {}, shell: {} },
      'node:child_process': {
        spawn: () => ({ on: () => {}, stdout: { on: () => {} }, stderr: { on: () => {} } }),
      },
      'node:fs': {
        existsSync: () => false, statSync: () => ({ mtimeMs: 0 }),
        readdirSync: () => [], rmSync: () => {},
      },
    },
    buildCases() {
      const base = { url: 'https://example.com/v/1', formatId: '137', taskId: 't1' }
      const mk = (kw = {}) => ({ ...base, ...kw })
      const ctxBase = { ffmpegLocation: '/opt/homebrew/bin', jsRuntime: null }
      const cases = [
        // 基础与三种模式
        [mk(), ctxBase],
        [mk({ downloadMode: 'audio', formatId: '140' }), ctxBase],
        [mk({ downloadMode: 'subtitle', subtitles: ['zh-Hans', 'en'] }), { ...ctxBase, ffmpegLocation: '' }],
        // 格式选择分支
        [mk({ hasAudio: true }), ctxBase],
        [mk({ hasAudio: false }), ctxBase],
        [mk({ hasAudio: false, audioTrack: { language: 'ja' } }), ctxBase],
        [mk({ audioTrack: { formatId: 'hls-audio', isM3u8: true } }), ctxBase],
        // 文件名模板
        [mk({ filenameTemplate: '%(title)s-%(id)s' }), ctxBase],
        [mk({ filenameTemplate: '%(title)s.%(ext)s' }), ctxBase],
        // 代理
        [mk({ proxy: 'http://127.0.0.1:7890' }), ctxBase],
        // 加速开关（含「未配置」这个被交叉验证抓到的分支）
        [mk({ acceleration: { enabled: true, maxConnections: 12, aria2Path: '' } }),
          { ...ctxBase, aria2Path: 'C:\\tools with spaces\\aria2c.exe' }],
        [mk({ acceleration: { enabled: false, maxConnections: 16, aria2Path: '' } }),
          { ...ctxBase, aria2Path: '/bin/aria2c' }],
        [mk(), { ...ctxBase, aria2Path: '/bin/aria2c' }],
        // JS 运行时
        [mk({ url: 'https://www.youtube.com/watch?v=x' }),
          { ...ctxBase, jsRuntime: { path: '/usr/bin/node', kind: 'node', name: 'Node.js' } }],
        [mk({ url: 'https://www.youtube.com/watch?v=x' }),
          { ...ctxBase, jsRuntime: { path: '/usr/bin/deno', kind: 'deno', name: 'Deno' } }],
        // 视频 + 字幕
        [mk({ subtitles: ['en'] }), ctxBase],
      ]
      return cases.map(([options, ctx]) => ({
        options: { ...options, outputDir: path.join('tmp', 'out') },
        outDir: path.join('tmp', 'out'),
        ctx,
      }))
    },
    tsCall(mod, testCase) {
      return mod.buildYtdlpArgs(testCase.options, testCase.outDir, testCase.ctx)
    },
  },
}

const selected = onlyModule ? { [onlyModule]: MODULES[onlyModule] } : MODULES
if (Object.keys(selected).length === 0 || Object.values(selected).some((m) => !m)) {
  console.error(`未知模块：${onlyModule}。可用：${Object.keys(MODULES).join(', ')}`)
  process.exit(1)
}

let failed = 0

for (const [name, spec] of Object.entries(selected)) {
  console.log(`\n=== ${name} ===`)
  const load = loader(spec.mocks)
  let mod
  try {
    mod = load(spec.tsFile)
  } catch (e) {
    console.error(`  ✗ 加载 ${spec.tsFile} 失败：${e.message}`)
    failed++
    continue
  }

  const cases = spec.buildCases()
  const results = []
  try {
    for (const c of cases) results.push(spec.tsCall(mod, c))
  } catch (e) {
    console.error(`  ✗ 生成 TS 结果失败：${e.message}`)
    failed++
    continue
  }

  // 交给 Go 侧比对（Go 测试会读这两个文件）
  const casesFile = path.join(os.tmpdir(), 'downvid-port-cases.json')
  const outFile = path.join(os.tmpdir(), 'downvid-port-ts-out.json')
  fs.writeFileSync(casesFile, JSON.stringify(cases, null, 1))
  fs.writeFileSync(outFile, JSON.stringify(results, null, 1))

  // Go 测试里读的是固定路径，保持一致
  fs.copyFileSync(casesFile, '/tmp/cases.json')
  fs.copyFileSync(outFile, '/tmp/ts-out.json')

  console.log(`  TS 侧生成 ${results.length} 组结果 → ${casesFile}`)
  try {
    const out = execFileSync('go', ['test', '-run', spec.goTest, '-v', `./${path.relative('app', path.join(ROOT, spec.goDir))}/`], {
      cwd: path.join(ROOT, 'app'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const line = out.split('\n').find((l) => l.includes('交叉验证通过'))
    console.log(`  ✓ ${line?.trim() ?? 'Go 侧比对通过'}`)
  } catch (e) {
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`
    console.error('  ✗ Go 侧比对不一致：')
    // 只打差异行，避免刷屏
    for (const line of out.split('\n')) {
      if (/got:|want:|不一致|FAIL/.test(line)) console.error(`      ${line.trim().slice(0, 300)}`)
    }
    failed++
  }
}

console.log('')
if (failed) {
  console.error(`交叉验证未通过：${failed} 个模块`)
  console.error('两边各自的单测都通过、但同一输入给出不同输出，是移植期最容易漏的一类问题。')
  process.exit(1)
}
console.log(`交叉验证通过：${Object.keys(selected).length} 个模块，TS 与 Go 对同一批输入输出逐字一致。`)
