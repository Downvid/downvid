<template>
  <div class="flex-1 flex flex-col bg-surface p-8 overflow-y-auto">
    <div class="max-w-2xl mx-auto w-full flex flex-col gap-6 pb-8">
      <!-- Header -->
      <div>
        <h1 class="font-headline text-2xl font-bold leading-tight text-on-surface">设置</h1>
        <p class="text-on-surface-variant text-sm mt-1">配置下载偏好和应用程序选项</p>
      </div>
      
      <!-- Settings Sections -->
      <div class="flex flex-col gap-6">
        <!-- Download Settings -->
        <div class="bg-surface-container-low rounded-lg p-6 border border-outline-variant/10">
          <h2 class="font-headline text-base font-bold text-on-surface mb-4 flex items-center gap-2">
            <MaterialIcon name="download" :size="20" class="text-primary" />
            下载设置
          </h2>
          
          <div class="flex flex-col gap-4">
            <!-- Download Path -->
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-on-surface">默认下载目录</label>
              <div class="flex gap-2">
                <input 
                  v-model="settings.downloadDir"
                  type="text"
                  readonly
                  class="flex-1 px-3 py-2 bg-surface-container-highest border border-outline-variant/20 rounded-md text-sm text-on-surface focus:outline-none focus:border-primary/40"
                />
                <button 
                  class="px-4 py-2 bg-surface-container-highest text-on-surface rounded-md text-sm font-medium hover:bg-surface-variant transition-colors border border-outline-variant/20"
                  @click="selectDownloadDir"
                >
                  选择目录
                </button>
              </div>
            </div>
            
            <!-- Filename Template -->
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-on-surface">文件名模板</label>
              <input 
                v-model="settings.filenameTemplate"
                type="text"
                class="px-3 py-2 bg-surface-container-highest border border-outline-variant/20 rounded-md text-sm text-on-surface focus:outline-none focus:border-primary/40"
                placeholder="%(title)s.%(ext)s"
              />
              <p class="text-[11px] text-on-surface-variant">
                可用变量: %(title)s - 标题, %(id)s - 视频ID, %(uploader)s - 上传者
              </p>
            </div>
            
            <!-- Cookies File -->
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-on-surface">设置Cookies 文件</label>
              <div class="flex gap-2">
                <input 
                  v-model="settings.cookiesFile"
                  type="text"
                  readonly
                  placeholder="选择 cookies.txt 文件（用于 YouTube 登录）"
                  class="flex-1 px-3 py-2 bg-surface-container-highest border border-outline-variant/20 rounded-md text-sm text-on-surface focus:outline-none focus:border-primary/40"
                />
                <button 
                  class="px-4 py-2 bg-surface-container-highest text-on-surface rounded-md text-sm font-medium hover:bg-surface-variant transition-colors border border-outline-variant/20"
                  @click="selectCookiesFile"
                >
                  选择文件
                </button>
                <button 
                  v-if="settings.cookiesFile"
                  class="px-4 py-2 bg-error-container text-on-error-container rounded-md text-sm font-medium hover:bg-error transition-colors hover:text-on-error border border-outline-variant/20"
                  @click="clearCookiesFile"
                >
                  清除
                </button>
              </div>
              <p class="text-[11px] text-on-surface-variant">
                用于下载B站和YouTube 视频。可使用 Chrome 扩展 "Get cookies.txt" 导出
              </p>
            </div>
          </div>
        </div>
        
        <!-- Quality Settings -->
        <div class="bg-surface-container-low rounded-lg p-6 border border-outline-variant/10">
          <h2 class="font-headline text-base font-bold text-on-surface mb-4 flex items-center gap-2">
            <MaterialIcon name="high_quality" :size="20" class="text-primary" />
            画质偏好
          </h2>
          
          <div class="flex flex-col gap-3">
            <label 
              v-for="quality in qualityOptions" 
              :key="quality.value"
              class="flex items-center gap-3 p-3 rounded-md cursor-pointer transition-colors hover:bg-surface-container-highest"
            >
              <div 
                class="size-4 rounded-full border-2 flex items-center justify-center"
                :class="settings.preferredQuality === quality.value ? 'border-primary' : 'border-outline-variant'"
              >
                <div v-if="settings.preferredQuality === quality.value" class="size-2 rounded-full bg-primary" />
              </div>
              <input 
                v-model="settings.preferredQuality"
                type="radio"
                :value="quality.value"
                class="hidden"
              />
              <span class="text-sm text-on-surface">{{ quality.label }}</span>
            </label>
          </div>
        </div>
        
        <!-- Save Button -->
        <button 
          class="w-full flex items-center justify-center gap-2 rounded-xl h-12 font-headline font-bold text-base shadow-md hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 text-on-primary-fixed gradient-btn-orange"
          @click="saveSettings"
        >
          <MaterialIcon name="save" :size="20" />
          <span>保存设置</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import MaterialIcon from './icons/MaterialIcon.vue'

interface Settings {
  downloadDir: string
  filenameTemplate: string
  preferredQuality: string
  cookiesFile: string
}

const settings = ref<Settings>({
  downloadDir: '',
  filenameTemplate: '%(title)s.%(ext)s',
  preferredQuality: 'best',
  cookiesFile: '',
})

const ytdlpVersion = ref('检测中...')

const qualityOptions = [
  { value: 'best', label: '最佳画质 (推荐)' },
  { value: '1080p', label: '1080P 高清' },
  { value: '720p', label: '720P 标清' },
  { value: '480p', label: '480P 流畅' },
]

async function selectDownloadDir() {
  const dir = await window.electronAPI.dialog.selectFolder()
  if (dir) {
    settings.value.downloadDir = dir
    // 自动保存设置
    localStorage.setItem('settings', JSON.stringify(settings.value))
  }
}

async function selectCookiesFile() {
  const file = await window.electronAPI.dialog.selectFile()
  if (file) {
    settings.value.cookiesFile = file
    // 自动保存设置
    localStorage.setItem('settings', JSON.stringify(settings.value))
  }
}

function clearCookiesFile() {
  settings.value.cookiesFile = ''
  // 自动保存设置
  localStorage.setItem('settings', JSON.stringify(settings.value))
}

function saveSettings() {
  localStorage.setItem('settings', JSON.stringify(settings.value))
  alert('设置已保存')
}

async function loadSettings() {
  // Load saved settings first
  const saved = localStorage.getItem('settings')
  if (saved) {
    const parsed = JSON.parse(saved)
    settings.value = { ...settings.value, ...parsed }
  }
  
  // If no download dir set, use default
  if (!settings.value.downloadDir) {
    settings.value.downloadDir = await window.electronAPI.app.getDefaultDownloadDir()
  }
  
  // Check YT-DLP version
  try {
    // This would need a new IPC handler to get version
    ytdlpVersion.value = '已安装'
  } catch (e) {
    ytdlpVersion.value = '未知'
  }
}

onMounted(() => {
  loadSettings()
})
</script>
