<template>
  <div class="flex-1 flex overflow-hidden">
    <!-- Left Panel -->
    <section class="w-[65%] flex flex-col bg-surface relative">
      <div class="flex-1 overflow-y-auto px-8 py-6">
        <div class="max-w-xl mx-auto w-full flex flex-col gap-6">
          <div class="flex flex-col gap-1">
            <h1 class="font-headline text-2xl font-bold leading-tight text-on-surface">全平台视频下载</h1>
            <p class="text-on-surface-variant text-sm">输入链接即刻解析高清数字资产</p>
          </div>

          <UrlInput @parse="parseVideo" />
          <p v-if="store.videoInfo?.parseNotice" role="status" class="text-sm text-on-surface-variant">{{ store.videoInfo.parseNotice }}</p>

          <FormatSelector
            v-if="store.videoInfo"
            :video-info="store.videoInfo"
            :selected-format="store.selectedFormat"
            :selected-audio-format="store.selectedAudioFormat"
            :selected-audio-track="store.selectedAudioTrack"
            :selected-subtitles="store.selectedSubtitles"
            :download-mode="store.downloadMode"
            :is-downloading="store.isDownloading"
            @select-video="store.selectVideoFormat"
            @select-audio="store.selectAudioFormat"
            @select-track="store.selectAudioTrack"
            @select-subtitle="store.selectSubtitle"
            @download="store.startDownload"
          />
        </div>
      </div>

      <!-- Progress Bar -->
      <div
        v-if="store.isParsing"
        class="sticky bottom-0 left-0 w-full bg-surface-container-low/95 backdrop-blur-md border-t border-outline-variant/15 px-8 py-3.5 z-20 shadow-sticky-up"
      >
        <div class="max-w-xl mx-auto flex flex-col gap-2">
          <div class="flex justify-between items-center text-[12px] font-semibold">
            <div class="flex items-center gap-2 text-primary">
              <MaterialIcon name="sync" :size="16" class="animate-spin" />
              <span class="tracking-wide">正在提取视频元数据...</span>
            </div>
            <!-- 解析没有可用的进度来源，因此不显示百分比，避免给出不真实的数字 -->
            <span class="text-on-surface-variant font-normal">{{ parseElapsedText }}</span>
          </div>
          <!-- 不确定进度条：只表示"正在进行"，不假装知道进度 -->
          <div class="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
            <div class="h-full w-1/3 bg-[#FFB347] rounded-full animate-parse-bar shadow-[0_0_8px_rgba(255,179,71,0.4)]" />
          </div>
        </div>
      </div>
    </section>

    <!-- Right Panel -->
    <DownloadQueue />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import MaterialIcon from './icons/MaterialIcon.vue'
import UrlInput from './UrlInput.vue'
import FormatSelector from './FormatSelector.vue'
import DownloadQueue from './DownloadQueue.vue'
import { useDownloadStore } from '../stores/download'
import { useDepsStore, readMissingKinds, stripDepMarkers } from '../stores/deps'
import { useErrorModal } from '../composables/useErrorModal'
import { classifyParseError, parseDiagnostic, PARSE_MESSAGES } from '../../shared/parse-error'

const store = useDownloadStore()
const { showError } = useErrorModal()

// 解析阶段拿不到真实进度（yt-dlp 只在下载阶段输出进度行），
// 因此不显示百分比，改为不确定进度条 + 已用时间。
const parseElapsed = ref(0)
const parseElapsedText = computed(() =>
  parseElapsed.value > 0 ? `已用 ${parseElapsed.value} 秒` : '通常需要几秒',
)

function extractUrl(text: string): string {
  const cleanText = text.replace(/锟斤拷|锟|斤|拷/g, '').trim()
  const patterns = [
    /https:\/\/v\.douyin\.com\/[a-zA-Z0-9_\-]+/i,
    /https:\/\/www\.xiaohongshu\.com\/discovery\/item\/[a-zA-Z0-9]+[^\s`]*/i,
    /https:\/\/www\.bilibili\.com\/video\/[a-zA-Z0-9]+[^\s`]*/i,
    /https:\/\/b23\.tv\/[a-zA-Z0-9]+/i,
    /https:\/\/(www\.)?(youtube\.com\/watch\?v=[a-zA-Z0-9_-]+|youtu\.be\/[a-zA-Z0-9_-]+)/i,
    /https:\/\/(www\.)?instagram\.com\/[^\s]+/i,
    /https?:\/\/[^\s\u4e00-\u9fa5]+/i,
  ]
  for (const p of patterns) {
    const match = cleanText.match(p)
    if (match) {
      if (p.source.includes('youtube') && match[1]) return 'https://' + match[1] + match[2]
      return match[0]
    }
  }
  return cleanText
}

