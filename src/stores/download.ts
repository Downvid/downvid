import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { VideoInfo, VideoFormat, DownloadTask, AudioFormat, AudioTrack } from '../types'
import { useDepsStore, readMissingKinds, stripDepMarkers } from './deps'
import {
  shouldIgnoreProgress,
  statusAfterResult,
  shouldRecordHistory,
  selectStartableTasks,
  retryReset,
} from './download-rules'
import { readSettings } from './settings'
import { t } from '../i18n'

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
      return t('err.forbiddenLogin')
    }
    return t('err.forbidden')
  }
  if (has('429', 'Too Many Requests')) return t('err.rateLimited')
  if (has('disk', 'space')) return t('err.diskFull')
  if (has('permission', 'access denied', 'EACCES', 'EPERM')) return t('err.permission')
  if (has('ECONNRESET', 'ETIMEDOUT', 'socket hang up', 'timed out')) return t('err.network')
  if (has('Unable to download webpage', 'Name or service not known', 'getaddrinfo')) {
    return t('err.unreachable')
  }
  if (has('ffmpeg', 'FFmpeg')) return t('err.ffmpeg')
  if (has('private video', 'members-only', '需要登录')) return t('err.privateVideo')
  if (has('video unavailable', 'not available in your country')) return t('err.videoUnavailable')
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
  const pauseRequests = new Map<string, Promise<unknown>>()
  const taskExecutions = new Map<string, Promise<void>>()
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
      const settings = readSettings()
      const manualFile = settings.cookieMode === 'manual' ? settings.cookiesFile : ''
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

  /** 排队等待中的任务数（用于在界面上区分「等待下载」与「正在下载」） */
  const queuedTaskCount = computed(() =>
    downloadTasks.value.filter(t => t.status === 'pending').length
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
    // 必须同时退订进度监听：否则每删一个任务就漏一个闭包（它捕获着整个 task
    // 对象），而且永远不会被 GC —— 表现为「用久了越来越卡」，很难联想到是删除。
    // 只有「下载进行中」那条路径会自己清理，暂停/完成/失败过再删除的都漏。
    if (taskProgressCleanups.has(taskId)) {
      taskProgressCleanups.get(taskId)!()
      taskProgressCleanups.delete(taskId)
    }
    downloadTasks.value = downloadTasks.value.filter(t => t.id !== taskId)
  }

  function clearCompletedTasks() {
    // 与 removeTask 同理：清列表时也要退订，否则批量清理会一次漏掉 N 个监听
    for (const task of downloadTasks.value) {
      if (task.status !== 'completed') continue
      if (taskProgressCleanups.has(task.id)) {
        taskProgressCleanups.get(task.id)!()
        taskProgressCleanups.delete(task.id)
      }
    }
    downloadTasks.value = downloadTasks.value.filter(t => t.status !== 'completed')
  }

  function pauseTask(taskId: string) {
    const idx = downloadTasks.value.findIndex(t => t.id === taskId)
    if (idx !== -1) {
      downloadTasks.value[idx].status = 'paused'
      downloadTasks.value[idx].speed = undefined
      downloadTasks.value[idx].eta = undefined
      pausedTasks.add(taskId)
      const stopped = window.electronAPI?.ytdlp?.pauseDownload?.(taskId)
      if (stopped) pauseRequests.set(taskId, Promise.resolve(stopped).catch(() => {}))
    }
  }

  async function resumeTask(task: DownloadTask) {
    // 前一次子进程完全退出后才能复用 taskId，避免旧调用清理新任务。
    await pauseRequests.get(task.id)
    // 暂停 IPC 和下载结果是独立通道，旧结果与监听必须先完成收尾。
    await taskExecutions.get(task.id)
    pauseRequests.delete(task.id)
    const idx = downloadTasks.value.findIndex(t => t.id === task.id)
    if (idx === -1 || downloadTasks.value[idx].status !== 'paused') return

    // 必须先脱离 'downloading'：processDownload 开头的守卫会拒绝状态已是
    // downloading/merging 的任务，否则"继续下载"会被自己挡回去——任务被标成
    // 下载中却什么都没发生，既不再推进也无法再次继续。
    pausedTasks.delete(task.id)
    downloadTasks.value[idx].status = 'pending'
    // 经队列闸门而不是直接启动：用户可能同时点「继续」多个任务，
    // 直接启动会突破并发上限。
    pumpQueue()
  }

  /**
   * 重试一个失败的任务。
   *
   * 失败的任务此前只能删掉重下——用户得重新解析、重选格式。重试直接复用
   * 已保存的 url / 格式 / 目录，回到 `pending` 交给队列调度。
   */
  function retryTask(taskId: string) {
    const idx = downloadTasks.value.findIndex(t => t.id === taskId)
    if (idx === -1 || downloadTasks.value[idx].status !== 'error') return
    Object.assign(downloadTasks.value[idx], retryReset())
    pumpQueue()
  }

  /**
   * 启动一个任务（不经过队列闸门）。
   *
   * 调用方必须先确认该任务拿到了下载槽位——要么来自 `pumpQueue`，
   * 要么是用户明确「继续」的暂停任务。直接调用会绕过并发上限。
   */
  function processDownload(task: DownloadTask) {
    if (taskExecutions.has(task.id)) return
    const execution = executeDownload(task)
    taskExecutions.set(task.id, execution)
    void execution.finally(() => {
      if (taskExecutions.get(task.id) === execution) taskExecutions.delete(task.id)
      // 一个任务让出槽位后立刻补位，否则队列会停在「明明有空闲却没人下载」。
      pumpQueue()
    })
  }

  /**
   * 把队列里排在前面的任务补进空闲的下载槽位。
   *
   * 这是**并发上限的唯一执行点**：所有「开始下载」的入口最终都汇到这里，
   * 由 `selectStartableTasks` 决定谁可以跑。之所以要集中：此前
   * `startDownload()` 每个任务都直接 `processDownload`，用户连点几次就会
   * 同时跑起来，各自再开 8～16 路分块，互相抢带宽。
   *
   * 重入是安全的：`processDownload` 有 `taskExecutions` 守卫，
   * 同一个任务不会被启动两次。
   */
  function pumpQueue() {
    for (const id of selectStartableTasks(downloadTasks.value)) {
      const task = downloadTasks.value.find(t => t.id === id)
      if (task) processDownload(task)
    }
  }

  async function executeDownload(task: DownloadTask) {
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
            downloadTasks.value[idx].statusMessage = data.message || t('queue.statusMerging')
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

      const settings = readSettings()
      const cookieMode = settings.cookieMode
      const cookiesFile = cookieMode === 'manual' ? settings.cookiesFile : ''
      const filenameTemplate = settings.filenameTemplate
      const proxy = settings.proxy

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
        acceleration: (task as any).acceleration || readSettings().acceleration,
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
      const [rawError, hint] = (e.message || t('queue.errorFallback')).split('\n\n提示：')
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
    // 缓存标记缺失时先重新检测，避免安装后旧状态把下载挡在提示框里。
    const deps = useDepsStore()
    const missingKinds = () => deps.deps
      .filter(d => !d.found && !d.optional)
      .filter(d => !(downloadMode.value === 'subtitle' && d.kind === 'ffmpeg'))
      .map(d => d.kind)
    if (missingKinds().length) {
      await deps.refresh(true)
      const missing = missingKinds()
      if (missing.length) {
        deps.promptForMissing(missing)
        return
      }
    }

    isDownloading.value = true
    // 只更新新任务目录；暂停任务继续使用原目录，不能丢失已有片段。
    downloadDir.value = readSettings().downloadDir || downloadDir.value
    const taskId = Date.now().toString()

    if (downloadMode.value === 'subtitle') {
      const task: DownloadTask = {
        id: taskId,
        url: url.value,
        videoInfo: videoInfo.value,
        selectedFormat: { formatId: 'subtitle', quality: t('download.downloadSubtitle'), ext: 'srt', filesize: 0 },
        outputDir: downloadDir.value,
        status: 'pending',
        progress: 0,
        createdAt: new Date().toISOString(),
      }
      ;(task as any).downloadMode = 'subtitle'
      ;(task as any).acceleration = { ...readSettings().acceleration }
      ;(task as any).selectedSubtitles = [...selectedSubtitles.value]
      downloadTasks.value.unshift(task)
      // 经队列闸门启动，而不是直接 processDownload：用户连点「下载」时
      // 其余任务会留在 pending 排队，而不是一起开跑互相抢带宽。
      pumpQueue()
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
    ;(task as any).acceleration = { ...readSettings().acceleration }
    ;(task as any).selectedAudioTrack = selectedAudioTrack.value ? { ...selectedAudioTrack.value } : null
    ;(task as any).selectedSubtitles = []
    downloadTasks.value.unshift(task)
    pumpQueue()
    isDownloading.value = false
  }

  return {
    url, isParsing, parseProgress, hasParsed,
    videoInfo, selectedFormat, selectedAudioFormat, selectedAudioTrack,
    selectedSubtitles, downloadMode, isDownloading,
    downloadTasks, downloadDir,
    isYouTubeUrl, showBilibiliCookieHint, cookieReady, cookieLastGoodBrowser, refreshCookieStatus, activeTaskCount, queuedTaskCount,
    selectVideoFormat, selectAudioFormat, selectAudioTrack, selectSubtitle,
    removeTask, clearCompletedTasks, pauseTask, resumeTask, retryTask, startDownload,
    sanitizeFilename,
  }
})
