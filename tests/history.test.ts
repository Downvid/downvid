import { describe, it, expect } from 'vitest'
import { dedupeHistory, upsertHistory } from '../electron/history'
import type { HistoryRecord } from '../src/types'

const record = (filePath: string, id = 'first'): HistoryRecord => ({
  id, filePath, title: '视频', thumbnail: '', url: 'https://example.com/video',
  format: 'mp4', quality: '1080p', createdAt: '2026-10-14T00:00:00.000Z',
})

describe('下载历史与本地文件对应', () => {
  it('重新下载与续传完成反复写入仍只有一条记录，保留原 ID 和时间', () => {
    let history = [record('C:\\Downloads\\video.mp4')]
    for (let i = 0; i < 3; i++) {
      history = upsertHistory(history, { ...history[0]!, title: '新标题' }, `retry-${i}`, '2026-10-15', 'win32')
    }
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ id: 'first', title: '新标题', createdAt: record('').createdAt })
  })

  it('Windows 的大小写、分隔符与相对段差异不会产生重复', () => {
    const history = upsertHistory([record('C:\\Downloads\\VIDEO.mp4')], record('c:/Downloads/sub/../video.mp4'), 'second', 'later', 'win32')
    expect(history).toHaveLength(1)
    expect(history[0]?.id).toBe('first')
  })

  it('同视频保存到不同目录或不同清晰度的独立文件仍保留', () => {
    const history = [record('C:\\Downloads\\video-1080.mp4')]
    const quality = upsertHistory(history, record('C:\\Downloads\\video-720.mp4'), 'quality', 'later', 'win32')
    const directory = upsertHistory(quality, record('D:\\Videos\\video-1080.mp4'), 'directory', 'later', 'win32')
    expect(directory).toHaveLength(3)
  })

  it('整理旧历史时保留最新副本，不持久化会过期的文件状态', () => {
    const latest = { ...record('C:\\Downloads\\video.mp4', 'latest'), fileExists: false }
    expect(dedupeHistory([latest, record('c:/downloads/video.mp4', 'old')], 'win32')).toEqual([
      record('C:\\Downloads\\video.mp4', 'latest'),
    ])
  })

  it('POSIX 上保留仅大小写不同的独立路径', () => {
    expect(dedupeHistory([record('/downloads/Video.mp4'), record('/downloads/video.mp4', 'second')], 'linux')).toHaveLength(2)
  })

  it('无效旧记录被过滤，缺失本地文件的有效记录不会被自动删除', () => {
    expect(dedupeHistory([record(''), record('/downloads/missing.mp4')], 'linux')).toEqual([record('/downloads/missing.mp4')])
  })

  it('记录上限保持 100，重复更新不挤掉其他文件', () => {
    const history = Array.from({ length: 100 }, (_, i) => record(`/downloads/${i}.mp4`, String(i)))
    const updated = upsertHistory(history, history[99]!, 'unused', 'later', 'linux')
    expect(updated).toHaveLength(100)
    expect(new Set(updated.map(item => item.id)).size).toBe(100)
    expect(updated[0]?.id).toBe('99')
  })
})
