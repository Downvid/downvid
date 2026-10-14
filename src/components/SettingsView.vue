<template>
  <Teleport to="body">
    <Transition name="modal">
      <!--
        设置是一个居中的模态浮窗，与错误提示 / 更新提示同一形态。
        不要做成右侧边栏：侧边栏在大窗口里离视线中心很远，且内容一长就要
        内部滚动显得局促；也不要拆成独立窗口 —— 那会多一次整页加载，
        打开明显变慢（用户反馈 1~3 秒）。
      -->
      <div
        v-if="visible"
        class="fixed inset-0 z-40 flex items-center justify-center p-4"
        @click.self="close"
      >
        <div class="absolute inset-0 bg-black/40 backdrop-blur-xs" @click="close" />

        <div class="relative bg-surface-container rounded-xl shadow-2xl border border-outline-variant/20 w-full max-w-3xl h-[80vh] max-h-[720px] flex flex-col overflow-hidden">
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
                      :value="abbreviatePath(settings.downloadDir)"
                      :title="settings.downloadDir"
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

              <div v-show="activeSection === 'acceleration'" class="flex flex-col gap-5">
                <label class="flex items-center justify-between gap-3 text-sm font-medium text-on-surface">
                  下载加速
                  <input v-model="settings.acceleration.enabled" type="checkbox" class="size-4 accent-primary" />
                </label>
                <div class="flex flex-col gap-2">
                  <label for="download-connections" class="flex justify-between gap-3 text-sm text-on-surface">
                    每个任务的最大连接数
                    <output class="w-6 text-right tabular-nums">{{ settings.acceleration.enabled ? settings.acceleration.maxConnections : 1 }}</output>
                  </label>
                  <input id="download-connections" v-model.number="settings.acceleration.maxConnections" type="range" min="1" max="16" step="1" :disabled="!settings.acceleration.enabled" class="w-full accent-primary" />
                </div>
                <div class="flex flex-col gap-2">
                  <label class="text-sm font-medium text-on-surface">aria2c 路径</label>
                  <div class="flex gap-2 min-w-0">
                    <input v-model="settings.acceleration.aria2Path" placeholder="自动检测" class="min-w-0 flex-1 px-3 py-2 bg-surface-container-highest border border-outline-variant/20 rounded-md text-sm text-on-surface" />
                    <button title="选择 aria2c" class="size-9 shrink-0 flex items-center justify-center rounded-md hover:bg-surface-container-highest" @click="selectAria2">
                      <MaterialIcon name="folder_open" :size="18" />
                    </button>
                    <button title="检测 aria2c" :disabled="checkingAria2" class="size-9 shrink-0 flex items-center justify-center rounded-md hover:bg-surface-container-highest" @click="checkAria2">
                      <MaterialIcon name="refresh" :size="18" />
                    </button>
                  </div>
                  <p class="text-xs text-on-surface-variant break-words" role="status">{{ checkingAria2 ? '检测中...' : aria2Status }}</p>
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

              <!-- 更新 -->
              <div v-show="activeSection === 'update'" class="flex flex-col gap-5">
                <div class="flex flex-col gap-3">
                  <label class="flex items-start gap-3 p-3 rounded-md cursor-pointer transition-colors hover:bg-surface-container-highest">
                    <input v-model="settings.autoCheckUpdate" type="checkbox" class="mt-0.5 size-4 accent-primary" />
                    <div class="flex flex-col gap-0.5">
                      <span class="text-sm font-medium text-on-surface">启动时自动检查更新</span>
                      <span class="text-[11px] text-on-surface-variant leading-relaxed">
                        启动 3 秒后向后请求一次 GitHub Releases。关闭后不再自动检查，
                        也不会在退出时自动安装；「关于」页的手动「检查更新」仍然可用。
                      </span>
                    </div>
                  </label>

                  <label
                    class="flex items-start gap-3 p-3 rounded-md transition-colors"
                    :class="settings.autoCheckUpdate ? 'cursor-pointer hover:bg-surface-container-highest' : 'opacity-50 cursor-not-allowed'"
                  >
                    <input
                      v-model="settings.autoDownloadUpdate"
                      type="checkbox"
                      class="mt-0.5 size-4 accent-primary"
                      :disabled="!settings.autoCheckUpdate"
                    />
                    <div class="flex flex-col gap-0.5">
                      <span class="text-sm font-medium text-on-surface">发现新版本时自动下载</span>
                      <span class="text-[11px] text-on-surface-variant leading-relaxed">
                        开启后自动下载安装包（仍需你点「立即安装」）。关闭时只提示有新版本，
                        下载由你决定 —— 移动网络或计费流量下建议关闭。
                      </span>
                    </div>
                  </label>
                </div>

                <p class="text-[11px] text-on-surface-variant leading-relaxed">
                  手动检查更新在「关于软件」页 —— 那里已有入口，不在此重复。
                </p>
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
import { abbreviatePath, ensureHomeDir } from '../composables/usePathDisplay'
import { readSettings, updateSettings } from '../stores/settings'
import { normalizeAcceleration, type AccelerationSettings } from '../../shared/acceleration'

const { showError, showInfo } = useErrorModal()

void ensureHomeDir()

