<script lang="ts">
  /**
   * 解析结果选择器：视频格式 / YouTube 音频 / 音轨 / 字幕 + 下载按钮。
   *
   * 迁移自 `src/components/FormatSelector.vue`（132 行，上游成分 44.3%）。
   *
   * ## 迁移要点（不能机械翻译的地方）
   *
   * 1. **emit → 回调 prop**：Vue 用 `defineEmits` + `$emit`，Svelte 5 传回调 prop。
   *    这不是「换个写法」——回调 prop 让调用方在类型层面必须提供，漏传会编译报错，
   *    而 Vue 的 emit 漏监听只是静默无响应。
   * 2. **`:class` 三元 → `class:` 指令**：Svelte 的 class 指令在条件变化时只增删
   *    那一个类，不会重写整个 class 属性（性能与 transition 都更稳）。
   * 3. **`v-for`+`:key` → `{#each ... (key)}`**：key 必须给，否则列表重排时
   *    选中态会跟着错位（这个组件有大量「选中哪个」的状态）。
   */
  import MaterialIcon from './MaterialIcon.svelte'
  import VideoInfoCard from './VideoInfoCard.svelte'
  import { t, getLocale } from '../i18n/index.svelte'
  import { formatFileSize } from './format-helpers'
  import type { VideoInfo, VideoFormat, AudioFormat, AudioTrack } from '../types'

  interface Props {
    videoInfo: VideoInfo
    selectedFormat: VideoFormat | null
    selectedAudioFormat: AudioFormat | null
    selectedAudioTrack: AudioTrack | null
    selectedSubtitles: string[]
    downloadMode: 'video' | 'audio' | 'subtitle'
    isDownloading: boolean

    onselectVideo: (format: VideoFormat) => void
    onselectAudio: (format: AudioFormat) => void
    onselectTrack: (track: AudioTrack) => void
    onselectSubtitle: (language: string) => void
    ondownload: () => void
  }

  let {
    videoInfo,
    selectedFormat,
    selectedAudioFormat,
    selectedAudioTrack,
    selectedSubtitles,
    downloadMode,
    isDownloading,
    onselectVideo,
    onselectAudio,
    onselectTrack,
    onselectSubtitle,
    ondownload,
  }: Props = $props()

  // 下载按钮的可用性与文案都由这三项决定
  const canDownload = $derived(
    (selectedFormat !== null || selectedAudioFormat !== null || selectedSubtitles.length > 0) &&
      !isDownloading,
  )

  const downloadLabel = $derived(
    isDownloading
      ? t('download.downloading')
      : downloadMode === 'audio'
        ? t('download.downloadAudio')
        : downloadMode === 'subtitle'
          ? t('download.downloadSubtitle')
          : t('download.startDownload'),
  )
</script>

