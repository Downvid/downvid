export interface DirectResource {
  url: string
  total: number
  etag: string
  lastModified: string
}

export interface DirectSegment {
  start: number
  end: number
  offset: number
}

export interface DirectCheckpoint extends DirectResource {
  segments: DirectSegment[]
}

export function createDirectSegments(total: number, connections = 8): DirectSegment[] {
  const unit = 1024 * 1024
  // 多个小块由固定数量的工作连接领取，快连接不必等待慢连接的大段。
  const size = connections <= 1 ? total : Math.max(unit, Math.ceil(total / Math.min(4096, connections * 8) / unit) * unit)
  const count = Math.ceil(total / size)
  return Array.from({ length: count }, (_, i) => ({ start: i * size, end: Math.min(total, (i + 1) * size), offset: i * size }))
}

/** 文件预分配不能证明下载进度，只接受同一资源的逐段检查点。 */
export function canResumeDirect(value: unknown, resource: DirectResource, fileSize: number): value is DirectCheckpoint {
  const saved = value as DirectCheckpoint | null
  if (!saved || saved.url !== resource.url || saved.total !== resource.total || fileSize !== resource.total
    || saved.etag !== resource.etag || saved.lastModified !== resource.lastModified || !Array.isArray(saved.segments)) return false
  // 接受旧版本的四段布局及暂停前的连接配置，不能因设置变化丢失进度。
  return saved.segments.length > 0 && saved.segments.length <= 4096 && saved.segments.every((segment, i) =>
    segment && segment.start === (i === 0 ? 0 : saved.segments[i - 1]?.end)
    && Number.isSafeInteger(segment.start) && Number.isSafeInteger(segment.end)
    && segment.end > segment.start && segment.end <= resource.total
    && (i !== saved.segments.length - 1 || segment.end === resource.total)
    && Number.isSafeInteger(segment.offset) && segment.offset >= segment.start && segment.offset <= segment.end)
}

export function matchesDirectRange(header: string | null, start: number, end: number, total: number): boolean {
  return header === `bytes ${start}-${end - 1}/${total}`
}
