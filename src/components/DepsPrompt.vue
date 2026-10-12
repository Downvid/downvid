<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="store.promptVisible"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        @click.self="store.dismissPrompt()"
      >
        <div class="absolute inset-0 bg-black/40 backdrop-blur-xs" @click="store.dismissPrompt()" />
        <div class="relative bg-surface-container rounded-xl shadow-2xl border border-outline-variant/20 w-full max-w-md overflow-hidden">
          <div class="flex items-start gap-3 px-6 pt-6 pb-2">
            <div class="shrink-0 size-10 rounded-full flex items-center justify-center bg-amber-container/20">
              <MaterialIcon name="download_for_offline" :size="20" class="text-amber" />
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="font-headline text-base font-bold text-on-surface">需要下载运行依赖</h3>
              <p class="text-xs text-on-surface-variant mt-1 leading-relaxed">
                DownVid 不再内置 yt-dlp / ffmpeg，会优先使用本机已安装的版本。
                当前缺少：
                <span class="font-mono text-on-surface">{{ missingText }}</span>
              </p>
            </div>
            <button
              class="shrink-0 p-1 rounded-md text-on-surface-variant hover:text-on-surface hover:bg-surface-variant transition-colors"
              @click="store.dismissPrompt()"
            >
              <MaterialIcon name="close" :size="18" />
            </button>
          </div>

          <div class="px-6 py-4 flex flex-col gap-3">
            <!-- 下载进度 -->
            <div v-if="store.downloading" class="flex flex-col gap-1.5">
              <div class="h-1.5 rounded-full bg-surface-container-highest overflow-hidden">
                <div
                  class="h-full bg-primary transition-all duration-200"
                  :class="store.percent === null ? 'animate-pulse w-1/3' : ''"
                  :style="store.percent === null ? {} : { width: `${store.percent}%` }"
                />
              </div>
              <div class="flex justify-between text-[11px] text-on-surface-variant">
                <span>{{ store.notice || `正在下载 ${store.activeTool || ''}...` }}</span>
                <span>{{ store.sizeText }}</span>
              </div>
            </div>

            <div v-if="store.error" class="flex gap-2 p-3 rounded-lg bg-error-container/20 border border-error/30">
              <MaterialIcon name="error" :size="16" class="text-error shrink-0 mt-0.5" />
              <p class="text-xs text-on-surface leading-relaxed break-all">{{ store.error }}</p>
            </div>

            <p class="text-[11px] text-on-surface-variant leading-relaxed">
              也可以自行安装后点「重新检测」：
              <span class="font-mono">{{ installHint }}</span>
            </p>
          </div>

          <div class="flex items-center justify-end gap-2 px-6 pb-5">
            <button
              class="px-3 py-2 rounded-md text-sm font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest transition-colors"
              @click="store.openManagedDir()"
            >打开安装目录</button>
            <button
              v-if="store.downloading"
              class="px-4 py-2 rounded-md text-sm font-medium bg-error-container text-on-error-container hover:bg-error hover:text-on-error transition-colors"
              @click="store.cancel()"
            >取消</button>
            <template v-else>
              <button
                class="px-3 py-2 rounded-md text-sm font-medium bg-surface-container-highest text-on-surface border border-outline-variant/20 hover:bg-surface-variant transition-colors disabled:opacity-40"
                :disabled="store.checking"
                @click="store.refresh(true)"
              >{{ store.checking ? '检测中...' : '重新检测' }}</button>
              <button
                class="px-4 py-2 rounded-md text-sm font-medium bg-primary text-on-primary hover:opacity-90 transition-opacity"
                @click="store.download(store.promptKinds.length ? store.promptKinds : undefined)"
              >下载并继续</button>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import MaterialIcon from './icons/MaterialIcon.vue'
import { useDepsStore } from '../stores/deps'

const store = useDepsStore()

const installHint = computed(() =>
  navigator.userAgent.includes('Mac')
    ? 'brew install yt-dlp ffmpeg'
    : navigator.userAgent.includes('Windows')
      ? 'winget install yt-dlp.yt-dlp Gyan.FFmpeg'
      : 'sudo apt install yt-dlp ffmpeg',
)

/** 弹窗里展示的缺失清单：优先显示触发这次提示的依赖 */
const missingText = computed(() => {
  const fromStore = store.deps.filter(d => !d.found).map(d => d.kind)
  const list = store.promptKinds.length ? store.promptKinds : fromStore
  return list.length ? list.join('、') : 'yt-dlp、ffmpeg'
})
</script>

<style scoped>
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-active .relative, .modal-leave-active .relative { transition: transform 0.2s ease; }
.modal-enter-from .relative, .modal-leave-to .relative { transform: scale(0.96); }
</style>
