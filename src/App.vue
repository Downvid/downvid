<template>
  <div class="relative flex w-full flex-col h-screen bg-surface">
    <!-- Header -->
    <Header :current-tab="currentTab" @change-tab="changeTab" />
    
    <!-- Main Content -->
    <main class="flex-1 flex overflow-hidden">
      <DownloadView v-show="currentTab === 'download'" />
      <HistoryView v-show="currentTab === 'history'" />
      <AboutView v-show="currentTab === 'about'" />
    </main>

    <!-- Global Error Modal -->
    <ErrorModal
      :visible="modalState.visible"
      :type="modalState.type"
      :title="modalState.title"
      :message="modalState.message"
      :detail="modalState.detail"
      :hint="modalState.hint"
      @update:visible="modal.close()"
    />

    <!-- 设置浮窗（居中模态，与错误/更新提示同一形态） -->
    <SettingsView :visible="showSettings" @update:visible="showSettings = $event" />

    <!-- Auto Update Modal -->
    <UpdateModal :visible="showUpdate" @close="showUpdate = false" />

    <!-- 缺少运行依赖时的下载引导 -->
    <DepsPrompt />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import Header from './components/Header.vue'
import DownloadView from './components/DownloadView.vue'
import HistoryView from './components/HistoryView.vue'
import AboutView from './components/AboutView.vue'
import ErrorModal from './components/ErrorModal.vue'
import UpdateModal from './components/UpdateModal.vue'
import SettingsView from './components/SettingsView.vue'
import DepsPrompt from './components/DepsPrompt.vue'
import { useErrorModal } from './composables/useErrorModal'
import { useDepsStore } from './stores/deps'
import { readSettings } from './stores/settings'
import type { TabType } from './types'

const modal = useErrorModal()
const modalState = modal.state
const deps = useDepsStore()

const currentTab = ref<TabType>('download')
const showUpdate = ref(false)
const showSettings = ref(false)

function changeTab(tab: TabType) {
  if (tab === 'settings') {
    showSettings.value = true
    return
  }
  currentTab.value = tab
  window.dispatchEvent(new CustomEvent('tab-changed', { detail: tab }))
}

// 监听跳转设置页事件
// 设置里的「立即检查更新」→ 切到关于页并打开更新弹窗
window.addEventListener('navigate-to-about-update', () => {
  currentTab.value = 'about'
  window.dispatchEvent(new CustomEvent('tab-changed', { detail: 'about' }))
  // 等视图切换后再让 AboutView 打开弹窗（它用 v-show 切换，事件监听已就绪）
  setTimeout(() => window.dispatchEvent(new CustomEvent('about-open-update')), 0)
})

window.addEventListener('navigate-to-settings', () => {
  showSettings.value = true
})

// 监听菜单点击关于事件
let unsubscribeMenu: (() => void) | null = null
let unsubscribeUpdate: (() => void) | null = null
let unsubscribeSettings: (() => void) | null = null

onMounted(async () => {
  // 通知 preload 移除启动加载动画
  window.postMessage({ payload: 'removeLoading' }, '*')

  // 首次启动探测运行依赖：缺 yt-dlp / ffmpeg 时直接弹下载引导，
  // 用户粘贴链接前就能装好，而不是等到解析失败才发现。
  void deps.refresh().then(() => {
    if (deps.missingRequired.length) {
      deps.promptForMissing(deps.missingRequired.map(d => d.kind))
    }
  })

  if (window.electronAPI?.onMenuShowAbout) {
    unsubscribeMenu = window.electronAPI.onMenuShowAbout(() => {
      currentTab.value = 'about'
    })
  }

  // macOS 菜单里的「设置…」⌘,：主进程广播到渲染进程，打开设置浮窗
  if (window.electronAPI?.onMenuOpenSettings) {
    unsubscribeSettings = window.electronAPI.onMenuOpenSettings(() => {
      showSettings.value = true
    })
  }

  // 启动时自动检查更新
  if (window.electronAPI?.onUpdateStatus) {
    unsubscribeUpdate = window.electronAPI.onUpdateStatus((data: any) => {
      if (data.status === 'available') {
        showUpdate.value = true
      }
    })
  }
  // 把自动更新开关同步给主进程（设置存在渲染进程，主进程读不到）
  const saved = readSettings()
  window.electronAPI?.setUpdatePrefs?.({
    autoCheck: saved.autoCheckUpdate,
    autoDownload: saved.autoDownloadUpdate,
  })

  // 延迟 3 秒后检查更新，避免影响启动速度。
  // 以返回值为准弹窗，不依赖 update:status 事件；检查失败时静默，不打扰启动。
  // 关闭了自动检查则完全不请求（主进程侧也会再挡一次）。
  if (saved.autoCheckUpdate) {
    setTimeout(async () => {
      try {
        const result = await window.electronAPI?.checkForUpdates?.()
        if (result?.hasUpdate) showUpdate.value = true
      } catch {}
    }, 3000)
  }
})

onUnmounted(() => {
  if (unsubscribeMenu) unsubscribeMenu()
  if (unsubscribeUpdate) unsubscribeUpdate()
  if (unsubscribeSettings) unsubscribeSettings()
})
</script>

