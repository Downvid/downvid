<template>
  <Teleport to="body">
    <Transition name="panel">
      <div v-if="visible" class="fixed inset-0 z-40 flex justify-end" @click.self="close">
        <!-- Overlay -->
        <div class="absolute inset-0 bg-black/30 backdrop-blur-xs" @click="close" />
        
        <!-- Panel -->
        <div class="relative w-full max-w-xl bg-surface-container-lowest shadow-2xl flex flex-col border-l border-outline-variant/20">
          <!-- Header -->
          <div class="flex items-center justify-between px-6 py-4 border-b border-outline-variant/15">
            <h2 class="font-headline text-lg font-bold text-on-surface">设置</h2>
            <button class="p-2 rounded-lg hover:bg-surface-container-highest transition-colors" @click="close">
              <MaterialIcon name="close" :size="20" class="text-on-surface-variant" />
            </button>
          </div>

          <!-- Body: Sidebar + Content -->
          <div class="flex-1 flex overflow-hidden">
            <!-- Sidebar -->
            <div class="w-40 shrink-0 bg-surface-container/50 border-r border-outline-variant/10 py-3 flex flex-col gap-1">
              <button
                v-for="section in sections"
                :key="section.key"
                class="flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium transition-colors text-left"
                :class="activeSection === section.key ? 'text-primary bg-primary/8' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest'"
                @click="activeSection = section.key"
              >
                <MaterialIcon :name="section.icon" :size="18" />
                {{ section.label }}
              </button>
            </div>

            <!-- Content -->
            <div class="flex-1 overflow-y-auto px-6 py-5">
              <!-- 下载设置 -->
              <div v-show="activeSection === 'download'" class="flex flex-col gap-5">
                <div class="flex flex-col gap-2">
                  <label class="text-sm font-medium text-on-surface">默认下载目录</label>
                  <div class="flex gap-2">
                    <input 
                      v-model="settings.downloadDir"
                      type="text"
                      readonly
                      class="flex-1 px-3 py-2 bg-surface-container-highest border border-outline-variant/20 rounded-md text-sm text-on-surface focus:outline-hidden focus:border-primary/40"
                    />
                    <button 
                      class="px-4 py-2 bg-surface-container-highest text-on-surface rounded-md text-sm font-medium hover:bg-surface-variant transition-colors border border-outline-variant/20"
                      @click="selectDownloadDir"
                    >
                      选择
                    </button>
                  </div>
                </div>

                <div class="flex flex-col gap-2">
                  <label class="text-sm font-medium text-on-surface">文件名模板</label>
                  <input 
                    v-model="settings.filenameTemplate"
                    type="text"
                    class="px-3 py-2 bg-surface-container-highest border border-outline-variant/20 rounded-md text-sm text-on-surface focus:outline-hidden focus:border-primary/40 font-mono"
                    placeholder="%(title)s.%(ext)s"
                  />
                  <p class="text-[11px] text-on-surface-variant">%(title)s 标题 · %(id)s ID · %(uploader)s 上传者</p>
                </div>

                <div class="flex flex-col gap-2">
                  <label class="text-sm font-medium text-on-surface">画质偏好</label>
                  <div class="flex flex-col gap-1.5">
                    <label 
                      v-for="q in qualityOptions" 
                      :key="q.value"
                      class="flex items-center gap-3 p-2.5 rounded-md cursor-pointer transition-colors hover:bg-surface-container-highest"
                    >
                      <div 
                        class="size-4 rounded-full border-2 flex items-center justify-center"
                        :class="settings.preferredQuality === q.value ? 'border-primary' : 'border-outline-variant'"
                      >
                        <div v-if="settings.preferredQuality === q.value" class="size-2 rounded-full bg-primary" />
                      </div>
                      <input v-model="settings.preferredQuality" type="radio" :value="q.value" class="hidden" />
                      <span class="text-sm text-on-surface">{{ q.label }}</span>
                    </label>
                  </div>
                </div>
              </div>

              <!-- Cookies -->
              <div v-show="activeSection === 'cookies'" class="flex flex-col gap-5">
                <div class="flex flex-col gap-2">
                  <label class="text-sm font-medium text-on-surface">Cookie 模式</label>
                  <div class="flex flex-col gap-1.5">
                    <label class="flex items-center gap-3 p-3 rounded-md cursor-pointer transition-colors hover:bg-surface-container-highest">
                      <div class="size-4 rounded-full border-2 flex items-center justify-center" :class="settings.cookieMode === 'auto' ? 'border-primary' : 'border-outline-variant'">
                        <div v-if="settings.cookieMode === 'auto'" class="size-2 rounded-full bg-primary" />
                      </div>
                      <input v-model="settings.cookieMode" type="radio" value="auto" class="hidden" />
                      <div class="flex flex-col">
                        <span class="text-sm text-on-surface font-medium">自动读取浏览器 Cookie</span>
                        <span class="text-[11px] text-on-surface-variant">从 Chrome/Edge/Safari 自动读取登录状态</span>
                      </div>
                    </label>
                    <label class="flex items-center gap-3 p-3 rounded-md cursor-pointer transition-colors hover:bg-surface-container-highest">
                      <div class="size-4 rounded-full border-2 flex items-center justify-center" :class="settings.cookieMode === 'manual' ? 'border-primary' : 'border-outline-variant'">
                        <div v-if="settings.cookieMode === 'manual'" class="size-2 rounded-full bg-primary" />
                      </div>
                      <input v-model="settings.cookieMode" type="radio" value="manual" class="hidden" />
                      <div class="flex flex-col">
                        <span class="text-sm text-on-surface font-medium">手动导入 Cookie 文件</span>
                        <span class="text-[11px] text-on-surface-variant">使用 Get cookies.txt 扩展导出</span>
                      </div>
                    </label>
                  </div>
                </div>

                <div v-if="settings.cookieMode === 'manual'" class="flex flex-col gap-2">
                  <label class="text-sm font-medium text-on-surface">Cookie 文件</label>
                  <div class="flex gap-2">
                    <input 
                      v-model="settings.cookiesFile"
                      type="text"
                      readonly
                      placeholder="选择 cookies.txt"
                      class="flex-1 px-3 py-2 bg-surface-container-highest border border-outline-variant/20 rounded-md text-sm text-on-surface focus:outline-hidden focus:border-primary/40"
                    />
                    <button class="px-3 py-2 bg-surface-container-highest text-on-surface rounded-md text-sm font-medium hover:bg-surface-variant transition-colors border border-outline-variant/20" @click="selectCookiesFile">
                      选择
                    </button>
                    <button v-if="settings.cookiesFile" class="px-3 py-2 bg-error-container text-on-error-container rounded-md text-sm font-medium hover:bg-error hover:text-on-error transition-colors border border-outline-variant/20" @click="clearCookiesFile">
                      清除
                    </button>
                  </div>
                </div>

                <p class="text-[11px] text-on-surface-variant">用于抖音、B站、YouTube 等需要登录的平台</p>
              </div>

              <!-- 代理 -->
              <div v-show="activeSection === 'proxy'" class="flex flex-col gap-5">
                <div class="flex flex-col gap-2">
                  <label class="text-sm font-medium text-on-surface">代理地址</label>
                  <div class="flex gap-2">
                    <input 
                      v-model="settings.proxy"
                      type="text"
                      class="flex-1 px-3 py-2 bg-surface-container-highest border border-outline-variant/20 rounded-md text-sm text-on-surface focus:outline-hidden focus:border-primary/40 font-mono"
                      placeholder="http://127.0.0.1:7890"
                    />
                    <button
                      class="px-3 py-2 bg-surface-container-highest text-on-surface rounded-md text-sm font-medium hover:bg-surface-variant transition-colors border border-outline-variant/20 flex items-center gap-1.5 whitespace-nowrap"
                      :class="{ 'text-green-600': proxyTestResult === 'success', 'text-error': proxyTestResult === 'fail' }"
                      :disabled="proxyTesting"
                      @click="testProxy"
                    >
                      <MaterialIcon v-if="proxyTesting" name="sync" :size="14" class="animate-spin" />
                      <MaterialIcon v-else-if="proxyTestResult === 'success'" name="check_circle" :size="14" />
                      <MaterialIcon v-else-if="proxyTestResult === 'fail'" name="error" :size="14" />
                      <MaterialIcon v-else name="wifi_find" :size="14" />
                      {{ proxyTesting ? '测试中' : proxyTestResult === 'success' ? `${proxyTestLatency}ms` : proxyTestResult === 'fail' ? '失败' : '测试' }}
                    </button>
                  </div>
                  <p class="text-[11px] text-on-surface-variant">支持 http/https/socks5。保存后立即生效，无需重启。</p>
                </div>
              </div>

              <!-- 运行依赖 -->
              <div v-show="activeSection === 'deps'" class="flex flex-col gap-5">
                <DepPanel />
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="px-6 py-3 border-t border-outline-variant/15 flex justify-end">
            <button 
              class="flex items-center gap-2 px-5 py-2 rounded-lg font-headline font-bold text-sm text-on-primary gradient-btn-orange transition-all hover:shadow-md"
              @click="saveSettings"
            >
              <MaterialIcon name="save" :size="16" />
              保存
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import MaterialIcon from './icons/MaterialIcon.vue'
import DepPanel from './DepPanel.vue'
import { useErrorModal } from '../composables/useErrorModal'

