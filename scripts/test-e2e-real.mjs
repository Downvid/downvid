#!/usr/bin/env node
/**
 * 真机 E2E：用**本机真实的 yt-dlp / ffmpeg** 跑一次完整链路。
 *
 * ## 为什么需要它（而不是只靠集成回归）
 *
 * 仓库里已有的 `test:download:integration` / `test:parse:integration` 用的是
 * **本地 HTTP 假服务器 + mock 掉的 yt-dlp**：它们能证明「我们的代码逻辑没坏」，
 * 但证明不了「真实 yt-dlp 的输出我们仍然解析得对」。
 *
 * 而这个项目最贵的两类 bug 恰好只在真机上才出现：
 *   - yt-dlp 改了进度输出格式 → 进度条不动，但所有单测全绿
 *   - yt-dlp 改了参数含义 → 参数拼错不报错，只是拿不到想要的格式
 *
 * 重构期间（尤其 TS → Go 移植）每走一步都要问「行为还是原来那个吗」。
 * 假服务器能回答一半，真机回答另一半。
 *
 * ## 设计要点
 *
 * 1. **不联网**：用本地 HTTP 服务提供一个真实的小 MP4 作为下载源，
 *    避免外网站点改版 / 限流 / 地区差异导致的随机失败（那类失败会训练人忽略红灯）。
 *    代价是「真实站点的解析」不在这层覆盖——那条靠 `test:parse:integration`
 *    与人工验收，文档里已写明。
 * 2. **依赖真实存在才跑**：检测不到可用的 yt-dlp 时**跳过并明确说明**，
 *    而不是假装通过。CI 里没装依赖是正常的。
 * 3. **比对的是产物**：文件真的落盘、大小与 SHA-256 与夹具一致，而不是「函数返回了 true」。
 *
 * 用法：
 *   node scripts/test-e2e-real.mjs                 # 全量
 *   node scripts/test-e2e-real.mjs --only=probe    # 只跑某一项
 *   node scripts/test-e2e-real.mjs --keep          # 保留临时目录便于排查
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const ROOT = path.resolve(import.meta.dirname, '..')
const KEEP = process.argv.includes('--keep')
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1]

const results = []
const skipped = []

function pass(name, detail = '') {
  results.push({ name, ok: true, detail })
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`)
}
function fail(name, detail) {
  results.push({ name, ok: false, detail })
  console.error(`  ✗ ${name} — ${detail}`)
}
function skip(name, why) {
  skipped.push({ name, why })
  console.log(`  · ${name} — 跳过：${why}`)
}

// ===== 定位真实依赖 =====

/** 与应用相同的查找顺序：托管目录优先，其次 PATH */
async function findYtDlp() {
  const managed = path.join(
    os.homedir(),
    process.platform === 'darwin'
      ? 'Library/Application Support/downvid/runtime/bin/yt-dlp'
      : process.platform === 'win32'
        ? 'AppData/Roaming/downvid/runtime/bin/yt-dlp.exe'
        : '.config/downvid/runtime/bin/yt-dlp',
  )
  if (fs.existsSync(managed)) return managed
  try {
    const { stdout } = await execFileAsync(process.platform === 'win32' ? 'where' : 'which', ['yt-dlp'])
    return stdout.trim().split('\n')[0]
  } catch {
    return null
  }
}

async function findFfmpeg() {
  try {
    const { stdout } = await execFileAsync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'])
    return stdout.trim().split('\n')[0]
  } catch {
    return null
  }
}

// ===== 夹具：真实可播放的最小 MP4 =====

/**
 * 用 ffmpeg 现场生成夹具，而不是往仓库里塞二进制。
 *
 * 好处：仓库不增加二进制、格式与编解码可随需求调整、SHA 由本进程现算。
 * 代价：跑之前需要 ffmpeg（本来就是 E2E 的前提之一）。
 */