function isBilibiliUrl(url: string): boolean {
  return url.includes('bilibili.com') || url.includes('b23.tv')
}

async function fetchBilibiliThumbnail(thumbnailUrl: string) {
  try {
    const base64Image = await window.electronAPI.app.fetchImage(thumbnailUrl, 'https://www.bilibili.com/')
    if (base64Image && store.videoInfo) {
      store.videoInfo.thumbnail = base64Image
    }
  } catch {}
}

async function parseVideo() {
  if (!store.url || store.isParsing) return

  store.hasParsed = true
  const extractedUrl = extractUrl(store.url)
  if (extractedUrl !== store.url) store.url = extractedUrl

  // 预校验 URL 格式
  try {
    const parsed = new URL(store.url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      showError('请输入有效的链接', `不支持的协议: ${parsed.protocol}`)
      return
    }
  } catch {
    showError('请输入有效的链接', `无法解析的 URL: ${store.url}`)
    return
  }

  store.isParsing = true
  store.parseProgress = 0
  parseElapsed.value = 0
  store.videoInfo = null
  store.selectedFormat = null

  const settings = JSON.parse(localStorage.getItem('settings') || '{}')
  const cookieMode = settings.cookieMode || 'auto'
  const cookiesFile = cookieMode === 'manual' ? (settings.cookiesFile || '') : ''
  const proxy = settings.proxy || ''

  // 解析阶段无法获知真实进度（yt-dlp 只在下载阶段输出进度行），
  // 因此这里只做两件事：显示一个不确定进度条 + 记录已用时间。
  const startedAt = Date.now()
  const elapsedTimer = setInterval(() => {
    parseElapsed.value = Math.round((Date.now() - startedAt) / 1000)
  }, 1000)
  const clearElapsed = () => clearInterval(elapsedTimer)

  try {
    const info = await window.electronAPI.ytdlp.parse(store.url, cookiesFile, proxy)
    store.videoInfo = info

    if (isBilibiliUrl(store.url) && info.thumbnail) {
      fetchBilibiliThumbnail(info.thumbnail)
    }

    if (info.formats?.length) {
      store.selectedFormat = info.formats[0]
      store.downloadMode = 'video'
    } else if (info.audioFormats?.length) {
      store.selectedAudioFormat = info.audioFormats[0]
      store.downloadMode = 'audio'
    }

    if (info.audioTracks?.length) {
      const defaultTrack = info.audioTracks.find((t: any) => t.name?.toLowerCase().includes('default') || t.language === 'original')
      store.selectedAudioTrack = defaultTrack || info.audioTracks[0]
    } else {
      store.selectedAudioTrack = null
    }

    clearElapsed()
    store.parseProgress = 100
  } catch (e: any) {
    clearElapsed()
    // 主进程可能在错误后附带 Cookie 读取失败的解决建议，分类时只看错误本身
    const [rawError, hint = ''] = (e.message || '未知错误').split('\n\n提示：')
    // 缺少运行依赖时直接弹「一键下载」引导，比只弹错误框更有用
    if (rawError.includes('[deps-missing:') || /未找到可用的 (yt-dlp|ffmpeg|ffprobe)/.test(rawError)) {
      useDepsStore().promptForMissing(readMissingKinds(rawError))
      store.isParsing = false
      return
    }
    const sanitized = stripDepMarkers(rawError)
    showError('解析失败：' + PARSE_MESSAGES[classifyParseError(sanitized)], parseDiagnostic(sanitized), hint)
  } finally {
    store.isParsing = false
  }
}

async function loadDownloadDir() {
  const savedSettings = localStorage.getItem('settings')
  if (savedSettings) {
    const settings = JSON.parse(savedSettings)
    if (settings.downloadDir) {
      store.downloadDir = settings.downloadDir
      return
    }
  }
  store.downloadDir = await window.electronAPI.app.getDefaultDownloadDir()
}

onMounted(async () => {
  await loadDownloadDir()
  // 应用代理设置
  const settings = JSON.parse(localStorage.getItem('settings') || '{}')
  if (settings.proxy) {
    window.electronAPI.app.setProxy(settings.proxy)
  }
  window.addEventListener('tab-changed', async (e: any) => {
    if (e.detail === 'download') await loadDownloadDir()
  })
})
</script>
