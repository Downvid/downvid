<script lang="ts">
  /**
   * 视觉验证页：玻璃拟态 + 氛围光晕 + 动效预算。
   *
   * 这一页要回答三个问题：
   *   1. 暖色 token 上做玻璃会不会发灰（答案：靠 saturate 补）
   *   2. 玻璃元素的性能预算够不够（每屏 ≤3 个 backdrop-filter）
   *   3. 动效是否「解释状态」而不是「装饰」
   *
   * 数据是 bilibili 的真实形状（三编码 + 浮点 fps），不联网——
   * 这样「组件对不对」与「网络通不通」不会混在一起。
   */
  import DownloadView from './components/DownloadView.svelte'
  import MaterialIcon from './components/MaterialIcon.svelte'
  import { t, setLocale, getLocale, LOCALES, type Locale } from './i18n/index.svelte'
  import type { VideoInfo } from './types'

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

  let log = $state<string[]>([])

  /**
   * 演示用的「后端」：延迟一段后返回固定结果。
   *
   * 真机上这里接的是 Wails 绑定的 `OnParse`（`internal/parse` 的真实实现）。
   * 演示版用 Promise 模拟延迟，是为了验证**加载态、错误态、空态**都渲染得对——
   * 那三种状态在没有网络的环境下永远看不到。
   */
  async function fakeParse(url: string): Promise<VideoInfo> {
    note(`解析 ${url}`)
    await new Promise((r) => setTimeout(r, 1200))
    if (url.includes('fail')) {
      throw new Error('[[parse-error:network]]网络请求失败或超时，请检查连接后重试')
    }
    return videoInfo
  }

  async function fakeDownload(p: { formatId: string; downloadMode: string }) {
    note(`下载 formatId=${p.formatId} mode=${p.downloadMode}`)
    await new Promise((r) => setTimeout(r, 600))
  }

  function note(msg: string) {
    log = [...log, msg].slice(-5)
  }

</script>

<!-- 氛围光晕：给玻璃提供「可透」的底层。fixed + pointer-events:none -->
<div class="ambient"></div>

<main>
  <header class="enter">
    <div class="flex items-center gap-2.5">
      <span class="brand-mark">
        <MaterialIcon name="download" size={20} />
      </span>
      <h1>DownVid</h1>
      <span class="pill">Svelte · 视觉验证</span>
    </div>
    <p class="muted mt-2">玻璃拟态只用在浮层，每屏 ≤3 个 backdrop-filter。基础形态是纯色 + 细边框。</p>
    <div class="flex gap-2 mt-3">
      {#each LOCALES as loc (loc)}
        <button
          class="chip"
          class:chip-active={getLocale() === loc}
          onclick={() => { setLocale(loc); note(`语言 ${loc}`) }}
        >{loc}</button>
      {/each}
    </div>
  </header>

  <div class="grid">
    <!-- 玻璃 #1：主内容容器（这一屏唯一的大面积玻璃） -->
    <section class="glass enter" style="animation-delay: 40ms">
      <DownloadView onParse={fakeParse} onDownload={fakeDownload} />
    </section>

    {#if log.length}
      <section class="plain enter" style="animation-delay: 80ms">
        <h2>交互记录</h2>
        <ul>
          {#each log as line}
            <li class="mono">{line}</li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>
</main>

<style>
  main {
    position: relative;
    z-index: 1;
    max-width: 760px;
    margin: 0 auto;
    padding: 40px 24px 56px;
  }

  header { margin-bottom: 22px; }

  h1 {
    font-family: var(--font-headline);
    font-size: 21px;
    font-weight: 700;
    margin: 0;
    letter-spacing: -0.025em;
  }

  /* 品牌标记：一个小方块承载主色，比一整片渐变克制 */
  .brand-mark {
    display: grid;
    place-items: center;
    width: 34px; height: 34px;
    border-radius: 10px;
    background: linear-gradient(140deg, var(--color-primary-container), var(--color-primary));
    color: var(--color-on-primary);
    box-shadow: 0 4px 14px color-mix(in oklab, var(--color-primary) 28%, transparent);
  }

  .pill {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 3px 8px;
    border-radius: 999px;
    background: color-mix(in oklab, var(--color-secondary) 14%, transparent);
    color: var(--color-secondary-dim);
  }

  .muted { color: var(--color-on-surface-variant); font-size: 13px; margin: 0; }

  .chip {
    font: inherit;
    font-size: 11px;
    padding: 4px 10px;
    border-radius: 999px;
    cursor: pointer;
    border: 1px solid color-mix(in oklab, var(--color-outline-variant) 55%, transparent);
    background: transparent;
    color: var(--color-on-surface-variant);
    transition: all var(--dur-base) var(--ease-out-expo);
  }
  .chip:hover { border-color: var(--color-primary); color: var(--color-primary); }
  .chip-active {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: var(--color-on-primary);
  }

  .grid { display: grid; gap: 16px; }

  section.glass { padding: 18px; }



  /* 普通区块：不用玻璃，只用极细的分隔感 */
  .plain {
    padding: 14px 16px;
    border-radius: var(--radius-xl);
    border: 1px solid color-mix(in oklab, var(--color-outline-variant) 28%, transparent);
    background: color-mix(in oklab, var(--color-surface-container-low) 60%, transparent);
  }
  .plain h2 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-on-surface-variant);
    margin: 0 0 8px;
    font-weight: 600;
  }
  .plain ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 3px; }
  .plain li { font-size: 11px; color: var(--color-on-surface-variant); }

  .mono { font-family: var(--font-mono); }
</style>
