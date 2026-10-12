import { describe, it, expect } from 'vitest'
import { isCookieError } from '../electron/utils/cookies'

/**
 * cookie 读取失败的识别。
 *
 * 这个判定决定「解析/下载是该换下一个 cookie 来源，还是直接失败」，
 * 出错的两个方向都有实际代价：
 *  - 漏判（把读取失败当真实错误）→ 整个解析失败，用户看到无关的报错
 *  - 误判（把真实错误当读取失败）→ 白白重试所有来源，把真正的错误信息淹没
 *
 * 因此每条用例都对应一个真实出现过的错误串。
 */
const ERROR = (msg: string) => `ERROR: ${msg}`

describe('isCookieError', () => {
  it('识别 macOS 上 Safari 的权限失败（需完全磁盘访问）', () => {
    // 实际报错：未授予权限时读不了 Safari 的 cookie 容器
    const stderr = ERROR("Operation not permitted: '/Users/mac/Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies'")
    expect(isCookieError(stderr)).toBe(true)
  })

  it('识别 Chrome 找不到 cookie 库', () => {
    expect(isCookieError(ERROR('could not find chrome cookies database in "/Users/x/Application Support/Google/Chrome"'))).toBe(true)
  })

  it('识别 Windows 上的解密失败', () => {
    expect(isCookieError(ERROR('Failed to decrypt with DPAPI'))).toBe(true)
  })

  it('识别 cookie 库被锁（浏览器运行中）', () => {
    expect(isCookieError(ERROR('Could not copy Chrome cookie database'))).toBe(true)
    expect(isCookieError(ERROR('unable to open database file'))).toBe(true)
  })

  it('识别 keyring / keychain 类失败', () => {
    expect(isCookieError(ERROR('Keyring Error: keychain not available'))).toBe(true)
  })

  it('识别 general 权限失败（Linux 上的文件权限）', () => {
    expect(isCookieError(ERROR('Permission denied: /home/x/.mozilla/firefox/cookies.sqlite'))).toBe(true)
  })

  it('不把「需要登录」当成读取失败——换来源没有意义', () => {
    const stderr = ERROR('Use --cookies-from-browser or --cookies for the authentication. See --help for more information')
    expect(isCookieError(stderr)).toBe(false)
  })

  it('不把视频本身的错误当成 cookie 问题', () => {
    expect(isCookieError(ERROR('[youtube] dQw4w9WgXcQ: Video unavailable'))).toBe(false)
    expect(isCookieError(ERROR('Unsupported URL: https://example.com/x'))).toBe(false)
    expect(isCookieError(ERROR('HTTP Error 429: Too Many Requests'))).toBe(false)
  })

  it('非 ERROR 行不参与判定（yt-dlp 会把提示写在其他行）', () => {
    expect(isCookieError('WARNING: Operation not permitted')).toBe(false)
  })

  it('多行输出中任意一行命中即判定为 cookie 错误', () => {
    const stderr = [
      'WARNING: something',
      'ERROR: Operation not permitted: /path/Cookies.binarycookies',
    ].join('\n')
    expect(isCookieError(stderr)).toBe(true)
  })
})
