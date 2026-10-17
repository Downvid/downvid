import { describe, it, expect } from 'vitest'
import { toDemoVideo, errorMarker, stripMarker, type BackendVideoInfo } from './backend'

/**
 * 后端适配层：把 Go 的 `parse.VideoInfo` 转成 demo store 的形状。
 *
 * 这一层的 bug **不会报错**——字段名对不上时前端只是显示空白
 * （`formats` 为空 → 格式选择器一片空），所以必须有测试钉住。
 */

function sampleInfo(): BackendVideoInfo {
  return {
    id: 'jNQXAC9IVRw',
    title: 'Me at the zoo',
    description: '',
    thumbnail: 'https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg',
    duration: 19,
    uploader: 'jawed',
    webpageUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    isYoutube: true,
    parseNotice: '',
    cacheFile: '/data/parse-cache/downvid-jNQXAC9IVRw.json',
    formats: [
      { formatId: '18', quality: '240P', ext: 'mp4', filesize: 785000, width: 320, height: 240, fps: 15, hasAudio: true },
      { formatId: '160', quality: '144P', ext: 'mp4', filesize: 220000, width: 192, height: 144, fps: 15, hasAudio: false },
    ],
    audioFormats: [
      { formatId: '140', quality: '128kbps', ext: 'm4a', filesize: 300000, abr: 128, acodec: 'mp4a.40.2' },
    ],
    audioTracks: [{ id: 'en', name: 'English', language: 'en', formatId: '140' }],
    subtitles: [{ language: 'en', name: 'English', url: 'https://x/en.vtt' }],
  }
}

describe('toDemoVideo', () => {
  it('格式列表按后端顺序保留，首个标为推荐', () => {
    const v = toDemoVideo(sampleInfo(), 'https://www.youtube.com/watch?v=jNQXAC9IVRw')
    expect(v.formats).toHaveLength(2)
    expect(v.formats[0].id).toBe('18')
    // 后端已按「兼容性优先」排序，前端不再排——两处各排一次必然漂移
    expect(v.formats[0].recommended).toBe(true)
    expect(v.formats[1].recommended).toBe(false)
  })

  it('平台信息从 URL 推断（后端不该给展示文案）', () => {
    const v = toDemoVideo(sampleInfo(), 'https://www.youtube.com/watch?v=x')
    expect(v.platformId).toBe('youtube')
    expect(v.host).toBe('youtube.com')

    const b = toDemoVideo({ ...sampleInfo(), webpageUrl: 'https://www.bilibili.com/video/BV1' }, '')
    expect(b.platformId).toBe('bilibili')
  })

  it('未知站点归到 other，且用 hostname 作显示名', () => {
    const v = toDemoVideo({ ...sampleInfo(), webpageUrl: 'https://example.com/v' }, '')
    expect(v.platformId).toBe('other')
    expect(v.platformName).toBe('example.com')
  })

  it('缺字段时给安全默认值，不产出 undefined', () => {
    const minimal: BackendVideoInfo = {
      id: '', title: '', description: '', thumbnail: '', duration: 0,
      uploader: '', webpageUrl: '', isYoutube: false, parseNotice: '',
      formats: [],
    }
    const v = toDemoVideo(minimal, 'https://x/v')
    expect(v.title).toBe('未知标题')
    expect(v.formats).toEqual([])
    expect(v.audios).toEqual([])
    expect(v.tracks).toEqual([])
    expect(v.subtitles).toEqual([])
    // url 回退到入参，不能是空串（历史记录要靠它去重）
    expect(v.url).toBe('https://x/v')
  })

  it('音频格式的 kbps 从 abr 取整', () => {
    const info = sampleInfo()
    info.audioFormats = [{ formatId: '140', quality: 'x', ext: 'm4a', filesize: 1, abr: 127.8, acodec: '' }]
    const v = toDemoVideo(info, 'https://www.youtube.com/watch?v=x')
    expect(v.audios[0].kbps).toBe(128)
  })

  it('YouTube 标记 needsCookies（决定要不要显示 Cookie 提示）', () => {
    const yt = toDemoVideo(sampleInfo(), 'https://www.youtube.com/watch?v=x')
    expect(yt.needsCookies).toBe(true)

    const bb = toDemoVideo({ ...sampleInfo(), isYoutube: false }, 'https://www.bilibili.com/video/BV1')
    expect(bb.needsCookies).toBe(false)
  })

  it('字幕转成 demo 的 SubtitleOption（id/lang/name/ext）', () => {
    const v = toDemoVideo(sampleInfo(), 'https://www.youtube.com/watch?v=x')
    expect(v.subtitles[0]).toMatchObject({ id: 'en', lang: 'en', name: 'English', ext: 'srt' })
  })
})

describe('errorMarker', () => {
  it('识别依赖缺失标记', () => {
    const m = errorMarker('[[deps-missing:yt-dlp]]未找到可用的 yt-dlp')
    expect(m.kind).toBe('deps')
    expect(m.code).toBe('yt-dlp')
  })

  it('识别解析错误标记', () => {
    const m = errorMarker('[[parse-error:network]]网络请求失败')
    expect(m.kind).toBe('parse')
    expect(m.code).toBe('network')
  })

  it('没有标记时返回空（普通错误）', () => {
    expect(errorMarker('something broke').kind).toBe('')
  })

  it('依赖标记优先于解析标记（两者同时出现时用更具体的）', () => {
    const m = errorMarker('[[deps-missing:ffmpeg]][[parse-error:unknown]]x')
    expect(m.kind).toBe('deps')
  })
})

describe('stripMarker', () => {
  it('去掉标记只留说明', () => {
    expect(stripMarker('[[parse-error:network]]网络请求失败')).toBe('网络请求失败')
    expect(stripMarker('[[deps-missing:yt-dlp]]未找到 yt-dlp')).toBe('未找到 yt-dlp')
  })

  it('没有标记时原样返回', () => {
    expect(stripMarker('普通错误')).toBe('普通错误')
  })
})
