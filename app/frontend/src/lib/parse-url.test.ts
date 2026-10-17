import { describe, it, expect } from 'vitest'
import { extractUrl, validateUrl, describeParseError, platformOf } from './parse-url'

/**
 * URL 提取与校验。
 *
 * 用户粘贴的很少是干净链接，而是分享文案。这里覆盖的都是真实形态：
 * 抖音的短链、B 站的分享参数、B 站被反引号包住的链接、Windows 客户端
 * 带出来的 GBK 乱码。
 */

describe('extractUrl', () => {
  it('从抖音分享文案里提取短链', () => {
    const text = '7.92 复制打开抖音，看看【某某】的作品 https://v.douyin.com/abc123/ 一起来看'
    expect(extractUrl(text)).toBe('https://v.douyin.com/abc123')
  })

  it('从 B 站分享文案里提取，并保留必要参数', () => {
    const text = '【标题】 https://www.bilibili.com/video/BV1xx411c7mD/?share_source=copy_web'
    expect(extractUrl(text)).toBe('https://www.bilibili.com/video/BV1xx411c7mD/?share_source=copy_web')
  })

  it('去掉包住链接的反引号', () => {
    // 分享文案里常用反引号包链接，不处理会让 URL 尾部带上反引号
    const text = '`https://www.bilibili.com/video/BV1xx411c7mD/`'
    expect(extractUrl(text)).not.toContain('`')
  })

  it('清洗 GBK 乱码（Windows 客户端常见）', () => {
    const text = '锟斤拷https://www.youtube.com/watch?v=abc123'
    expect(extractUrl(text)).toBe('https://www.youtube.com/watch?v=abc123')
  })

  it('YouTube 两种域名都认，且拼回完整 URL', () => {
    expect(extractUrl('看这个 https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    )
    expect(extractUrl('https://youtu.be/dQw4w9WgXcQ')).toBe('https://youtu.be/dQw4w9WgXcQ')
  })

  it('未知站点退回「任意 http(s) URL」', () => {
    expect(extractUrl('看看 https://example.com/v/1 这个')).toBe('https://example.com/v/1')
  })

  it('不认识中文标点（不能把后面的中文当成 URL 一部分）', () => {
    const text = 'https://example.com/v/1，看看这个'
    expect(extractUrl(text)).toBe('https://example.com/v/1')
  })

  it('空输入返回空串', () => {
    expect(extractUrl('')).toBe('')
    expect(extractUrl('   ')).toBe('')
  })

  it('纯文本（没有链接）原样返回，交给校验去判无效', () => {
    expect(extractUrl('这不是链接')).toBe('这不是链接')
  })
})

describe('validateUrl', () => {
  it('合法链接通过（返回空串）', () => {
    expect(validateUrl('https://example.com/v')).toBe('')
    expect(validateUrl('http://example.com/v')).toBe('')
  })

  it('空输入 / 纯文本 → invalidLink', () => {
    expect(validateUrl('')).toBe('download.invalidLink')
    expect(validateUrl('这不是链接')).toBe('download.invalidLink')
  })

  it('非 http(s) 协议 → badProtocol', () => {
    // file:// 与 javascript: 既下不了，也可能是用户被误导
    expect(validateUrl('file:///etc/passwd')).toBe('download.badProtocol')
    expect(validateUrl('javascript:alert(1)')).toBe('download.badProtocol')
  })

  it('返回的是**词条键**而不是文案（i18n 不硬编码）', () => {
    // 直接返回中文会让这个函数把文案硬编码进来，i18n 就漏了
    const err = validateUrl('这不是链接')
    expect(err.startsWith('download.')).toBe(true)
  })
})

describe('describeParseError', () => {
  it('去掉后端的标记，保留说明', () => {
    const raw = '[[parse-error:network]]网络请求失败或超时\n\n提示：检查连接'
    const got = describeParseError(raw)
    expect(got).not.toContain('[[')
    expect(got).toContain('网络请求失败或超时')
  })

  it('去掉依赖缺失标记', () => {
    const raw = '[[deps-missing:yt-dlp]]未找到可用的 yt-dlp'
    expect(describeParseError(raw)).not.toContain('[[')
  })

  it('多行说明只留前两行（弹窗里塞十行没人看）', () => {
    const raw = '第一行\n第二行\n第三行\n第四行'
    const got = describeParseError(raw)
    expect(got.split('\n')).toHaveLength(2)
  })

  it('空输入返回空串', () => {
    expect(describeParseError('')).toBe('')
  })
})

describe('platformOf', () => {
  it('识别四个平台', () => {
    expect(platformOf('https://www.youtube.com/watch?v=x')).toBe('youtube')
    expect(platformOf('https://youtu.be/x')).toBe('youtube')
    expect(platformOf('https://www.bilibili.com/video/BV1')).toBe('bilibili')
    expect(platformOf('https://b23.tv/x')).toBe('bilibili')
    expect(platformOf('https://v.douyin.com/x')).toBe('douyin')
    expect(platformOf('https://www.kuaishou.com/short-video/x')).toBe('kuaishou')
  })

  it('其他站点返回 other（决定要不要显示 Cookie 提示）', () => {
    expect(platformOf('https://example.com/v')).toBe('other')
  })
})
