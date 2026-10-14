import { describe, it, expect } from 'vitest'
import {
  shouldIgnoreProgress,
  statusAfterResult,
  shouldRecordHistory,
  selectStartableTasks,
  isActiveStatus,
  retryReset,
  MAX_CONCURRENT_DOWNLOADS,
} from '../src/stores/download-rules'

/**
 * 下载状态流转规则。
 *
 * 每条规则都对应一个用户反馈的真实 bug：
 *  - 点暂停后按钮消失、只能重新下载
 *  - 暂停/重试/失败都在下载历史里留下记录
 *
 * 注意这些用例引用的是 store **实际使用**的那份实现（download-rules.ts），
 * 不是复刻的逻辑——复刻的测试不会随实现变化而失败，等于没测。
 */
describe('已暂停任务的进度事件', () => {
  it('一律忽略，包括 completed', () => {
    // 主进程 kill 子进程时可能残留一条结束事件；照单全收会把任务标成已完成
    expect(shouldIgnoreProgress(true)).toBe(true)
  })

  it('未暂停时不忽略', () => {
    expect(shouldIgnoreProgress(false)).toBe(false)
  })
})

describe('下载结束后的状态', () => {
  it('主进程返回 paused → paused（而不是 completed）', () => {
    expect(statusAfterResult({ paused: true })).toBe('paused')
  })

  it('暂停且带着半成品路径时仍是 paused', () => {
    // 暂停时 main 会返回已写入的 .part 路径，不能因此当成完成
    expect(statusAfterResult({ paused: true, filePath: '/tmp/x.mp4.part' })).toBe('paused')
  })

  it('正常结束 → completed', () => {
    expect(statusAfterResult({ filePath: '/tmp/x.mp4' })).toBe('completed')
  })
})

describe('是否写入下载历史', () => {
  it('暂停不写', () => {
    expect(shouldRecordHistory({ paused: true, filePath: '/tmp/x.part' })).toBe(false)
  })

  it('没有产物路径不写（失败、被取消）', () => {
    expect(shouldRecordHistory({})).toBe(false)
    expect(shouldRecordHistory({ filePath: '' })).toBe(false)
    expect(shouldRecordHistory({ filePath: undefined })).toBe(false)
  })

  it('真正下到文件才写', () => {
    expect(shouldRecordHistory({ filePath: '/Users/x/Downloads/a.mp4' })).toBe(true)
  })
})

/**
 * 任务级并发闸门。
 *
 * 对应的问题：用户连点几次「下载」会有多个任务同时跑，每个再开 8～16 路分块，
 * 互相抢带宽——表现为「每一个都变慢」，很难在真机上归因，必须靠用例钉住。
 */
describe('队列并发闸门', () => {
  const task = (id: string, status: string, createdAt: string) => ({ id, status, createdAt })

  it('空闲时最多放出 MAX_CONCURRENT_DOWNLOADS 个', () => {
    const tasks = [
      task('a', 'pending', '2026-01-01T00:00:01Z'),
      task('b', 'pending', '2026-01-01T00:00:02Z'),
      task('c', 'pending', '2026-01-01T00:00:03Z'),
      task('d', 'pending', '2026-01-01T00:00:04Z'),
      task('e', 'pending', '2026-01-01T00:00:05Z'),
    ]
    expect(selectStartableTasks(tasks)).toHaveLength(MAX_CONCURRENT_DOWNLOADS)
  })

  it('已有任务在跑时，只补满剩余槽位', () => {
    const tasks = [
      task('running1', 'downloading', '2026-01-01T00:00:00Z'),
      task('running2', 'downloading', '2026-01-01T00:00:00Z'),
      task('a', 'pending', '2026-01-01T00:00:01Z'),
      task('b', 'pending', '2026-01-01T00:00:02Z'),
    ]
    // 3 - 2 = 1 个槽位，只放出最早排队的那个
    expect(selectStartableTasks(tasks)).toEqual(['a'])
  })

  it('merging 也占槽位（ffmpeg 同样在抢 CPU 与磁盘）', () => {
    const tasks = [
      task('m', 'merging', '2026-01-01T00:00:00Z'),
      task('a', 'pending', '2026-01-01T00:00:01Z'),
    ]
    expect(selectStartableTasks(tasks, 1)).toEqual([])
  })

  it('槽位占满时不再放出任何任务（这正是「连点变慢」的根因）', () => {
    const tasks = [
      task('r1', 'downloading', '2026-01-01T00:00:00Z'),
      task('r2', 'downloading', '2026-01-01T00:00:00Z'),
      task('r3', 'downloading', '2026-01-01T00:00:00Z'),
      task('a', 'pending', '2026-01-01T00:00:01Z'),
    ]
    expect(selectStartableTasks(tasks)).toEqual([])
  })

  it('先进先出：先加进队列的先下载', () => {
    const tasks = [
      task('later', 'pending', '2026-01-01T00:00:09Z'),
      task('earlier', 'pending', '2026-01-01T00:00:01Z'),
      task('middle', 'pending', '2026-01-01T00:00:05Z'),
    ]
    expect(selectStartableTasks(tasks, 1)).toEqual(['earlier'])
  })

  it('暂停 / 失败 / 已完成的任务不会被调度', () => {
    const tasks = [
      task('p', 'paused', '2026-01-01T00:00:01Z'),
      task('e', 'error', '2026-01-01T00:00:02Z'),
      task('c', 'completed', '2026-01-01T00:00:03Z'),
    ]
    expect(selectStartableTasks(tasks)).toEqual([])
  })

  it('没有排队任务时返回空', () => {
    expect(selectStartableTasks([task('r', 'downloading', '2026-01-01T00:00:00Z')])).toEqual([])
  })

  it('isActiveStatus 只认真正在占用资源的两个状态', () => {
    expect(isActiveStatus('downloading')).toBe(true)
    expect(isActiveStatus('merging')).toBe(true)
    expect(isActiveStatus('pending')).toBe(false)
    expect(isActiveStatus('paused')).toBe(false)
    expect(isActiveStatus('error')).toBe(false)
    expect(isActiveStatus('completed')).toBe(false)
  })
})

describe('失败任务的重试', () => {
  it('回到 pending，而不是停在 error', () => {
    // 停在 error 上不会被队列调度，用户点「重试」看起来毫无反应
    expect(retryReset().status).toBe('pending')
  })

  it('清掉上次的错误与进度，避免看起来像在续传', () => {
    const reset = retryReset()
    expect(reset.progress).toBe(0)
    expect(reset.error).toBeUndefined()
    expect(reset.speed).toBeUndefined()
    expect(reset.eta).toBeUndefined()
  })
})
