<template>
  <div class="flex flex-col gap-4">
    <h3 class="font-headline text-sm font-bold text-on-surface border-b border-outline-variant/20 pb-2">{{ t('formats.title') }}</h3>

    <!-- Video Info Card -->
    <VideoInfoCard :video-info="videoInfo" :selected-format="selectedFormat" />

    <!-- Video Formats -->
    <div class="flex flex-col gap-2">
      <span class="text-[11px] font-bold text-outline uppercase tracking-wider">{{ t('formats.videoHeader', { count: videoInfo.formats?.length || 0 }) }}</span>
      <div class="grid grid-cols-2 gap-2">
        <label
          v-for="format in videoInfo.formats"
          :key="format.formatId"
          class="flex items-center justify-between p-2.5 rounded-md cursor-pointer transition-colors"
          :class="selectedFormat?.formatId === format.formatId ? 'bg-surface-container-highest/50 border border-primary/30 hover:bg-primary-container/20' : 'bg-surface-container-lowest border border-outline-variant/20 hover:border-primary/40'"
          @click="$emit('selectVideo', format)"
        >
          <div class="flex items-center gap-2">
            <div
              class="size-4 rounded-full border-4 shrink-0"
              :class="selectedFormat?.formatId === format.formatId ? 'border-primary bg-surface' : 'border-outline-variant bg-surface'"
            />
            <span class="text-xs font-semibold" :class="selectedFormat?.formatId === format.formatId ? 'text-on-surface' : 'text-on-surface font-medium'">{{ format.quality }}</span>
          </div>
          <span class="text-[10px] font-mono text-on-surface-variant">{{ format.filesize ? formatFileSize(format.filesize) : t('formats.unknownSize') }}</span>
        </label>
      </div>
    </div>

    <!-- YouTube Audio Formats -->
    <div v-if="videoInfo.isYoutube && videoInfo.audioFormats?.length" class="flex flex-col gap-2">
      <span class="text-[11px] font-bold text-outline uppercase tracking-wider">{{ t('formats.audioHeader', { count: videoInfo.audioFormats.length }) }}</span>
      <div class="grid grid-cols-2 gap-2">
        <label
          v-for="format in videoInfo.audioFormats"
          :key="format.formatId"
          class="flex items-center justify-between p-2.5 rounded-md cursor-pointer transition-colors"
          :class="selectedAudioFormat?.formatId === format.formatId ? 'bg-surface-container-highest/50 border border-primary/30' : 'bg-surface-container-lowest border border-outline-variant/20 hover:border-primary/40'"
          @click="$emit('selectAudio', format)"
        >
          <div class="flex items-center gap-2">
            <div class="size-4 rounded-full border-4 shrink-0" :class="selectedAudioFormat?.formatId === format.formatId ? 'border-primary bg-surface' : 'border-outline-variant bg-surface'" />
            <span class="text-xs font-semibold">{{ format.quality }}</span>
          </div>
          <span class="text-[10px] font-mono text-on-surface-variant">{{ format.filesize ? formatFileSize(format.filesize) : t('formats.unknownSize') }}</span>
        </label>
      </div>
    </div>

    <!-- YouTube Audio Tracks -->
    <div v-if="videoInfo.isYoutube && videoInfo.audioTracks?.length" class="flex flex-col gap-2">
      <span class="text-[11px] font-bold text-outline uppercase tracking-wider">{{ t('formats.trackHeader', { count: videoInfo.audioTracks.length }) }}</span>
      <div class="grid grid-cols-2 gap-2">
        <label
          v-for="track in videoInfo.audioTracks"
          :key="track.id"
          class="flex items-center justify-between p-2.5 rounded-md cursor-pointer transition-colors"
          :class="selectedAudioTrack?.id === track.id ? 'bg-surface-container-highest/50 border border-primary/30' : 'bg-surface-container-lowest border border-outline-variant/20 hover:border-primary/40'"
          @click="$emit('selectTrack', track)"
        >
          <div class="flex items-center gap-2">
            <div class="size-4 rounded-full border-4 shrink-0" :class="selectedAudioTrack?.id === track.id ? 'border-primary bg-surface' : 'border-outline-variant bg-surface'" />
            <span class="text-xs font-semibold">{{ track.name }}</span>
          </div>
          <span class="text-[10px] font-mono text-on-surface-variant">{{ track.language }}</span>
        </label>
      </div>
    </div>

    <!-- YouTube Subtitles -->
    <div v-if="videoInfo.isYoutube && videoInfo.subtitles?.length" class="flex flex-col gap-2">
      <span class="text-[11px] font-bold text-outline uppercase tracking-wider">{{ t('formats.subtitleHeader', { count: videoInfo.subtitles.length }) }}</span>
      <div class="flex flex-wrap gap-2">
        <label
          v-for="sub in videoInfo.subtitles"
          :key="sub.language"
          class="flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors"
          :class="selectedSubtitles.includes(sub.language) ? 'bg-surface-container-highest/50 border border-primary/30' : 'bg-surface-container-lowest border border-outline-variant/20 hover:border-primary/40'"
          @click="$emit('selectSubtitle', sub.language)"
        >
          <div class="size-3 rounded-sm border-2 shrink-0" :class="selectedSubtitles.includes(sub.language) ? 'border-primary bg-primary' : 'border-outline-variant bg-surface'" />
          <span class="text-xs font-semibold">{{ sub.name }}</span>
        </label>
      </div>
    </div>

    <!-- Download Button -->
    <button
      class="w-full flex items-center justify-center gap-2 rounded-xl h-12 font-headline font-bold text-base shadow-md hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 mt-4 text-on-primary-fixed gradient-btn-orange"
      :disabled="(!selectedFormat && !selectedAudioFormat && selectedSubtitles.length === 0) || isDownloading"
      @click="$emit('download')"
    >
      <MaterialIcon v-if="isDownloading" name="sync" :size="24" class="animate-spin" />
      <MaterialIcon v-else name="download" :size="24" />
      <span>{{ isDownloading ? t('download.downloading') : (downloadMode === 'audio' ? t('download.downloadAudio') : (downloadMode === 'subtitle' ? t('download.downloadSubtitle') : t('download.startDownload'))) }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import MaterialIcon from './icons/MaterialIcon.vue'
import VideoInfoCard from './VideoInfoCard.vue'
import { t } from '../i18n'
import type { VideoInfo, VideoFormat, AudioFormat, AudioTrack } from '../types'

defineProps<{
  videoInfo: VideoInfo
  selectedFormat: VideoFormat | null
  selectedAudioFormat: AudioFormat | null
  selectedAudioTrack: AudioTrack | null
  selectedSubtitles: string[]
  downloadMode: 'video' | 'audio' | 'subtitle'
  isDownloading: boolean
}>()

defineEmits<{
  selectVideo: [format: VideoFormat]
  selectAudio: [format: AudioFormat]
  selectTrack: [track: AudioTrack]
  selectSubtitle: [language: string]
  download: []
}>()

function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return t('common.unknown')
  if (bytes === 0) return t('formats.sizeUnknown')
  const mb = bytes / 1024 / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}
</script>
