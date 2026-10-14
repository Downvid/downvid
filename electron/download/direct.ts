import fs from 'node:fs'
import { isKuaishouUrl } from '../utils/platform'
import { formatBytes, formatEta } from './progress'
import { canResumeDirect, createDirectSegments, matchesDirectRange, type DirectCheckpoint, type DirectResource } from './direct-state'

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
  report: (data: { percent: number; totalSize: string; speed: string; eta: string }) => void
}

/** 抖音/快手直链：暂停保留分段检查点，恢复只请求尚未写入的范围。 */
export async function downloadDirectFile(params: DirectDownloadParams): Promise<void> {
  const { url, pageUrl, outputPath, signal, report } = params
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
    let state: DirectCheckpoint = { ...probe.resource, segments: createDirectSegments(total) }
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
      const results = await Promise.allSettled(state.segments.map(async segment => {
        for (let attempt = 0; segment.offset < segment.end; attempt++) {
          try {
            const extra: Record<string, string> = { Range: `bytes=${segment.offset}-${segment.end - 1}` }
            const validator = state.etag && !state.etag.startsWith('W/') ? state.etag : state.lastModified
            if (validator) extra['If-Range'] = validator
            const res = await fetch(url, { headers: directHeaders(pageUrl, extra), signal: controller.signal })
            if (res.status !== 206 || !res.body || !matchesDirectRange(res.headers.get('content-range'), segment.offset, segment.end, total)) {
              await res.body?.cancel()
              throw new Error('服务器未返回请求的下载范围')
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
            if (controller.signal.aborted || attempt >= DIRECT_RETRIES) {
              controller.abort()
              throw e
            }
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
          }
        }
      }))
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
      const { done, value } = await reader.read()
      if (done) return
      yield value
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
