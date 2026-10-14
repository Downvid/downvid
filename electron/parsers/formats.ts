// yt-dlp info JSON → 界面可选的视频格式列表（纯函数，便于测试）

function getResolutionLabel(height: number, fps: number): string {
  let label = ''
  if (height >= 2160) label = '4K'
  else if (height >= 1440) label = '2K'
  else if (height >= 1080) label = '1080P'
  else if (height >= 720) label = '720P'
  else if (height >= 480) label = '480P'
  else if (height >= 360) label = '360P'
  else if (height >= 240) label = '240P'
  else label = `${height}P`
  if (fps > 30) label += ` ${fps}fps`
  return label
}

function cleanQualityLabel(raw: string): string {
  if (!raw) return ''
  const s = raw.trim()
  if (/^\d{3,4}x\d{3,4}$/.test(s)) return ''
  if (/^\d+$/.test(s)) return ''
  const heightMatch = s.match(/(\d{3,4})\s*p/i)
  if (heightMatch) {
    const h = parseInt(heightMatch[1])
    const fpsMatch = s.match(/(\d{3,4})\s*p[_\s]*(\d+)\s*(?:fps)?/i)
    const fps = fpsMatch ? parseInt(fpsMatch[2]) : 0
    let label = ''
    if (h >= 2160) label = '4K'
    else if (h >= 1440) label = '2K'
    else label = `${h}P`
    if (fps > 30) label += ` ${fps}fps`
    return label
  }
  return ''
}

export function buildVideoFormats(info: any, isYoutube: boolean, allowYoutubeManifests = false): any[] {
  const isM3u8 = (f: any) => (f.protocol || '').includes('m3u8')
  // 不要求 vcodec 字段存在：X/Twitter 等站点的 mp4 直链格式不带编解码信息（vcodec 为空）
  const videoFormats = (info.formats || []).filter((f: any) => f.vcodec !== 'none' && (f.height || 0) > 0)
  // 同一高度有直链时去掉 m3u8（直链下载更快更稳）；只有 m3u8 的清晰度保留（部分 X 视频、直播回放）。
  // YouTube 仅在流格式回退时开放 m3u8，仍优先同清晰度的直链。
  const directHeights = new Set(videoFormats.filter((f: any) => !isM3u8(f)).map((f: any) => f.height))
  const seenQuality = new Set<string>()

  let formats = videoFormats
    .filter((f: any) => !isM3u8(f) || ((!isYoutube || allowYoutubeManifests) && !directHeights.has(f.height)))
    .map((f: any) => {
      let filesize = f.filesize || f.filesize_approx || 0
      if (!filesize && info.duration) {
        let bitrate = f.tbr || 0
        if (!bitrate) { bitrate = (f.vbr || 0) + (f.abr || (f.acodec && f.acodec !== 'none' ? 128 : 0)) }
        if (bitrate > 0) filesize = Math.floor((bitrate * 1000 * info.duration) / 8)
      }
      const height = f.height || 0
      const fps = f.fps || 0
      const rawLabel = cleanQualityLabel(f.quality_label || '') || cleanQualityLabel(f.format_note || '')
      const quality = rawLabel || getResolutionLabel(height, fps)
      return {
        formatId: f.format_id || '', quality,
        ext: f.ext || f.video_ext || 'mp4', filesize,
        width: f.width || 0, height, fps,
        // acodec 缺失视为音视频一体（渐进式 mp4 通常如此），下载时不再额外合并音轨
        hasAudio: f.acodec == null ? true : f.acodec !== 'none',
        _tbr: f.tbr || 0,
      }
    })
    .sort((a: any, b: any) => (b.height || 0) - (a.height || 0) || (b._tbr || 0) - (a._tbr || 0))
    // 同一清晰度只保留码率最高的一个（已按码率降序）
    .filter((f: any) => {
      const key = `${f.quality}_${f.fps || 0}`
      if (seenQuality.has(key)) return false
      seenQuality.add(key)
      return true
    })
    .map(({ _tbr, ...rest }: any) => rest)

  // 兜底：站点没有提供可识别的分辨率信息时，交给 yt-dlp 自动选择最佳格式，避免无格式可选
  if (formats.length === 0 && (info.formats?.length || info.url)) {
    formats = [{ formatId: 'bv*+ba/b', quality: '最佳画质', ext: info.ext || 'mp4', filesize: info.filesize || info.filesize_approx || 0, width: info.width || 0, height: info.height || 0, fps: info.fps || 0, hasAudio: true }]
  }

  return formats
}
