<template>
  <div class="flex-1 flex overflow-hidden">
    <!-- Left Panel -->
    <section class="w-[65%] flex flex-col bg-surface relative">
      <div class="flex-1 overflow-y-auto px-8 py-6">
        <div class="max-w-xl mx-auto w-full flex flex-col gap-6">
          <!-- Title -->
          <div class="flex flex-col gap-1">
            <h1 class="font-headline text-2xl font-bold leading-tight text-on-surface">全平台视频下载VIDEO</h1>
            <p class="text-on-surface-variant text-sm">输入链接即刻解析高清数字资产</p>
          </div>
          
          <!-- URL Input -->
          <div class="flex flex-col gap-3">
            <div class="relative">
              <textarea 
                ref="urlInput"
                v-model="url"
                aria-label="Paste video URL here" 
                class="w-full h-24 bg-surface-container-highest rounded-md p-3 text-on-surface placeholder:text-outline-variant resize-none font-body text-sm border-2 border-transparent focus:border-primary focus:outline-none transition-all"
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
                  class="w-full px-4 py-2 text-left text-sm text-on-surface hover:bg-surface-container-highest transition-colors flex items-center gap-2"
                  @click="handleContextMenuAction('cut')"
                >
                  <MaterialIcon name="content_cut" :size="16" />
                  <span>剪切</span>
                </button>
                <button 
                  class="w-full px-4 py-2 text-left text-sm text-on-surface hover:bg-surface-container-highest transition-colors flex items-center gap-2"
                  @click="handleContextMenuAction('copy')"
                >
                  <MaterialIcon name="content_copy" :size="16" />
                  <span>复制</span>
                </button>
                <button 
                  class="w-full px-4 py-2 text-left text-sm text-on-surface hover:bg-surface-container-highest transition-colors flex items-center gap-2"
                  @click="handleContextMenuAction('paste')"
                >
                  <MaterialIcon name="content_paste" :size="16" />
                  <span>粘贴</span>
                </button>
                <div class="h-px bg-outline-variant/20 my-1"></div>
                <button 
                  class="w-full px-4 py-2 text-left text-sm text-on-surface hover:bg-surface-container-highest transition-colors flex items-center gap-2"
                  @click="handleContextMenuAction('delete')"
                >
                  <MaterialIcon name="delete" :size="16" />
                  <span>删除</span>
                </button>
                <button 
                  class="w-full px-4 py-2 text-left text-sm text-on-surface hover:bg-surface-container-highest transition-colors flex items-center gap-2"
                  @click="handleContextMenuAction('selectAll')"
                >
                  <MaterialIcon name="select_all" :size="16" />
                  <span>全选</span>
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
                :disabled="isParsing"
                @click="parseVideo"
              >
                <MaterialIcon v-if="isParsing" name="sync" :size="18" class="animate-spin" />
                <MaterialIcon v-else name="bolt" :size="18" />
                <span>{{ isParsing ? '解析中...' : '解析视频信息' }}</span>
              </button>
            </div>
          </div>
          
          <!-- YouTube Cookie Hint -->
          <div v-if="isYouTubeUrl && !hasParsed" class="flex flex-col gap-2 p-4 bg-tertiary-container/30 rounded-lg border border-tertiary/20">
            <div class="flex items-start gap-3">
              <MaterialIcon name="info" :size="20" class="text-tertiary flex-shrink-0 mt-0.5" />
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
          <div v-if="showBilibiliCookieHint && !hasParsed" class="flex flex-col gap-2 p-4 bg-tertiary-container/30 rounded-lg border border-tertiary/20">
            <div class="flex items-start gap-3">
              <MaterialIcon name="info" :size="20" class="text-tertiary flex-shrink-0 mt-0.5" />
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
            <span class="text-[10px] font-bold text-outline uppercase tracking-[0.1em] ml-1">支持解析平台</span>
            <div class="flex items-center gap-4 px-4 py-2.5 bg-surface-container-low rounded-lg border border-outline-variant/10">
              <div v-for="platform in platforms" :key="platform.name" class="flex items-center gap-2 transition-all cursor-default">
                <MaterialIcon :name="platform.icon" :size="18" class="text-primary" :weight="200"/>
                <span class="text-[11px] font-medium text-on-surface-variant">{{ platform.name }}</span>
              </div>
            </div>
          </div>
          
          <!-- Preview Section -->
          <div v-if="videoInfo" class="mt-2 flex flex-col gap-4">
            <h3 class="font-headline text-sm font-bold text-on-surface border-b border-outline-variant/20 pb-2">解析结果预览</h3>
            
            <!-- Video Info Card -->
            <div class="flex gap-4 p-3 bg-surface-container-low rounded-md border border-outline-variant/10">
              <div 
                class="w-40 h-24 rounded-sm bg-surface-variant bg-cover bg-center flex-shrink-0 relative overflow-hidden shadow-sm"
                :style="{ backgroundImage: `url(${videoInfo.thumbnail})` }"
              >
                <div v-if="videoInfo.duration" class="absolute bottom-1 right-1 bg-inverse-surface/80 backdrop-blur-sm text-inverse-on-surface text-[10px] font-mono px-1 rounded-sm">
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
            
            <!-- Format Selection - Two Column Layout -->
            <div class="flex flex-col gap-2">
              <span class="text-[11px] font-bold text-outline uppercase tracking-wider">视频格式 (MP4) - 共 {{ videoInfo.formats?.length || 0 }} 个</span>
              <div class="grid grid-cols-2 gap-2">
                <label 
                  v-for="format in videoInfo.formats" 
                  :key="format.formatId"
                  class="flex items-center justify-between p-2.5 rounded-md cursor-pointer transition-colors"
                  :class="selectedFormat?.formatId === format.formatId ? 'bg-surface-container-highest/50 border border-primary/30 hover:bg-primary-container/20' : 'bg-surface-container-lowest border border-outline-variant/20 hover:border-primary/40'"
                  @click="selectVideoFormat(format)"
                >
                  <div class="flex items-center gap-2">
                    <div 
                      class="size-4 rounded-full border-4 flex-shrink-0"
                      :class="selectedFormat?.formatId === format.formatId ? 'border-primary bg-surface' : 'border-outline-variant bg-surface'"
                    />
                    <span class="text-xs font-semibold" :class="selectedFormat?.formatId === format.formatId ? 'text-on-surface' : 'text-on-surface font-medium'">{{ format.quality }}</span>
                  </div>
                  <span class="text-[10px] font-mono text-on-surface-variant">{{ format.filesize ? formatFileSize(format.filesize) : '未知大小' }}</span>
                </label>
              </div>
            </div>
            
            <!-- YouTube Audio Formats -->
            <div v-if="videoInfo.isYoutube === true && videoInfo.audioFormats?.length" class="flex flex-col gap-2">
              <span class="text-[11px] font-bold text-outline uppercase tracking-wider">纯音频格式 - 共 {{ videoInfo.audioFormats.length }} 个</span>
              <div class="grid grid-cols-2 gap-2">
                <label 
                  v-for="format in videoInfo.audioFormats" 
                  :key="format.formatId"
                  class="flex items-center justify-between p-2.5 rounded-md cursor-pointer transition-colors"
                  :class="selectedAudioFormat?.formatId === format.formatId ? 'bg-surface-container-highest/50 border border-primary/30 hover:bg-primary-container/20' : 'bg-surface-container-lowest border border-outline-variant/20 hover:border-primary/40'"
                  @click="selectAudioFormat(format)"
                >
                  <div class="flex items-center gap-2">
                    <div 
                      class="size-4 rounded-full border-4 flex-shrink-0"
                      :class="selectedAudioFormat?.formatId === format.formatId ? 'border-primary bg-surface' : 'border-outline-variant bg-surface'"
                    />
                    <span class="text-xs font-semibold" :class="selectedAudioFormat?.formatId === format.formatId ? 'text-on-surface' : 'text-on-surface font-medium'">{{ format.quality }}</span>
                  </div>
                  <span class="text-[10px] font-mono text-on-surface-variant">{{ format.filesize ? formatFileSize(format.filesize) : '未知大小' }}</span>
                </label>
              </div>
            </div>
            
            <!-- YouTube Audio Tracks -->
            <div v-if="videoInfo.isYoutube === true && videoInfo.audioTracks?.length" class="flex flex-col gap-2">
              <span class="text-[11px] font-bold text-outline uppercase tracking-wider">音频轨道 - 共 {{ videoInfo.audioTracks.length }} 个</span>
              <div class="grid grid-cols-2 gap-2">
                <label 
                  v-for="track in videoInfo.audioTracks" 
                  :key="track.id"
                  class="flex items-center justify-between p-2.5 rounded-md cursor-pointer transition-colors"
                  :class="selectedAudioTrack?.id === track.id ? 'bg-surface-container-highest/50 border border-primary/30 hover:bg-primary-container/20' : 'bg-surface-container-lowest border border-outline-variant/20 hover:border-primary/40'"
                  @click="selectAudioTrack(track)"
                >
                  <div class="flex items-center gap-2">
                    <div 
                      class="size-4 rounded-full border-4 flex-shrink-0"
                      :class="selectedAudioTrack?.id === track.id ? 'border-primary bg-surface' : 'border-outline-variant bg-surface'"
                    />
                    <span class="text-xs font-semibold" :class="selectedAudioTrack?.id === track.id ? 'text-on-surface' : 'text-on-surface font-medium'">{{ track.name }}</span>
                  </div>
                  <span class="text-[10px] font-mono text-on-surface-variant">{{ track.language }}</span>
                </label>
              </div>
            </div>
            
            <!-- YouTube Subtitles -->
            <div v-if="videoInfo.isYoutube === true && videoInfo.subtitles?.length" class="flex flex-col gap-2">
              <span class="text-[11px] font-bold text-outline uppercase tracking-wider">字幕 - 共 {{ videoInfo.subtitles.length }} 个</span>
              <div class="flex flex-wrap gap-2">
                <label 
                  v-for="sub in videoInfo.subtitles" 
                  :key="sub.language"
                  class="flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors"
                  :class="selectedSubtitles.includes(sub.language) ? 'bg-surface-container-highest/50 border border-primary/30 hover:bg-primary-container/20' : 'bg-surface-container-lowest border border-outline-variant/20 hover:border-primary/40'"
                  @click="selectSubtitle(sub.language)"
                >
                  <div 
                    class="size-3 rounded-sm border-2 flex-shrink-0"
                    :class="selectedSubtitles.includes(sub.language) ? 'border-primary bg-primary' : 'border-outline-variant bg-surface'"
                  />
                  <span class="text-xs font-semibold" :class="selectedSubtitles.includes(sub.language) ? 'text-on-surface' : 'text-on-surface font-medium'">{{ sub.name }}</span>
                </label>
              </div>
            </div>
            
            <!-- Download Button -->
            <button 
              class="w-full flex items-center justify-center gap-2 rounded-xl h-12 font-headline font-bold text-base shadow-md hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 mt-4 text-on-primary-fixed gradient-btn-orange"
              :disabled="(!selectedFormat && !selectedAudioFormat && selectedSubtitles.length === 0) || isDownloading"
              @click="startDownload"
            >
              <MaterialIcon v-if="isDownloading" name="sync" :size="24" class="animate-spin" />
              <MaterialIcon v-else name="download" :size="24" />
              <span>{{ isDownloading ? '正在下载...' : (downloadMode === 'audio' ? '下载纯音频' : (downloadMode === 'subtitle' ? '下载字幕' : '立即下载所选资源')) }}</span>
            </button>
          </div>
        </div>
      </div>
      
      <!-- Progress Bar -->
      <div 
        v-if="isParsing"
        class="sticky bottom-0 left-0 w-full bg-surface-container-low/95 backdrop-blur-md border-t border-outline-variant/15 px-8 py-3.5 z-20 shadow-sticky-up"
      >
        <div class="max-w-xl mx-auto flex flex-col gap-2">
          <div class="flex justify-between items-center text-[12px] font-semibold">
            <div class="flex items-center gap-2 text-primary">
              <MaterialIcon name="sync" :size="16" class="animate-spin" />
              <span class="tracking-wide">正在提取视频元数据...</span>
            </div>
            <span class="font-mono text-primary font-bold">{{ parseProgress }}%</span>
          </div>
          <div class="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
            <div 
              class="h-full bg-[#FFB347] rounded-full transition-all duration-500 shadow-[0_0_8px_rgba(255,179,71,0.4)]"
              :style="{ width: parseProgress + '%' }"
            />
          </div>
        </div>
      </div>
    </section>
    
    <!-- Right Panel - Task Queue -->
    <section class="w-[45%] bg-surface-container-low flex flex-col pt-6 px-6 pb-6 shadow-ambient z-10 border-l border-outline-variant/10">
      <div class="flex items-center justify-between mb-4">
        <h2 class="font-headline text-base font-bold text-on-surface">任务队列</h2>
        <div class="flex items-center gap-2">
          <span class="text-[10px] font-mono font-bold text-on-secondary-container bg-secondary-container px-1.5 py-0.5 rounded-sm">
            {{ activeTaskCount }} 进行中
          </span>
          <button 
            class="p-1.5 text-on-surface-variant hover:text-on-surface rounded-sm hover:bg-surface-container-highest transition-colors"
            @click="clearCompletedTasks"
          >
            <MaterialIcon name="clear_all" :size="18" />
          </button>
        </div>
      </div>
      
      <!-- Task List -->
      <div class="flex flex-col gap-3 overflow-y-auto pr-1 pb-4">
        <div v-if="downloadTasks.length === 0" class="flex flex-col items-center justify-center py-12 text-on-surface-variant">
          <MaterialIcon name="download_for_offline" :size="48" class="mb-3 opacity-30" />
          <p class="text-sm">暂无下载任务</p>
          <p class="text-xs mt-1 opacity-70">解析视频后点击下载按钮添加任务</p>
        </div>
        
        <div 
          v-for="task in downloadTasks" 
          :key="task.id"
          class="flex flex-col p-3 rounded-md border transition-all"
          :class="{
            'bg-surface-container-lowest shadow-sm border-outline-variant/10': task.status === 'downloading' || task.status === 'merging',
            'bg-surface-container-lowest border-outline-variant/10 opacity-70': task.status === 'pending',
            'bg-surface-container-highest/60 border-outline-variant/5': task.status === 'completed',
            'bg-error-container/10 border-error/20': task.status === 'error',
            'bg-amber-container/20 border-amber/30': task.status === 'paused'
          }"
        >
          <div class="flex gap-3">
            <!-- Thumbnail -->
            <div 
              class="w-20 h-14 rounded-sm bg-surface-variant bg-cover bg-center flex-shrink-0 relative overflow-hidden"
              :style="{ backgroundImage: `url(${task.videoInfo.thumbnail})` }"
            >
              <div v-if="task.videoInfo.duration" class="absolute bottom-1 right-1 bg-inverse-surface/80 text-inverse-on-surface text-[8px] font-mono px-0.5 rounded-sm">
                {{ formatDuration(task.videoInfo.duration) }}
              </div>
              <div v-if="task.status === 'pending'" class="absolute inset-0 bg-surface/40 flex items-center justify-center backdrop-blur-[1px]">
                <MaterialIcon name="hourglass_empty" class="text-on-surface" :size="18" />
              </div>
            </div>
            
            <!-- Task Info -->
            <div class="flex flex-col flex-1 justify-between min-w-0 py-0.5">
              <div class="flex justify-between items-start gap-2">
                <h4 
                  class="font-headline text-xs font-bold truncate"
                  :class="task.status === 'pending' ? 'text-on-surface opacity-70' : 'text-on-surface'"
                >
                  {{ task.videoInfo.title }}
                </h4>
                <button 
                  class="text-on-surface-variant hover:text-error transition-colors flex-shrink-0"
                  @click="removeTask(task.id)"
                >
                  <MaterialIcon name="close" :size="14" />
                </button>
              </div>
              
              <!-- Downloading/Merging Status -->
              <template v-if="task.status === 'downloading' || task.status === 'merging'">
                <div class="flex items-center justify-between text-[10px] text-on-surface-variant font-mono">
                  <span>
                    <span v-if="task.status === 'merging'" class="text-primary">{{ task.statusMessage || '正在合并音视频...' }}</span>
                    <span v-else-if="task.speed">{{ task.speed }} - ETA {{ task.eta }}</span>
                    <span v-else>正在下载...</span>
                  </span>
                  <div class="flex items-center gap-2">
                    <button
                      class="text-on-surface-variant hover:text-amber transition-colors"
                      @click="pauseTask(task.id)"
                      title="暂停下载"
                    >
                      <MaterialIcon name="pause" :size="14" />
                    </button>
                    <span class="font-bold text-primary">{{ Math.round(task.progress || 0) }}%</span>
                  </div>
                </div>
                <div class="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden mt-1">
                  <div 
                    class="h-full bg-primary-fixed rounded-full transition-all duration-300"
                    :class="{ 'animate-pulse': task.status === 'merging' }"
                    :style="{ width: (task.progress || 0) + '%' }"
                  />
                </div>
              </template>
              
              <!-- Paused Status -->
              <template v-else-if="task.status === 'paused'">
                <div class="flex items-center justify-between text-[10px] text-on-surface-variant font-mono">
                  <span class="text-amber">已暂停</span>
                  <div class="flex items-center gap-2">
                    <button
                      class="text-on-surface-variant hover:text-primary transition-colors"
                      @click="resumeTask(task)"
                      title="继续下载"
                    >
                      <MaterialIcon name="play_arrow" :size="14" />
                    </button>
                    <span class="font-bold text-amber">{{ Math.round(task.progress || 0) }}%</span>
                  </div>
                </div>
                <div class="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden mt-1">
                  <div 
                    class="h-full bg-amber rounded-full transition-all duration-300"
                    :style="{ width: (task.progress || 0) + '%' }"
                  />
                </div>
              </template>
              
              <!-- Pending Status -->
              <div v-else-if="task.status === 'pending'" class="flex items-center gap-1.5 text-[10px] text-on-surface-variant mt-1.5">
                <MaterialIcon name="pending" :size="12" />
                <span>等待下载...</span>
              </div>
              
              <!-- Completed Status -->
              <div v-else-if="task.status === 'completed'" class="flex items-center justify-between mt-1">
                <span class="text-[10px] text-on-surface-variant font-mono">{{ task.selectedFormat.quality }}</span>
                <button 
                  class="p-1 text-on-surface-variant hover:text-primary transition-colors"
                  @click="openFileLocation(task)"
                >
                  <MaterialIcon name="folder_open" :size="16" />
                </button>
              </div>
              
              <!-- Error Status -->
              <div v-else-if="task.status === 'error'" class="flex items-center gap-1.5 text-[10px] text-error mt-1.5">
                <MaterialIcon name="error" :size="12" />
                <span class="truncate">{{ task.error || '下载失败' }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Storage Info -->
      <div class="mt-auto pt-4 border-t border-outline-variant/10 flex items-center justify-between text-[11px] text-on-surface-variant">
        <div class="flex items-center gap-2">
          <MaterialIcon name="storage" :size="14" />
          <span>存储空间: {{ storageInfo }}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="font-mono">{{ downloadDir }}</span>
          <button 
            class="p-1 hover:bg-surface-container-highest rounded transition-colors"
            @click="selectDownloadDir"
          >
            <MaterialIcon name="folder_open" :size="14" />
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import MaterialIcon from './icons/MaterialIcon.vue'
import type { VideoInfo, VideoFormat, DownloadTask, AudioFormat, AudioTrack } from '../types'

// URL Input
const url = ref('')

// 检测是否为 YouTube 链接
const hasParsed = ref(false)
const isYouTubeUrl = computed(() => {
  const urlStr = url.value.trim().toLowerCase()
  return urlStr.includes('youtube.com') || urlStr.includes('youtu.be')
})

// 检测是否为 B站 链接（用于显示 Cookie 提示）
const showBilibiliCookieHint = computed(() => {
  const urlStr = url.value.trim().toLowerCase()
  return urlStr.includes('bilibili.com') || urlStr.includes('b23.tv')
})

// 跳转到设置页
function goToSettings() {
  window.dispatchEvent(new CustomEvent('navigate-to-settings'))
}

// 打开 Cookie 帮助页面
function openCookieHelp() {
  window.electronAPI?.shell?.openExternal?.('https://github.com/cshuangyy/videdown/wiki/YouTube-Cookie-Setup')
}
const isParsing = ref(false)
const parseProgress = ref(0)
const videoInfo = ref<VideoInfo | null>(null)
const selectedFormat = ref<VideoFormat | null>(null)
const selectedAudioFormat = ref<AudioFormat | null>(null)
const selectedAudioTrack = ref<AudioTrack | null>(null)
const selectedSubtitles = ref<string[]>([])
const downloadMode = ref<'video' | 'audio' | 'subtitle'>('video')
const isDownloading = ref(false)
const urlInput = ref<HTMLTextAreaElement | null>(null)

// 选择视频格式（互斥：取消音频格式和字幕选择，保留音频轨道）
function selectVideoFormat(format: VideoFormat) {
  selectedFormat.value = format
  downloadMode.value = 'video'
  // 取消音频格式选择
  selectedAudioFormat.value = null
  // 取消字幕选择
  selectedSubtitles.value = []
}

// 选择音频格式（互斥：取消视频格式、音频轨道和字幕选择）
function selectAudioFormat(format: AudioFormat) {
  selectedAudioFormat.value = format
  downloadMode.value = 'audio'
  // 取消视频格式选择
  selectedFormat.value = null
  // 取消音频轨道
  selectedAudioTrack.value = null
  // 取消字幕选择
  selectedSubtitles.value = []
}

// 选择音频轨道（辅助选项，不取消视频格式，但取消纯音频和字幕）
function selectAudioTrack(track: AudioTrack) {
  selectedAudioTrack.value = track
  // 取消纯音频格式和字幕
  selectedAudioFormat.value = null
  selectedSubtitles.value = []
  // 如果没有选视频格式，自动选第一个
  if (!selectedFormat.value && videoInfo.value?.formats?.length) {
    selectedFormat.value = videoInfo.value.formats[0]
  }
  downloadMode.value = 'video'
}

// 选择字幕（互斥：取消视频和音频选择）
function selectSubtitle(language: string) {
  const index = selectedSubtitles.value.indexOf(language)
  if (index > -1) {
    selectedSubtitles.value.splice(index, 1)
  } else {
    selectedSubtitles.value = [language] // 只保留当前选中的字幕
  }
  // 取消视频和音频选择
  selectedFormat.value = null
  selectedAudioFormat.value = null
  selectedAudioTrack.value = null
  downloadMode.value = 'subtitle'
}

// Context Menu
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
  const selectedText = url.value.substring(start, end)

  switch (action) {
    case 'cut':
      if (selectedText) {
        await window.electronAPI?.clipboard?.writeText?.(selectedText)
        url.value = url.value.substring(0, start) + url.value.substring(end)
        input.setSelectionRange(start, start)
      }
      break
    case 'copy':
      if (selectedText) {
        await window.electronAPI?.clipboard?.writeText?.(selectedText)
      }
      break
    case 'paste':
      try {
        const text = await window.electronAPI?.clipboard?.readText?.()
        if (text) {
          url.value = url.value.substring(0, start) + text + url.value.substring(end)
          const newPos = start + text.length
          input.setSelectionRange(newPos, newPos)
        }
      } catch (e) {
        console.error('Failed to paste:', e)
      }
      break
    case 'delete':
      if (selectedText) {
        url.value = url.value.substring(0, start) + url.value.substring(end)
        input.setSelectionRange(start, start)
      }
      break
    case 'selectAll':
      input.select()
      break
  }
  hideContextMenu()
}

