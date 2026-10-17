<template>
  <div class="flex-1 bg-surface overflow-y-auto">
    <div class="max-w-2xl mx-auto px-6 py-8">
      <!-- Header -->
      <div class="mb-8">
        <h1 class="font-headline text-2xl font-bold text-on-surface">关于</h1>
      </div>
      
      <!-- App Info Card -->
      <div class="bg-gradient-to-br from-primary/5 to-secondary/5 rounded-2xl p-6 mb-6 border border-outline-variant/10">
        <div class="flex items-center gap-4">
          <!-- App Icon -->
          <div class="w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <svg class="w-9 h-9 text-primary" fill="none" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
              <path d="M8.57829 8.57829C5.52816 11.6284 3.451 15.5145 2.60947 19.7452C1.76794 23.9758 2.19984 28.361 3.85056 32.3462C5.50128 36.3314 8.29667 39.7376 11.8832 42.134C15.4698 44.5305 19.6865 45.8096 24 45.8096C28.3135 45.8096 32.5302 44.5305 36.1168 42.134C39.7033 39.7375 42.4987 36.3314 44.1494 32.3462C45.8002 28.361 46.2321 23.9758 45.3905 19.7452C44.549 15.5145 42.4718 11.6284 39.4217 8.57829L24 24L8.57829 8.57829Z" fill="currentColor"/>
            </svg>
          </div>
          
          <!-- App Info -->
          <div class="flex-1 min-w-0">
            <h2 class="font-headline text-xl font-bold text-on-surface">Videdown</h2>
            <p class="text-on-surface-variant text-sm mt-0.5">v{{ appVersion }}</p>
          </div>
          
          <!-- Update Button -->
          <button 
            class="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-on-primary text-sm font-medium hover:bg-primary/90 transition-colors shrink-0"
            :disabled="checkingUpdate"
            @click="checkUpdate"
          >
            <MaterialIcon :name="checkingUpdate ? 'sync' : 'update'" :size="16" :class="{ 'animate-spin': checkingUpdate }" />
            <span>{{ checkingUpdate ? '检测中' : '检测更新' }}</span>
          </button>
        </div>
        
        <!-- Update Result -->
        <div v-if="updateMessage" class="mt-4 pt-4 border-t border-outline-variant/20">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 text-sm" :class="updateMessageClass">
              <MaterialIcon :name="isLatest ? 'check_circle' : 'info'" :size="16" />
              <span>{{ updateMessage }}</span>
            </div>
            <button 
              v-if="downloadUrl && !isLatest"
              @click="openExternal(downloadUrl)"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              <MaterialIcon name="download" :size="14" />
              <span>前往下载</span>
            </button>
          </div>
        </div>
      </div>
      
      <!-- Description -->
      <div class="bg-surface-container-low rounded-xl p-5 mb-6 border border-outline-variant/10">
        <p class="text-sm text-on-surface-variant leading-relaxed">
          Videdown 是一款开源的视频下载工具，基于 YT-DLP 开发，支持抖音、B站、YouTube 等多个平台的视频下载。
        </p>
      </div>
      
      <!-- Donate Card -->
      <div class="bg-surface-container-low rounded-xl p-5 mb-6 border border-outline-variant/10">
        <div class="flex items-center gap-2 mb-4">
          <MaterialIcon name="favorite" :size="18" class="text-red-500" />
          <span class="text-base font-medium text-on-surface">支持作者</span>
        </div>
        <p class="text-sm text-on-surface-variant mb-5">
          如果这个项目对你有帮助，可以考虑请作者喝杯咖啡 ☕
        </p>
        
        <!-- QR Codes -->
        <div class="flex gap-6 justify-center">
          <div class="text-center">
            <div class="w-32 h-32 rounded-xl bg-surface-container-highest border border-outline-variant/30 overflow-hidden">
              <img src="../assets/wepay.png" alt="微信支付" class="w-full h-full object-cover">
            </div>
            <p class="text-xs text-on-surface-variant mt-2">微信支付</p>
          </div>
          <div class="text-center">
            <div class="w-32 h-32 rounded-xl bg-surface-container-highest border border-outline-variant/30 overflow-hidden">
              <img src="../assets/alipay.png" alt="支付宝" class="w-full h-full object-cover">
            </div>
            <p class="text-xs text-on-surface-variant mt-2">支付宝</p>
          </div>
        </div>
      </div>
      
      <!-- Links -->
      <div class="space-y-3 mb-6">
        <button 
          @click="openExternal('https://github.com/cshuangyy/videdown')"
          class="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-container-low hover:bg-surface-container-highest transition-colors group border border-outline-variant/10 text-left"
        >
          <div class="w-9 h-9 rounded-lg bg-surface-container-highest flex items-center justify-center group-hover:bg-surface transition-colors">
            <MaterialIcon name="code" :size="18" class="text-on-surface" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-on-surface">GitHub</p>
            <p class="text-xs text-on-surface-variant truncate">github.com/cshuangyy/videdown</p>
          </div>
          <MaterialIcon name="arrow_forward_ios" :size="14" class="text-on-surface-variant" />
        </button>
        
        <button 
          @click="openExternal('https://github.com/cshuangyy/videdown/issues')"
          class="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-container-low hover:bg-surface-container-highest transition-colors group border border-outline-variant/10 text-left"
        >
          <div class="w-9 h-9 rounded-lg bg-surface-container-highest flex items-center justify-center group-hover:bg-surface transition-colors">
            <MaterialIcon name="feedback" :size="18" class="text-on-surface" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-on-surface">问题反馈</p>
            <p class="text-xs text-on-surface-variant">提交建议或报告问题</p>
          </div>
          <MaterialIcon name="arrow_forward_ios" :size="14" class="text-on-surface-variant" />
        </button>
      </div>
      
      <!-- Tech Stack -->
      <div class="mb-6">
        <h3 class="text-xs font-medium text-on-surface-variant uppercase tracking-wider mb-3">技术栈</h3>
        <div class="flex flex-wrap gap-2">
          <span class="text-xs px-3 py-1.5 bg-surface-container-low rounded-lg text-on-surface border border-outline-variant/10">Electron</span>
          <span class="text-xs px-3 py-1.5 bg-surface-container-low rounded-lg text-on-surface border border-outline-variant/10">Vue 3</span>
          <span class="text-xs px-3 py-1.5 bg-surface-container-low rounded-lg text-on-surface border border-outline-variant/10">TypeScript</span>
          <span class="text-xs px-3 py-1.5 bg-surface-container-low rounded-lg text-on-surface border border-outline-variant/10">YT-DLP</span>
          <span class="text-xs px-3 py-1.5 bg-surface-container-low rounded-lg text-on-surface border border-outline-variant/10">FFmpeg</span>
        </div>
      </div>
      
      <!-- License -->
      <div class="flex items-center justify-between py-4 border-t border-outline-variant/20">
        <div class="flex items-center gap-2">
          <MaterialIcon name="gavel" :size="16" class="text-on-surface-variant" />
          <span class="text-sm text-on-surface-variant">开源协议</span>
        </div>
        <span class="text-xs font-medium text-primary bg-primary/10 px-3 py-1 rounded-full">MIT License</span>
      </div>
      
      <!-- Copyright -->
      <div class="text-center pt-4">
        <p class="text-xs text-on-surface-variant/60">© 2026 Videdown</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import MaterialIcon from './icons/MaterialIcon.vue'

