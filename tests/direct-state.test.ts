import { describe, expect, it } from 'vitest'
import { canResumeDirect, createDirectSegments, matchesDirectRange } from '../electron/download/direct-state'

const resource = { url: 'https://cdn.example/video', total: 8 * 1024 * 1024 + 1, etag: '"v1"', lastModified: '' }
const checkpoint = () => ({ ...resource, segments: createDirectSegments(resource.total) })

describe('直链续传检查点', () => {
  it('分段无重叠且覆盖完整文件，小文件只用一段', () => {
    const segments = createDirectSegments(resource.total)
    expect(segments).toHaveLength(9)
    expect(segments[0].start).toBe(0)
    expect(segments.at(-1)?.end).toBe(resource.total)
    segments.slice(1).forEach((segment, i) => expect(segment.start).toBe(segments[i].end))
    expect(createDirectSegments(1024)).toEqual([{ start: 0, end: 1024, offset: 0 }])
    expect(createDirectSegments(resource.total, 1)).toHaveLength(1)
  })

  it('只接受已写入的逐段偏移，不把预分配文件当作下载完成', () => {
    const saved = checkpoint()
    saved.segments[0].offset = 16384
    expect(canResumeDirect(saved, resource, resource.total)).toBe(true)
    expect(canResumeDirect(null, resource, resource.total)).toBe(false)
    expect(canResumeDirect(saved, resource, 16384)).toBe(false)
  })

  it.each(['url', 'total', 'etag', 'lastModified'] as const)('资源 %s 变化后拒绝拼接旧片段', key => {
    const saved = checkpoint()
    const changed = { ...resource, [key]: key === 'total' ? resource.total + 1 : 'changed' }
    expect(canResumeDirect(saved, changed, resource.total)).toBe(false)
  })

  it('损坏、越界或布局错误的检查点不可续传', () => {
    expect(canResumeDirect({ ...checkpoint(), segments: [] }, resource, resource.total)).toBe(false)
    for (const offset of [-1, resource.total + 1, 0.5]) {
      const saved = checkpoint()
      saved.segments[0].offset = offset
      expect(canResumeDirect(saved, resource, resource.total)).toBe(false)
    }
    const saved = checkpoint()
    saved.segments[1].start++
    expect(canResumeDirect(saved, resource, resource.total)).toBe(false)
  })

  it('响应范围必须与请求和总长度一致', () => {
    expect(matchesDirectRange('bytes 100-199/1000', 100, 200, 1000)).toBe(true)
    for (const value of [null, 'bytes 0-199/1000', 'bytes 100-200/1000', 'bytes 100-199/999']) {
      expect(matchesDirectRange(value, 100, 200, 1000)).toBe(false)
    }
  })
})
