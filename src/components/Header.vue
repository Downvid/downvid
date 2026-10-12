<template>
  <header
    class="flex items-center justify-between whitespace-nowrap bg-surface-container-low select-none"
    :class="isMac ? 'pl-[78px] pr-6 py-3' : 'px-6 py-3'"
    style="-webkit-app-region: drag"
  >
    <!-- Logo：所有平台都显示。macOS 上靠 header 的 pl-[78px] 让出原生红绿灯按钮的位置
         （按钮占 x=16~68，78px 留 10px 余量），不要在这里用 v-if 隐藏，否则会空出一块。 -->
    <div class="flex items-center gap-3 text-on-surface shrink-0" style="-webkit-app-region: no-drag">
      <div class="size-6 rounded-md overflow-hidden bg-primary/10 flex items-center justify-center shrink-0">
        <img src="@/assets/logo.png" alt="DownVid" class="w-full h-full object-contain" />
      </div>
      <h2 class="font-headline text-base font-bold leading-tail tracking-tight text-on-surface">DownVid</h2>
    </div>
    
    <!-- Navigation -->
    <div class="flex flex-1 justify-end gap-6" style="-webkit-app-region: no-drag">
      <nav class="flex items-center gap-6">
        <div 
          v-for="tab in tabs" 
          :key="tab.key"
          class="relative flex items-center h-full cursor-pointer"
          @click="$emit('change-tab', tab.key)"
        >
          <span 
            class="font-headline text-sm leading-normal transition-colors"
            :class="currentTab === tab.key ? 'text-primary font-semibold' : 'text-on-surface-variant hover:text-on-surface font-medium'"
          >
            {{ tab.label }}
          </span>
          <div 
            v-if="currentTab === tab.key"
            class="absolute -bottom-3 left-0 w-full h-0.5 bg-primary rounded-t-full"
          />
        </div>
      </nav>
      
      <!-- Settings Button -->
      <button 
        aria-label="Settings" 
        class="flex items-center justify-center rounded-md size-8 bg-surface-container-highest text-on-surface hover:bg-surface-variant transition-colors"
        @click="$emit('change-tab', 'settings')"
      >
        <MaterialIcon name="settings" :size="18" />
      </button>

      <!-- Window Controls (non-macOS) -->
      <div v-if="!isMac" class="flex items-center gap-0.5 ml-2" style="-webkit-app-region: no-drag">
        <button
          class="flex items-center justify-center size-8 rounded-md hover:bg-surface-variant transition-colors"
          @click="winCtrl.minimize()"
        >
          <MaterialIcon name="remove" :size="16" class="text-on-surface-variant" />
        </button>
        <button
          class="flex items-center justify-center size-8 rounded-md hover:bg-surface-variant transition-colors"
          @click="winCtrl.maximize()"
        >
          <MaterialIcon :name="isMaximized ? 'filter_none' : 'crop_square'" :size="14" class="text-on-surface-variant" />
        </button>
        <button
          class="flex items-center justify-center size-8 rounded-md hover:bg-error/80 hover:text-on-error transition-colors group"
          @click="winCtrl.close()"
        >
          <MaterialIcon name="close" :size="16" class="text-on-surface-variant group-hover:text-on-error" />
        </button>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import MaterialIcon from './icons/MaterialIcon.vue'
import type { TabType } from '../types'

defineProps<{
  currentTab: TabType
}>()

defineEmits<{
  (e: 'change-tab', tab: TabType): void
}>()

const isMac = navigator.platform.includes('Mac')
const isMaximized = ref(false)

const winCtrl = {
  minimize: () => window.electronAPI?.window?.minimize(),
  maximize: async () => {
    await window.electronAPI?.window?.maximize()
    isMaximized.value = await window.electronAPI?.window?.isMaximized() ?? false
  },
  close: () => window.electronAPI?.window?.close(),
}

onMounted(async () => {
  if (!isMac) {
    isMaximized.value = await window.electronAPI?.window?.isMaximized() ?? false
  }
})

const tabs = [
  { key: 'download' as TabType, label: '解析下载' },
  { key: 'history' as TabType, label: '下载历史' },
  { key: 'about' as TabType, label: '关于软件' },
]
</script>
