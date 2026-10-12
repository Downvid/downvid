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
              <h3 class="font-headline text-base font-bold text-on-surface">为什么需要 Cookie</h3>
              <p class="text-xs text-on-surface-variant mt-1 leading-relaxed">
                YouTube 对未登录请求做了限制，带上浏览器的登录态后即可正常解析与下载。
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
                <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/15 text-primary">推荐</span>
                <h4 class="text-sm font-medium text-on-surface">让 DownVid 自动读取浏览器 Cookie</h4>
              </div>
              <ol class="flex flex-col gap-1.5 text-xs text-on-surface-variant leading-relaxed pl-4 list-decimal">
                <li>先在浏览器里登录 YouTube</li>
                <li>打开「设置 → Cookies」，Cookie 模式选择<b class="text-on-surface">自动读取浏览器 Cookie</b></li>
                <li>然后回到这里重新解析一次即可，无需手动导出任何文件</li>
              </ol>
              <p class="mt-2 text-[11px] text-on-surface-variant leading-relaxed">
                DownVid 会自动尝试机器上已安装的浏览器（Chrome / Edge / Firefox / Safari / Brave），
                读到后导出快照并复用，解析与下载用的是同一份登录态。
                可在「设置 → 运行依赖」上方的「Cookies」板块查看当前用的是哪个来源。
              </p>
            </section>

            <!-- 自动读取失败的情形 -->
            <section class="p-3 rounded-lg bg-amber-container/20 border border-amber/25">
              <div class="flex gap-2">
                <MaterialIcon name="info" :size="16" class="text-amber shrink-0 mt-0.5" />
                <div class="text-xs text-on-surface leading-relaxed">
                  <p class="font-medium mb-1">如果自动读取失败</p>
                  <ul class="flex flex-col gap-1 text-on-surface-variant pl-4 list-disc">
                    <li><b class="text-on-surface">浏览器正在运行</b>：完全退出该浏览器后重试（Chrome / Edge 会锁住 Cookie 数据库）</li>
                    <li><b class="text-on-surface">macOS 上的 Safari</b>：需要授予 DownVid「完全磁盘访问」权限（系统设置 → 隐私与安全性 → 完全磁盘访问）</li>
                    <li><b class="text-on-surface">Windows 上的 Chrome</b>：运行时 Cookie 被 App-Bound 加密且数据库被锁，建议改用 Firefox，或采用下方的手动方式</li>
                  </ul>
                </div>
              </div>
            </section>

            <!-- 方式二：手动导入 -->
            <section>
              <h4 class="text-sm font-medium text-on-surface mb-2">手动导入 cookies.txt</h4>
              <ol class="flex flex-col gap-1.5 text-xs text-on-surface-variant leading-relaxed pl-4 list-decimal">
                <li>
                  在浏览器中安装扩展
                  <button class="text-tertiary hover:underline font-medium" @click="openExtensionStore">
                    Get cookies.txt LOCALLY
                  </button>
                </li>
                <li>打开 <span class="font-mono">youtube.com</span> 并确保已登录，用扩展导出 Netscape 格式的 cookies.txt</li>
                <li>打开「设置 → Cookies」，模式改为<b class="text-on-surface">手动导入 Cookie 文件</b>并选择刚导出的文件</li>
              </ol>
              <p class="mt-2 text-[11px] text-on-surface-variant leading-relaxed">
                Cookie 会过期，失效后需要重新导出。如果你经常遇到失效，用自动读取会更省事。
              </p>
            </section>
          </div>

          <!-- Footer -->
          <div class="flex items-center justify-end gap-2 px-6 py-4 border-t border-outline-variant/15">
            <button
              class="px-3 py-2 rounded-md text-sm font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest transition-colors"
              @click="close"
            >知道了</button>
            <button
              class="px-4 py-2 rounded-md text-sm font-medium bg-primary text-on-primary hover:opacity-90 transition-opacity"
              @click="goSettings"
            >打开 Cookie 设置</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import MaterialIcon from './icons/MaterialIcon.vue'

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
