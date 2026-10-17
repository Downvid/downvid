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
            <h2 class="font-headline text-lg font-bold text-on-surface">{{ t('settings.title') }}</h2>
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
                <!-- 界面语言：放在第一个分区的最上面——海外用户装上应用第一件事
                     就是找它，藏进二级面板等于没做。 -->
                <div class="flex flex-col gap-2">
                  <label class="text-sm font-medium text-on-surface">{{ t('settings.language') }}</label>
                  <select
                    v-model="settings.language"
                    class="px-3 py-2 bg-surface-container-highest border border-outline-variant/20 rounded-md text-sm text-on-surface focus:outline-hidden focus:border-primary/40"
                    @change="onLanguageChange"
                  >
                    <option value="auto">{{ t('settings.languageAuto') }}</option>
                    <option value="zh-CN">简体中文</option>
                    <option value="en-US">English</option>
                  </select>
                  <p class="text-[11px] text-on-surface-variant">{{ t('settings.languageHint') }}</p>
                </div>

                <div class="flex flex-col gap-2">
                  <label class="text-sm font-medium text-on-surface">{{ t('settings.downloadDir') }}</label>
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
                      {{ t('common.select') }}
                    </button>
                  </div>
                </div>

                <div class="flex flex-col gap-2">
                  <label class="text-sm font-medium text-on-surface">{{ t('settings.filenameTemplate') }}</label>
                  <input 
                    v-model="settings.filenameTemplate"
                    type="text"
                    class="px-3 py-2 bg-surface-container-highest border border-outline-variant/20 rounded-md text-sm text-on-surface focus:outline-hidden focus:border-primary/40 font-mono"
                    placeholder="%(title)s.%(ext)s"
                  />
                  <p class="text-[11px] text-on-surface-variant">{{ t('settings.filenameTemplateHint') }}</p>
                </div>

                <div class="flex flex-col gap-2">
                  <label class="text-sm font-medium text-on-surface">{{ t('settings.quality') }}</label>
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
                  {{ t('accel.title') }}
                  <input v-model="settings.acceleration.enabled" type="checkbox" class="size-4 accent-primary" />
                </label>
                <div class="flex flex-col gap-2">
                  <label for="download-connections" class="flex justify-between gap-3 text-sm text-on-surface">
                    {{ t('accel.maxConnections') }}
                    <output class="w-6 text-right tabular-nums">{{ settings.acceleration.enabled ? settings.acceleration.maxConnections : 1 }}</output>
                  </label>
                  <input id="download-connections" v-model.number="settings.acceleration.maxConnections" type="range" min="1" max="16" step="1" :disabled="!settings.acceleration.enabled" class="w-full accent-primary" />
                </div>
                <!-- aria2 的检测与下载都在「运行依赖」页：它现在是依赖体系的一员
                     （与 yt-dlp / ffmpeg 同一套探测 + 一键下载），在这里再放一份
                     检测按钮会让「明明依赖页显示已就绪，加速页又说没找到」成为常态。
                     这里只留一句指引。 -->
                <p class="text-[11px] text-on-surface-variant leading-relaxed">
                  {{ t('accel.aria2MovedHint') }}
                </p>
              </div>

              <!-- Cookies -->
              <div v-show="activeSection === 'cookies'" class="flex flex-col gap-5">
                <div class="flex flex-col gap-2">
                  <label class="text-sm font-medium text-on-surface">{{ t('cookies.mode') }}</label>
                  <div class="flex flex-col gap-1.5">
                    <label class="flex items-center gap-3 p-3 rounded-md cursor-pointer transition-colors hover:bg-surface-container-highest">
                      <div class="size-4 rounded-full border-2 flex items-center justify-center" :class="settings.cookieMode === 'auto' ? 'border-primary' : 'border-outline-variant'">
                        <div v-if="settings.cookieMode === 'auto'" class="size-2 rounded-full bg-primary" />
                      </div>
                      <input v-model="settings.cookieMode" type="radio" value="auto" class="hidden" />
                      <div class="flex flex-col">
                        <span class="text-sm text-on-surface font-medium">{{ t('cookies.autoTitle') }}</span>
                        <span class="text-[11px] text-on-surface-variant">{{ t('cookies.autoHint') }}</span>
                      </div>
                    </label>
                    <label class="flex items-center gap-3 p-3 rounded-md cursor-pointer transition-colors hover:bg-surface-container-highest">
                      <div class="size-4 rounded-full border-2 flex items-center justify-center" :class="settings.cookieMode === 'manual' ? 'border-primary' : 'border-outline-variant'">
                        <div v-if="settings.cookieMode === 'manual'" class="size-2 rounded-full bg-primary" />
                      </div>
                      <input v-model="settings.cookieMode" type="radio" value="manual" class="hidden" />
                      <div class="flex flex-col">
                        <span class="text-sm text-on-surface font-medium">{{ t('cookies.manualTitle') }}</span>
                        <span class="text-[11px] text-on-surface-variant">{{ t('cookies.manualHint') }}</span>
                      </div>
                    </label>
                  </div>
                </div>

                <div v-if="settings.cookieMode === 'manual'" class="flex flex-col gap-2">
                  <label class="text-sm font-medium text-on-surface">{{ t('cookies.file') }}</label>
                  <div class="flex gap-2">
                    <input 
                      v-model="settings.cookiesFile"
                      type="text"
                      readonly
                      :placeholder="t('cookies.filePlaceholder')"
                      class="flex-1 px-3 py-2 bg-surface-container-highest border border-outline-variant/20 rounded-md text-sm text-on-surface focus:outline-hidden focus:border-primary/40"
                    />
                    <button class="px-3 py-2 bg-surface-container-highest text-on-surface rounded-md text-sm font-medium hover:bg-surface-variant transition-colors border border-outline-variant/20" @click="selectCookiesFile">
                      {{ t('common.select') }}
                    </button>
                    <button v-if="settings.cookiesFile" class="px-3 py-2 bg-error-container text-on-error-container rounded-md text-sm font-medium hover:bg-error hover:text-on-error transition-colors border border-outline-variant/20" @click="clearCookiesFile">
                      {{ t('common.clear') }}
                    </button>
                  </div>
                </div>

                <p class="text-[11px] text-on-surface-variant">{{ t('cookies.usage') }}</p>
              </div>

              <!-- 代理 -->
              <div v-show="activeSection === 'proxy'" class="flex flex-col gap-5">
                <div class="flex flex-col gap-2">
                  <label class="text-sm font-medium text-on-surface">{{ t('proxy.label') }}</label>
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
                      {{ proxyTesting ? t('common.testing') : proxyTestResult === 'success' ? `${proxyTestLatency}ms` : proxyTestResult === 'fail' ? t('common.failed') : t('common.test') }}
                    </button>
                  </div>
                  <p class="text-[11px] text-on-surface-variant">{{ t('proxy.hint') }}</p>
                </div>
              </div>

              <!-- 更新 -->
              <div v-show="activeSection === 'update'" class="flex flex-col gap-5">
                <div class="flex flex-col gap-3">
                  <label class="flex items-start gap-3 p-3 rounded-md cursor-pointer transition-colors hover:bg-surface-container-highest">
                    <input v-model="settings.autoCheckUpdate" type="checkbox" class="mt-0.5 size-4 accent-primary" />
                    <div class="flex flex-col gap-0.5">
                      <span class="text-sm font-medium text-on-surface">{{ t('updateSettings.autoCheck') }}</span>
                      <span class="text-[11px] text-on-surface-variant leading-relaxed">
                        {{ t('updateSettings.autoCheckHint') }}
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
                      <span class="text-sm font-medium text-on-surface">{{ t('updateSettings.autoDownload') }}</span>
                      <span class="text-[11px] text-on-surface-variant leading-relaxed">
                        {{ t('updateSettings.autoDownloadHint') }}
                      </span>
                    </div>
                  </label>
                </div>

                <div class="flex flex-col gap-2">
                  <label class="text-sm font-medium text-on-surface">{{ t('updateSettings.source') }}</label>
                  <select
                    v-model="settings.updateSource"
                    class="px-3 py-2 bg-surface-container-highest border border-outline-variant/20 rounded-md text-sm text-on-surface focus:outline-hidden focus:border-primary/40"
                  >
                    <option v-for="opt in updateSourceChoices" :key="opt.id" :value="opt.id">
                      {{ opt.label }}
                    </option>
                  </select>
                  <p class="text-[11px] text-on-surface-variant leading-relaxed">
                    {{ t('updateSettings.sourceHint') }}
                  </p>
                </div>

                <p class="text-[11px] text-on-surface-variant leading-relaxed">
                  {{ t('updateSettings.manualHint') }}
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
              {{ t('common.save') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { t, setLocale, resolveLocale } from '../i18n'
import MaterialIcon from './icons/MaterialIcon.vue'
import DepPanel from './DepPanel.vue'
import { useErrorModal } from '../composables/useErrorModal'
import { abbreviatePath, ensureHomeDir } from '../composables/usePathDisplay'
import { readSettings, updateSettings } from '../stores/settings'
import { normalizeAcceleration, type AccelerationSettings } from '../../shared/acceleration'
import { UPDATE_SOURCE_IDS, type UpdateSourceId } from '../../shared/update-sources'

const { showError, showInfo } = useErrorModal()

void ensureHomeDir()

defineProps<{ visible: boolean }>()
const emit = defineEmits<{ (e: 'update:visible', v: boolean): void }>()

function close() { emit('update:visible', false) }

const activeSection = ref('download')
const sections = [
  { key: 'download', icon: 'download', get label() { return t('settings.tabDownload') } },
  { key: 'acceleration', icon: 'speed', get label() { return t('settings.tabAcceleration') } },
  { key: 'cookies', icon: 'cookie', get label() { return t('settings.tabCookies') } },
  { key: 'proxy', icon: 'language', get label() { return t('settings.tabProxy') } },
  { key: 'deps', icon: 'extension', get label() { return t('settings.tabDeps') } },
  { key: 'update', icon: 'system_update', get label() { return t('settings.tabUpdate') } },
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
  updateSource: UpdateSourceId
  language: 'auto' | 'zh-CN' | 'en-US'
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
  updateSource: 'auto',
  language: 'auto',
})

/**
 * 更新源候选。
 *
 * 标签走 `t()`，但**不能在模块顶层调用**（那样切换语言不会重绘），
 * 所以用 getter —— 与上面的 `qualityOptions` 是同一个写法。
 *
 * 每个 id 手写一条字面量词条而不是按 id 拼键名：
 * `lint:i18n` 只认字面量键，拼出来的键写错不会被任何检查拦住，
 * 界面上就直接显示 `updateSettings.source.gitee` 这一串。
 */
const UPDATE_SOURCE_LABEL_KEYS: Record<UpdateSourceId, () => string> = {
  auto: () => t('updateSettings.source.auto'),
  github: () => t('updateSettings.source.github'),
  jsdelivr: () => t('updateSettings.source.jsdelivr'),
  ghproxy: () => t('updateSettings.source.ghproxy'),
  gitee: () => t('updateSettings.source.gitee'),
  website: () => t('updateSettings.source.website'),
}

const updateSourceChoices = UPDATE_SOURCE_IDS.map(id => ({
  id,
  get label() { return UPDATE_SOURCE_LABEL_KEYS[id]() },
}))

const qualityOptions = [
  { value: 'best', get label() { return t('settings.qualityBest') } },
  { value: '1080p', get label() { return t('settings.quality1080') } },
  { value: '720p', get label() { return t('settings.quality720') } },
  { value: '480p', get label() { return t('settings.quality480') } },
]

const proxyTesting = ref(false)
const proxyTestResult = ref<'success' | 'fail' | ''>('')
const proxyTestLatency = ref(0)

async function testProxy() {
  if (!settings.value.proxy) { showInfo(t('settings.enterProxyFirst')); return }
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
      showError(t('settings.proxyUnavailable'), undefined, result.error)
    }
  } catch (e) {
    proxyTestResult.value = 'fail'
    showError(t('settings.proxyTestFailed', { message: e instanceof Error ? e.message : t('download.unknownError') }))
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

/**
 * 切换语言：立即生效并持久化。
 *
 * 不走「保存」按钮——语言是**预览型**设置，用户改完要马上看到结果，
 * 否则他会以为切换失败而反复点。
 */
function onLanguageChange() {
  updateSettings({ language: settings.value.language })
  setLocale(resolveLocale(settings.value.language))
}

function saveSettings() {
  // 合并写入：SettingsView 不管 depPaths，整体覆盖会把 DepPanel 存的手动路径抹掉
  updateSettings({ ...settings.value })
  window.electronAPI?.app?.setProxy?.(settings.value.proxy || '')
  // 开关要立刻生效（无需重启）
  window.electronAPI?.setUpdatePrefs?.({
    autoCheck: settings.value.autoCheckUpdate,
    autoDownload: settings.value.autoDownloadUpdate,
    source: settings.value.updateSource,
  })
  showInfo(t('settings.saved'))
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
    updateSource: saved.updateSource,
    language: saved.language,
  }
  if (!settings.value.downloadDir) {
    settings.value.downloadDir = await window.electronAPI.app.getDefaultDownloadDir()
  }
}

onMounted(() => { loadSettings() })
</script>

<style scoped>
.modal-enter-active, .modal-leave-active { transition: opacity 0.18s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-active .relative, .modal-leave-active .relative { transition: transform 0.18s ease; }
.modal-enter-from .relative, .modal-leave-to .relative { transform: scale(0.97); }
</style>
