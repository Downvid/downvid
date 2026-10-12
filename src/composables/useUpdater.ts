import { ref, computed, onUnmounted, watch } from 'vue'
import { RELEASES_URL } from '../../shared/app'

/**
 * 应用内更新的状态机。
 *
 * 从 UpdateModal.vue 抽出：那里模板与逻辑共 466 行，而更新流程本身
 * （检查 → 下载 → 安装，加上主进程广播的 update:status 事件）与界面渲染
 * 是两件独立的事。抽出来后状态流转可以单独阅读与测试。
 *
 * 注意：检查/下载/安装的结果有两个来源——IPC 调用的返回值，以及主进程
 * 主动广播的 update:status。两者都要处理，且不能互相覆盖出错误状态
 * （例如下载中收到 error 事件时，错误应归类到 download 阶段而非 check）。
 */

export type UpdateStatus = 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'downloaded' | 'error'
export type UpdateErrorPhase = 'check' | 'download' | 'install'

export interface UseUpdaterOptions {
  /** 弹窗是否可见，用于"打开即检查" */
  visible: () => boolean
}

export function useUpdater(options: UseUpdaterOptions) {
  const status = ref<UpdateStatus>('idle')
  const currentVersion = ref('1.0.0')
  const newVersion = ref('')
  const releaseNotes = ref('')
  const errorMsg = ref('')
  const downloadPercent = ref(0)
  const downloadSpeed = ref('')
  const downloadUrl = ref(RELEASES_URL)
  /** 当前安装方式不支持自动安装（便携版、tar.gz、DMG 内运行等），只能手动下载 */
  const manual = ref(false)
  const manualReason = ref('')
  const errorPhase = ref<UpdateErrorPhase>('check')

  const errorTitle = computed(() => ({
    check: '检查失败',
    download: '下载失败',
    install: '安装失败',
  })[errorPhase.value])

  let unsubscribe: (() => void) | null = null

  function fail(phase: UpdateErrorPhase, message: string) {
    status.value = 'error'
    errorPhase.value = phase
    errorMsg.value = message
  }

  /** 应用一次「有新版本」的结果（来自 IPC 返回值或广播事件，字段一致） */
  function applyAvailable(data: { version?: string; releaseNotes?: string; manual?: boolean; manualReason?: string }) {
    status.value = 'available'
    newVersion.value = data.version || ''
    releaseNotes.value = data.releaseNotes || ''
    manual.value = !!data.manual
    manualReason.value = data.manualReason || ''
  }

  function openReleasePage() {
    window.electronAPI?.shell?.openExternal?.(downloadUrl.value)
  }

  function retry() {
    if (errorPhase.value === 'check') return checkUpdate()
    if (errorPhase.value === 'download') return downloadUpdate()
    return installUpdate()
  }

  async function checkUpdate() {
    status.value = 'checking'
    try {
      const result = await window.electronAPI?.checkForUpdates?.()
      if (result?.downloadUrl) downloadUrl.value = result.downloadUrl
      if (result?.error) {
        fail('check', result.error)
      } else if (result?.hasUpdate) {
        applyAvailable(result)
      } else {
        status.value = 'latest'
        currentVersion.value = result?.currentVersion || currentVersion.value
      }
    } catch {
      fail('check', '检查更新失败，请检查网络连接')
    }
  }

  async function downloadUpdate() {
    status.value = 'downloading'
    downloadPercent.value = 0
    downloadSpeed.value = '准备下载...'
    try {
      const result = await window.electronAPI?.downloadUpdate?.()
      if (result && !result.success) {
        fail('download', result.error || '下载更新失败')
      } else if (status.value === 'downloading') {
        // 不依赖 update:status 事件，下载完成即进入可安装状态
        status.value = 'downloaded'
      }
    } catch {
      fail('download', '下载更新失败')
    }
  }

  async function installUpdate() {
    try {
      const result = await window.electronAPI?.installUpdate?.()
      if (result && !result.success) fail('install', result.error || '安装更新失败')
    } catch {
      fail('install', '安装更新失败')
    }
  }

  /** 读取当前版本号并订阅主进程的更新状态 */
  async function init() {
    try {
      const version = await window.electronAPI?.app?.getVersion?.()
      if (version) currentVersion.value = version
    } catch {}

    unsubscribe = window.electronAPI?.onUpdateStatus?.((data) => {
      switch (data.status) {
        case 'checking':
          status.value = 'checking'
          break
        case 'available':
          applyAvailable(data)
          break
        case 'not-available':
          status.value = 'latest'
          break
        case 'downloading':
          status.value = 'downloading'
          downloadPercent.value = data.percent || 0
          if (data.speed) downloadSpeed.value = `${(data.speed / 1024 / 1024).toFixed(1)} MB/s`
          break
        case 'downloaded':
          status.value = 'downloaded'
          break
        case 'error':
          // 下载中报错应归类为 download 阶段，否则重试按钮会跳回检查
          fail(status.value === 'downloading' ? 'download' : errorPhase.value, data.message || '更新失败')
          break
      }
    }) ?? null
  }

  // 弹窗打开时自动检查（仅在尚未产生状态时，避免每次打开都重新请求）
  watch(options.visible, (visible) => {
    if (visible && status.value === 'idle') void checkUpdate()
  })

  onUnmounted(() => {
    unsubscribe?.()
    unsubscribe = null
  })

  return {
    status, currentVersion, newVersion, releaseNotes, errorMsg,
    downloadPercent, downloadSpeed, downloadUrl, manual, manualReason, errorPhase,
    errorTitle,
    checkUpdate, downloadUpdate, installUpdate, openReleasePage, retry, init,
  }
}
