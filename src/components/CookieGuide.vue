<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="visible"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        @click.self="close"
      >
        <div class="absolute inset-0 bg-black/40 backdrop-blur-xs" @click="close" />
        <div class="relative bg-surface-container rounded-xl shadow-2xl border border-outline-variant/20 w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
          <!-- Header -->
          <div class="flex items-start gap-3 px-6 pt-6 pb-3">
            <div class="shrink-0 size-10 rounded-full flex items-center justify-center bg-primary-container/20">
              <MaterialIcon name="cookie" :size="20" class="text-primary" />
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="font-headline text-base font-bold text-on-surface">{{ t('cookieGuide.title') }}</h3>
              <p class="text-xs text-on-surface-variant mt-1 leading-relaxed">
                {{ t('cookieGuide.intro') }}
              </p>
            </div>
            <button class="shrink-0 p-1 rounded-md text-on-surface-variant hover:text-on-surface hover:bg-surface-variant transition-colors" @click="close">
              <MaterialIcon name="close" :size="18" />
            </button>
          </div>

          <!-- Body -->
          <div class="flex-1 overflow-y-auto px-6 pb-4 flex flex-col gap-5">
            <!-- 方式一：自动读取（推荐） -->
            <section>
              <div class="flex items-center gap-2 mb-2">
                <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/15 text-primary">{{ t('cookieGuide.recommended') }}</span>
                <h4 class="text-sm font-medium text-on-surface">{{ t('cookieGuide.autoTitle') }}</h4>
              </div>
              <ol class="flex flex-col gap-1.5 text-xs text-on-surface-variant leading-relaxed pl-4 list-decimal">
                <li>{{ t('cookieGuide.autoStep1') }}</li>
                <li>{{ t('cookieGuide.autoStep2') }}</li>
                <li>{{ t('cookieGuide.autoStep3') }}</li>
              </ol>
              <p class="mt-2 text-[11px] text-on-surface-variant leading-relaxed">
                {{ t('cookieGuide.autoNote') }}
              </p>
            </section>

            <!-- 自动读取失败的情形 -->
            <section class="p-3 rounded-lg bg-amber-container/20 border border-amber/25">
              <div class="flex gap-2">
                <MaterialIcon name="info" :size="16" class="text-amber shrink-0 mt-0.5" />
                <div class="text-xs text-on-surface leading-relaxed">
                  <p class="font-medium mb-1">{{ t('cookieGuide.ifFail') }}</p>
                  <ul class="flex flex-col gap-1 text-on-surface-variant pl-4 list-disc">
                    <li>{{ t('cookieGuide.failBrowserRunning') }}</li>
                    <li>{{ t('cookieGuide.failSafari') }}</li>
                    <li>{{ t('cookieGuide.failWindowsChrome') }}</li>
                  </ul>
                </div>
              </div>
            </section>

            <!-- 方式二：手动导入 -->
            <section>
              <h4 class="text-sm font-medium text-on-surface mb-2">{{ t('cookieGuide.manualTitle') }}</h4>
              <ol class="flex flex-col gap-1.5 text-xs text-on-surface-variant leading-relaxed pl-4 list-decimal">
                <li>
                  {{ t('cookieGuide.manualStepInstall') }}
                  <button class="text-tertiary hover:underline font-medium" @click="openExtensionStore">
                    Get cookies.txt LOCALLY
                  </button>
                </li>
                <li>{{ t('cookieGuide.manualStepExport') }}</li>
                <li>{{ t('cookieGuide.manualStepImport') }}</li>
              </ol>
              <p class="mt-2 text-[11px] text-on-surface-variant leading-relaxed">
                {{ t('cookieGuide.expireNote') }}
              </p>
            </section>
          </div>

          <!-- Footer -->
          <div class="flex items-center justify-end gap-2 px-6 py-4 border-t border-outline-variant/15">
            <button
              class="px-3 py-2 rounded-md text-sm font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest transition-colors"
              @click="close"
            >{{ t('error.acknowledge') }}</button>
            <button
              class="px-4 py-2 rounded-md text-sm font-medium bg-primary text-on-primary hover:opacity-90 transition-opacity"
              @click="goSettings"
            >{{ t('cookieGuide.openSettings') }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import MaterialIcon from './icons/MaterialIcon.vue'
import { t } from '../i18n'

/**
 * Cookie 使用引导。
 *
 * 此前点「查看详细教程」会跳转到仓库 wiki —— 用户离开应用去读文档，
 * 回来还要自己找路径。改为应用内浮窗，把步骤直接讲清楚，
 * 并提供一键跳到 Cookie 设置。
 */
defineProps<{ visible: boolean }>()
const emit = defineEmits<{ close: [] }>()

function close() {
  emit('close')
}

function goSettings() {
  emit('close')
  window.dispatchEvent(new CustomEvent('navigate-to-settings'))
}

/** 扩展商店地址按平台给：Chrome 系用 Chrome 商店 */
function openExtensionStore() {
  const isFirefox = /firefox/i.test(navigator.userAgent)
  const url = isFirefox
    ? 'https://addons.mozilla.org/firefox/addon/get-cookies-txt-locally/'
    : 'https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc'
  window.electronAPI?.shell?.openExternal?.(url)
}
</script>

<style scoped>
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-active .relative, .modal-leave-active .relative { transition: transform 0.2s ease; }
.modal-enter-from .relative, .modal-leave-to .relative { transform: scale(0.96); }
</style>
