<script lang="ts">
  /**
   * 下载主视图：粘贴链接 → 解析 → 选格式 → 下载。
   *
   * 迁移自 `src/components/DownloadView.vue`（220 行）。
   *
   * ## 旧版的一个问题，这次顺手修掉
   *
   * 旧版把**整套解析流程写在视图里**：URL 正则提取、协议校验、调 IPC、
   * 封面转 base64、缺依赖兜底、错误分类、`setInterval` 计时器——159 行脚本
   * 里只有一小半是渲染。
   *
   * 这让「解析」这件事无法复用（容器端要重写一遍），也无法单测。
   * 现在拆成两部分：
   *   - `parse.ts`：纯逻辑（URL 校验、错误分类、状态计算）——可单测
   *   - 本组件：只负责渲染与调用
   *
   * ## 解析计时器
   *
   * 旧版用 `setInterval` 且有两个出口（完成 / 卸载），漏一个就会泄漏。
   * Svelte 5 里用 `$effect` 返回清理函数，结构上只有一个出口。
   */
  import MaterialIcon from './MaterialIcon.svelte'
  import UrlInput from './UrlInput.svelte'
  import FormatSelector from './FormatSelector.svelte'
  import { t } from '../i18n/index.svelte'
  import { validateUrl, describeParseError } from '../lib/parse-url'
  import type { VideoInfo, VideoFormat, AudioFormat, AudioTrack } from '../types'

  interface Props {
    /** 后端解析函数（桌面走 Wails 绑定，容器走 WebSocket RPC） */
    onParse: (url: string) => Promise<VideoInfo>
    onDownload: (payload: DownloadPayload) => Promise<void>
    /** 依赖缺失时跳设置页 */
    onopenSettings?: () => void
  }

  export interface DownloadPayload {
    url: string
    formatId: string
    downloadMode: 'video' | 'audio' | 'subtitle'
    hasAudio: boolean
    subtitles: string[]
    filenameTemplate: string
  }

  let { onParse, onDownload, onopenSettings }: Props = $props()

  let url = $state('')
  let parsing = $state(false)
  let parsed = $state<VideoInfo | null>(null)
  let parseError = $state('')
  let elapsed = $state(0)
  let downloading = $state(false)
  let downloadError = $state('')

  let selectedFormat = $state<VideoFormat | null>(null)
  let selectedAudioFormat = $state<AudioFormat | null>(null)
  let selectedAudioTrack = $state<AudioTrack | null>(null)
  let selectedSubtitles = $state<string[]>([])
  let downloadMode = $state<'video' | 'audio' | 'subtitle'>('video')

  /**
   * 解析计时器。
   *
   * `$effect` 的清理函数在 `parsing` 变 false 或组件卸载时都会跑——
   * 只有一个出口，不会漏。旧版的 `setInterval` + 手工 `clearElapsed`
   * 有两个出口，漏一个就是永久泄漏（每秒一次 setState，界面会越来越慢）。
   */
  $effect(() => {
    if (!parsing) return
    elapsed = 0
    const timer = setInterval(() => { elapsed += 0.1 }, 100)
    return () => clearInterval(timer)
  })

  async function parse() {
    parseError = ''
    const invalid = validateUrl(url)
    if (invalid) {
      // 本地就能判定的错误不必往返后端——省一次网络，错误也更即时
      parseError = t(invalid)
      return
    }

    parsing = true
    parsed = null
    try {
      const info = await onParse(url.trim())
      parsed = info
      // 默认选中第一个视频格式：让「粘贴 → 解析 → 下载」能一路点完，
      // 不必先去勾一个选项（旧版也是这样）
      selectedFormat = info.formats?.[0] ?? null
      downloadMode = 'video'
    } catch (e) {
      parseError = describeParseError(String((e as Error)?.message ?? e))
    } finally {
      parsing = false
    }
  }

  async function download() {
    if (!parsed || downloading) return
    downloadError = ''
    downloading = true
    try {
      await onDownload({
        url: parsed.webpageUrl || url.trim(),
        formatId:
          downloadMode === 'audio'
            ? (selectedAudioFormat?.formatId ?? selectedFormat?.formatId ?? '')
            : (selectedFormat?.formatId ?? ''),
        downloadMode,
        hasAudio: selectedFormat?.hasAudio ?? false,
        subtitles: selectedSubtitles,
        filenameTemplate: '%(title)s.%(ext)s',
      })
    } catch (e) {
      downloadError = String((e as Error)?.message ?? e)
    } finally {
      downloading = false
    }
  }

  const canParse = $derived(url.trim().length > 0 && !parsing)
