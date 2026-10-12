<template>
  <Teleport to="body">
    <!-- Overlay -->
    <Transition name="fade">
      <div
        v-if="visible"
        class="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4"
        @click.self="close"
      />
    </Transition>

    <!-- Modal -->
    <Transition name="modal">
      <div
        v-if="visible"
        class="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-[520px] bg-surface-container-lowest rounded-2xl shadow-2xl overflow-hidden border border-outline-variant/20"
      >
        <!-- Header -->
        <div class="flex items-center gap-3 px-6 py-5 border-b border-outline-variant/15">
          <div class="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <MaterialIcon name="system_update" :size="24" class="text-primary" />
          </div>
          <div class="flex-1 min-w-0">
            <h2 class="font-headline text-lg font-bold text-on-surface">软件更新</h2>
            <p class="text-xs text-on-surface-variant mt-0.5">
              <template v-if="status === 'available'">
                新版本 v{{ newVersion }} 可用 · 当前 v{{ currentVersion }}
              </template>
              <template v-else>
                当前版本 v{{ currentVersion }}
              </template>
            </p>
          </div>
          <button
            class="p-2 rounded-lg hover:bg-surface-container-highest transition-colors shrink-0"
            @click="close"
          >
            <MaterialIcon name="close" :size="20" class="text-on-surface-variant" />
          </button>
        </div>

        <!-- Body -->
        <div class="px-6 py-5 max-h-[60vh] overflow-y-auto">
          <!-- Checking -->
          <div v-if="status === 'checking'" class="flex flex-col items-center justify-center py-10">
            <div class="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <MaterialIcon name="sync" :size="26" class="text-primary animate-spin" />
            </div>
            <p class="text-sm text-on-surface-variant">正在检查更新...</p>
          </div>

          <!-- Latest -->
          <div v-else-if="status === 'latest'" class="flex flex-col items-center justify-center py-10">
            <div class="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center mb-3">
              <MaterialIcon name="check_circle" :size="32" class="text-green-500" />
            </div>
            <p class="text-base font-semibold text-on-surface mb-1">已是最新版本</p>
            <p class="text-sm text-on-surface-variant">DownVid v{{ currentVersion }} 暂无更新</p>
          </div>

          <!-- Error -->
          <div v-else-if="status === 'error'" class="flex flex-col items-center justify-center py-10">
            <div class="w-14 h-14 rounded-full bg-error/10 flex items-center justify-center mb-3">
              <MaterialIcon name="error_outline" :size="32" class="text-error" />
            </div>
            <p class="text-base font-semibold text-on-surface mb-1">{{ errorTitle }}</p>
            <p class="text-sm text-on-surface-variant text-center mb-4">{{ errorMsg }}</p>
            <div class="flex items-center gap-3">
              <button
                class="px-4 py-2 rounded-lg bg-primary text-on-primary text-sm font-medium hover:bg-primary/90 transition-colors"
                @click="retry"
              >
                重试
              </button>
              <button
                class="px-4 py-2 rounded-lg text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
                @click="openReleasePage"
              >
                前往下载页手动更新
              </button>
            </div>
          </div>

          <!-- Update Available -->
          <div v-else-if="status === 'available'">
            <!-- Version Banner -->
            <div class="flex items-center gap-3 p-3.5 bg-primary/5 rounded-xl border border-primary/10 mb-4">
              <MaterialIcon name="new_releases" :size="22" class="text-primary shrink-0" />
              <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold text-on-surface">DownVid v{{ newVersion }}</p>
                <p class="text-xs text-on-surface-variant mt-0.5">
                  {{ manual ? manualReason || '当前安装方式不支持自动更新，请前往发布页下载' : '建议更新以获得最新功能和安全修复' }}
                </p>
              </div>
            </div>

            <!-- Release Notes -->
            <div class="flex flex-col gap-2">
              <h3 class="text-xs font-bold text-outline uppercase tracking-wider">更新内容</h3>
              <div
                v-if="releaseNotes"
                class="release-notes bg-surface rounded-xl p-4 border border-outline-variant/10 text-sm text-on-surface-variant leading-relaxed"
                v-html="releaseNotes"
              />
              <div
                v-else
                class="bg-surface rounded-xl p-4 border border-outline-variant/10 text-sm text-on-surface-variant"
              >
                暂无更新说明
              </div>
            </div>
          </div>

          <!-- Downloading -->
          <div v-else-if="status === 'downloading'" class="flex flex-col gap-4">
            <div class="flex items-center gap-3 p-3.5 bg-primary/5 rounded-xl border border-primary/10">
              <MaterialIcon name="download" :size="22" class="text-primary shrink-0" />
              <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold text-on-surface">正在下载 v{{ newVersion }}</p>
                <p class="text-xs text-on-surface-variant mt-0.5">{{ downloadSpeed }}</p>
              </div>
              <span class="text-sm font-bold text-primary font-mono">{{ Math.round(downloadPercent) }}%</span>
            </div>

            <!-- Progress Bar -->
            <div class="h-2 w-full bg-surface-container-highest rounded-full overflow-hidden">
              <div
                class="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                :style="{ width: downloadPercent + '%' }"
              />
            </div>

            <p class="text-xs text-on-surface-variant text-center">下载过程中请勿关闭应用</p>
          </div>

          <!-- Downloaded -->
          <div v-else-if="status === 'downloaded'" class="flex flex-col items-center justify-center py-8">
            <div class="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center mb-3">
              <MaterialIcon name="download_done" :size="32" class="text-green-500" />
            </div>
            <p class="text-base font-semibold text-on-surface mb-1">下载完成</p>
            <p class="text-sm text-on-surface-variant text-center mb-2">
              新版本 v{{ newVersion }} 已准备就绪
            </p>
            <p class="text-xs text-on-surface-variant/70 text-center">
              点击“重启并安装”完成更新，应用将自动重新打开
            </p>
          </div>
        </div>

        <!-- Footer -->
        <div
          v-if="status === 'available' || status === 'downloaded' || status === 'latest' || status === 'error'"
          class="flex items-center justify-end gap-3 px-6 py-4 border-t border-outline-variant/15 bg-surface-container-low/50"
        >
          <template v-if="status === 'available'">
            <button
              class="px-5 py-2 rounded-lg text-sm font-medium text-on-surface-variant hover:bg-surface-container-highest transition-colors"
              @click="close"
            >
              稍后
            </button>
            <button
              v-if="manual"
              class="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-on-primary text-sm font-semibold hover:bg-primary/90 transition-colors shadow-md"
              @click="openReleasePage"
            >
              <MaterialIcon name="open_in_new" :size="16" />
              <span>前往下载页</span>
            </button>
            <button
              v-else
              class="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-on-primary text-sm font-semibold hover:bg-primary/90 transition-colors shadow-md"
              @click="downloadUpdate"
            >
              <MaterialIcon name="download" :size="16" />
              <span>下载更新</span>
            </button>
          </template>

          <template v-else-if="status === 'downloaded'">
            <button
              class="px-5 py-2 rounded-lg text-sm font-medium text-on-surface-variant hover:bg-surface-container-highest transition-colors"
              @click="close"
            >
              稍后重启
            </button>
            <button
              class="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-on-primary text-sm font-semibold hover:bg-primary/90 transition-colors shadow-md"
              @click="installUpdate"
            >
              <MaterialIcon name="restart_alt" :size="16" />
              <span>重启并安装</span>
            </button>
          </template>

          <template v-else>
            <button
              class="px-5 py-2 rounded-lg bg-primary text-on-primary text-sm font-semibold hover:bg-primary/90 transition-colors shadow-md"
              @click="close"
            >
              完成
            </button>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import MaterialIcon from './icons/MaterialIcon.vue'
