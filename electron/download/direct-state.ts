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

export function createDirectSegments(total: number): DirectSegment[] {
  const count = Math.max(1, Math.min(4, Math.floor(total / (2 * 1024 * 1024))))
  const size = Math.ceil(total / count)
  return Array.from({ length: count }, (_, i) => ({ start: i * size, end: Math.min(total, (i + 1) * size), offset: i * size }))
}

/** 文件预分配不能证明下载进度，只接受同一资源的逐段检查点。 */
export function canResumeDirect(value: unknown, resource: DirectResource, fileSize: number): value is DirectCheckpoint {
  const saved = value as DirectCheckpoint | null
  if (!saved || saved.url !== resource.url || saved.total !== resource.total || fileSize !== resource.total
    || saved.etag !== resource.etag || saved.lastModified !== resource.lastModified || !Array.isArray(saved.segments)) return false
  const expected = createDirectSegments(resource.total)
  return saved.segments.length === expected.length && saved.segments.every((segment, i) =>
    segment && segment.start === expected[i].start && segment.end === expected[i].end
    && Number.isSafeInteger(segment.offset) && segment.offset >= segment.start && segment.offset <= segment.end)
}

export function matchesDirectRange(header: string | null, start: number, end: number, total: number): boolean {
  return header === `bytes ${start}-${end - 1}/${total}`
}