const { showError, showInfo } = useErrorModal()

defineProps<{ visible: boolean }>()
const emit = defineEmits<{ (e: 'update:visible', v: boolean): void }>()

function close() { emit('update:visible', false) }

const activeSection = ref('download')
const sections = [
  { key: 'download', icon: 'download', label: '下载' },
  { key: 'cookies', icon: 'cookie', label: 'Cookies' },
  { key: 'proxy', icon: 'language', label: '代理' },
  { key: 'deps', icon: 'extension', label: '运行依赖' },
]

interface Settings {
  downloadDir: string
  filenameTemplate: string
  preferredQuality: string
  cookieMode: 'auto' | 'manual'
  cookiesFile: string
  proxy: string
}

const settings = ref<Settings>({
  downloadDir: '',
  filenameTemplate: '%(title)s.%(ext)s',
  preferredQuality: 'best',
  cookieMode: 'auto',
  cookiesFile: '',
  proxy: '',
})

const qualityOptions = [
  { value: 'best', label: '最佳画质（推荐）' },
  { value: '1080p', label: '1080P 高清' },
  { value: '720p', label: '720P 标清' },
  { value: '480p', label: '480P 流畅' },
]

const proxyTesting = ref(false)
const proxyTestResult = ref<'success' | 'fail' | ''>('')
const proxyTestLatency = ref(0)