async function makeFixture(ffmpeg, dir) {
  const out = path.join(dir, 'fixture.mp4')
  await execFileAsync(ffmpeg, [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest',
    out,
  ])
  const buf = fs.readFileSync(out)
  return { path: out, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') }
}

/** 本地 HTTP 服务：提供夹具，并支持 Range（直链下载的分块续传依赖它） */
function serveFixture(fixture) {
  const buf = fs.readFileSync(fixture.path)
  const server = http.createServer((req, res) => {
    const range = req.headers.range
    if (!range) {
      res.writeHead(200, { 'Content-Length': buf.length, 'Accept-Ranges': 'bytes', 'Content-Type': 'video/mp4' })
      res.end(buf)
      return
    }
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    const start = m?.[1] ? Number(m[1]) : 0
    const end = m?.[2] ? Number(m[2]) : buf.length - 1
    if (start >= buf.length) {
      res.writeHead(416).end()
      return
    }
    const slice = buf.subarray(start, Math.min(end, buf.length - 1) + 1)
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${start + slice.length - 1}/${buf.length}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': slice.length,
      'Content-Type': 'video/mp4',
    })
    res.end(slice)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, url: `http://127.0.0.1:${port}/fixture.mp4` })
    })
  })
}

// ===== 各项检查 =====

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'downvid-e2e-'))
  console.log(`真机 E2E（临时目录 ${tmp}）\n`)

  const ytdlp = await findYtDlp()
  const ffmpeg = await findFfmpeg()

  // ---- 1. 依赖探测（真机）----
  if (!ONLY || ONLY === 'probe') {
    if (!ytdlp) {
      skip('依赖探测', '本机没有可用的 yt-dlp')
    } else {
      try {
        const { stdout } = await execFileAsync(ytdlp, ['--ignore-config', '--version'], { timeout: 30_000 })
        const v = stdout.trim()
        // 版本号必须能被 parseDiagnostic 认出来（那是错误诊断里唯一可信的版本信息）
        if (!/^\d{4}\.\d{2}\.\d{2}/.test(v)) throw new Error(`版本输出无法识别：${JSON.stringify(v)}`)
        pass('依赖探测', `yt-dlp ${v}`)
      } catch (e) {
        fail('依赖探测', `yt-dlp --version 失败：${e.message}`)
      }
    }
  }

  // ---- 2. 夹具生成（真机 ffmpeg）----
  if (!ffmpeg) {
    skip('夹具生成', '本机没有 ffmpeg（这是 E2E 的前提）')
    console.log('\n无法继续：缺少 ffmpeg。')
    finish(tmp)
    return
  }

  let fixture
  try {
    fixture = await makeFixture(ffmpeg, tmp)
    if (!ONLY || ONLY === 'fixture') pass('夹具生成', `${(fixture.size / 1024).toFixed(1)} KB，SHA-256 ${fixture.sha256.slice(0, 16)}…`)
  } catch (e) {
    fail('夹具生成', e.message)
    finish(tmp)
    return
  }

  const { server, url } = await serveFixture(fixture)

  // ---- 3. Range 分块下载（直链路径的真实形态）----
  if (!ONLY || ONLY === 'range') {
    try {
      const parts = 4
      const size = fixture.size
      const chunk = Math.ceil(size / parts)
      const buffers = []
      for (let i = 0; i < parts; i++) {
        const start = i * chunk
        const end = Math.min(start + chunk - 1, size - 1)
        const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } })
        if (res.status !== 206) throw new Error(`分块 ${i} 返回 ${res.status}，期望 206`)
        buffers.push(Buffer.from(await res.arrayBuffer()))
      }
      const joined = Buffer.concat(buffers)
      const sha = crypto.createHash('sha256').update(joined).digest('hex')
      if (sha !== fixture.sha256) throw new Error('分块拼接后 SHA-256 与源文件不一致')
      pass('Range 分块下载', `${parts} 块，逐字节一致`)
    } catch (e) {
      fail('Range 分块下载', e.message)
    }
  }

  // ---- 4. yt-dlp 真实解析（generic 提取器）----
  if (!ONLY || ONLY === 'parse') {
    if (!ytdlp) {
      skip('yt-dlp 真实解析', '本机没有可用的 yt-dlp')
    } else {
      try {
        const { stdout } = await execFileAsync(
          ytdlp,
          [
            '--ignore-config', '--no-playlist', '--no-check-certificates', '--quiet',
            '--socket-timeout', '10', '--extractor-retries', '1',
            '--dump-json', url,
          ],
          { timeout: 60_000, maxBuffer: 32 * 1024 * 1024 },
        )
        const info = JSON.parse(stdout.split('\n').find((l) => l.trim().startsWith('{')) || '{}')
        if (!info.title && !info.id) throw new Error('解析结果缺少 title/id')
        if (!Array.isArray(info.formats) || info.formats.length === 0) throw new Error('解析结果缺少 formats')
        pass('yt-dlp 真实解析', `${info.formats.length} 条格式`)
      } catch (e) {
        fail('yt-dlp 真实解析', String(e.message).slice(0, 200))
      }
    }
  }

  // ---- 5. yt-dlp 真实下载 + 进度输出协议 ----
  //
  // 这一条最重要：进度靠 `--progress-template` 的 `[dvp]` 前缀行驱动，
  // 而它一旦变化，界面进度条不动、所有单测仍全绿。
  if (!ONLY || ONLY === 'download') {
    if (!ytdlp) {
      skip('yt-dlp 真实下载', '本机没有可用的 yt-dlp')
    } else {
      try {
        const outDir = path.join(tmp, 'dl')
        fs.mkdirSync(outDir, { recursive: true })
        const dvpLines = []
        const stderrLines = []
        await new Promise((resolve, reject) => {
          const child = spawn(ytdlp, [
            '--ignore-config', '--no-playlist', '--no-check-certificates', '--quiet',
            '--socket-timeout', '10',
            // `--progress` 必须显式给：`--progress-template` 只改格式，不负责开启进度输出。
            // 而且 `--quiet` 会把进度一起压掉，所以两者必须同时出现（生产代码
            // electron/download/ytdlp.ts 里就是 '--newline', '--progress', '--progress-template' 这一组）。
            // 这条差异正是本 harness 存在的意义：它先在我自己的脚本上暴露了一次。
            '--newline', '--progress',
            '--progress-template', 'download:[dvp]%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes_estimate)s',
            '--output', path.join(outDir, 'e2e.%(ext)s'),
            url,
          ])
          child.stdout.on('data', (d) => {
            for (const line of d.toString().split('\n')) if (line.startsWith('[dvp]')) dvpLines.push(line)
          })
          child.stderr.on('data', (d) => stderrLines.push(d.toString()))
          child.on('error', reject)
          child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`yt-dlp 退出码 ${code}：${stderrLines.join('').slice(-300)}`))))
        })

        // 1) 进度行必须出现，且格式可解析（前缀 + 至少 3 个字段）
        if (dvpLines.length === 0) throw new Error('没有收到任何 [dvp] 进度行（--progress-template 失效或输出流变了）')
        const sample = dvpLines[dvpLines.length - 1]
        const fields = sample.replace('[dvp]', '').split('|')
        if (fields.length < 3) throw new Error(`[dvp] 行字段数不足：${sample}`)

        // 2) 文件必须真的落盘且逐字节一致
        const produced = fs.readdirSync(outDir).filter((f) => !f.endsWith('.part'))
        if (produced.length !== 1) throw new Error(`期望 1 个产物，实际 ${produced.length} 个：${produced.join(',')}`)
        const buf = fs.readFileSync(path.join(outDir, produced[0]))
        const sha = crypto.createHash('sha256').update(buf).digest('hex')
        if (sha !== fixture.sha256) throw new Error(`下载产物 SHA-256 不一致（${sha.slice(0, 12)} vs ${fixture.sha256.slice(0, 12)}）`)

        pass('yt-dlp 真实下载', `${dvpLines.length} 条进度，产物逐字节一致`)
      } catch (e) {
        fail('yt-dlp 真实下载', String(e.message).slice(0, 300))
      }
    }
  }

  server.close()
  finish(tmp)
}

function finish(tmp) {
  const failed = results.filter((r) => !r.ok)
  const passed = results.filter((r) => r.ok)

  if (!KEEP) {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  } else {
    console.log(`\n临时目录保留在：${tmp}`)
  }

  console.log('')
  if (skipped.length) console.log(`跳过 ${skipped.length} 项（缺少真实依赖，不算失败）`)
  if (failed.length) {
    console.error(`真机 E2E 未通过：${passed.length} 通过 / ${failed.length} 失败`)
    for (const f of failed) console.error(`  ✗ ${f.name}：${f.detail}`)
    process.exit(1)
  }
  if (passed.length === 0) {
    console.log('真机 E2E：全部跳过（本机缺少 yt-dlp / ffmpeg）。这不是通过，请在有依赖的机器上重跑。')
    process.exit(0)
  }
  console.log(`真机 E2E 通过：${passed.length} 项`)
}

run().catch((e) => {
  console.error('真机 E2E 运行出错：', e)
  process.exit(1)
})
