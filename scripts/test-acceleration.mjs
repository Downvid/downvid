import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFile, execFileSync } from 'node:child_process'
import { loader } from './lib/load-source.mjs'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'downvid-acceleration-'))
const data = Buffer.alloc(16 * 1024 * 1024)
for (let i = 0; i < data.length; i++) data[i] = i % 251
let active = 0, peak = 0, ranges = [], sockets = new Set(), sentBytes = 0, intervalMs = 10
const server = http.createServer((req, res) => {
  const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '')
  const start = match ? Number(match[1]) : 0
  const end = match && match[2] ? Number(match[2]) + 1 : data.length
  sockets.add(req.socket.remotePort)
  ranges.push({ start, end })
  res.writeHead(match ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': end - start,
    'Accept-Ranges': 'bytes', ETag: '"fixture-v1"', ...(match ? { 'Content-Range': `bytes ${start}-${end - 1}/${data.length}` } : {}) })
  if (req.method === 'HEAD') { res.end(); return }
  active++; peak = Math.max(peak, active)
  let offset = start
  // 模拟每条连接限速，测并发收益而非宣称真实站点的固定加速倍数。
  const timer = setInterval(() => {
    const next = Math.min(end, offset + 32768)
    res.write(data.subarray(offset, next)); sentBytes += next - offset; offset = next
    if (offset === end) { clearInterval(timer); res.end() }
  }, intervalMs)
  res.on('close', () => { clearInterval(timer); active-- })
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/video.mp4`
const mocks = { electron: { app: { getPath: () => temp }, BrowserWindow: { getAllWindows: () => [] } } }
const load = loader(mocks)
const { downloadDirectFile } = load('electron/download/direct.ts')
const results = []
async function measure(name, operation, output, maxRequests) {
  await new Promise(resolve => setTimeout(resolve, 50))
  peak = 0; ranges = []; sockets = new Set()
  const start = performance.now()
  await operation()
  const milliseconds = Math.round(performance.now() - start)
  assert.deepEqual(fs.readFileSync(output), data)
  if (maxRequests) assert.ok(peak <= maxRequests, `${name} 超过并发上限：${peak}`)
  const result = { name, milliseconds, bytes: data.length, peakRequests: peak, socketsUsed: sockets.size, requests: ranges.length }
  results.push(result)
  console.log(JSON.stringify(result))
}
const settings = count => ({ enabled: count > 1, maxConnections: count, aria2Path: '' })
const direct = (download, count, output) => download({ url, pageUrl: 'https://douyin.com/test', outputPath: output,
  acceleration: settings(count), signal: new AbortController().signal, report: () => {} })
const run = (exe, args) => new Promise((resolve, reject) => {
  execFile(exe, args, { windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) =>
    error ? reject(new Error(`${error.message}\n${stdout}\n${stderr}`)) : resolve({ stdout, stderr }))
})
try {
  for (let i = 0; i < (process.argv.includes('--external-only') ? 0 : 3); i++) {
    const single = path.join(temp, `single-${i}.mp4`)
    await measure('内置单连接', () => direct(downloadDirectFile, 1, single), single, 1)
    const ref = process.env.DOWNVID_BENCH_BASELINE
    if (ref) {
      const sources = Object.fromEntries(['electron/download/direct.ts', 'electron/download/direct-state.ts'].map(file =>
        [file, execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8' })]))
      const previous = loader(mocks, {}, sources)('electron/download/direct.ts').downloadDirectFile
      const output = path.join(temp, `previous-${i}.mp4`)
      await measure('旧版四段', () => direct(previous, 4, output), output, 4)
    }
    const multi = path.join(temp, `multi-${i}.mp4`)
    await measure('内置八路队列', () => direct(downloadDirectFile, 8, multi), multi, 8)
  }

  const aria2Path = process.env.DOWNVID_TEST_ARIA2
  const ytdlpPath = process.env.DOWNVID_TEST_YTDLP
  if (aria2Path && ytdlpPath) {
    const status = await load('electron/download/aria2.ts').detectAria2(aria2Path)
    assert.equal(status.found, true, status.reason)
    const output = path.join(temp, 'aria2.mp4')
    const { buildYtdlpArgs } = load('electron/download/ytdlp.ts')
    const options = { url, taskId: 'test', formatId: 'best', outputDir: temp, hasAudio: true,
      filenameTemplate: 'aria2', acceleration: settings(8) }
    const args = buildYtdlpArgs(options, temp, { ffmpegLocation: '', jsRuntime: null, aria2Path })
    await measure('yt-dlp + aria2 八路', async () => {
      const result = await run(ytdlpPath, [...args, '--ignore-config', url])
      assert.ok(result.stdout.includes('[dvfile]'), '最终路径事件缺失')
    }, output, 8)
    assert.equal(fs.existsSync(path.join(temp, '.downvid-aria2', 'aria2.mp4.part.aria2')), false)
    console.log('通过：真实 aria2/yt-dlp 调用、分段、最终路径、片段隔离与逐字节完整性')

    intervalMs = 40
    const liveProgress = []
    const runtime = loader({ ...mocks,
      electron: { ...mocks.electron, BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (_channel, value) => liveProgress.push(value) } }] } },
      'electron/utils/binary.ts': { resolveDependency: async () => ytdlpPath, getFfmpegLocation: () => '' },
      'electron/utils/cookies.ts': { getCookieAttempts: () => [[]], cookieFailureHint: () => '',
        runWithCookies: async (_attempts, runOnce) => ({ ...await runOnce([]), failedBrowsers: [] }) },
      'electron/parsers/ytdlp.ts': { getExtractorArgs: () => [] },
    })('electron/download/ytdlp.ts')
    const pauseOptions = { ...options, taskId: 'pause-real-aria2', filenameTemplate: 'paused-aria2',
      acceleration: { ...settings(8), aria2Path } }
    const running = runtime.runYtdlpDownload(pauseOptions, temp)
    const part = path.join(temp, '.downvid-aria2', 'paused-aria2.mp4.part')
    const deadline = Date.now() + 20000
    while (!(fs.existsSync(`${part}.aria2`) && active > 1)) {
      assert.ok(Date.now() < deadline, '未出现 aria2 续传检查点')
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    await new Promise(resolve => setTimeout(resolve, 1200))
    assert.equal(await runtime.pauseDownload(pauseOptions.taskId), true)
    assert.equal((await running).paused, true)
    assert.ok(liveProgress.some(value => value.percent > 0 && value.percent < 100 && value.speed), '缺少 aria2 实时进度')
    const pausedSize = fs.statSync(part).size
    await new Promise(resolve => setTimeout(resolve, 200))
    assert.equal(fs.statSync(part).size, pausedSize)
    sentBytes = 0
    const resumed = await runtime.runYtdlpDownload(pauseOptions, temp)
    assert.equal(resumed.paused, false)
    assert.deepEqual(fs.readFileSync(resumed.filePath), data)
    assert.ok(sentBytes < data.length, `续传重新传输了完整文件：${sentBytes}`)
    console.log(JSON.stringify({ realAria2Resume: { bytesTransferredAfterResume: sentBytes, total: data.length, completeFileMatches: true } }))
  } else console.log('跳过外部引擎：设置 DOWNVID_TEST_ARIA2 和 DOWNVID_TEST_YTDLP 后运行')

  const median = name => results.filter(value => value.name === name).map(value => value.milliseconds).sort((a, b) => a - b)[1]
  console.log(JSON.stringify({ medianSingle: median('内置单连接'), medianQueue8: median('内置八路队列'),
    medianPrevious4: median('旧版四段'), caveat: '本地每连接限速场景；不代表真实站点、总带宽限速或不支持 Range 的服务器' }))
} finally {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  assert.equal(path.dirname(temp), path.resolve(os.tmpdir()))
  fs.rmSync(temp, { recursive: true, force: true })
}