async function testProxy() {
  if (!settings.value.proxy) { showInfo('请先输入代理地址'); return }
  proxyTesting.value = true
  proxyTestResult.value = ''
  try {
    const result = await window.electronAPI.app.testProxy(settings.value.proxy)
    if (result.success) { proxyTestResult.value = 'success'; proxyTestLatency.value = result.latency || 0 }
    else { proxyTestResult.value = 'fail'; showError(`连接失败: ${result.error}`) }
  } catch (e) {
    proxyTestResult.value = 'fail'
    showError(`测试失败: ${e instanceof Error ? e.message : '未知错误'}`)
  } finally { proxyTesting.value = false }
}

async function selectDownloadDir() {
  const dir = await window.electronAPI.dialog.selectFolder()
  if (dir) { settings.value.downloadDir = dir; localStorage.setItem('settings', JSON.stringify(settings.value)) }
}

async function selectCookiesFile() {
  const file = await window.electronAPI.dialog.selectFile()
  if (file) { settings.value.cookiesFile = file; localStorage.setItem('settings', JSON.stringify(settings.value)) }
}

function clearCookiesFile() {
  settings.value.cookiesFile = ''
  localStorage.setItem('settings', JSON.stringify(settings.value))
}

function saveSettings() {
  localStorage.setItem('settings', JSON.stringify(settings.value))
  window.electronAPI?.app?.setProxy?.(settings.value.proxy || '')
  showInfo('设置已保存')
  close()
}

async function loadSettings() {
  const saved = localStorage.getItem('settings')
  if (saved) settings.value = { ...settings.value, ...JSON.parse(saved) }
  if (!settings.value.downloadDir) {
    settings.value.downloadDir = await window.electronAPI.app.getDefaultDownloadDir()
  }
}

onMounted(() => { loadSettings() })
</script>

<style scoped>
.panel-enter-active, .panel-leave-active { transition: opacity 0.2s ease; }
.panel-enter-from, .panel-leave-to { opacity: 0; }
.panel-enter-active .relative, .panel-leave-active .relative { transition: transform 0.25s ease; }
.panel-enter-from .relative { transform: translateX(100%); }
.panel-leave-to .relative { transform: translateX(100%); }
</style>
