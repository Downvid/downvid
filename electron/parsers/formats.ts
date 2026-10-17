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

/**
 * 帧率归一化。
 *
 * ## 为什么必须归一化（真实 bug）
 *
 * bilibili 同一清晰度会给三种编码（HEVC / AV1 / AVC），而 fps 字段是**浮点**：
 * 29.969 与 29.97 其实是同一个 30fps 档位，但两个数字不相等。去重键里带上原始
 * fps 时，它们就成了两个不同的键 —— 界面于是显示**两个 1080P**，用户以为可选
 * 清晰度变多了，其实只是同一条视频的三个编码被拆成了两组。
 *
 * 用「取整到常见档位」的方式归一：23.976/24→24、25→25、29.97/30→30、
 * 50→50、59.94/60→60。这样既保留了「30fps 与 60fps 是两个不同选项」的能力，
 * 又不会因为小数点后的抖动而分裂。
 */
export function normalizeFps(fps: number): number {
  if (!fps || fps <= 0) return 0
  const common = [24, 25, 30, 48, 50, 60, 120, 144]
  for (const target of common) {
    // 容差 1：29.969 与 30 相差 0.031，59.94 与 60 相差 0.06
    if (Math.abs(fps - target) <= 1) return target
  }
  return Math.round(fps)
}

/**
 * 编码兼容性排序：越小越优先。
 *
 * 同一清晰度只能留一个时，选**兼容性最好**的那个而不是码率最高的：
 * - AVC (h264)：所有播放器、所有硬件都能解，这是用户拖进剪辑软件/电视时最不容易出问题的
 * - HEVC (h265)：省带宽，但老设备/浏览器可能不支持
 * - AV1：更省带宽，但支持面最窄（大量播放器直接打不开）
 *
 * 之前的实现按码率排序取第一个，而 bilibili 上 AVC 恰好码率最高（3252 vs 2070），
 * 结果「碰巧」是对的 —— 但那是运气，不是规则。换个站点（AV1 码率更低但更不兼容）
 * 就会把最不兼容的编码推给用户。
 */
function codecRank(vcodec: string): number {
  const c = (vcodec || '').toLowerCase()
  if (c.startsWith('avc') || c.startsWith('h264')) return 0
  if (c.startsWith('hev') || c.startsWith('hvc') || c.startsWith('h265')) return 1
  if (c.startsWith('av01') || c.startsWith('av1')) return 2
  if (c.startsWith('vp9') || c.startsWith('vp09')) return 3
  if (c.startsWith('vp8')) return 4
  return 5
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
        width: f.width || 0, height, fps: normalizeFps(fps),
        // acodec 缺失视为音视频一体（渐进式 mp4 通常如此），下载时不再额外合并音轨
        hasAudio: f.acodec == null ? true : f.acodec !== 'none',
        _tbr: f.tbr || 0,
        _codec: codecRank(f.vcodec || ''),
      }
    })
    // 排序决定「同一清晰度留哪一个」：先按分辨率/帧率降序（展示顺序），
    // 同档位内按编码兼容性升序（AVC 优先），最后才比码率
    .sort((a: any, b: any) => (b.height || 0) - (a.height || 0)
      || (b.fps || 0) - (a.fps || 0)
      || a._codec - b._codec
      || (b._tbr || 0) - (a._tbr || 0))
    // 同一清晰度只保留一个。
    // 去重键用 **height + 归一化 fps**，而不是 `quality` 字符串：
    //   - quality 是给人看的标签，同一 height 可能被标成不同的写法
    //   - 归一化 fps 让 29.969 与 29.97 落进同一个桶（这正是「两个 1080P」的根因）
    .filter((f: any) => {
      const key = `${f.height || 0}_${f.fps || 0}`
      if (seenQuality.has(key)) return false
      seenQuality.add(key)
      return true
    })
    .map(({ _tbr, _codec, ...rest }: any) => rest)

  // 兜底：站点没有提供可识别的分辨率信息时，交给 yt-dlp 自动选择最佳格式，避免无格式可选
  if (formats.length === 0 && (info.formats?.length || info.url)) {
    formats = [{ formatId: 'bv*+ba/b', quality: '最佳画质', ext: info.ext || 'mp4', filesize: info.filesize || info.filesize_approx || 0, width: info.width || 0, height: info.height || 0, fps: info.fps || 0, hasAudio: true }]
  }

  return formats
}
