import fs from 'node:fs'
import { isKuaishouUrl } from '../utils/platform'
import { formatBytes, formatEta } from './progress'

/**
 * 直链下载：抖音/快手解析器拿到 CDN 地址后不再走 yt-dlp，直接 fetch。
 *
 * 这条路径存在的理由是那些 CDN 地址有效期很短，走 yt-dlp 会二次请求平台接口，
 * 容易拿不到同一份地址。
 */

const DIRECT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
/** 分段数：CDN 常对单连接限速，并行 4 段可成倍提速 */
const DIRECT_SEGMENTS = 4
/** 小于此大小不值得分段 */
const DIRECT_MIN_SEGMENT = 2 * 1024 * 1024
const DIRECT_RETRIES = 3

function directHeaders(pageUrl: string, extra: Record<string, string> = {}) {
  const referer = isKuaishouUrl(pageUrl) ? 'https://www.kuaishou.com/' : 'https://www.douyin.com/'
  return { 'User-Agent': DIRECT_UA, 'Referer': referer, ...extra }
}

/** 探测是否支持 Range 以及文件总大小 */
async function probeDirect(url: string, pageUrl: string, signal: AbortSignal) {
  try {
    const res = await fetch(url, { headers: directHeaders(pageUrl, { Range: 'bytes=0-0' }), signal })
    const total = parseInt(res.headers.get('content-range')?.split('/')[1] || '0')
    await res.body?.cancel()
    return { rangeSupported: res.status === 206 && total > 0, total }
  } catch (e) {
    if (signal.aborted) throw e
    return { rangeSupported: false, total: 0 }
  }
}

export interface DirectDownloadParams {
  url: string
  pageUrl: string
  outputPath: string
  signal: AbortSignal
  /** 上报进度；节流由调用方统一处理 */
  report: (data: { percent: number; totalSize: string; speed: string; eta: string }) => void
}

export async function downloadDirectFile(params: DirectDownloadParams): Promise<void> {
  const { url, pageUrl, outputPath, signal, report } = params
  const startTime = Date.now()
  let downloaded = 0
  let total = 0

  report({ percent: 0, totalSize: '', speed: '', eta: '计算中...' })

  const emit = () => {
    const elapsed = (Date.now() - startTime) / 1000
    const speed = elapsed > 0 ? downloaded / elapsed : 0
    report({
      percent: total > 0 ? (downloaded / total) * 100 : 0,
      totalSize: formatBytes(total),
      speed: speed > 0 ? `${formatBytes(speed)}/s` : '',
      eta: speed > 0 && total > 0 ? formatEta((total - downloaded) / speed) : '',
    })
  }

  const probe = await probeDirect(url, pageUrl, signal)
  total = probe.total
  const tempPath = `${outputPath}.part`

  /** 单连接流式下载：遵守写入背压，避免大文件把内存撑爆 */
  async function singleStream() {
    const res = await fetch(url, { headers: directHeaders(pageUrl), signal })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    total = total || parseInt(res.headers.get('content-length') || '0')
    const writer = fs.createWriteStream(tempPath)
    try {
      const reader = res.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        downloaded += value.length
        if (!writer.write(value)) await new Promise(r => writer.once('drain', r))
        emit()
      }
    } finally {
      await new Promise<void>((resolve, reject) => writer.end((err?: Error | null) => err ? reject(err) : resolve()))
    }
  }

  /** 多连接分段下载：CDN 常对单连接限速，分段并行可成倍提速 */
  async function segmented() {
    const segmentCount = Math.max(1, Math.min(DIRECT_SEGMENTS, Math.floor(total / DIRECT_MIN_SEGMENT)))
    const segmentSize = Math.ceil(total / segmentCount)
    const handle = await fs.promises.open(tempPath, 'w')
    try {
      await handle.truncate(total)
      await Promise.all(Array.from({ length: segmentCount }, async (_, i) => {
        const start = i * segmentSize
        const end = Math.min(total, start + segmentSize) - 1
        let offset = start
        for (let attempt = 0; ; attempt++) {
          try {
            const res = await fetch(url, { headers: directHeaders(pageUrl, { Range: `bytes=${offset}-${end}` }), signal })
            if (res.status !== 206 || !res.body) throw new Error(`HTTP ${res.status}`)
            const reader = res.body.getReader()
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              await handle.write(value, 0, value.length, offset)
              offset += value.length
              downloaded += value.length
              emit()
            }
            if (offset <= end) throw new Error('分段数据不完整')
            return
          } catch (e) {
            // 断点续传：从本段已写入的位置重试
            if (signal.aborted || attempt >= DIRECT_RETRIES) throw e
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
          }
        }
      }))
    } finally {
      await handle.close()
    }
  }

  try {
    if (probe.rangeSupported && total >= DIRECT_MIN_SEGMENT * 2) await segmented()
    else await singleStream()
    fs.renameSync(tempPath, outputPath)
  } catch (e) {
    fs.rmSync(tempPath, { force: true })
    throw e
  }

  emit()
}
