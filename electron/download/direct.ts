import fs from 'node:fs'
import { isKuaishouUrl } from '../utils/platform'
import { formatBytes, formatEta } from './progress'
import { canResumeDirect, createDirectSegments, matchesDirectRange, type DirectCheckpoint, type DirectResource } from './direct-state'
import { accelerationConnections, type AccelerationSettings } from '../../shared/acceleration'

const DIRECT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const DIRECT_RETRIES = 3

function directHeaders(pageUrl: string, extra: Record<string, string> = {}) {
  const referer = isKuaishouUrl(pageUrl) ? 'https://www.kuaishou.com/' : 'https://www.douyin.com/'
  return { 'User-Agent': DIRECT_UA, 'Referer': referer, ...extra }
}

async function probeDirect(url: string, pageUrl: string, signal: AbortSignal) {
  try {
    const res = await fetch(url, { headers: directHeaders(pageUrl, { Range: 'bytes=0-0' }), signal })
    const total = parseInt(res.headers.get('content-range')?.split('/')[1] || '0')
    const resource: DirectResource = {
      url, total, etag: res.headers.get('etag') || '', lastModified: res.headers.get('last-modified') || '',
    }
    const rangeSupported = res.status === 206 && Number.isSafeInteger(total) && total > 0
      && matchesDirectRange(res.headers.get('content-range'), 0, 1, total)
    await res.body?.cancel()
    return { rangeSupported, resource }
  } catch (e) {
    if (signal.aborted) throw e
    return { rangeSupported: false, resource: { url, total: 0, etag: '', lastModified: '' } }
  }
}

export interface DirectDownloadParams {
  url: string
  pageUrl: string
  outputPath: string
  signal: AbortSignal
  acceleration?: AccelerationSettings
  report: (data: { percent: number; totalSize: string; speed: string; eta: string }) => void
}

