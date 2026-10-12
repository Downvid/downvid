import { ipcMain } from 'electron'
import path from 'node:path'
import { isDouyinUrl, isKuaishouUrl, ensureDownloadDir } from '../utils/platform'
import { parseDouyinWithAPI, parseDouyinWithPuppeteer } from '../parsers/douyin'
import { parseKuaishouWithAPI, parseKuaishouWithPuppeteer } from '../parsers/kuaishou'
import { parseWithYtdlp } from '../parsers/ytdlp'
import { activeDownloads } from '../store'
import { downloadDirectFile } from '../download/direct'
import { runYtdlpDownload, pauseDownload } from '../download/ytdlp'
import { sendDownloadProgress, throttledProgress } from '../download/progress'
import type { DownloadOptions } from '../download/ytdlp'

/**
 * 下载相关的 IPC 注册与分发。
 *
 * 具体实现拆在 electron/download/ 下：
 *   direct.ts   抖音/快手的 CDN 直链下载（不走 yt-dlp）
 *   ytdlp.ts    yt-dlp 路径：参数组装、进度解析、cookie 重试、暂停
 *   progress.ts 统一的进度广播与节流
 * 本文件只负责把请求分发到对应路径。
 */
export function registerDownloadIpc() {
  ipcMain.handle('ytdlp:parse', async (_event, ...args) => {
    const url = args[0] as string
    const cookiesFile = args[1] as string | undefined
    const proxy = args[2] as string | undefined

    try {
      // 抖音/快手有专属解析器：平台 API 优先，headless 浏览器兜底。
      // 每次失败都被空 catch 吞掉后落到 yt-dlp，因此调试解析问题时
      // 要先确认究竟是哪个分支实际运行了——错误在这里是不可见的。
      if (isDouyinUrl(url)) {
        try { return await parseDouyinWithAPI(url, cookiesFile) } catch {
          try { return await parseDouyinWithPuppeteer(url, cookiesFile) } catch {}
        }
      }
      if (isKuaishouUrl(url)) {
        try { return await parseKuaishouWithAPI(url) } catch {
          try { return await parseKuaishouWithPuppeteer(url) } catch {}
        }
      }

      return await parseWithYtdlp(url, cookiesFile, proxy)
    } catch (e: any) {
      throw new Error(e?.message || '解析失败，请检查链接是否有效')
    }
  })

  ipcMain.handle('ytdlp:download', async (_event, options: DownloadOptions) => {
    const outputDir = ensureDownloadDir(options.outputDir)

    // ===== 直链路径（仅抖音/快手）=====
    if (options.directUrl) {
      const filename = options.filename || `video_${Date.now()}.mp4`
      const outputPath = path.join(outputDir, filename)
      const controller = new AbortController()
      let paused = false

      activeDownloads.set(options.taskId, {
        abort: () => { paused = true; controller.abort() },
        options,
        status: 'downloading',
      })

      try {
        await downloadDirectFile({
          url: options.directUrl,
          pageUrl: options.url,
          outputPath,
          signal: controller.signal,
          report: (data) => throttledProgress({
            taskId: options.taskId,
            url: options.url,
            status: 'downloading',
            ...data,
          }),
        })
        sendDownloadProgress({ taskId: options.taskId, url: options.url, percent: 100, status: 'completed' })
        return { filePath: outputPath }
      } catch {
        if (paused) return { filePath: outputPath, paused: true }
        // 直链失败时回退到 yt-dlp：CDN 地址可能已过期
      } finally {
        activeDownloads.delete(options.taskId)
      }
    }

    // ===== yt-dlp 路径 =====
    const result = await runYtdlpDownload(options, outputDir)
    if (result.paused) return { filePath: result.filePath, paused: true }
    return { success: true, filePath: result.filePath }
  })

  ipcMain.handle('ytdlp:pauseDownload', async (_, taskId: string) => pauseDownload(taskId))
}
