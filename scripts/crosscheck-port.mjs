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

  /**
   * 格式列表生成。
   *
   * 比参数组装更值得交叉验证——这里有**排序 + 去重**，而两者的顺序敏感：
   * 排序决定「同一清晰度留哪一个」，去重决定「留下哪些」。任何一处不同都会
   * 让界面显示不同的选项，但两边单测都绿。
   */
  formats: {
    tsFile: 'electron/parsers/formats.ts',
    goDir: 'app/internal/parse',
    goTest: 'TestCrossCheckFormats',
    mocks: {},
    buildCases() {
      // 真实 bilibili 数据的 12 条（三编码 + 浮点 fps 抖动）
      const bilibili = {
        duration: 1206.833,
        formats: [
          { format_id: '30011', height: 360, fps: 29.969, vcodec: 'hev1.1.6.L120', acodec: 'none', tbr: 253.637 },
          { format_id: '100022', height: 360, fps: 29.969, vcodec: 'av01.0.00M.10', acodec: 'none', tbr: 226.967 },
          { format_id: '30016', height: 360, fps: 29.97, vcodec: 'avc1.64001E', acodec: 'none', tbr: 363.121 },
          { format_id: '30033', height: 480, fps: 29.969, vcodec: 'hev1.1.6.L120', acodec: 'none', tbr: 415.96 },
          { format_id: '100023', height: 480, fps: 29.969, vcodec: 'av01.0.00M.10', acodec: 'none', tbr: 382.091 },
          { format_id: '30032', height: 480, fps: 29.97, vcodec: 'avc1.64001F', acodec: 'none', tbr: 621.299 },
          { format_id: '30066', height: 720, fps: 29.969, vcodec: 'hev1.1.6.L120', acodec: 'none', tbr: 878.474 },
          { format_id: '100024', height: 720, fps: 29.969, vcodec: 'av01.0.00M.10', acodec: 'none', tbr: 819.378 },
          { format_id: '30064', height: 720, fps: 29.97, vcodec: 'avc1.640028', acodec: 'none', tbr: 1301.438 },
          { format_id: '30077', height: 1080, fps: 29.969, vcodec: 'hev1.1.6.L150', acodec: 'none', tbr: 2070.001 },
          { format_id: '100026', height: 1080, fps: 29.969, vcodec: 'av01.0.00M.10', acodec: 'none', tbr: 2000.529 },
          { format_id: '30080', height: 1080, fps: 29.97, vcodec: 'avc1.640032', acodec: 'none', tbr: 3252.336 },
        ],
      }
      return [
        { info: bilibili, isYoutube: false, allow: false },
        { info: bilibili, isYoutube: true, allow: false },
        { info: bilibili, isYoutube: true, allow: true },
        // 无 vcodec（X/Twitter）
        { info: { formats: [{ format_id: 'http-1', url: 'https://x/v.mp4', ext: 'mp4', width: 1280, height: 720 }] }, isYoutube: false, allow: false },
        // m3u8 共存
        { info: { formats: [
          { format_id: 'direct-720', vcodec: 'h264', height: 720, width: 1280, ext: 'mp4', protocol: 'https' },
          { format_id: 'hls-720', vcodec: 'h264', height: 720, width: 1280, ext: 'mp4', protocol: 'm3u8_native' },
        ] }, isYoutube: false, allow: false },
        // 只有 m3u8
        { info: { formats: [
          { format_id: 'direct-360', vcodec: 'h264', height: 360, width: 640, ext: 'mp4', protocol: 'https' },
          { format_id: 'hls-1080', vcodec: 'h264', height: 1080, width: 1920, ext: 'mp4', protocol: 'm3u8_native' },
        ] }, isYoutube: false, allow: false },
        // 无分辨率 → 兜底
        { info: { formats: [{ format_id: 'x', vcodec: 'h264', ext: 'mp4' }] }, isYoutube: false, allow: false },
        // 空
        { info: { formats: [] }, isYoutube: false, allow: false },
        { info: {}, isYoutube: false, allow: false },
        // 音轨标记
        { info: { formats: [
          { format_id: 'with-audio', vcodec: 'h264', acodec: 'aac', height: 720, width: 1280, ext: 'mp4' },
          { format_id: 'video-only', vcodec: 'h264', acodec: 'none', height: 1080, width: 1920, ext: 'mp4' },
        ] }, isYoutube: false, allow: false },
        // 编码优先级 vs 码率
        { info: { formats: [
          { format_id: 'av1', vcodec: 'av01.0.00M.10', height: 1080, fps: 30, acodec: 'none', tbr: 9999 },
          { format_id: 'hevc', vcodec: 'hev1.1.6.L150', height: 1080, fps: 30, acodec: 'none', tbr: 5000 },
          { format_id: 'avc', vcodec: 'avc1.640032', height: 1080, fps: 30, acodec: 'none', tbr: 1000 },
        ] }, isYoutube: false, allow: false },
        // fps 抖动去重
        { info: { formats: [
          { format_id: 'x1', vcodec: 'hev1.1.6.L150', height: 1080, fps: 29.969, acodec: 'none' },
          { format_id: 'x2', vcodec: 'avc1.640032', height: 1080, fps: 29.97, acodec: 'none' },
        ] }, isYoutube: false, allow: false },
        // quality 标签不同但同 height
        { info: { formats: [
          { format_id: 'lab1', vcodec: 'avc1', height: 1080, fps: 30, acodec: 'none', format_note: '1080P' },
          { format_id: 'lab2', vcodec: 'hev1', height: 1080, fps: 30, acodec: 'none', format_note: '1080P60' },
        ] }, isYoutube: false, allow: false },
        // 30 vs 60 fps
        { info: { formats: [
          { format_id: 'a', vcodec: 'avc1', height: 1080, fps: 30, acodec: 'none' },
          { format_id: 'b', vcodec: 'avc1', height: 1080, fps: 60, acodec: 'none' },
        ] }, isYoutube: false, allow: false },
        // 分辨率档位与 fps 后缀
        { info: { formats: [
          { format_id: 'h4k', vcodec: 'avc1', height: 2160, fps: 60, acodec: 'none' },
          { format_id: 'h2k', vcodec: 'avc1', height: 1440, fps: 30, acodec: 'none' },
          { format_id: 'h144', vcodec: 'avc1', height: 144, fps: 0, acodec: 'none' },
        ] }, isYoutube: false, allow: false },
        // filesize 由 tbr + duration 推算
        { info: { duration: 100, formats: [
          { format_id: 'bitrate', vcodec: 'avc1', height: 720, tbr: 1000, acodec: 'none' },
        ] }, isYoutube: false, allow: false },
        // filesize 缺失、只有 vbr+abr
        { info: { duration: 100, formats: [
          { format_id: 'vbr', vcodec: 'avc1', height: 720, vbr: 800, abr: 128, acodec: 'aac' },
        ] }, isYoutube: false, allow: false },
        // **fps 不在常见档位**：走 NormalizeFPS 的 round 分支而不是「命中容差」分支。
        // 少了这条，把 round 改成截断（29.9 → 29）这类变异不会被发现——
        // 因为其他用例的 fps 都在容差内，两条分支结果相同。
        { info: { formats: [
          { format_id: 'odd', vcodec: 'avc1', height: 720, fps: 29.4, acodec: 'none' },
          { format_id: 'odd2', vcodec: 'avc1', height: 480, fps: 33.7, acodec: 'none' },
          { format_id: 'odd3', vcodec: 'avc1', height: 360, fps: 7.6, acodec: 'none' },
        ] }, isYoutube: false, allow: false },
      ]
    },
    tsCall(mod, testCase) {
      return mod.buildVideoFormats(testCase.info, testCase.isYoutube, testCase.allow)
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

  // 交给 Go 侧比对。
  //
  // **每个模块用独立文件名**：早先所有模块都写 /tmp/cases.json，虽然因为
  // 「写一份→立刻比对」的顺序而碰巧没出错，但一旦有人把比对挪到循环外，
  // 后一个模块就会覆盖前一个的用例，表现为「莫名通过」或「莫名不一致」。
  const casesFile = `/tmp/downvid-cases-${name}.json`
  const outFile = `/tmp/downvid-tsout-${name}.json`
  fs.writeFileSync(casesFile, JSON.stringify(cases, null, 1))
  fs.writeFileSync(outFile, JSON.stringify(results, null, 1))

  console.log(`  TS 侧生成 ${results.length} 组结果 → ${casesFile}`)
  try {
    const out = execFileSync('go', ['test', '-run', spec.goTest, '-v', `./${path.relative('app', path.join(ROOT, spec.goDir))}/`], {
      env: { ...process.env, DOWNVID_CROSSCHECK_MODULE: name },
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
