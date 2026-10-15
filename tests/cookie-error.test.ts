import { describe, it, expect } from 'vitest'
import { isCookieError, runWithCookies, type CookieAttempt } from '../electron/utils/cookies'

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

  it('识别 Cookie 库读不出表结构（issue #53）', () => {
    // #53 的原始报错：yt-dlp 挑中的 Cookies 文件里没有 meta 表（空库就是这样）。它只打出 sqlite3 的
    // 原始异常；又因为同时传了 --cookies，退出保存时会再加载一次，所以同一行出现两遍
    const stderr = [ERROR('no such table: meta'), ERROR('no such table: meta')].join('\n')
    expect(isCookieError(stderr)).toBe(true)
  })

  it('识别 Cookie 库不是可读 SQLite 的其他形态', () => {
    // 都是真实 yt-dlp 读同类坏库的输出：Firefox 的空库、根本不是 SQLite 的文件、拷贝时损坏的库
    expect(isCookieError(ERROR('no such table: moz_cookies'))).toBe(true)
    expect(isCookieError(ERROR('file is not a database'))).toBe(true)
    expect(isCookieError(ERROR('database disk image is malformed'))).toBe(true)
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

/**
 * 识别之后要真的换来源。#53 里第一个浏览器的报错没被识别，整个解析直接以
 * `no such table: meta` 失败，后面的浏览器、快照和「不带 Cookie」一个都没轮到。
 */
describe('runWithCookies', () => {
  it('浏览器 Cookie 库读不出来时换下一个来源，而不是整个解析失败（issue #53）', async () => {
    const tried: string[] = []
    const failed: string[] = []
    const attempt = (label: string): CookieAttempt => ({
      label,
      prepare: () => (label === 'none' ? [] : ['--cookies-from-browser', label]),
      onSuccess: () => {},
      onCookieFailure: () => { failed.push(label) },
      cleanup: () => {},
    })
    const result = await runWithCookies([attempt('chrome'), attempt('none')], async (_args, { label }) => {
      tried.push(label)
      return label === 'chrome'
        ? { code: 1, stderr: 'ERROR: no such table: meta\nERROR: no such table: meta\n' }
        : { code: 0, stderr: '' }
    })
    expect(tried).toEqual(['chrome', 'none'])
    // 记为读取失败，接下来十分钟跳过这个浏览器，不再反复撞同一个坏库
    expect(failed).toEqual(['chrome'])
    expect(result.code).toBe(0)
  })
})