import { useUpdater } from '../composables/useUpdater'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

// 更新流程的状态机见 composables/useUpdater.ts
const {
  status, currentVersion, newVersion, releaseNotes, errorMsg,
  downloadPercent, downloadSpeed, manual, manualReason,
  errorTitle,
  downloadUpdate, installUpdate, openReleasePage, retry, init,
} = useUpdater({ visible: () => props.visible })

function close() {
  emit('close')
}

onMounted(() => {
  void init()
})
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.modal-enter-active {
  transition: opacity 0.25s ease, transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.modal-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.95);
}

/* Release Notes HTML 内容样式 */
.release-notes :deep(h1) {
  font-size: 1.1rem;
  font-weight: 700;
  color: #3b3125;
  margin: 0 0 0.5rem 0;
  padding-bottom: 0.3rem;
  border-bottom: 1px solid rgba(191, 175, 159, 0.3);
}
.release-notes :deep(h2) {
  font-size: 0.95rem;
  font-weight: 700;
  color: #3b3125;
  margin: 0.75rem 0 0.4rem 0;
}
.release-notes :deep(h3) {
  font-size: 0.85rem;
  font-weight: 600;
  color: #3b3125;
  margin: 0.6rem 0 0.3rem 0;
}
.release-notes :deep(p) {
  margin: 0.3rem 0;
  line-height: 1.6;
}
.release-notes :deep(ul),
.release-notes :deep(ol) {
  margin: 0.3rem 0;
  padding-left: 1.25rem;
}
.release-notes :deep(li) {
  margin: 0.2rem 0;
  line-height: 1.6;
}
.release-notes :deep(a) {
  color: #8c5100;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.release-notes :deep(a:hover) {
  opacity: 0.8;
}
.release-notes :deep(code) {
  background: rgba(140, 81, 0, 0.08);
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  font-size: 0.85em;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.release-notes :deep(pre) {
  background: rgba(59, 49, 37, 0.04);
  padding: 0.75rem;
  border-radius: 8px;
  overflow-x: auto;
  margin: 0.5rem 0;
}
.release-notes :deep(pre code) {
  background: none;
  padding: 0;
}
.release-notes :deep(hr) {
  border: none;
  border-top: 1px solid rgba(191, 175, 159, 0.3);
  margin: 0.75rem 0;
}
.release-notes :deep(blockquote) {
  border-left: 3px solid rgba(140, 81, 0, 0.3);
  padding-left: 0.75rem;
  margin: 0.5rem 0;
  color: #695d50;
}
.release-notes :deep(img) {
  max-width: 100%;
  border-radius: 8px;
  margin: 0.5rem 0;
}
.release-notes :deep(strong),
.release-notes :deep(b) {
  font-weight: 600;
  color: #3b3125;
}
</style>
