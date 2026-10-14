import { describe, it, expect } from 'vitest'
import { buildVideoFormats } from '../electron/parsers/formats'

/**
 * 格式列表生成。
 *
 * 这是纯函数，但过去出过多次线上问题：
 *  - X/Twitter 的 mp4 没有 vcodec 字段，被过滤后格式列表为空 → 无法下载
 *  - m3u8 与直链共存时优先选了 m3u8，导致只能浏览器式串流
 *  - 全部格式都没有分辨率时，没有兜底项，用户无从选择
 * 因此针对这些回归点各留一个用例。
 */
describe('buildVideoFormats', () => {
  it('YouTube 流格式回退保留仅有的 HLS 清晰度', () => {
    const info = { formats: [{ format_id: 'hls', vcodec: 'h264', acodec: 'aac', height: 720, protocol: 'm3u8_native' }] }
    expect(buildVideoFormats(info, true, true)[0].formatId).toBe('hls')
    expect(buildVideoFormats(info, true)[0].formatId).not.toBe('hls')
  })
  it('保留没有 vcodec 的格式（X/Twitter 的 mp4）', () => {
    const info = {
      formats: [
        { format_id: 'http-1', url: 'https://x/v.mp4', ext: 'mp4', width: 1280, height: 720 },
      ],
    }
    const formats = buildVideoFormats(info, false)
    expect(formats.length).toBeGreaterThan(0)
    expect(formats[0].formatId).toBe('http-1')
  })

  it('按分辨率降序排列', () => {
    const info = {
      formats: [
        { format_id: 'sd', vcodec: 'h264', height: 360, width: 640, ext: 'mp4' },
        { format_id: 'hd', vcodec: 'h264', height: 1080, width: 1920, ext: 'mp4' },
        { format_id: 'md', vcodec: 'h264', height: 720, width: 1280, ext: 'mp4' },
      ],
    }
    const heights = buildVideoFormats(info, false).map(f => f.height)
    expect(heights).toEqual([...heights].sort((a, b) => (b ?? 0) - (a ?? 0)))
  })

  it('同一清晰度已有直链时不重复保留 m3u8', () => {
    const info = {
      formats: [
        { format_id: 'direct-720', vcodec: 'h264', height: 720, width: 1280, ext: 'mp4', protocol: 'https' },
        { format_id: 'hls-720', vcodec: 'h264', height: 720, width: 1280, ext: 'mp4', protocol: 'm3u8_native' },
      ],
    }
    const ids = buildVideoFormats(info, false).map(f => f.formatId)
    expect(ids).toContain('direct-720')
    expect(ids).not.toContain('hls-720')
  })

  it('该清晰度只有 m3u8 时保留 m3u8', () => {
    const info = {
      formats: [
        { format_id: 'direct-360', vcodec: 'h264', height: 360, width: 640, ext: 'mp4', protocol: 'https' },
        { format_id: 'hls-1080', vcodec: 'h264', height: 1080, width: 1920, ext: 'mp4', protocol: 'm3u8_native' },
      ],
    }
    const ids = buildVideoFormats(info, false).map(f => f.formatId)
    expect(ids).toContain('hls-1080')
  })

  it('都没有分辨率时给出「最佳画质」兜底，避免用户无可选项', () => {
    const info = { formats: [{ format_id: 'x', vcodec: 'h264', ext: 'mp4' }] }
    const formats = buildVideoFormats(info, false)
    expect(formats.some(f => f.formatId === 'bv*+ba/b')).toBe(true)
  })

  it('无可用格式时返回空数组而不是抛错', () => {
    expect(buildVideoFormats({ formats: [] }, false)).toEqual([])
    expect(buildVideoFormats({}, false)).toEqual([])
  })

  it('标记含音轨的格式，供下载时决定是否合并', () => {
    const info = {
      formats: [
        { format_id: 'with-audio', vcodec: 'h264', acodec: 'aac', height: 720, width: 1280, ext: 'mp4' },
        { format_id: 'video-only', vcodec: 'h264', acodec: 'none', height: 1080, width: 1920, ext: 'mp4' },
      ],
    }
    const byId = Object.fromEntries(buildVideoFormats(info, false).map(f => [f.formatId, f]))
    expect(byId['with-audio']?.hasAudio).toBe(true)
    expect(byId['video-only']?.hasAudio).toBe(false)
  })
})
