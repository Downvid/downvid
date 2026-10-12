<template>
  <div class="flex flex-col gap-3">
    <div class="relative">
      <textarea
        ref="urlInput"
        :value="store.url"
        @input="store.url = ($event.target as HTMLTextAreaElement).value"
        aria-label="Paste video URL here"
        class="w-full h-24 bg-surface-container-highest rounded-md p-3 text-on-surface placeholder:text-outline-variant resize-none font-body text-sm border-2 border-transparent focus:border-primary focus:outline-hidden transition-all"
        placeholder="在此处粘贴需要解析的视频链接..."
        @contextmenu.prevent="showContextMenu"
      />
      <!-- Context Menu -->
      <div
        v-if="contextMenuVisible"
        class="absolute z-50 bg-surface-container-high rounded-lg shadow-lg border border-outline-variant/20 py-1 min-w-[120px]"
        :style="{ top: contextMenuY + 'px', left: contextMenuX + 'px' }"
      >
        <button
          v-for="item in contextMenuItems"
          :key="item.action"
          class="w-full px-4 py-2 text-left text-sm text-on-surface hover:bg-surface-container-highest transition-colors flex items-center gap-2"
          @click="handleContextMenuAction(item.action)"
        >
          <MaterialIcon :name="item.icon" :size="16" />
          <span>{{ item.label }}</span>
        </button>
      </div>
    </div>
    <div class="flex gap-3">
      <button
        class="flex-1 flex items-center justify-center gap-2 rounded-md h-10 bg-surface-container-highest text-on-surface font-headline font-semibold text-sm hover:bg-surface-variant transition-colors border border-outline-variant/10"
        @click="pasteUrl"
      >
        <MaterialIcon name="content_paste" :size="18" />
        <span>粘贴链接</span>
      </button>
      <button
        class="flex-[1.5] flex items-center justify-center gap-2 rounded-md h-10 font-headline font-semibold text-sm transition-all border-2 bg-tertiary-container/40 text-tertiary border-tertiary/30 hover:bg-tertiary-container/60 hover:border-tertiary/50 disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="store.isParsing"
        @click="$emit('parse')"
      >
        <MaterialIcon v-if="store.isParsing" name="sync" :size="18" class="animate-spin" />
        <MaterialIcon v-else name="bolt" :size="18" />
        <span>{{ store.isParsing ? '解析中...' : '解析视频信息' }}</span>
      </button>
    </div>

    <!-- YouTube Cookie Hint -->
    <div v-if="store.isYouTubeUrl && !store.hasParsed" class="flex flex-col gap-2 p-4 bg-tertiary-container/30 rounded-lg border border-tertiary/20">
      <div class="flex items-start gap-3">
        <MaterialIcon name="info" :size="20" class="text-tertiary shrink-0 mt-0.5" />
        <div class="flex-1">
          <p class="text-sm font-medium text-on-surface">YouTube 视频需要 Cookie 才能下载</p>
          <p class="text-xs text-on-surface-variant mt-1 leading-relaxed">
            由于 YouTube 的限制，需安装 Chrome 插件
            <span class="font-medium text-tertiary">Get cookies.txt LOCALLY</span>
            导出 cookies 文件命名为 cookies.txt，然后在设置中导入并且需要经常更新cookies.txt。
          </p>
          <button
            @click="openCookieHelp"
            class="mt-2 text-xs text-tertiary hover:text-tertiary/80 underline underline-offset-2 transition-colors"
          >
            查看详细教程
          </button>
        </div>
      </div>
    </div>

    <!-- Bilibili Cookie Hint -->
    <div v-if="store.showBilibiliCookieHint && !store.hasParsed" class="flex flex-col gap-2 p-4 bg-tertiary-container/30 rounded-lg border border-tertiary/20">
      <div class="flex items-start gap-3">
        <MaterialIcon name="info" :size="20" class="text-tertiary shrink-0 mt-0.5" />
        <div class="flex-1">
          <p class="text-sm font-medium text-on-surface">B站视频需要 Cookie 才能下载</p>
          <p class="text-xs text-on-surface-variant mt-1 leading-relaxed">
            由于 B站的限制，需要导入 cookies.txt 文件才能下载完整视频。
          </p>
          <button
            @click="goToSettings"
            class="mt-2 flex items-center gap-1 text-xs text-tertiary hover:text-tertiary/80 underline underline-offset-2 transition-colors"
          >
            <MaterialIcon name="settings" :size="14" />
            <span>去设置导入 Cookie</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Supported Platforms -->
    <div class="flex flex-col gap-2 mt-2">
      <span class="text-[10px] font-bold text-outline uppercase tracking-widest ml-1">支持解析平台</span>
      <div class="flex items-center gap-4 px-4 py-2.5 bg-surface-container-low rounded-lg border border-outline-variant/10">
        <div v-for="platform in platforms" :key="platform.name" class="flex items-center gap-2 transition-all cursor-default">
          <MaterialIcon :name="platform.icon" :size="18" class="text-primary" :weight="200"/>
          <span class="text-[11px] font-medium text-on-surface-variant">{{ platform.name }}</span>
        </div>
      </div>
    </div>
  </div>
  <CookieGuide :visible="showCookieGuide" @close="showCookieGuide = false" />
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import MaterialIcon from './icons/MaterialIcon.vue'
import CookieGuide from './CookieGuide.vue'
import { useDownloadStore } from '../stores/download'
/** Cookie 使用引导浮窗（不再跳转到仓库 wiki） */
const showCookieGuide = ref(false)

