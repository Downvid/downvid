import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'
import { loader } from './lib/load-source.mjs'

// 与纯逻辑单测分开：实际网络/文件 IO，Electron IPC 在边界处替换。
const require = createRequire(import.meta.url)
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'downvid-download-'))
const tick = () => new Promise(resolve => setImmediate(resolve))

async function directChecks() {
  const requests = []
  let etag = '"v1"'
  let supportRange = true
  let rateLimits = 0
  let rateLimitedRange = ''
  let retryAfter = '0'
  let onRateLimit = () => {}
  let data = Buffer.alloc(8 * 1024 * 1024 + 1)
  for (let i = 0; i < data.length; i++) data[i] = i % 251
  const server = http.createServer((req, res) => {
    const match = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '')
    const start = supportRange && match ? Number(match[1]) : 0
    const end = supportRange && match ? Number(match[2]) + 1 : data.length
    const request = { range: req.headers.range || 'FULL', start, end, ifRange: req.headers['if-range'] }
    requests.push(request)
    if (rateLimits && req.headers.range !== 'bytes=0-0') {
      rateLimits--
      rateLimitedRange = request.range
      res.writeHead(429, { 'Retry-After': retryAfter }); res.end(); onRateLimit(); return
    }
    res.writeHead(supportRange && match ? 206 : 200, {
      'Content-Length': end - start, ETag: etag,
      ...(supportRange && match ? { 'Content-Range': `bytes ${start}-${end - 1}/${data.length}` } : {}),
    })
    let offset = start
    const timer = setInterval(() => {
      const next = Math.min(end, offset + 16384)
      res.write(data.subarray(offset, next)); offset = next
      if (offset === end) { clearInterval(timer); res.end() }
    }, 1)
    res.on('close', () => clearInterval(timer))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const load = loader({ electron: { BrowserWindow: { getAllWindows: () => [] } } })
  const { downloadDirectFile } = load('electron/download/direct.ts')
  const { createDirectSegments } = load('electron/download/direct-state.ts')
  const url = `http://127.0.0.1:${server.address().port}/video`
  const outputPath = path.join(temp, 'direct.mp4')
  const params = { url, pageUrl: 'https://douyin.com/test', outputPath }
  const pause = async () => {
    const controller = new AbortController()
    await assert.rejects(downloadDirectFile({ ...params, signal: controller.signal,
      report: value => { if (value.percent > 1) controller.abort() },
    }), error => error.name === 'AbortError')
    assert.ok(fs.existsSync(`${outputPath}.part`))
  }
  const complete = async () => {
    await downloadDirectFile({ ...params, signal: new AbortController().signal, report: () => {} })
    assert.deepEqual(fs.readFileSync(outputPath), data)
    assert.equal(fs.existsSync(`${outputPath}.part`), false)
    assert.equal(fs.existsSync(`${outputPath}.part.json`), false)
  }
  const assertFreshSegments = () => {
    const actual = requests.filter(item => item.range !== 'bytes=0-0')
      .map(item => ({ start: item.start, end: item.end }))
      .sort((a, b) => a.start - b.start)
    const expected = Array.from(createDirectSegments(data.length), ({ start, end }) => ({ start, end }))
    assert.deepEqual(actual, expected)
  }
  try {
    await pause()
    const saved = JSON.parse(fs.readFileSync(`${outputPath}.part.json`, 'utf8'))
    assert.ok(saved.segments.some(segment => segment.offset > segment.start))
    requests.length = 0
    await complete()
    const resumed = requests.filter(item => item.range !== 'bytes=0-0')
    assert.deepEqual(resumed.map(item => item.start).sort((a, b) => a - b),
      saved.segments.filter(segment => segment.offset < segment.end).map(segment => segment.offset).sort((a, b) => a - b))
    assert.ok(resumed.every(item => item.ifRange === '"v1"'))
    console.log('通过：多段暂停保留进度、Range 续传、文件逐字节校验与临时文件清理')

    await pause()
    etag = '"v2"'
    requests.length = 0
    await complete()
    assertFreshSegments()
    assert.ok(requests.filter(item => item.range !== 'bytes=0-0').every(item => item.ifRange === etag))
    console.log('通过：同 URL 的资源版本变化后从头下载')

    await pause()
    fs.writeFileSync(`${outputPath}.part.json`, '{broken')
    requests.length = 0
    await complete()
    assertFreshSegments()
    console.log('通过：损坏检查点不续传')

    rateLimits = 1
    requests.length = 0
    await complete()
    assert.equal(rateLimits, 0)
    assert.ok(rateLimitedRange && requests.filter(item => item.range === rateLimitedRange).length >= 2)
    console.log('通过：429 降低并发并重试，最终文件保持完整')

    rateLimits = 1; retryAfter = '30'
    const backoff = new AbortController()
    onRateLimit = () => setTimeout(() => backoff.abort(), 50)
    const pauseStart = Date.now()
    await assert.rejects(downloadDirectFile({ ...params, signal: backoff.signal, report: () => {} }), error => error.name === 'AbortError')
    assert.ok(Date.now() - pauseStart < 2000, '重试等待期间暂停必须及时生效')
    retryAfter = '0'; onRateLimit = () => {}
    await complete()
    console.log('通过：长 Retry-After 等待期间可立即暂停并继续')

    supportRange = false
    await pause()
    assert.equal(fs.existsSync(`${outputPath}.part.json`), false)
    requests.length = 0
    await complete()
    assert.equal(requests[1].range, 'FULL')
    console.log('通过：无 Range 支持时安全重下，不拼接旧数据')

    data = data.subarray(0, 1024 * 1024)
    supportRange = true
    await pause()
    const small = JSON.parse(fs.readFileSync(`${outputPath}.part.json`, 'utf8'))
    assert.equal(small.segments.length, 1)
    requests.length = 0
    await complete()
    assert.equal(requests[1].start, small.segments[0].offset)
    console.log('通过：小文件单段 Range 续传')
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}

async function storeChecks() {
  const pinia = require('pinia')
  pinia.setActivePinia(pinia.createPinia())
  let saved = '{}'
  const storage = { getItem: () => saved, setItem: (_key, value) => { saved = value } }
  const pending = [], calls = [], cleanups = [], listeners = [], history = []
  const api = {
    ytdlp: { download: options => { calls.push(options); return new Promise(resolve => pending.push(resolve)) }, pauseDownload: async () => true },
    history: { add: async entry => history.push(entry) },
    onDownloadProgress: callback => {
      const id = listeners.push(callback)
      return () => cleanups.push(id)
    },
  }
  const load = loader({
    'src/stores/deps.ts': { useDepsStore: () => ({ deps: [], promptForMissing: () => {} }), readMissingKinds: () => [], stripDepMarkers: x => x },
  }, { window: { electronAPI: api }, localStorage: storage })
  const { useDownloadStore } = load('src/stores/download.ts')
  const { updateSettings } = load('src/stores/settings.ts')
  const store = useDownloadStore()
  store.url = 'https://douyin.com/test'
  store.videoInfo = { title: '测试视频', thumbnail: '' }
  store.selectedFormat = { formatId: 'test', quality: '720p', ext: 'mp4', url: 'https://cdn.example/video' }
  store.downloadDir = temp
  await store.startDownload()
  const task = store.downloadTasks[0]
  const newDir = path.join(temp, 'new-directory')
  updateSettings({ downloadDir: newDir })
  store.pauseTask(task.id)
  const resume = store.resumeTask(task)
  const duplicateResume = store.resumeTask(task)
  await tick()
  assert.equal(pending.length, 1, '旧下载未收尾之前不能复用 taskId')
  pending[0]({ paused: true })
  await Promise.all([resume, duplicateResume])
  assert.equal(pending.length, 2)
  assert.equal(task.status, 'downloading')
  assert.deepEqual(cleanups, [1])
  assert.equal(calls[1].outputDir, temp, '续传保持原目录')
  listeners[1]({ taskId: task.id, percent: 50, status: 'downloading' })
  assert.equal(task.progress, 50)
  assert.equal(history.length, 0)
  pending[1]({ filePath: path.join(temp, 'video.mp4') })
  await tick()
  assert.equal(task.status, 'completed')
  assert.equal(history.length, 1)
  assert.deepEqual(cleanups, [1, 2])
  await new Promise(resolve => setTimeout(resolve, 2))
  await store.startDownload()
  assert.equal(calls[2].outputDir, newDir, '新任务立即使用保存的目录')
  pending[2]({ paused: true })
  await tick()
  console.log('通过：旧下载收尾后恢复、重复继续防重入、进度监听、历史仅完成写入、目录立即生效')
}

async function ipcChecks() {
  const activeDownloads = new Map()
  const handlers = new Map()
  let rejectDownload
  const direct = { downloadDirectFile: () => new Promise((_resolve, reject) => { rejectDownload = reject }) }
  const load = loader({
    electron: { ipcMain: { handle: (name, callback) => handlers.set(name, callback) }, BrowserWindow: { getAllWindows: () => [] } },
    'electron/store.ts': { activeDownloads },
    'electron/download/direct.ts': direct,
    'electron/utils/binary.ts': {}, 'electron/utils/cookies.ts': {},
    'electron/parsers/ytdlp.ts': {}, 'electron/parsers/douyin.ts': {}, 'electron/parsers/kuaishou.ts': {},
  })
  load('electron/ipc/download.ts').registerDownloadIpc()
  const download = handlers.get('ytdlp:download')(null, {
    taskId: 'ipc', url: 'https://douyin.com/test', directUrl: 'https://cdn.example/video', outputDir: temp,
  })
  let stopped = false
  const pause = handlers.get('ytdlp:pauseDownload')(null, 'ipc').then(() => { stopped = true })
  await tick()
  assert.equal(stopped, false, 'abort 不能提前确认暂停')
  assert.ok(activeDownloads.has('ipc'))
  rejectDownload(new Error('已暂停'))
  await pause
  assert.equal((await download).paused, true)
  assert.equal(activeDownloads.has('ipc'), false)
  console.log('通过：直链暂停 IPC 等待文件下载完整收尾')
}

async function preparingChecks() {
  let resolveDependency
  const activeDownloads = new Map()
  const load = loader({
    electron: { BrowserWindow: { getAllWindows: () => [] } },
    'electron/store.ts': { activeDownloads },
    'electron/utils/binary.ts': { resolveDependency: () => new Promise(resolve => { resolveDependency = resolve }) },
    'electron/utils/cookies.ts': {}, 'electron/parsers/ytdlp.ts': {},
  })
  const runtime = load('electron/download/ytdlp.ts')
  const running = runtime.runYtdlpDownload({ taskId: 'preparing', url: 'https://example.com/video' }, temp)
  const paused = runtime.pauseDownload('preparing')
  resolveDependency('not-executed')
  assert.equal(await paused, true)
  assert.equal((await running).paused, true)
  assert.equal(activeDownloads.size, 0)
  console.log('通过：探测/准备期间暂停不会事后启动下载进程')
}

try {
  await directChecks()
  await storeChecks()
  await ipcChecks()
  await preparingChecks()
  await import('./test-parse-integration.mjs')
} finally { fs.rmSync(temp, { recursive: true, force: true }) }
