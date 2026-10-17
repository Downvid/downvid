<script lang="ts">
  /**
   * 视频信息卡：缩略图 + 标题 + UP 主 + 时长 / 大小。
   *
   * 迁移自 `src/components/VideoInfoCard.vue`（上游成分 76.5%，是全仓库最高的之一）。
   * 结构、class 与视觉逐字保留——这类「纯展示」组件换框架最容易出的问题就是
   * 顺手调整了间距，用户一眼就能看出「排版变了」。
   */
  import MaterialIcon from './MaterialIcon.svelte'
  import { formatDuration, formatFileSize } from './format-helpers'
  import { getLocale } from '../i18n/index.svelte'
  import type { VideoInfo, VideoFormat } from '../types'

  interface Props {
    videoInfo: VideoInfo
    selectedFormat?: VideoFormat | null
  }

  let { videoInfo, selectedFormat = null }: Props = $props()

</script>

<div class="flex gap-4 p-3 bg-surface-container-low rounded-md border border-outline-variant/10">
  <!-- 缩略图用内联 backgroundImage 而不是 <img>：
       <img> 加载失败会显示破图图标，而背景图失败只是留白。
       平台缩略图地址经常过期（CDN 有时效），留白比破图好看。 -->
  <div
    class="w-40 h-24 rounded-sm bg-surface-variant bg-cover bg-center shrink-0 relative overflow-hidden shadow-xs"
    style="background-image: url({videoInfo.thumbnail})"
  >
    {#if videoInfo.duration}
      <div
        class="absolute bottom-1 right-1 bg-inverse-surface/80 backdrop-blur-xs text-inverse-on-surface text-[10px] font-mono px-1 rounded-sm"
      >
        {formatDuration(videoInfo.duration)}
      </div>
    {/if}
  </div>

  <div class="flex flex-col flex-1 justify-between py-0.5">
    <div>
      <h4 class="font-headline text-sm font-bold text-on-surface leading-snug line-clamp-2">
        {videoInfo.title}
      </h4>
      {#if videoInfo.uploader}
        <p class="text-xs text-on-surface-variant mt-1 flex items-center gap-1">
          <MaterialIcon name="account_circle" size={14} />
          <span>{videoInfo.uploader}</span>
        </p>
      {/if}
    </div>

    <div class="flex items-center gap-3 text-[11px] text-on-surface-variant font-mono">
      {#if videoInfo.duration}
        <span class="flex items-center gap-1">
          <MaterialIcon name="schedule" size={14} />
          {formatDuration(videoInfo.duration)}
        </span>
      {/if}
      {#if selectedFormat?.filesize}
        <span class="flex items-center gap-1">
          <MaterialIcon name="database" size={14} />
          {formatFileSize(selectedFormat.filesize, getLocale())}
        </span>
      {/if}
    </div>
  </div>
</div>
