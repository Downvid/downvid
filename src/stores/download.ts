import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { VideoInfo, VideoFormat, DownloadTask, AudioFormat, AudioTrack } from '../types'
import { useDepsStore, readMissingKinds, stripDepMarkers } from './deps'

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
    if (idx !== -1) {
      downloadTasks.value[idx].status = 'downloading'
      pausedTasks.delete(task.id)
      processDownload(downloadTasks.value[idx])
    }
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
        if (pausedTasks.has(task.id) && data.status !== 'completed') return
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
      if ((task as any).selectedSubtitles?.length > 0) downloadOptions.subtitles = (task as any).selectedSubtitles

      const result = await window.electronAPI.ytdlp.download(downloadOptions)

      const finalIdx = downloadTasks.value.findIndex(t => t.id === task.id)
      if (finalIdx !== -1) {
        downloadTasks.value[finalIdx].status = 'completed'
        downloadTasks.value[finalIdx].filePath = (result as any).filePath
        downloadTasks.value[finalIdx].progress = 100
      }

      try {
        await window.electronAPI.history.add({
          title: task.videoInfo.title,
          thumbnail: task.videoInfo.thumbnail,
          url: task.url,
          filePath: (result as any).filePath,
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
      let errorMsg = stripDepMarkers(rawError)
      if (errorMsg.includes('disk') || errorMsg.includes('space')) errorMsg = '磁盘空间不足'
      else if (errorMsg.includes('permission') || errorMsg.includes('access')) errorMsg = '没有写入权限'
      else if (errorMsg.includes('network') || errorMsg.includes('timeout') || errorMsg.includes('ECONNRESET')) errorMsg = '网络连接中断'
      else if (errorMsg.includes('ffmpeg') || errorMsg.includes('FFmpeg')) errorMsg = 'FFmpeg 合并失败'

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

    // 依赖缺失时先引导下载，而不是把任务丢进队列再报错
    // （ffmpeg 仅音视频合并/转码需要，字幕模式不依赖它）
    const deps = useDepsStore()
    await deps.refresh()
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
