import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { VideoInfo, VideoFormat, DownloadTask, AudioFormat, AudioTrack } from '../types'
import { useDepsStore, readMissingKinds, stripDepMarkers } from './deps'
import { shouldIgnoreProgress, statusAfterResult, shouldRecordHistory } from './download-rules'

/**
 * 把任意值转成"可被 structured clone"的普通数据。
 *
 * Vue 的 reactive/ref 会被包成 Proxy，而 Electron 的 IPC 用 structured clone
 * 传参，Proxy 会直接抛 `An object could not be cloned`。这里用 JSON 往返做深拷贝：
 * 下载参数都是字符串/数字/布尔/数组，没有 Date、Map 等需要保留类型的值。
 *
 * 之所以整体做而不是逐字段展开：逐字段太容易漏（subtitles 就漏过一次）。
 */
export function toPlainData<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return value
  }
}

/**
 * 把 yt-dlp / 网络层的原始错误翻译成用户能看懂、且能据此行动的一句话。
 *
 * 此前只处理了磁盘/权限/网络/ffmpeg 四类，**403 完全没有归类**，
 * 于是队列里直接显示 `ERROR: unable to download video data: HTTP Error 403: Forbidden`
 * ——用户看到的就是这一整串（这也是反馈里那个"数字乱码行"的来源）。
 *
 * 顺序有讲究：403 必须在"网络"之前判断，否则会被误归成"网络连接中断"。
 */
export function friendlyDownloadError(raw: string): string {
  const text = raw || ''
  const has = (...keys: string[]) => keys.some(k => text.toLowerCase().includes(k.toLowerCase()))

  // 站点拒绝下载媒体分片：通常是登录态/限流/需要 Cookie
  if (has('403', 'Forbidden')) {
    // yt-dlp 明确提示需要登录时，把方向指到 Cookie 上
    if (has('sign in', 'login', 'cookies')) {
      return '站点拒绝下载（403）：该视频需要登录，请在「设置 → Cookies」配置后重试'
    }
    return '站点拒绝下载（403）：可能是访问过于频繁或需要登录。稍后重试，或在「设置 → Cookies」配置 Cookie'
  }
  if (has('429', 'Too Many Requests')) return '请求过于频繁（429）：请等待几分钟后重试'
  if (has('disk', 'space')) return '磁盘空间不足'
  if (has('permission', 'access denied', 'EACCES', 'EPERM')) return '没有写入权限，请检查下载目录'
  if (has('ECONNRESET', 'ETIMEDOUT', 'socket hang up', 'timed out')) return '网络连接中断，请重试'
  if (has('Unable to download webpage', 'Name or service not known', 'getaddrinfo')) {
    return '无法访问该站点：请检查网络连接，或在「设置 → 代理」中配置代理'
  }
  if (has('ffmpeg', 'FFmpeg')) return 'FFmpeg 合并失败：请检查「设置 → 运行依赖」中的 ffmpeg'
  if (has('private video', 'members-only', '需要登录')) return '该视频需要登录才能访问'
  if (has('video unavailable', 'not available in your country')) return '视频不可用（可能已删除或限制地区）'
  return text
}