/** 抖音/快手直链：暂停保留分段检查点，恢复只请求尚未写入的范围。 */
export async function downloadDirectFile(params: DirectDownloadParams): Promise<void> {
  const { url, pageUrl, outputPath, signal, report } = params
  const connections = accelerationConnections(params.acceleration)
  const startTime = Date.now()
  let downloaded = 0
  let resumed = 0
  let total = 0
  const emit = () => {
    const elapsed = (Date.now() - startTime) / 1000
    const speed = elapsed > 0 ? (downloaded - resumed) / elapsed : 0
    report({ percent: total > 0 ? downloaded / total * 100 : 0, totalSize: formatBytes(total),
      speed: speed > 0 ? `${formatBytes(speed)}/s` : '',
      eta: speed > 0 && total > 0 ? formatEta((total - downloaded) / speed) : '' })
  }
  report({ percent: 0, totalSize: '', speed: '', eta: '计算中...' })
  const probe = await probeDirect(url, pageUrl, signal)
  signal.throwIfAborted()
  total = probe.resource.total
  const tempPath = `${outputPath}.part`
  const checkpointPath = `${tempPath}.json`

  async function singleStream() {
    // 不支持 Range 的服务器无法安全续传，必须重新下载。
    fs.rmSync(checkpointPath, { force: true })
    const res = await fetch(url, { headers: directHeaders(pageUrl), signal })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    total = parseInt(res.headers.get('content-length') || '0')
    const handle = await fs.promises.open(tempPath, 'w')
    try {
      for await (const value of streamChunks(res.body)) {
        await writeAll(handle, value, downloaded)
        downloaded += value.length
        emit()
      }
      signal.throwIfAborted()
      if (total && downloaded !== total) throw new Error('下载数据不完整')
    } finally { await handle.close() }
  }

  async function segmented() {
    let state: DirectCheckpoint = { ...probe.resource, segments: createDirectSegments(total, connections) }
    let resume = false
    try {
      const saved: unknown = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'))
      if (canResumeDirect(saved, probe.resource, fs.statSync(tempPath).size)) { state = saved; resume = true }
    } catch {}
    const handle = await fs.promises.open(tempPath, resume ? 'r+' : 'w+')
    const controller = new AbortController()
    const abort = () => controller.abort(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    try {
      if (!resume) await handle.truncate(total)
      downloaded = resumed = state.segments.reduce((sum, segment) => sum + segment.offset - segment.start, 0)
      emit()
      // 等待所有分段结束后才关闭文件、保存进度，避免暂停确认时还有写入。
      let next = 0
      let active = 0
      let limit = connections
      const waiters = new Set<() => void>()
      const wake = () => { for (const resolve of waiters) resolve(); waiters.clear() }
      controller.signal.addEventListener('abort', wake, { once: true })
      const acquire = async () => {
        while (active >= limit && !controller.signal.aborted) await new Promise<void>(resolve => waiters.add(resolve))
        controller.signal.throwIfAborted()
        active++
        return () => { active--; wake() }
      }
      const worker = async () => {
        while (next < state.segments.length && !controller.signal.aborted) {
          const segment = state.segments[next++]
          for (let attempt = 0; segment.offset < segment.end; attempt++) {
            let release: (() => void) | undefined
            let retryAfter = 0
            try {
              release = await acquire()
              const extra: Record<string, string> = { Range: `bytes=${segment.offset}-${segment.end - 1}` }
              const validator = state.etag && !state.etag.startsWith('W/') ? state.etag : state.lastModified
              if (validator) extra['If-Range'] = validator
              const res = await fetch(url, { headers: directHeaders(pageUrl, extra), signal: controller.signal })
              if (res.status === 429 || res.status === 503) {
                limit = Math.max(1, Math.floor(limit / 2))
                const raw = res.headers.get('retry-after') || '0'
                const seconds = Number(raw)
                retryAfter = Math.min(30, Math.max(0, Number.isFinite(seconds) ? seconds : (Date.parse(raw) - Date.now()) / 1000)) || 0
              }
              if (res.status !== 206 || !res.body || !matchesDirectRange(res.headers.get('content-range'), segment.offset, segment.end, total)) {
                await res.body?.cancel()
                throw new Error(`下载范围不可用（HTTP ${res.status}）`)
              }
              for await (const value of streamChunks(res.body)) {
                if (segment.offset + value.length > segment.end) throw new Error('分段数据超出请求范围')
                await writeAll(handle, value, segment.offset)
                segment.offset += value.length
                downloaded += value.length
                emit()
              }
              if (segment.offset !== segment.end) throw new Error('分段数据不完整')
            } catch (e) {
              release?.(); release = undefined
              if (controller.signal.aborted || attempt >= DIRECT_RETRIES) {
                controller.abort(e)
                throw e
              }
              await waitRetry(Math.max(retryAfter, attempt + 1) * 1000, controller.signal)
            } finally {
              release?.()
            }
          }
        }
        controller.signal.throwIfAborted()
      }
      const results = await Promise.allSettled(Array.from({ length: Math.min(connections, state.segments.length) }, worker))
      controller.signal.removeEventListener('abort', wake)
      const failed = results.find(result => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
      signal.throwIfAborted()
    } finally {
      signal.removeEventListener('abort', abort)
      try { await handle.sync() } finally { await handle.close() }
      fs.writeFileSync(`${checkpointPath}.tmp`, JSON.stringify(state))
      fs.renameSync(`${checkpointPath}.tmp`, checkpointPath)
    }
  }

  if (probe.rangeSupported) await segmented()
  else await singleStream()
  signal.throwIfAborted()
  fs.renameSync(tempPath, outputPath)
  fs.rmSync(checkpointPath, { force: true })
  emit()
}

async function writeAll(handle: fs.promises.FileHandle, value: Uint8Array, position: number) {
  let written = 0
  while (written < value.length) {
    const result = await handle.write(value, written, value.length - written, position + written)
    if (!result.bytesWritten) throw new Error('文件写入失败')
    written += result.bytesWritten
  }
}

async function* streamChunks(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const result = await Promise.race([reader.read(), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('下载连接读取超时')), 30000)
      })]).finally(() => { if (timer) clearTimeout(timer) })
      const { done, value } = result
      if (done) return
      yield value
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function waitRetry(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, milliseconds)
    signal.addEventListener('abort', abort, { once: true })
  })
}
