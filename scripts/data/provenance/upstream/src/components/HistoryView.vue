<template>
  <div class="flex-1 flex flex-col bg-surface p-8 overflow-hidden">
    <div class="max-w-4xl mx-auto w-full flex flex-col gap-6 h-full">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="font-headline text-2xl font-bold leading-tight text-on-surface">下载历史</h1>
          <p class="text-on-surface-variant text-sm mt-1">查看和管理已下载的视频</p>
        </div>
        <button 
          v-if="history.length > 0"
          class="flex items-center gap-2 px-4 py-2 rounded-md bg-surface-container-highest text-on-surface font-headline text-sm font-medium hover:bg-surface-variant transition-colors"
          @click="clearAllHistory"
        >
          <MaterialIcon name="delete_sweep" :size="18" />
          <span>清空历史</span>
        </button>
      </div>
      
      <!-- History List -->
      <div class="flex-1 overflow-y-auto pr-2">
        <div v-if="history.length === 0" class="flex flex-col items-center justify-center py-20 text-on-surface-variant">
          <MaterialIcon name="history" :size="64" class="mb-4 opacity-20" />
          <p class="text-lg font-medium">暂无下载记录</p>
          <p class="text-sm mt-2 opacity-70">下载的视频将显示在这里</p>
        </div>
        
        <div v-else class="grid grid-cols-1 gap-4">
          <div 
            v-for="item in history" 
            :key="item.id"
            class="flex gap-4 p-4 bg-surface-container-low rounded-lg border border-outline-variant/10 hover:border-primary/30 transition-colors group"
          >
            <!-- Thumbnail -->
            <div 
              class="w-32 h-20 rounded-md bg-surface-variant bg-cover bg-center flex-shrink-0 relative overflow-hidden"
              :style="{ backgroundImage: `url(${item.thumbnail})` }"
            >
              <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                <button 
                  class="opacity-0 group-hover:opacity-100 transition-opacity p-2 bg-primary/90 rounded-full text-on-primary"
                  @click="openFile(item)"
                >
                  <MaterialIcon name="play_arrow" :size="20" />
                </button>
              </div>
            </div>
            
            <!-- Info -->
            <div class="flex-1 flex flex-col justify-between min-w-0">
              <div>
                <h4 class="font-headline text-sm font-bold text-on-surface line-clamp-2">{{ item.title }}</h4>
                <p class="text-xs text-on-surface-variant mt-1 font-mono">{{ item.url }}</p>
              </div>
              <div class="flex items-center gap-4 text-[11px] text-on-surface-variant">
                <span class="flex items-center gap-1">
                  <MaterialIcon name="high_definition" :size="14" />
                  {{ item.quality }}
                </span>
                <span class="flex items-center gap-1">
                  <MaterialIcon name="schedule" :size="14" />
                  {{ formatDate(item.createdAt) }}
                </span>
              </div>
            </div>
            
            <!-- Actions -->
            <div class="flex flex-col gap-2 justify-center">
              <button 
                class="p-2 text-on-surface-variant hover:text-primary hover:bg-primary-container/20 rounded-md transition-colors"
                title="打开文件"
                @click="openFile(item)"
              >
                <MaterialIcon name="play_circle" :size="20" />
              </button>
              <button 
                class="p-2 text-on-surface-variant hover:text-primary hover:bg-primary-container/20 rounded-md transition-colors"
                title="打开所在文件夹"
                @click="openFolder(item)"
              >
                <MaterialIcon name="folder_open" :size="20" />
              </button>
              <button 
                class="p-2 text-on-surface-variant hover:text-error hover:bg-error-container/20 rounded-md transition-colors"
                title="删除记录"
                @click="deleteHistory(item.id)"
              >
                <MaterialIcon name="delete" :size="20" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import MaterialIcon from './icons/MaterialIcon.vue'
import type { HistoryRecord } from '../types'

const history = ref<HistoryRecord[]>([])

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function loadHistory() {
  try {
    history.value = await window.electronAPI.history.get()
  } catch (e) {
    console.error('Failed to load history:', e)
  }
}

async function deleteHistory(id: string) {
  try {
    await window.electronAPI.history.delete(id)
    history.value = history.value.filter(h => h.id !== id)
  } catch (e) {
    console.error('Failed to delete history:', e)
  }
}

async function clearAllHistory() {
  if (!confirm('确定要清空所有下载历史吗？')) return
  
  try {
    for (const item of history.value) {
      await window.electronAPI.history.delete(item.id)
    }
    history.value = []
  } catch (e) {
    console.error('Failed to clear history:', e)
  }
}

async function openFile(item: HistoryRecord) {
  await window.electronAPI.shell.openPath(item.filePath)
}

async function openFolder(item: HistoryRecord) {
  const path = item.filePath.substring(0, item.filePath.lastIndexOf('\\'))
  await window.electronAPI.shell.openPath(path)
}

onMounted(() => {
  loadHistory()
})
</script>