defineProps<{ visible: boolean }>()
const emit = defineEmits<{ (e: 'update:visible', v: boolean): void }>()

function close() { emit('update:visible', false) }

const activeSection = ref('download')
const sections = [
  { key: 'download', icon: 'download', label: '下载' },
  { key: 'acceleration', icon: 'speed', label: '加速' },
  { key: 'cookies', icon: 'cookie', label: 'Cookies' },
  { key: 'proxy', icon: 'language', label: '代理' },
  { key: 'deps', icon: 'extension', label: '运行依赖' },
  { key: 'update', icon: 'system_update', label: '更新' },
]

interface Settings {
  downloadDir: string
  filenameTemplate: string
  preferredQuality: string
  cookieMode: 'auto' | 'manual'
  cookiesFile: string
  proxy: string
  acceleration: AccelerationSettings
  autoCheckUpdate: boolean
  autoDownloadUpdate: boolean
}

const settings = ref<Settings>({
  downloadDir: '',
  filenameTemplate: '%(title)s.%(ext)s',
  preferredQuality: 'best',
  cookieMode: 'auto',
  cookiesFile: '',
  proxy: '',
  acceleration: normalizeAcceleration(),
  autoCheckUpdate: true,
  autoDownloadUpdate: false,
})

const qualityOptions = [
  { value: 'best', label: '最佳画质（推荐）' },
  { value: '1080p', label: '1080P 高清' },
  { value: '720p', label: '720P 标清' },
  { value: '480p', label: '480P 流畅' },
]

const proxyTesting = ref(false)
const checkingAria2 = ref(false)
const aria2Status = ref('')

async function checkAria2() {
  if (checkingAria2.value) return
  checkingAria2.value = true
  try {
    const result = await window.electronAPI.ytdlp.accelerationStatus(settings.value.acceleration.aria2Path)
    aria2Status.value = result.found ? `aria2 ${result.version} · ${result.path}` : result.reason
  } catch { aria2Status.value = '检测失败，使用内置下载器' }
  finally { checkingAria2.value = false }
}

async function selectAria2() {
  const file = await window.electronAPI.dialog.selectFile()
  if (file) { settings.value.acceleration.aria2Path = file; await checkAria2() }
}
const proxyTestResult = ref<'success' | 'fail' | ''>('')
const proxyTestLatency = ref(0)

async function testProxy() {
  if (!settings.value.proxy) { showInfo('请先输入代理地址'); return }
  proxyTesting.value = true
  proxyTestResult.value = ''
  try {
    const result = await window.electronAPI.app.testProxy(settings.value.proxy)
    if (result.success) {
      proxyTestResult.value = 'success'
      proxyTestLatency.value = result.latency || 0
      // 代理与直连都通时提示"代理可能未生效"——不能断言失败，但值得让用户知道
      if (result.warning) showInfo(result.warning)
    } else {
      proxyTestResult.value = 'fail'
      showError('代理不可用', undefined, result.error)
    }
  } catch (e) {
    proxyTestResult.value = 'fail'
    showError(`测试失败: ${e instanceof Error ? e.message : '未知错误'}`)
  } finally { proxyTesting.value = false }
}

async function selectDownloadDir() {
  const dir = await window.electronAPI.dialog.selectFolder()
  if (dir) { settings.value.downloadDir = dir; updateSettings({ downloadDir: dir }) }
}

async function selectCookiesFile() {
  const file = await window.electronAPI.dialog.selectFile()
  if (file) { settings.value.cookiesFile = file; updateSettings({ cookiesFile: file }) }
}

function clearCookiesFile() {
  settings.value.cookiesFile = ''
  updateSettings({ cookiesFile: '' })
}

function saveSettings() {
  // 合并写入：SettingsView 不管 depPaths，整体覆盖会把 DepPanel 存的手动路径抹掉
  updateSettings({ ...settings.value })
  window.electronAPI?.app?.setProxy?.(settings.value.proxy || '')
  // 开关要立刻生效（无需重启）
  window.electronAPI?.setUpdatePrefs?.({
    autoCheck: settings.value.autoCheckUpdate,
    autoDownload: settings.value.autoDownloadUpdate,
  })
  showInfo('设置已保存')
  close()
}

async function loadSettings() {
  // 走统一的读取入口：它会补齐默认值，老数据缺字段也不会是 undefined
  const saved = readSettings()
  settings.value = {
    downloadDir: saved.downloadDir,
    filenameTemplate: saved.filenameTemplate,
    preferredQuality: saved.preferredQuality,
    cookieMode: saved.cookieMode,
    cookiesFile: saved.cookiesFile,
    proxy: saved.proxy,
    acceleration: { ...saved.acceleration },
    autoCheckUpdate: saved.autoCheckUpdate,
    autoDownloadUpdate: saved.autoDownloadUpdate,
  }
  if (!settings.value.downloadDir) {
    settings.value.downloadDir = await window.electronAPI.app.getDefaultDownloadDir()
  }
  void checkAria2()
}

onMounted(() => { loadSettings() })
</script>

<style scoped>
.modal-enter-active, .modal-leave-active { transition: opacity 0.18s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-active .relative, .modal-leave-active .relative { transition: transform 0.18s ease; }
.modal-enter-from .relative, .modal-leave-to .relative { transform: scale(0.97); }
</style>
