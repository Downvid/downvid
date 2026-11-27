import { describe, expect, it } from 'vitest'
import { applyDepInstallEvent, totalDepInstallProgress } from './dep-install-progress'
import type { DepItem } from './types'

const dep = (id: string, busy = false): DepItem => ({
  id, name: id, busy, progress: 0, status: 'missing', found: false, required: true, optional: false,
})

describe('依赖并行进度', () => {
  it('交错事件只更新对应且正在下载的行，不串到其他进度', () => {
    let rows = [dep('yt-dlp', true), dep('ffmpeg', true), dep('aria2')]
    rows = applyDepInstallEvent(rows, { event: 'progress', tool: 'yt-dlp', downloaded: 25, total: 100 })
    rows = applyDepInstallEvent(rows, { event: 'progress', tool: 'ffmpeg', downloaded: 48, total: 60 })
    rows = applyDepInstallEvent(rows, { event: 'installed', tool: 'aria2' })
    expect(applyDepInstallEvent(rows, { event: 'progress', downloaded: 9, total: 10 })).toBe(rows)
    expect(applyDepInstallEvent(rows, { event: 'progress', tool: 'yt-dlp', downloaded: 9 })).toBe(rows)
    expect(rows.map(({ busy, progress }) => [busy, progress])).toEqual([
      [true, 0.25], [true, 0.8], [false, 0],
    ])
  })

  it('批量进度计入已排队的依赖，完成一项或失败不清空其他项', () => {
    const batch = new Map<string, number>()
    let rows = [dep('yt-dlp'), dep('ffmpeg'), dep('ffprobe')]
    expect(totalDepInstallProgress(batch)).toBe(0)
    for (const row of rows) rows = applyDepInstallEvent(rows, { event: 'start', tool: row.id }, batch)
    rows = applyDepInstallEvent(rows, { event: 'progress', tool: 'ffmpeg', downloaded: 5, total: 10 }, batch)
    rows = applyDepInstallEvent(rows, { event: 'installed', tool: 'yt-dlp' }, batch)
    expect(applyDepInstallEvent(rows, { event: 'error', tool: 'ffprobe' }, batch)).toBe(rows)
    expect(rows.every((row) => row.busy)).toBe(true)
    expect(totalDepInstallProgress(batch)).toBe(0.5)
  })
})
