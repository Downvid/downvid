<template>
  <div class="flex gap-4 p-3 bg-surface-container-low rounded-md border border-outline-variant/10">
    <div
      class="w-40 h-24 rounded-sm bg-surface-variant bg-cover bg-center shrink-0 relative overflow-hidden shadow-xs"
      :style="{ backgroundImage: `url(${videoInfo.thumbnail})` }"
    >
      <div v-if="videoInfo.duration" class="absolute bottom-1 right-1 bg-inverse-surface/80 backdrop-blur-xs text-inverse-on-surface text-[10px] font-mono px-1 rounded-sm">
        {{ formatDuration(videoInfo.duration) }}
      </div>
    </div>
    <div class="flex flex-col flex-1 justify-between py-0.5">
      <div>
        <h4 class="font-headline text-sm font-bold text-on-surface leading-snug line-clamp-2">{{ videoInfo.title }}</h4>
        <p v-if="videoInfo.uploader" class="text-xs text-on-surface-variant mt-1 flex items-center gap-1">
          <MaterialIcon name="account_circle" :size="14" />
          <span>{{ videoInfo.uploader }}</span>
        </p>
      </div>
      <div class="flex items-center gap-3 text-[11px] text-on-surface-variant font-mono">
        <span v-if="videoInfo.duration" class="flex items-center gap-1">
          <MaterialIcon name="schedule" :size="14" />
          {{ formatDuration(videoInfo.duration) }}
        </span>
        <span v-if="selectedFormat?.filesize" class="flex items-center gap-1">
          <MaterialIcon name="database" :size="14" />
          {{ formatFileSize(selectedFormat.filesize) }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import MaterialIcon from './icons/MaterialIcon.vue'
import { t } from '../i18n'
import type { VideoInfo, VideoFormat } from '../types'

defineProps<{
  videoInfo: VideoInfo
  selectedFormat?: VideoFormat | null
}>()

function formatDuration(seconds?: number): string {
  if (!seconds) return ''
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return t('common.unknown')
  if (bytes === 0) return t('formats.sizeUnknown')
  const mb = bytes / 1024 / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}
</script>
