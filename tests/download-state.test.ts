import { describe, it, expect } from 'vitest'
import { shouldIgnoreProgress, statusAfterResult, shouldRecordHistory } from '../src/stores/download-rules'

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
