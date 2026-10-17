import { ref, computed, onUnmounted, watch } from 'vue'
import { marked } from 'marked'
import { RELEASES_URL } from '../../shared/app'
import { t } from '../i18n'

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

/**
 * 容器版（Docker / WebUI）的更新信息。
 *
 * 由 `docker/server/index.ts` 的 `app:checkForUpdates` 附带返回。桌面版没有
 * 这个字段——容器里进程跑在只读镜像层上，**自更新会在下次 docker run 时消失**，
 * 所以那边只能展示「拉镜像 + 重建容器」的命令。
 */
export interface ContainerUpdateInfo {
  currentVersion: string
  latestVersion: string | null
  imageOutdated?: boolean
  upgrade: { commands: string[]; compose: boolean }
  error: string | null
  source: string | null
}

/**
 * 从 Release 正文里裁出「只给用户看的更新内容」。
 *
 * Release 正文由 scripts/gen-release-notes.mjs 生成，顶部是"点徽章即下载"的引导区
 * （下载徽章、平台对照表、各平台注意事项）。那段内容在**发布页**有用——用户是去下载的；
 * 但在**应用内**的更新弹窗里，用户已经装好了应用，只想看这个版本改了什么，
 * 徽章与对照表纯属噪音（徽章还会渲染成一堆图片链接）。
 *
 * 裁剪依据是生成脚本写下的分节标题「## 📝 更新内容」。找不到就原样返回——
 * 兼容手工编写的 Release。
 */
/**
 * 把 Release 正文里的 Markdown 转成 HTML。
 *
 * 这一步之前漏了：`v-html` 期待 HTML，而 GitHub 的 Release 正文是 **Markdown**，
 * 于是更新弹窗里把 `### 修复`、`- **…**` 原样显示成一坨纯文本。
 *
 * 用 `marked` 而不是自己写正则：Release 正文里会有列表、粗体、行内代码、
 * 引用块与链接，正则拼接必然漏。
 *
 * 安全性：内容来自本仓库自己的 Release（由 `scripts/gen-release-notes.mjs` 生成，
 * 数据源是 CHANGELOG），不是任意用户输入，因此直接渲染是可接受的。
 * 若将来改成渲染第三方来源，需要加 sanitize。
 */
export function renderNotesHtml(markdown: string): string {
  if (!markdown) return ''
  try {
    // breaks **必须为 false**：CHANGELOG 的条目是按 ~80 字符手工折行的，
    // 开启后每个折行都会被当成硬换行（插入 <br>），一段话被切成好几行。
    // 标准 Markdown 语义是「软换行合并成一个段落」，这才是我们要的。
    return marked.parse(markdown, { async: false, gfm: true, breaks: false }) as string
  } catch {
    // 解析失败时退回纯文本，至少不要白屏
    return markdown.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!))
  }
}

export function extractUserNotes(notes: string): string {
  if (!notes) return ''
  // 容忍生成脚本改模板：允许 emoji、空格与大小写差异
  const marker = /^#{2,3}\s*(?:📝\s*)?更新内容\s*$/m
  const hit = marker.exec(notes)
  if (!hit) return renderNotesHtml(notes.trim())

  let body = notes.slice(hit.index + hit[0].length)
  // 去掉尾部的页脚小字（"完整历史见 CHANGELOG"之类），它是发布页的导航，应用内不需要
  body = body.replace(/\n---\s*\n<sub>[\s\S]*$/m, '')
  body = body.replace(/\n*<sub>[\s\S]*$/m, '')
  // 转成 HTML：v-html 不认 Markdown
  return renderNotesHtml(body.trim())
}
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
  /** 容器版才有值；桌面版恒为 null，界面据此切换展示形态 */
  const container = ref<ContainerUpdateInfo | null>(null)

  const errorTitle = computed(() => ({
    check: t('update.errCheck'),
    download: t('update.errDownload'),
    install: t('update.errInstall'),
  })[errorPhase.value])

  let unsubscribe: (() => void) | null = null

  function fail(phase: UpdateErrorPhase, message: string) {
    status.value = 'error'
    errorPhase.value = phase
    errorMsg.value = message
  }

  /** 应用一次「有新版本」的结果（来自 IPC 返回值或广播事件，字段一致） */
  function applyAvailable(data: {
    version?: string
    releaseNotes?: string
    manual?: boolean
    manualReason?: string
    container?: ContainerUpdateInfo | null
  }) {
    status.value = 'available'
    newVersion.value = data.version || ''
    releaseNotes.value = extractUserNotes(data.releaseNotes || '')
    manual.value = !!data.manual
    manualReason.value = data.manualReason || ''
    container.value = data.container ?? null
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
      fail('check', t('update.errCheckNetwork'))
    }
  }

  async function downloadUpdate() {
    status.value = 'downloading'
    downloadPercent.value = 0
    downloadSpeed.value = t('update.preparing')
    try {
      const result = await window.electronAPI?.downloadUpdate?.()
      if (result && !result.success) {
        fail('download', result.error || t('update.errDownload'))
      } else if (status.value === 'downloading') {
        // 不依赖 update:status 事件，下载完成即进入可安装状态
        status.value = 'downloaded'
      }
    } catch {
      fail('download', t('update.errDownload'))
    }
  }

  async function installUpdate() {
    try {
      const result = await window.electronAPI?.installUpdate?.()
      if (result && !result.success) fail('install', result.error || t('update.errInstall'))
    } catch {
      fail('install', t('update.errInstall'))
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
          fail(status.value === 'downloading' ? 'download' : errorPhase.value, data.message || t('update.errGeneric'))
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

  /** 复制升级命令（容器版的主操作） */
  async function copyUpgradeCommands(): Promise<boolean> {
    const text = (container.value?.upgrade.commands || []).filter((c) => !c.startsWith('#')).join('\n')
    if (!text) return false
    try {
      await window.electronAPI?.clipboard?.writeText?.(text)
      return true
    } catch {
      return false
    }
  }

  return {
    status, currentVersion, newVersion, releaseNotes, errorMsg,
    downloadPercent, downloadSpeed, downloadUrl, manual, manualReason, errorPhase, container,
    errorTitle, copyUpgradeCommands,
    checkUpdate, downloadUpdate, installUpdate, openReleasePage, retry, init,
  }
}
