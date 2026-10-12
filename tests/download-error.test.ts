import { describe, it, expect } from 'vitest'
import { friendlyDownloadError } from '../src/stores/download'

/**
 * 下载错误的用户可读翻译。
 *
 * 背景：用户下载时看到队列里直接显示
 * `ERROR: unable to download video data: HTTP Error 403: Forbidden`
 * ——403 此前完全没有归类，原始字符串就透传到了界面上。
 * 这些用例用 yt-dlp 的真实输出串，而不是编造的简化版。
 */
describe('friendlyDownloadError', () => {
  it('把 403 翻译成可行动的建议（真实串）', () => {
    const raw = 'ERROR: unable to download video data: HTTP Error 403: Forbidden'
    const msg = friendlyDownloadError(raw)
    expect(msg).toContain('403')
    expect(msg).not.toContain('unable to download video data')
    expect(msg).toMatch(/重试|Cookie/)
  })

  it('403 且提示需要登录时，指向 Cookie 设置', () => {
    const raw = 'ERROR: HTTP Error 403: Forbidden. Sign in to confirm you are not a bot'
    expect(friendlyDownloadError(raw)).toContain('Cookies')
  })

  it('403 不会被误判成网络中断（判断顺序）', () => {
    expect(friendlyDownloadError('HTTP Error 403: Forbidden')).not.toContain('网络连接中断')
  })

  it('429 仍按原来的文案处理', () => {
    expect(friendlyDownloadError('ERROR: HTTP Error 429: Too Many Requests')).toContain('429')
  })

  it('其余各类仍然正确归类', () => {
    expect(friendlyDownloadError('ERROR: [Errno 28] No space left on device')).toBe('磁盘空间不足')
    expect(friendlyDownloadError('ERROR: Permission denied: /out/x.mp4')).toContain('写入权限')
    expect(friendlyDownloadError('ERROR: [youtube] x: Video unavailable')).toContain('视频不可用')
    expect(friendlyDownloadError('ERROR: unable to download webpage')).toContain('代理')
  })

  it('无法归类时原样返回，不吞掉信息', () => {
    const raw = 'ERROR: 某个我们不认识的新错误'
    expect(friendlyDownloadError(raw)).toBe(raw)
  })

  it('空输入不抛错', () => {
    expect(friendlyDownloadError('')).toBe('')
  })
})