</script>

<div class="flex flex-col gap-4">
  <UrlInput
    value={url}
    isParsing={parsing}
    oninput={(v) => { url = v }}
    onparse={parse}
    {onopenSettings}
  />

  {#if parsing}
    <div class="flex flex-col gap-2 p-4 bg-surface-container-low rounded-md border border-outline-variant/10">
      <div class="flex items-center justify-between text-xs">
        <span class="flex items-center gap-2 text-on-surface-variant">
          <MaterialIcon name="sync" size={14} class="animate-spin" />
          {t('url.parsing')}
        </span>
        <span class="font-mono text-on-surface-variant">{elapsed.toFixed(1)}s</span>
      </div>
      <!-- 不确定进度：解析阶段拿不到真实进度，只表示「正在进行」 -->
      <div class="h-1 rounded-full bg-outline-variant/25 overflow-hidden">
        <div class="h-full w-1/3 rounded-full bg-tertiary animate-parse-bar"></div>
      </div>
      {#if elapsed > 8}
        <p class="text-[11px] text-on-surface-variant">
          {t('url.parseSlowHint')}
        </p>
      {/if}
    </div>
  {/if}

  {#if parseError}
    <div class="flex items-start gap-3 p-4 bg-error-container/25 rounded-md border border-error/30">
      <MaterialIcon name="error" size={20} class="text-error shrink-0 mt-0.5" />
      <div class="flex-1">
        <p class="text-sm font-medium text-on-surface">{t('url.parseFailed')}</p>
        <p class="text-xs text-on-surface-variant mt-1 leading-relaxed">{parseError}</p>
      </div>
    </div>
  {/if}

  {#if parsed}
    <div class="enter">
      <FormatSelector
        videoInfo={parsed}
        {selectedFormat}
        {selectedAudioFormat}
        {selectedAudioTrack}
        {selectedSubtitles}
        {downloadMode}
        isDownloading={downloading}
        onselectVideo={(f) => { selectedFormat = f; selectedAudioFormat = null; downloadMode = 'video' }}
        onselectAudio={(f) => { selectedAudioFormat = f; downloadMode = 'audio' }}
        onselectTrack={(tk) => { selectedAudioTrack = tk }}
        onselectSubtitle={(lang) => {
          selectedSubtitles = selectedSubtitles.includes(lang)
            ? selectedSubtitles.filter((l) => l !== lang)
            : [...selectedSubtitles, lang]
          downloadMode = selectedSubtitles.length ? 'subtitle' : 'video'
        }}
        ondownload={download}
      />
    </div>
  {/if}

  {#if downloadError}
    <div class="flex items-start gap-3 p-3 bg-error-container/25 rounded-md border border-error/30">
      <MaterialIcon name="error" size={18} class="text-error shrink-0 mt-0.5" />
      <p class="text-xs text-on-surface-variant flex-1">{downloadError}</p>
    </div>
  {/if}

  {#if !parsed && !parsing && !parseError && !canParse}
    <!-- 空态：告诉用户下一步做什么，而不是一片空白 -->
    <div class="flex flex-col items-center justify-center py-16 text-center">
      <MaterialIcon name="link" size={40} class="text-outline-variant/40 mb-3" />
      <p class="text-sm font-medium text-on-surface-variant">{t('url.emptyTitle')}</p>
      <p class="text-xs text-outline mt-1">{t('url.emptyHint')}</p>
    </div>
  {/if}
</div>
