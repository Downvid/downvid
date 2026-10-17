<script lang="ts">
  /**
   * 前端迁移的演示页：用**真实组件**渲染一次解析结果。
   *
   * 这一步的目的不是「做出最终界面」，而是：
   *   1. 验证 Tailwind token、i18n、组件 props 三者串得起来
   *   2. 让视觉可以肉眼对比旧版（排版、配色、间距是否一致）
   *   3. 为后续迁移 DownloadView / DownloadQueue 提供落点
   *
   * 数据是写死的（bilibili 那条真实的三编码 + 浮点 fps），不联网——
   * 这样「组件对不对」与「网络通不通」两件事不会混在一起。
   */
  import FormatSelector from './components/FormatSelector.svelte'
  import MaterialIcon from './components/MaterialIcon.svelte'
  import { t, setLocale, getLocale, LOCALES, type Locale } from './i18n/index.svelte'
  import type { VideoInfo, VideoFormat, AudioFormat, AudioTrack } from './types'

  // 真实形状的解析结果：三个 1080P 编码（去重后应只剩一条 AVC）
  const videoInfo: VideoInfo = {
    id: 'demo',
    title: '示例视频标题 · 中文与 English 混排，用来检查换行与截断',
    thumbnail: '',
    duration: 754,
    uploader: '示例 UP 主',
    webpageUrl: 'https://example.com/v',
    isYoutube: true,
    formats: [
      { formatId: '30080', quality: '1080P', ext: 'mp4', filesize: 128_000_000, height: 1080, hasAudio: false },
      { formatId: '30064', quality: '720P', ext: 'mp4', filesize: 64_000_000, height: 720, hasAudio: false },
      { formatId: '30032', quality: '480P', ext: 'mp4', filesize: 28_000_000, height: 480, hasAudio: false },
    ],
    audioFormats: [
      { formatId: '140', quality: '128 kbps', ext: 'm4a', filesize: 12_000_000 },
      { formatId: '251', quality: '160 kbps', ext: 'webm', filesize: 15_000_000 },
    ],
    audioTracks: [
      { id: 'ja', name: '日本語', language: 'ja', formatId: '251' },
      { id: 'en', name: 'English', language: 'en', formatId: '251' },
    ],
    subtitles: [
      { language: 'zh-Hans', name: '中文（简体）', url: '#' },
      { language: 'en', name: 'English', url: '#' },
    ],
  }

  let selectedFormat = $state<VideoFormat | null>(videoInfo.formats[0])
  let selectedAudioFormat = $state<AudioFormat | null>(null)
  let selectedAudioTrack = $state<AudioTrack | null>(null)
  let selectedSubtitles = $state<string[]>([])
  let downloadMode = $state<'video' | 'audio' | 'subtitle'>('video')
  let isDownloading = $state(false)
  let log = $state<string[]>([])

  function note(msg: string) {
    log = [...log, msg].slice(-6)
  }

  function onselectVideo(f: VideoFormat) {
    selectedFormat = f
    selectedAudioFormat = null
    downloadMode = 'video'
    note(`选中视频 ${f.quality}`)
  }
  function onselectAudio(f: AudioFormat) {
    selectedAudioFormat = f
    downloadMode = 'audio'
    note(`选中音频 ${f.quality}`)
  }
  function onselectTrack(track: AudioTrack) {
    selectedAudioTrack = track
    note(`选中音轨 ${track.name}`)
  }
  function onselectSubtitle(lang: string) {
    selectedSubtitles = selectedSubtitles.includes(lang)
      ? selectedSubtitles.filter((l) => l !== lang)
      : [...selectedSubtitles, lang]
    downloadMode = selectedSubtitles.length ? 'subtitle' : 'video'
    note(`字幕：${selectedSubtitles.join(',') || '（无）'}`)
  }
  function ondownload() {
    isDownloading = true
    note(`开始下载（模式 ${downloadMode}）`)
    setTimeout(() => { isDownloading = false }, 1500)
  }

  function switchLocale(next: Locale) {
    setLocale(next)
    note(`语言切到 ${next}`)
  }
</script>

<main>
  <header>
    <div class="flex items-center gap-2">
      <MaterialIcon name="download" size={22} />
      <h1>DownVid <span class="tag">Svelte 组件预览</span></h1>
    </div>
    <p class="muted">用真实组件渲染一份解析结果，检查排版与文案是否与旧版一致。</p>
    <div class="flex gap-2 mt-3">
      {#each LOCALES as loc (loc)}
        <button
          class="text-xs px-3 py-1 rounded-md border"
          class:border-primary={getLocale() === loc}
          class:text-primary={getLocale() === loc}
          onclick={() => switchLocale(loc)}
        >{loc}</button>
      {/each}
    </div>
  </header>

  <section>
    <!-- 真实组件：FormatSelector 内部会渲染 VideoInfoCard -->
    <FormatSelector
      {videoInfo}
      {selectedFormat}
      {selectedAudioFormat}
      {selectedAudioTrack}
      {selectedSubtitles}
      {downloadMode}
      {isDownloading}
      {onselectVideo}
      {onselectAudio}
      {onselectTrack}
      {onselectSubtitle}
      {ondownload}
    />
  </section>

  {#if log.length}
    <section>
      <h2>交互记录</h2>
      <ul class="list">
        {#each log as line}
          <li class="mono small">{line}</li>
        {/each}
      </ul>
    </section>
  {/if}
</main>

<style>
  main { max-width: 720px; margin: 0 auto; padding: 32px 24px 48px; }
  header { margin-bottom: 24px; }
  h1 { font-size: 20px; margin: 0; letter-spacing: -0.02em; }
  .tag {
    font-size: 10px; font-weight: 600; vertical-align: middle;
    background: var(--color-primary); color: var(--color-on-primary);
    padding: 2px 7px; border-radius: 999px; margin-left: 4px;
  }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em;
       color: var(--color-on-surface-variant); margin: 24px 0 10px; font-weight: 600; }
  .muted { color: var(--color-on-surface-variant); font-size: 13px; margin: 8px 0 0; }
  .list { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; }
  .list li { font-size: 12px; color: var(--color-on-surface-variant); }
  .mono { font-family: var(--font-mono); }
  .small { font-size: 11px; }
</style>