const store = useDownloadStore()

defineEmits<{
  parse: []
}>()

const urlInput = ref<HTMLTextAreaElement | null>(null)

const platforms = [
  { name: '抖音', icon: 'music_note' },
  { name: '小红书', icon: 'menu_book' },
  { name: 'B站', icon: 'live_tv' },
  { name: 'YouTube', icon: 'smart_display' },
  { name: 'Instagram', icon: 'photo_camera' },
]

const contextMenuItems = [
  { action: 'cut', label: '剪切', icon: 'content_cut' },
  { action: 'copy', label: '复制', icon: 'content_copy' },
  { action: 'paste', label: '粘贴', icon: 'content_paste' },
  { action: 'delete', label: '删除', icon: 'delete' },
  { action: 'selectAll', label: '全选', icon: 'select_all' },
]

const contextMenuVisible = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)

function showContextMenu(event: MouseEvent) {
  contextMenuX.value = event.offsetX
  contextMenuY.value = event.offsetY
  contextMenuVisible.value = true
}

function hideContextMenu() {
  contextMenuVisible.value = false
}

async function handleContextMenuAction(action: string) {
  const input = urlInput.value
  if (!input) return

  const start = input.selectionStart || 0
  const end = input.selectionEnd || 0
  const selectedText = store.url.substring(start, end)

  switch (action) {
    case 'cut':
      if (selectedText) {
        await window.electronAPI?.clipboard?.writeText?.(selectedText)
        store.url = store.url.substring(0, start) + store.url.substring(end)
        input.setSelectionRange(start, start)
      }
      break
    case 'copy':
      if (selectedText) await window.electronAPI?.clipboard?.writeText?.(selectedText)
      break
    case 'paste':
      try {
        const text = await window.electronAPI?.clipboard?.readText?.()
        if (text) {
          store.url = store.url.substring(0, start) + text + store.url.substring(end)
          input.setSelectionRange(start + text.length, start + text.length)
        }
      } catch {}
      break
    case 'delete':
      if (selectedText) {
        store.url = store.url.substring(0, start) + store.url.substring(end)
        input.setSelectionRange(start, start)
      }
      break
    case 'selectAll':
      input.select()
      break
  }
  hideContextMenu()
}

async function pasteUrl() {
  try {
    const text = await window.electronAPI.clipboard.readText()
    store.url = text
  } catch {}
}

function goToSettings() {
  window.dispatchEvent(new CustomEvent('navigate-to-settings'))
}

function openCookieHelp() {
  showCookieGuide.value = true
}

onMounted(() => document.addEventListener('click', hideContextMenu))
onUnmounted(() => document.removeEventListener('click', hideContextMenu))
</script>
