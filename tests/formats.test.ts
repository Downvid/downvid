import { describe, it, expect } from 'vitest'
import { buildVideoFormats, normalizeFps } from '../electron/parsers/formats'

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

/**
 * 同一清晰度不能显示多条（真实 bug）。
 *
 * bilibili 的 `formats` 里**每个清晰度有三种编码**（HEVC / AV1 / AVC），
 * 而 fps 是浮点：29.969 与 29.97 其实是同一个 30fps 档位，但两个数字不相等。
 * 旧的去重键是 `${quality}_${fps}`，于是它们成了两个不同的键 ——
 * 界面显示**两个 1080P**，用户以为可选清晰度变多了。
 *
 * 这条用例用的是真实 bilibili 响应里截出来的那 12 条格式，而不是编造的简化版：
 * 只有真实数据才会同时包含「三编码 + 浮点 fps 抖动」这两个特征。
 */
describe('同一清晰度去重', () => {
  const bilibiliInfo = {
    duration: 1206.833,
    formats: [
      { format_id: '30011', height: 360, fps: 29.969, vcodec: 'hev1.1.6.L120', acodec: 'none', tbr: 253.637 },
      { format_id: '100022', height: 360, fps: 29.969, vcodec: 'av01.0.00M.10', acodec: 'none', tbr: 226.967 },
      { format_id: '30016', height: 360, fps: 29.97, vcodec: 'avc1.64001E', acodec: 'none', tbr: 363.121 },
      { format_id: '30033', height: 480, fps: 29.969, vcodec: 'hev1.1.6.L120', acodec: 'none', tbr: 415.96 },
      { format_id: '100023', height: 480, fps: 29.969, vcodec: 'av01.0.00M.10', acodec: 'none', tbr: 382.091 },
      { format_id: '30032', height: 480, fps: 29.97, vcodec: 'avc1.64001F', acodec: 'none', tbr: 621.299 },
      { format_id: '30066', height: 720, fps: 29.969, vcodec: 'hev1.1.6.L120', acodec: 'none', tbr: 878.474 },
      { format_id: '100024', height: 720, fps: 29.969, vcodec: 'av01.0.00M.10', acodec: 'none', tbr: 819.378 },
      { format_id: '30064', height: 720, fps: 29.97, vcodec: 'avc1.640028', acodec: 'none', tbr: 1301.438 },
      { format_id: '30077', height: 1080, fps: 29.969, vcodec: 'hev1.1.6.L150', acodec: 'none', tbr: 2070.001 },
      { format_id: '100026', height: 1080, fps: 29.969, vcodec: 'av01.0.00M.10', acodec: 'none', tbr: 2000.529 },
      { format_id: '30080', height: 1080, fps: 29.97, vcodec: 'avc1.640032', acodec: 'none', tbr: 3252.336 },
    ],
  }

  it('bilibili 的 12 条格式收成 4 个清晰度（曾经显示成 8 个）', () => {
    const formats = buildVideoFormats(bilibiliInfo, false)
    expect(formats.map(f => f.quality)).toEqual(['1080P', '720P', '480P', '360P'])
    // 每个清晰度只能出现一次
    expect(new Set(formats.map(f => f.height)).size).toBe(formats.length)
  })

  it('同一清晰度保留兼容性最好的编码（AVC 优先于 HEVC / AV1）', () => {
    const formats = buildVideoFormats(bilibiliInfo, false)
    // 30080/30064/30032/30016 都是 avc1
    expect(formats.map(f => f.formatId)).toEqual(['30080', '30064', '30032', '30016'])
  })

  it('编码优先级不能靠「码率恰好最高」蒙对', () => {
    // bilibili 上 AVC 恰好码率最高，所以「按码率取第一」也会选对 —— 那是运气。
    // 这里把 AV1 的码率调到最高：只有真正按编码兼容性排序才会选 AVC。
    const info = {
      formats: [
        { format_id: 'av1', vcodec: 'av01.0.00M.10', height: 1080, fps: 30, acodec: 'none', tbr: 9999 },
        { format_id: 'hevc', vcodec: 'hev1.1.6.L150', height: 1080, fps: 30, acodec: 'none', tbr: 5000 },
        { format_id: 'avc', vcodec: 'avc1.640032', height: 1080, fps: 30, acodec: 'none', tbr: 1000 },
      ],
    }
    expect(buildVideoFormats(info, false).map(f => f.formatId)).toEqual(['avc'])
  })

  it('去重必须依赖归一化后的 fps（不归一化时同一清晰度会分裂成两条）', () => {
    // 只有两种编码、且**没有 quality 标签可用**时，旧实现（用原始 fps 拼 key）
    // 会把 29.969 与 29.97 当成两个档位，于是显示两条 1080P。
    const info = {
      formats: [
        { format_id: 'x1', vcodec: 'hev1.1.6.L150', height: 1080, fps: 29.969, acodec: 'none' },
        { format_id: 'x2', vcodec: 'avc1.640032', height: 1080, fps: 29.97, acodec: 'none' },
      ],
    }
    const formats = buildVideoFormats(info, false)
    expect(formats).toHaveLength(1)
    expect(formats[0].formatId).toBe('x2')
  })

  it('去重键不能退回 quality 字符串：同一 height 的标签可能不同', () => {
    // quality_label / format_note 是站点自报的文案，同一 height 完全可能被标成
    // 「1080P」与「1080p60」，按标签拼 key 就会留下两条。按 height 才稳定。
    const info = {
      formats: [
        { format_id: 'lab1', vcodec: 'avc1', height: 1080, fps: 30, acodec: 'none', format_note: '1080P' },
        { format_id: 'lab2', vcodec: 'hev1', height: 1080, fps: 30, acodec: 'none', format_note: '1080P60' },
      ],
    }
    expect(buildVideoFormats(info, false)).toHaveLength(1)
  })

  it('30fps 与 60fps 仍是两个不同选项（归一化不能把帧率档次也吃掉）', () => {
    const info = {
      formats: [
        { format_id: 'a', vcodec: 'avc1', height: 1080, fps: 30, acodec: 'none' },
        { format_id: 'b', vcodec: 'avc1', height: 1080, fps: 60, acodec: 'none' },
      ],
    }
    expect(buildVideoFormats(info, false).map(f => f.formatId)).toEqual(['b', 'a'])
  })
})

describe('normalizeFps', () => {
  it('浮点抖动归到同一档位', () => {
    expect(normalizeFps(29.969)).toBe(30)
    expect(normalizeFps(29.97)).toBe(30)
    expect(normalizeFps(59.94)).toBe(60)
    expect(normalizeFps(23.976)).toBe(24)
  })

  it('未知帧率保持原值（取整），0 表示没有信息', () => {
    expect(normalizeFps(0)).toBe(0)
    expect(normalizeFps(15)).toBe(15)
  })
})