<div class="flex flex-col gap-4">
  <h3 class="font-headline text-sm font-bold text-on-surface border-b border-outline-variant/20 pb-2">
    {t('formats.title')}
  </h3>

  <VideoInfoCard {videoInfo} {selectedFormat} />

  <!-- 视频格式 -->
  <div class="flex flex-col gap-2">
    <span class="text-[11px] font-bold text-outline uppercase tracking-wider">
      {t('formats.videoHeader', { count: videoInfo.formats?.length || 0 })}
    </span>
    <div class="grid grid-cols-2 gap-2">
      {#each videoInfo.formats as format (format.formatId)}
        <label
          class="flex items-center justify-between p-2.5 rounded-md cursor-pointer transition-colors bg-surface-container-lowest border border-outline-variant/20 hover:border-primary/40"
          class:bg-surface-container-highest={selectedFormat?.formatId === format.formatId}
          class:border-primary={selectedFormat?.formatId === format.formatId}
          class:hover:bg-primary-container={selectedFormat?.formatId === format.formatId}
        >
          <div class="flex items-center gap-2">
            <div
              class="size-4 rounded-full border-4 shrink-0 bg-surface"
              class:border-primary={selectedFormat?.formatId === format.formatId}
              class:border-outline-variant={selectedFormat?.formatId !== format.formatId}
            ></div>
            <span class="text-xs font-semibold">{format.quality}</span>
          </div>
          <span class="text-[10px] font-mono text-on-surface-variant">
            {format.filesize ? formatFileSize(format.filesize, getLocale()) : t('formats.unknownSize')}
          </span>
          <!-- 用 label + 隐藏 input 而不是 button：与旧版一致（键盘可达、
               屏幕阅读器能读出「单选」）。点 label 触发，不用额外处理 click。 -->
          <input
            type="radio"
            class="sr-only"
            name="video-format"
            checked={selectedFormat?.formatId === format.formatId}
            onchange={() => onselectVideo(format)}
          />
        </label>
      {/each}
    </div>
  </div>

  <!-- YouTube 音频格式 -->
  {#if videoInfo.isYoutube && videoInfo.audioFormats?.length}
    <div class="flex flex-col gap-2">
      <span class="text-[11px] font-bold text-outline uppercase tracking-wider">
        {t('formats.audioHeader', { count: videoInfo.audioFormats.length })}
      </span>
      <div class="grid grid-cols-2 gap-2">
        {#each videoInfo.audioFormats as format (format.formatId)}
          <label
            class="flex items-center justify-between p-2.5 rounded-md cursor-pointer transition-colors bg-surface-container-lowest border border-outline-variant/20 hover:border-primary/40"
            class:bg-surface-container-highest={selectedAudioFormat?.formatId === format.formatId}
            class:border-primary={selectedAudioFormat?.formatId === format.formatId}
          >
            <div class="flex items-center gap-2">
              <div
                class="size-4 rounded-full border-4 shrink-0 bg-surface"
                class:border-primary={selectedAudioFormat?.formatId === format.formatId}
                class:border-outline-variant={selectedAudioFormat?.formatId !== format.formatId}
              ></div>
              <span class="text-xs font-semibold">{format.quality}</span>
            </div>
            <span class="text-[10px] font-mono text-on-surface-variant">
              {format.filesize ? formatFileSize(format.filesize, getLocale()) : t('formats.unknownSize')}
            </span>
            <input
              type="radio"
              class="sr-only"
              name="audio-format"
              checked={selectedAudioFormat?.formatId === format.formatId}
              onchange={() => onselectAudio(format)}
            />
          </label>
        {/each}
      </div>
    </div>
  {/if}

  <!-- YouTube 音轨 -->
  {#if videoInfo.isYoutube && videoInfo.audioTracks?.length}
    <div class="flex flex-col gap-2">
      <span class="text-[11px] font-bold text-outline uppercase tracking-wider">
        {t('formats.trackHeader', { count: videoInfo.audioTracks.length })}
      </span>
      <div class="grid grid-cols-2 gap-2">
        {#each videoInfo.audioTracks as track (track.id)}
          <label
            class="flex items-center justify-between p-2.5 rounded-md cursor-pointer transition-colors bg-surface-container-lowest border border-outline-variant/20 hover:border-primary/40"
            class:bg-surface-container-highest={selectedAudioTrack?.id === track.id}
            class:border-primary={selectedAudioTrack?.id === track.id}
          >
            <div class="flex items-center gap-2">
              <div
                class="size-4 rounded-full border-4 shrink-0 bg-surface"
                class:border-primary={selectedAudioTrack?.id === track.id}
                class:border-outline-variant={selectedAudioTrack?.id !== track.id}
              ></div>
              <span class="text-xs font-semibold">{track.name}</span>
            </div>
            <span class="text-[10px] font-mono text-on-surface-variant">{track.language}</span>
            <input
              type="radio"
              class="sr-only"
              name="audio-track"
              checked={selectedAudioTrack?.id === track.id}
              onchange={() => onselectTrack(track)}
            />
          </label>
        {/each}
      </div>
    </div>
  {/if}

  <!-- YouTube 字幕（多选：可以同时下多种语言） -->
  {#if videoInfo.isYoutube && videoInfo.subtitles?.length}
    <div class="flex flex-col gap-2">
      <span class="text-[11px] font-bold text-outline uppercase tracking-wider">
        {t('formats.subtitleHeader', { count: videoInfo.subtitles.length })}
      </span>
      <div class="flex flex-wrap gap-2">
        {#each videoInfo.subtitles as sub (sub.language)}
          <label
            class="flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors bg-surface-container-lowest border border-outline-variant/20 hover:border-primary/40"
            class:bg-surface-container-highest={selectedSubtitles.includes(sub.language)}
            class:border-primary={selectedSubtitles.includes(sub.language)}
          >
            <div
              class="size-3 rounded-sm border-2 shrink-0"
              class:border-primary={selectedSubtitles.includes(sub.language)}
              class:bg-primary={selectedSubtitles.includes(sub.language)}
              class:border-outline-variant={!selectedSubtitles.includes(sub.language)}
              class:bg-surface={!selectedSubtitles.includes(sub.language)}
            ></div>
            <span class="text-xs font-semibold">{sub.name}</span>
            <input
              type="checkbox"
              class="sr-only"
              checked={selectedSubtitles.includes(sub.language)}
              onchange={() => onselectSubtitle(sub.language)}
            />
          </label>
        {/each}
      </div>
    </div>
  {/if}

  <!-- 下载按钮 -->
  <button
    class="w-full flex items-center justify-center gap-2 rounded-xl h-12 font-headline font-bold text-base shadow-md hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 mt-4 text-on-primary-fixed gradient-btn-orange"
    disabled={!canDownload}
    onclick={ondownload}
  >
    {#if isDownloading}
      <MaterialIcon name="sync" size={24} class="animate-spin" />
    {:else}
      <MaterialIcon name="download" size={24} />
    {/if}
    <span>{downloadLabel}</span>
  </button>
</div>