// Click outside to close context menu
onMounted(() => {
  document.addEventListener('click', hideContextMenu)
})

onUnmounted(() => {
  document.removeEventListener('click', hideContextMenu)
})

// Download Tasks
const downloadTasks = ref<DownloadTask[]>([])
const downloadDir = ref('')

// 清理非法文件名字符
function sanitizeFilename(filename: string): string {
  // 替换 Windows 和 Unix 中的非法字符
  return filename.replace(/[<>"/\\|?*]/g, '_').trim()
}

// Platforms
const platforms = [
  { name: '抖音', icon: 'music_note' },
  { name: '小红书', icon: 'menu_book' },
  { name: 'B站', icon: 'live_tv' },
  { name: 'YouTube', icon: 'smart_display' },
  { name: 'Instagram', icon: 'photo_camera' },
]

// Computed
const activeTaskCount = computed(() => {
  return downloadTasks.value.filter(t => t.status === 'downloading' || t.status === 'pending' || t.status === 'merging' || t.status === 'paused').length
})

const storageInfo = computed(() => {
  return '可用'
})

// Methods
function formatDuration(seconds?: number): string {
  if (!seconds) return ''
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return '未知'
  if (bytes === 0) return '大小未知'
  const mb = bytes / 1024 / 1024
  if (mb < 1024) {
    return `${mb.toFixed(1)} MB`
  }
  return `${(mb / 1024).toFixed(2)} GB`
}

async function pasteUrl() {
  try {
    const text = await window.electronAPI.clipboard.readText()
    url.value = text
  } catch (e) {
    console.error('Failed to read clipboard:', e)
  }
}

// 从分享文本中提取有效链接
function extractUrl(text: string): string {
  // 移除乱码字符（锟斤拷等）
  const cleanText = text.replace(/锟斤拷|锟|斤|拷/g, '').trim()
  
  // 抖音链接匹配
  const douyinMatch = cleanText.match(/https:\/\/v\.douyin\.com\/[a-zA-Z0-9_\-]+/i)
  if (douyinMatch) return douyinMatch[0]
  
  // 小红书链接匹配
  const xiaohongshuMatch = cleanText.match(/https:\/\/www\.xiaohongshu\.com\/discovery\/item\/[a-zA-Z0-9]+[^\s`]*/i)
  if (xiaohongshuMatch) return xiaohongshuMatch[0]
  
  // B站链接匹配
  const bilibiliMatch = cleanText.match(/https:\/\/www\.bilibili\.com\/video\/[a-zA-Z0-9]+[^\s`]*/i)
  if (bilibiliMatch) return bilibiliMatch[0]
  
  // B站短链接
  const b23Match = cleanText.match(/https:\/\/b23\.tv\/[a-zA-Z0-9]+/i)
  if (b23Match) return b23Match[0]
  
  // YouTube链接匹配
  const youtubeMatch = cleanText.match(/https:\/\/(www\.)?(youtube\.com\/watch\?v=[a-zA-Z0-9_-]+|youtu\.be\/[a-zA-Z0-9_-]+)/i)
  if (youtubeMatch) return 'https://' + (youtubeMatch[1] || '') + youtubeMatch[2]
  
  // Instagram链接匹配
  const instagramMatch = cleanText.match(/https:\/\/(www\.)?instagram\.com\/[^\s]+/i)
  if (instagramMatch) return instagramMatch[0]
  
  // 如果没有匹配到特定平台，尝试提取任何URL
  const generalMatch = cleanText.match(/https?:\/\/[^\s\u4e00-\u9fa5]+/i)
  if (generalMatch) return generalMatch[0]
  
  return cleanText
}

async function parseVideo() {
  if (!url.value || isParsing.value) return
  
  // 标记已点击解析按钮，隐藏 YouTube 提示
  hasParsed.value = true
  
  // 提取有效链接
  const extractedUrl = extractUrl(url.value)
  if (extractedUrl !== url.value) {
    url.value = extractedUrl
  }
  
  isParsing.value = true
  parseProgress.value = 0
  videoInfo.value = null
  selectedFormat.value = null
  
  // Simulate progress
  const progressInterval = setInterval(() => {
    if (parseProgress.value < 90) {
      parseProgress.value += Math.random() * 15
    }
  }, 200)
  
  try {
    // 获取 cookies 文件路径
    const settings = JSON.parse(localStorage.getItem('settings') || '{}')
    const cookiesFile = settings.cookiesFile || ''
    
    const info = await window.electronAPI.ytdlp.parse(url.value, cookiesFile)
    videoInfo.value = info
    
    // B站预览图需要特殊处理（添加referer）
    if (isBilibiliUrl(url.value) && info.thumbnail) {
      fetchBilibiliThumbnail(info.thumbnail)
    }
    
    // Auto select best quality
    if (info.formats && info.formats.length > 0) {
      selectedFormat.value = info.formats[0]
      downloadMode.value = 'video'
    } else if (info.audioFormats && info.audioFormats.length > 0) {
      // 如果没有视频格式但有音频格式，自动选择音频模式
      selectedAudioFormat.value = info.audioFormats[0]
      downloadMode.value = 'audio'
    }
    
    // Auto select original language audio track (default/first track)
    if (info.audioTracks && info.audioTracks.length > 0) {
      // 优先选择默认轨道或第一个轨道（通常是原语言）
      const defaultTrack = info.audioTracks.find((t: AudioTrack) => t.name?.toLowerCase().includes('default') || t.language === 'original')
      selectedAudioTrack.value = defaultTrack || info.audioTracks[0]
    } else {
      selectedAudioTrack.value = null
    }
    parseProgress.value = 100
  } catch (e: any) {
    let errorMsg = e.message || '未知错误'
    
    // 优化错误提示
    if (errorMsg.includes('not a valid URL') || errorMsg.includes('Unsupported URL') || errorMsg.includes('url')) {
      errorMsg = '请输入有效的链接'
    } else if (errorMsg.includes('not found') || errorMsg.includes('404')) {
      errorMsg = '视频不存在或已被删除'
    } else if (errorMsg.includes('private') || errorMsg.includes('登录')) {
      errorMsg = '该视频需要登录才能访问'
    } else if (errorMsg.includes('network') || errorMsg.includes('timeout')) {
      errorMsg = '网络连接超时，请检查网络后重试'
    } else if (errorMsg.includes('ffmpeg') || errorMsg.includes('FFmpeg')) {
      errorMsg = 'FFmpeg 未找到，请确保 ffmpeg.exe 存在于程序目录'
    } else if (errorMsg.toLowerCase().includes('yt-dlp') && (errorMsg.includes('not found') || errorMsg.includes('未找到') || errorMsg.includes('cannot find') || errorMsg.includes('enoent'))) {
      errorMsg = 'yt-dlp 未找到，请确保 yt-dlp.exe 存在于程序目录'
    } else if (!errorMsg || errorMsg === '解析失败') {
      errorMsg = '无法解析该链接，请检查链接是否正确或尝试其他视频'
    }
    
    alert('解析失败：' + errorMsg)
  } finally {
    clearInterval(progressInterval)
    isParsing.value = false
  }
}

// 检查是否是B站链接
function isBilibiliUrl(url: string): boolean {
  return url.includes('bilibili.com') || url.includes('b23.tv')
}

// 获取B站预览图（需要referer）
async function fetchBilibiliThumbnail(thumbnailUrl: string) {
  try {
    const base64Image = await window.electronAPI.app.fetchImage(thumbnailUrl, 'https://www.bilibili.com/')
    if (base64Image && videoInfo.value) {
      videoInfo.value.thumbnail = base64Image
    }
  } catch (e) {
    console.error('Failed to fetch bilibili thumbnail:', e)
  }
}

async function startDownload() {
  if (!videoInfo.value || isDownloading.value) return
  if (downloadMode.value === 'video' && !selectedFormat.value) return
  if (downloadMode.value === 'audio' && !selectedAudioFormat.value) return
  if (downloadMode.value === 'subtitle' && selectedSubtitles.value.length === 0) return
  
  isDownloading.value = true
  
  const taskId = Date.now().toString()
  
  // 字幕下载模式
  if (downloadMode.value === 'subtitle') {
    const task: DownloadTask = {
      id: taskId,
      url: url.value,
      videoInfo: videoInfo.value,
      selectedFormat: {
        formatId: 'subtitle',
        quality: '字幕',
        ext: 'srt',
        filesize: 0
      },
      outputDir: downloadDir.value,
      status: 'pending',
      progress: 0,
      createdAt: new Date().toISOString(),
    }
    
    // 存储额外的下载选项
    ;(task as any).downloadMode = 'subtitle'
    ;(task as any).selectedSubtitles = [...selectedSubtitles.value]
    
    downloadTasks.value.unshift(task)
    
    // Start download
    processDownload(task)
    
    isDownloading.value = false
    return
  }
  
  const task: DownloadTask = {
    id: taskId,
    url: url.value,
    videoInfo: videoInfo.value,
    selectedFormat: downloadMode.value === 'audio' && selectedAudioFormat.value
      ? { ...selectedAudioFormat.value, quality: selectedAudioFormat.value.quality, ext: selectedAudioFormat.value.ext }
      : selectedFormat.value!,
    outputDir: downloadDir.value,
    status: 'pending',
    progress: 0,
    createdAt: new Date().toISOString(),
  }
  
  // 存储额外的下载选项
  ;(task as any).downloadMode = downloadMode.value
  ;(task as any).selectedAudioTrack = selectedAudioTrack.value ? { ...selectedAudioTrack.value } : null
  ;(task as any).selectedSubtitles = []
  
  downloadTasks.value.unshift(task)
  
  // Start download
  processDownload(task)
  
  isDownloading.value = false
}

// 存储每个任务的进度监听器清理函数
const taskProgressCleanups = new Map<string, () => void>()

async function processDownload(task: DownloadTask) {
  // 找到任务在数组中的索引，确保响应式更新
  const taskIndex = downloadTasks.value.findIndex(t => t.id === task.id)
  if (taskIndex === -1) return
  
  // 如果任务已经在下载中，不要重复启动
  if (downloadTasks.value[taskIndex].status === 'downloading' || downloadTasks.value[taskIndex].status === 'merging') {
    return
  }
  
  // 更新状态为下载中
  downloadTasks.value[taskIndex].status = 'downloading'
  
  // 如果已经有监听器，先清理
  if (taskProgressCleanups.has(task.id)) {
    taskProgressCleanups.get(task.id)!()
    taskProgressCleanups.delete(task.id)
  }
  
  // 每个任务有自己的进度监听器
  const cleanup = window.electronAPI.onDownloadProgress((data: any) => {
    if (data.taskId === task.id) {
      // 如果任务已暂停，忽略进度更新（除了完成状态）
      if (pausedTasks.has(task.id) && data.status !== 'completed') {
        return
      }
      
      // 通过索引更新，确保响应式
      const idx = downloadTasks.value.findIndex(t => t.id === task.id)
      if (idx !== -1) {
        if (data.status === 'merging') {
          downloadTasks.value[idx].status = 'merging'
          downloadTasks.value[idx].statusMessage = data.message || '正在合并音视频...'
          downloadTasks.value[idx].progress = 99
        } else if (data.status === 'completed') {
          downloadTasks.value[idx].status = 'completed'
          downloadTasks.value[idx].progress = 100
          pausedTasks.delete(task.id)
        } else {
          downloadTasks.value[idx].progress = data.percent || 0
          downloadTasks.value[idx].totalSize = data.totalSize
          downloadTasks.value[idx].speed = data.speed
          downloadTasks.value[idx].eta = data.eta
        }
      }
    }
  })
  
  // 存储清理函数
  taskProgressCleanups.set(task.id, cleanup)
  
  try {
    // 检查是否有直接下载链接（抖音/快手等通过 Puppeteer 解析的平台）
    const directUrl = task.selectedFormat.url
    const isDouyin = task.url.includes('douyin.com') || task.url.includes('v.douyin.com')
    const isKuaishou = task.url.includes('kuaishou.com') || task.url.includes('v.kuaishou.com')
    const useDirectDownload = isDouyin || isKuaishou
    
    // 获取 cookies 文件路径和文件名模板
    const settings = JSON.parse(localStorage.getItem('settings') || '{}')
    const cookiesFile = settings.cookiesFile || ''
    const filenameTemplate = settings.filenameTemplate || '%(title)s'

    const downloadOptions: any = {
      url: task.url,
      formatId: task.selectedFormat.formatId,
      outputDir: task.outputDir,
      taskId: task.id,
      directUrl: useDirectDownload && directUrl ? directUrl : undefined,
      filename: useDirectDownload && directUrl ? `${sanitizeFilename(task.videoInfo.title).slice(0, 50)}_${task.selectedFormat.quality}.mp4` : undefined,
      cookiesFile: cookiesFile,
      filenameTemplate: filenameTemplate,
    }
    
    // 添加 YouTube 特有选项
    if ((task as any).downloadMode === 'audio') {
      downloadOptions.downloadMode = 'audio'
    }
    if ((task as any).downloadMode === 'subtitle') {
      downloadOptions.downloadMode = 'subtitle'
    }
    if ((task as any).selectedAudioTrack) {
      downloadOptions.audioTrack = { ...(task as any).selectedAudioTrack }
    }
    if ((task as any).selectedSubtitles?.length > 0) {
      downloadOptions.subtitles = (task as any).selectedSubtitles
    }
    
    const result = await window.electronAPI.ytdlp.download(downloadOptions)

    // 更新任务状态到数组（确保响应式）
    const finalIdx = downloadTasks.value.findIndex(t => t.id === task.id)
    if (finalIdx !== -1) {
      downloadTasks.value[finalIdx].status = 'completed'
      downloadTasks.value[finalIdx].filePath = (result as any).filePath
      downloadTasks.value[finalIdx].progress = 100
    }

    // Add to history
    await window.electronAPI.history.add({
      title: task.videoInfo.title,
      thumbnail: task.videoInfo.thumbnail,
      url: task.url,
      filePath: (result as any).filePath,
      format: task.selectedFormat.ext,
      quality: task.selectedFormat.quality,
    })
  } catch (e: any) {
    // 优化错误提示
    let errorMsg = e.message || '下载失败'
    
    if (errorMsg.includes('disk') || errorMsg.includes('space')) {
      errorMsg = '磁盘空间不足，请清理磁盘后重试'
    } else if (errorMsg.includes('permission') || errorMsg.includes('access')) {
      errorMsg = '没有写入权限，请更换下载目录或以管理员身份运行'
    } else if (errorMsg.includes('network') || errorMsg.includes('timeout') || errorMsg.includes('ECONNRESET')) {
      errorMsg = '网络连接中断，请检查网络后重试'
    } else if (errorMsg.includes('ffmpeg') || errorMsg.includes('FFmpeg')) {
      errorMsg = 'FFmpeg 合并失败，请确保 ffmpeg.exe 存在于程序目录'
    } else if (errorMsg.includes('cancel') || errorMsg.includes('abort')) {
      errorMsg = '下载已取消'
    }
    
    // 更新错误状态到数组（确保响应式）
    const errorIdx = downloadTasks.value.findIndex(t => t.id === task.id)
    if (errorIdx !== -1) {
      downloadTasks.value[errorIdx].status = 'error'
      downloadTasks.value[errorIdx].error = errorMsg
    }
  } finally {
    // 清理监听器
    if (taskProgressCleanups.has(task.id)) {
      taskProgressCleanups.get(task.id)!()
      taskProgressCleanups.delete(task.id)
    }
  }
}

// 存储每个任务的暂停状态
const pausedTasks = new Set<string>()

function pauseTask(taskId: string) {
  const taskIndex = downloadTasks.value.findIndex(t => t.id === taskId)
  if (taskIndex !== -1) {
    downloadTasks.value[taskIndex].status = 'paused'
    downloadTasks.value[taskIndex].speed = undefined
    downloadTasks.value[taskIndex].eta = undefined
    pausedTasks.add(taskId)
    // 通知主进程暂停下载
    window.electronAPI?.ytdlp?.pauseDownload?.(taskId)
  }
}

function resumeTask(task: DownloadTask) {
  const taskIndex = downloadTasks.value.findIndex(t => t.id === task.id)
  if (taskIndex !== -1) {
    downloadTasks.value[taskIndex].status = 'downloading'
    // 从暂停集合中移除
    pausedTasks.delete(task.id)
    // 重新启动下载
    processDownload(downloadTasks.value[taskIndex])
  }
}

function removeTask(taskId: string) {
  downloadTasks.value = downloadTasks.value.filter(t => t.id !== taskId)
}

function clearCompletedTasks() {
  downloadTasks.value = downloadTasks.value.filter(t => t.status !== 'completed')
}

async function openFileLocation(task: DownloadTask) {
  if (task.filePath) {
    await window.electronAPI.shell.openPath(task.filePath)
  }
}

async function selectDownloadDir() {
  const dir = await window.electronAPI.dialog.selectFolder()
  if (dir) {
    downloadDir.value = dir
    // 同步保存到 settings
    const savedSettings = localStorage.getItem('settings')
    const settings = savedSettings ? JSON.parse(savedSettings) : {}
    settings.downloadDir = dir
    localStorage.setItem('settings', JSON.stringify(settings))
  }
}

// 加载下载目录
async function loadDownloadDir() {
  const savedSettings = localStorage.getItem('settings')
  if (savedSettings) {
    const settings = JSON.parse(savedSettings)
    if (settings.downloadDir) {
      downloadDir.value = settings.downloadDir
    } else {
      downloadDir.value = await window.electronAPI.app.getDefaultDownloadDir()
    }
  } else {
    downloadDir.value = await window.electronAPI.app.getDefaultDownloadDir()
  }
}

// Initialize
onMounted(async () => {
  await loadDownloadDir()
  
  // 监听标签切换事件，切换回下载页时重新加载设置
  window.addEventListener('tab-changed', async (e: any) => {
    if (e.detail === 'download') {
      await loadDownloadDir()
    }
  })
})
</script>