const appVersion = ref('1.0.0')

// 页面加载时获取应用版本号
onMounted(async () => {
  try {
    const version = await window.electronAPI?.app?.getVersion?.()
    if (version) {
      appVersion.value = version
    }
  } catch (error) {
    console.error('获取版本号失败:', error)
  }
})
const isLatest = ref(true)
const checkingUpdate = ref(false)
const updateMessage = ref('')
const updateMessageClass = ref('')
const latestVersion = ref('')
const releaseNotes = ref('')
const downloadUrl = ref('')

async function checkUpdate() {
  checkingUpdate.value = true
  updateMessage.value = ''
  downloadUrl.value = ''
  
  try {
    const result = await window.electronAPI?.checkForUpdates?.()
    
    if (result?.error) {
      isLatest.value = true
      updateMessage.value = '检测失败：' + result.error
      updateMessageClass.value = 'text-red-600'
    } else if (result?.hasUpdate) {
      isLatest.value = false
      latestVersion.value = result.version || ''
      releaseNotes.value = result.releaseNotes || ''
      downloadUrl.value = result.downloadUrl || ''
      updateMessage.value = `发现新版本 v${result.version}`
      updateMessageClass.value = 'text-blue-600'
    } else {
      isLatest.value = true
      appVersion.value = result?.currentVersion || '1.0.0'
      updateMessage.value = '当前已是最新版本 v' + appVersion.value
      updateMessageClass.value = 'text-green-600'
    }
  } catch (error) {
    isLatest.value = true
    updateMessage.value = '检测失败，请检查网络连接'
    updateMessageClass.value = 'text-red-600'
  } finally {
    checkingUpdate.value = false
  }
}

async function openExternal(url: string) {
  try {
    await window.electronAPI.shell.openExternal(url)
  } catch (error) {
    // 静默处理错误
  }
}
</script>