export const useDownloadStore = defineStore('download', () => {
  // URL Input
  const url = ref('')
  const isParsing = ref(false)
  const parseProgress = ref(0)
  const hasParsed = ref(false)

  // Video Info
  const videoInfo = ref<VideoInfo | null>(null)
  const selectedFormat = ref<VideoFormat | null>(null)
  const selectedAudioFormat = ref<AudioFormat | null>(null)
  const selectedAudioTrack = ref<AudioTrack | null>(null)
  const selectedSubtitles = ref<string[]>([])
  const downloadMode = ref<'video' | 'audio' | 'subtitle'>('video')
  const isDownloading = ref(false)

  // Download Tasks
  const downloadTasks = ref<DownloadTask[]>([])
  const downloadDir = ref('')
  const pausedTasks = new Set<string>()
  const taskProgressCleanups = new Map<string, () => void>()

  // Computed
  const isYouTubeUrl = computed(() => {
    const s = url.value.trim().toLowerCase()
    return s.includes('youtube.com') || s.includes('youtu.be')
  })

  /**
   * Cookie 是否已经可用（有手动文件 / 有快照 / 有可尝试的浏览器）。
   *
   * 界面用它决定要不要提示"需要 Cookie"——此前只看 URL 域名，
   * 即使用户早已配好、上次解析也成功读到了登录态，仍会一直提示。
   */
  const cookieReady = ref(false)
  const cookieLastGoodBrowser = ref('')

  async function refreshCookieStatus() {
    try {
      const settings = JSON.parse(localStorage.getItem('settings') || '{}')
      const manualFile = settings.cookieMode === 'manual' ? (settings.cookiesFile || '') : ''
      const status = await window.electronAPI?.app?.cookieStatus?.(manualFile || undefined)
      if (!status) return
      cookieReady.value = status.manual || status.hasSnapshot || status.availableBrowsers.length > 0
      cookieLastGoodBrowser.value = status.lastGoodBrowser || ''
    } catch {
      // 拿不到状态时保守处理：不隐藏提示
      cookieReady.value = false
    }
  }

  const showBilibiliCookieHint = computed(() => {
    const s = url.value.trim().toLowerCase()
    const isBilibili = s.includes('bilibili.com') || s.includes('b23.tv')
    // 已确认有可用 Cookie 来源时不再提示
    return isBilibili && !cookieReady.value
  })

  const activeTaskCount = computed(() =>
    downloadTasks.value.filter(t =>
      t.status === 'downloading' || t.status === 'pending' || t.status === 'merging' || t.status === 'paused'
    ).length
  )

  // Actions
  function selectVideoFormat(format: VideoFormat) {
    selectedFormat.value = format
    downloadMode.value = 'video'
    selectedAudioFormat.value = null
    selectedSubtitles.value = []
  }

  function selectAudioFormat(format: AudioFormat) {
    selectedAudioFormat.value = format
    downloadMode.value = 'audio'
    selectedFormat.value = null
    selectedAudioTrack.value = null
    selectedSubtitles.value = []
  }

  function selectAudioTrack(track: AudioTrack) {
    selectedAudioTrack.value = track
    selectedAudioFormat.value = null
    selectedSubtitles.value = []
    if (!selectedFormat.value && videoInfo.value?.formats?.length) {
      selectedFormat.value = videoInfo.value.formats[0]
    }
    downloadMode.value = 'video'
  }

  function selectSubtitle(language: string) {
    const idx = selectedSubtitles.value.indexOf(language)
    if (idx > -1) {
      selectedSubtitles.value.splice(idx, 1)
    } else {
      selectedSubtitles.value = [language]
    }
    selectedFormat.value = null
    selectedAudioFormat.value = null
    selectedAudioTrack.value = null
    downloadMode.value = 'subtitle'
  }

  function sanitizeFilename(name: string): string {
    return name.replace(/[<>"/\\|?*]/g, '_').trim()
  }

  function removeTask(taskId: string) {
    downloadTasks.value = downloadTasks.value.filter(t => t.id !== taskId)
  }

  function clearCompletedTasks() {
    downloadTasks.value = downloadTasks.value.filter(t => t.status !== 'completed')
  }

  function pauseTask(taskId: string) {
    const idx = downloadTasks.value.findIndex(t => t.id === taskId)
    if (idx !== -1) {
      downloadTasks.value[idx].status = 'paused'
      downloadTasks.value[idx].speed = undefined
      downloadTasks.value[idx].eta = undefined
      pausedTasks.add(taskId)
      window.electronAPI?.ytdlp?.pauseDownload?.(taskId)
    }
  }

  function resumeTask(task: DownloadTask) {
    const idx = downloadTasks.value.findIndex(t => t.id === task.id)
    if (idx === -1) return

    // 必须先脱离 'downloading'：processDownload 开头的守卫会拒绝状态已是
    // downloading/merging 的任务，否则"继续下载"会被自己挡回去——任务被标成
    // 下载中却什么都没发生，既不再推进也无法再次继续。
    pausedTasks.delete(task.id)
    downloadTasks.value[idx].status = 'pending'
    processDownload(downloadTasks.value[idx])
  }

  async function processDownload(task: DownloadTask) {
    const taskIndex = downloadTasks.value.findIndex(t => t.id === task.id)
    if (taskIndex === -1) return
    if (downloadTasks.value[taskIndex].status === 'downloading' || downloadTasks.value[taskIndex].status === 'merging') return

    downloadTasks.value[taskIndex].status = 'downloading'

    if (taskProgressCleanups.has(task.id)) {
      taskProgressCleanups.get(task.id)!()
      taskProgressCleanups.delete(task.id)
    }

    const cleanup = window.electronAPI.onDownloadProgress((data: any) => {
      if (data.taskId === task.id) {
        // 已暂停的任务忽略**所有**进度事件，包括 completed：
        // 主进程 kill 子进程时可能还会残留一条结束事件，若照单全收，
        // 会把任务标成"已完成"并清掉 paused 标记，用户就只能重新下载了。
        if (shouldIgnoreProgress(pausedTasks.has(task.id))) return
        const idx = downloadTasks.value.findIndex(t => t.id === task.id)
        if (idx !== -1) {
          if (data.status === 'merging') {
            downloadTasks.value[idx].status = 'merging'
            downloadTasks.value[idx].statusMessage = data.message || '正在合并音视频...'
            downloadTasks.value[idx].progress = 99
          } else if (data.status === 'completed') {
            downloadTasks.value[idx].status = 'completed'
            downloadTasks.value[idx].progress = 100
            pausedTasks.delete(task.id)
          } else {
            downloadTasks.value[idx].progress = data.percent || 0
            downloadTasks.value[idx].totalSize = data.totalSize
            downloadTasks.value[idx].speed = data.speed
            downloadTasks.value[idx].eta = data.eta
          }
        }
      }
    })

    taskProgressCleanups.set(task.id, cleanup)

    try {
      const directUrl = task.selectedFormat.url
      const isDouyin = task.url.includes('douyin.com') || task.url.includes('v.douyin.com')
      const isKuaishou = task.url.includes('kuaishou.com') || task.url.includes('v.kuaishou.com')
      const useDirectDownload = isDouyin || isKuaishou

      const settings = JSON.parse(localStorage.getItem('settings') || '{}')
      const cookieMode = settings.cookieMode || 'auto'
      const cookiesFile = cookieMode === 'manual' ? (settings.cookiesFile || '') : ''
      const filenameTemplate = settings.filenameTemplate || '%(title)s'
      const proxy = settings.proxy || ''

      const downloadOptions: any = {
        url: task.url,
        formatId: task.selectedFormat.formatId,
        outputDir: task.outputDir,
        taskId: task.id,
        directUrl: useDirectDownload && directUrl ? directUrl : undefined,
        filename: useDirectDownload && directUrl ? `${sanitizeFilename(task.videoInfo.title).slice(0, 50)}_${task.selectedFormat.quality}.mp4` : undefined,
        cookiesFile,
        filenameTemplate,
        proxy,
        hasAudio: task.selectedFormat.hasAudio,
        // 解析时保存的 info JSON，下载时跳过 yt-dlp 二次提取
        cacheFile: task.videoInfo.cacheFile,
      }

      if ((task as any).downloadMode === 'audio') downloadOptions.downloadMode = 'audio'
      if ((task as any).downloadMode === 'subtitle') downloadOptions.downloadMode = 'subtitle'
      if ((task as any).selectedAudioTrack) downloadOptions.audioTrack = { ...(task as any).selectedAudioTrack }
      if ((task as any).selectedSubtitles?.length > 0) {
        downloadOptions.subtitles = [...(task as any).selectedSubtitles]
      }

      // 统一拍平后再交给 IPC。
      //
      // 逐字段展开容易漏（subtitles 就漏过一次），而 resume 时 task 来自
      // downloadTasks，是 Vue 的 Proxy —— Proxy **无法被 structured clone**，
      // 漏掉任何一个字段都会报 `An object could not be cloned`。
      // 这里做一次整体深拷贝，把这类问题一次性挡掉。
      const result = (await window.electronAPI.ytdlp.download(toPlainData(downloadOptions))) as any

      // 暂停时主进程会返回 { paused: true }。此时**不能**标成完成，
      // 否则界面显示"已完成"、进度 100%，用户没法继续，只能重新下载。
      if (result?.paused) {
        const pausedIdx = downloadTasks.value.findIndex(t => t.id === task.id)
        if (pausedIdx !== -1) {
          downloadTasks.value[pausedIdx].status = statusAfterResult(result)
          downloadTasks.value[pausedIdx].speed = undefined
          downloadTasks.value[pausedIdx].eta = undefined
        }
        return
      }

      const finalIdx = downloadTasks.value.findIndex(t => t.id === task.id)
      if (finalIdx !== -1) {
        downloadTasks.value[finalIdx].status = 'completed'
        downloadTasks.value[finalIdx].filePath = result?.filePath
        downloadTasks.value[finalIdx].progress = 100
      }

      // 只在**确实拿到文件**时记历史（规则见 download-rules.ts）
      if (!shouldRecordHistory(result)) return

      try {
        await window.electronAPI.history.add({
          title: task.videoInfo.title,
          thumbnail: task.videoInfo.thumbnail,
          url: task.url,
          filePath: result.filePath,
          format: task.selectedFormat.ext,
          quality: task.selectedFormat.quality,
        })
      } catch (historyErr) {
        console.error('Failed to add history record:', historyErr)
      }
    } catch (e: any) {
      // 主进程可能附带 Cookie 读取失败的解决建议：分类只看错误本身，建议保留展示
      const [rawError, hint] = (e.message || '下载失败').split('\n\n提示：')
      // 解析/下载因缺少 yt-dlp、ffmpeg 失败时，弹出「一键下载」引导
      if (rawError.includes('[deps-missing:') || /未找到可用的 (yt-dlp|ffmpeg|ffprobe)/.test(rawError)) {
        useDepsStore().promptForMissing(readMissingKinds(rawError))
      }
      const errorMsg = friendlyDownloadError(stripDepMarkers(rawError))

      const errorIdx = downloadTasks.value.findIndex(t => t.id === task.id)
      if (errorIdx !== -1) {
        downloadTasks.value[errorIdx].status = 'error'
        downloadTasks.value[errorIdx].error = hint ? `${errorMsg}（${hint}）` : errorMsg
      }
    } finally {
      if (taskProgressCleanups.has(task.id)) {
        taskProgressCleanups.get(task.id)!()
        taskProgressCleanups.delete(task.id)
      }
    }
  }

  async function startDownload() {
    if (!videoInfo.value || isDownloading.value) return
    if (downloadMode.value === 'video' && !selectedFormat.value) return
    if (downloadMode.value === 'audio' && !selectedAudioFormat.value) return
    if (downloadMode.value === 'subtitle' && selectedSubtitles.value.length === 0) return

    // 依赖检查放在**下载**这一步（元数据解析只需要 yt-dlp，已由解析成功证明可用）。
    //
    // 这里刻意不 `await deps.refresh()`：那会启动 Go 边车做一次完整探测
    // （冷启动 1~3 秒），用户每次点下载都要白等；而且探测是异步的，
    // 弹窗还可能出现在「正在提取元数据」之后，看起来像先解析后才提示。
    //
    // 改为读**已有的缓存状态**：启动时已后台探测过一次，解析成功也说明
    // yt-dlp 可用；只有确实缺必需依赖时才弹引导。
    const deps = useDepsStore()
    const missing = deps.deps
      .filter(d => !d.found && !d.optional)
      .filter(d => !(downloadMode.value === 'subtitle' && d.kind === 'ffmpeg'))
      .map(d => d.kind)
    if (missing.length) {
      deps.promptForMissing(missing)
      return
    }

    isDownloading.value = true
    const taskId = Date.now().toString()

    if (downloadMode.value === 'subtitle') {
      const task: DownloadTask = {
        id: taskId,
        url: url.value,
        videoInfo: videoInfo.value,
        selectedFormat: { formatId: 'subtitle', quality: '字幕', ext: 'srt', filesize: 0 },
        outputDir: downloadDir.value,
        status: 'pending',
        progress: 0,
        createdAt: new Date().toISOString(),
      }
      ;(task as any).downloadMode = 'subtitle'
      ;(task as any).selectedSubtitles = [...selectedSubtitles.value]
      downloadTasks.value.unshift(task)
      processDownload(task)
      isDownloading.value = false
      return
    }

    const task: DownloadTask = {
      id: taskId,
      url: url.value,
      videoInfo: videoInfo.value,
      selectedFormat: downloadMode.value === 'audio' && selectedAudioFormat.value
        ? { ...selectedAudioFormat.value, quality: selectedAudioFormat.value.quality, ext: selectedAudioFormat.value.ext }
        : selectedFormat.value!,
      outputDir: downloadDir.value,
      status: 'pending',
      progress: 0,
      createdAt: new Date().toISOString(),
    }
    ;(task as any).downloadMode = downloadMode.value
    ;(task as any).selectedAudioTrack = selectedAudioTrack.value ? { ...selectedAudioTrack.value } : null
    ;(task as any).selectedSubtitles = []
    downloadTasks.value.unshift(task)
    processDownload(task)
    isDownloading.value = false
  }

  return {
    url, isParsing, parseProgress, hasParsed,
    videoInfo, selectedFormat, selectedAudioFormat, selectedAudioTrack,
    selectedSubtitles, downloadMode, isDownloading,
    downloadTasks, downloadDir,
    isYouTubeUrl, showBilibiliCookieHint, cookieReady, cookieLastGoodBrowser, refreshCookieStatus, activeTaskCount,
    selectVideoFormat, selectAudioFormat, selectAudioTrack, selectSubtitle,
    removeTask, clearCompletedTasks, pauseTask, resumeTask, startDownload,
    sanitizeFilename,
  }
})
