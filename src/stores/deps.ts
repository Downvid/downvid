import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { DepKind, DepStatus, DepsProgress, RuntimeStatus } from '../types/deps'
import { readSettings } from './settings'
import { t } from '../i18n'

/**
 * 去掉错误信息里的依赖标记与 Electron 的 IPC 前缀，只留给人看的部分。
 *
 * 主进程抛出的错误经 invoke 传递后会带上
 * `Error invoking remote method 'ytdlp:parse': Error: ` 前缀，标记也不能展示给用户。
 */
export function stripDepMarkers(message: string): string {
  return message
    .replace(/\[\[deps-missing:[a-z0-9-]+\]\]/g, '')
    .replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '')
    .trim()
}

/**
 * 从主进程的错误信息里读出缺失的依赖种类。
 *
 * 主进程用 `[[deps-missing:ffmpeg]]` 标记（见 electron/utils/binary.ts），
 * 没有标记时退化为按关键字匹配，保证旧格式的错误也能引导下载。
 */
export function readMissingKinds(message: string): DepKind[] {
  const kinds: DepKind[] = []
  const marker = /\[\[deps-missing:([a-z0-9-]+)\]\]/g
  let hit: RegExpExecArray | null
  while ((hit = marker.exec(message)) !== null) {
    kinds.push(hit[1] as DepKind)
  }
  if (kinds.length) return [...new Set(kinds)]

  for (const kind of ['yt-dlp', 'ffmpeg', 'ffprobe'] as DepKind[]) {
    if (message.includes(`未找到可用的 ${kind}`)) kinds.push(kind)
  }
  return kinds
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

/**
 * 运行依赖（yt-dlp / ffmpeg / ffprobe）管理。
 *
 * 依赖不随安装包分发：主进程探测机器上的系统安装并复用，
 * 缺失时由这里的 download() 触发 Go 边车下载到 userData。
 */
export const useDepsStore = defineStore('deps', () => {
  const status = ref<RuntimeStatus | null>(null)
  const checking = ref(false)
  const downloading = ref(false)
  /** 当前正在下载的依赖 */
  const activeTool = ref<DepKind | null>(null)
  const downloaded = ref(0)
  const total = ref(0)
  const transferring = ref(false)
  const error = ref('')
  /** 最近一条事件文本，用于下载时展示「正在解压 / 正在签名」等 */
  const notice = ref('')

  /** 依赖缺失时弹出的引导 */
  const promptVisible = ref(false)
  const promptKinds = ref<DepKind[]>([])

  const deps = computed<DepStatus[]>(() => status.value?.results ?? [])

  /** 必需依赖（ffprobe 缺失不阻塞下载） */
  const missingRequired = computed(() => deps.value.filter(d => !d.found && !d.optional))
  const missingOptional = computed(() => deps.value.filter(d => !d.found && d.optional))
  const ready = computed(() => deps.value.length > 0 && missingRequired.value.length === 0)
  const anyMissing = computed(() => deps.value.some(d => !d.found))
  /** 探测结果里是否由 DownVid 托管（决定界面显示「更新」还是「下载」） */
  const managedCount = computed(() => deps.value.filter(d => d.found && d.source === 'managed').length)

  /** 已下载比例；total 未知时返回 null，界面改用不确定进度条 */
  const percent = computed(() => {
    if (!total.value) return null
    return Math.min(100, (downloaded.value / total.value) * 100)
  })
  const sizeText = computed(() => {
    if (!total.value) return formatBytes(downloaded.value) ? t('deps.downloadedSize', { size: formatBytes(downloaded.value) }) : ''
    return `${formatBytes(downloaded.value)} / ${formatBytes(total.value)}`
  })

  let subscribed = false

  function subscribe() {
    if (subscribed) return
    subscribed = true
    window.electronAPI.deps.onProgress((data: DepsProgress) => {
      switch (data.event) {
        case 'start':
          activeTool.value = data.tool ?? null
          downloaded.value = 0
          total.value = 0
          transferring.value = true
          notice.value = t('depsPrompt.downloading', { tool: data.tool })
          break
        case 'progress':
          if (data.tool && data.tool !== activeTool.value) {
            activeTool.value = data.tool
            downloaded.value = 0
          }
          downloaded.value = data.downloaded || 0
          total.value = data.total || 0
          transferring.value = true
          break
        case 'retry':
          notice.value = data.message ? `${data.tool}: ${data.message}` : t('deps.retrying')
          break
        case 'installed':
          transferring.value = false
          notice.value = t('deps.installedNotice', { tool: data.tool })
          break
        case 'warn':
          notice.value = data.message || ''
          break
        case 'error':
          error.value = data.message || t('deps.downloadFailed')
          transferring.value = false
          break
      }
    })
  }

  /** 读取当前状态；force 时强制重新探测（忽略主进程 60 秒缓存） */
  async function refresh(force = false) {
    subscribe()
    if (checking.value) return
    checking.value = true
    error.value = ''
    try {
      const { depPaths, proxy } = readSettings()
      const res = force
        ? await window.electronAPI.deps.check({ manualPaths: { ...depPaths }, proxy })
        : await window.electronAPI.deps.status({ manualPaths: { ...depPaths }, proxy })
      if (res.success && res.status) {
        status.value = res.status
      } else if (res.error) {
        error.value = res.error
      }
    } catch (e: any) {
      error.value = e?.message || t('deps.checkFailed')
    } finally {
      checking.value = false
    }
  }

  /** 下载缺失依赖；only 为空时下载全部缺失项 */
  async function download(only?: DepKind[], force = false): Promise<boolean> {
    subscribe()
    if (downloading.value) return false
    downloading.value = true
    error.value = ''
    notice.value = ''
    downloaded.value = 0
    total.value = 0
    try {
      const { depPaths, proxy } = readSettings()
      // 必须传普通对象/数组：调用方（如 DepsPrompt）可能直接把手动的
      // reactive 数组传进来，而 Vue 的 Proxy **无法被 structured clone**，
      // 会抛 `An object could not be cloned`。这里统一拍平。
      const res = await window.electronAPI.deps.download({
        manualPaths: { ...depPaths },
        proxy,
        only: only ? [...only] : undefined,
        force,
      })
      if (res.success && res.status) {
        status.value = res.status
        notice.value = t('deps.readyNotice')
        // 下载成功后关闭引导弹窗：用户原本要做的操作现在可以继续了
        promptVisible.value = false
        promptKinds.value = []
        return true
      }
      error.value = res.error || t('deps.downloadFailed')
      return false
    } catch (e: any) {
      error.value = e?.message || t('deps.downloadFailed')
      return false
    } finally {
      downloading.value = false
      activeTool.value = null
      transferring.value = false
    }
  }

  /** 只下载缺失的依赖，已就绪的跳过 */
  function downloadMissing(force = false) {
    const kinds = deps.value.filter(d => !d.found).map(d => d.kind)
    return download(kinds.length ? kinds : undefined, force)
  }

  async function cancel() {
    try {
      await window.electronAPI.deps.cancel()
    } catch {}
    transferring.value = false
  }

  async function openManagedDir() {
    try {
      await window.electronAPI.deps.openDir()
    } catch {}
  }

  /** 解析/下载因缺依赖失败时调用：弹出一键下载引导 */
  function promptForMissing(kinds: DepKind[]) {
    subscribe()
    // 先把状态拉回来，弹窗里才能显示具体缺什么
    void refresh()
    promptKinds.value = kinds.length ? kinds : ['yt-dlp']
    promptVisible.value = true
  }

  function dismissPrompt() {
    promptVisible.value = false
  }

  return {
    status, checking, downloading, activeTool, transferring, error, notice,
    promptVisible, promptKinds,
    deps, missingRequired, missingOptional, ready, anyMissing, managedCount,
    percent, sizeText,
    refresh, download, downloadMissing, cancel, openManagedDir,
    promptForMissing, dismissPrompt,
  }
})
