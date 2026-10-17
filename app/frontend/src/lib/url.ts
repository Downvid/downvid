/**
 * URL 提取与平台识别 —— 纯函数。
 *
 * 与后端的分工：**后端不判断平台**（它只回答「这是什么视频」），
 * 平台标识是展示层信息（平台名要翻译、host 要显示），所以在前端算。
 */
import type { PlatformId } from './types'

/** 从 URL 判断站点。只认域名片段，不解析出具体资源。 */
export function detectPlatform(url: string): PlatformId {
  const u = url.toLowerCase()
  if (u.includes('bilibili.com') || u.includes('b23.tv')) return 'bilibili'
  if (u.includes('youtu')) return 'youtube'
  if (u.includes('douyin') || u.includes('iesdouyin')) return 'douyin'
  if (u.includes('xiaohongshu')) return 'xiaohongshu'
  if (u.includes('instagram')) return 'instagram'
  if (u.includes('kuaishou')) return 'kuaishou'
  return 'other'
}

/** 平台显示名。返回 key 而不是文案——翻译在 i18n 层做。 */
export function platformName(id: PlatformId): string {
  const names: Record<PlatformId, string> = {
    bilibili: '哔哩哔哩',
    youtube: 'YouTube',
    douyin: '抖音',
    xiaohongshu: '小红书',
    instagram: 'Instagram',
    kuaishou: '快手',
    other: '其他',
  }
  return names[id]
}

/**
 * 从一段**文本**里取出 URL。
 *
 * 用户粘贴的往往是分享文案而不是干净链接：
 *
 *   7.92 复制打开抖音，看看【xxx】的作品 https://v.douyin.com/abc123/ 一起来看
 *
 * 所以先匹配具体站点的形态（能裁掉尾部的追踪参数），最后才退回任意 http(s)。
 *
 * 排除中文与中文标点是必须的：只排除汉字 `\u4e00-\u9fa5` 时，
 * `https://example.com/v/1，看看这个` 会把逗号带进 URL ——
 * 后端拿到一个不存在的地址，而错误只说「解析失败」。
 */
export function extractUrl(raw: string): string | null {
  // 去掉 GBK 乱码残留（Windows 客户端复制时常见）
  const clean = raw.replace(/锟斤拷|锟|斤|拷/g, '').trim()
  if (!clean) return null

  const patterns: RegExp[] = [
    /https:\/\/v\.douyin\.com\/[a-zA-Z0-9_-]+/i,
    /https:\/\/www\.xiaohongshu\.com\/discovery\/item\/[a-zA-Z0-9]+[^\s`]*/i,
    /https:\/\/www\.bilibili\.com\/video\/[a-zA-Z0-9]+[^\s`]*/i,
    /https:\/\/b23\.tv\/[a-zA-Z0-9]+/i,
    /https:\/\/(www\.)?(youtube\.com\/watch\?v=[a-zA-Z0-9_-]+|youtu\.be\/[a-zA-Z0-9_-]+)/i,
    /https:\/\/(www\.)?instagram\.com\/[^\s]+/i,
    // 兜底：排除中文与中日韩标点区
    /https?:\/\/[^\s\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef`]+/i,
  ]

  for (const p of patterns) {
    const match = clean.match(p)
    if (!match) continue
    const candidate = p.source.includes('youtube') && match[1] && match[2]
      ? `https://${match[1]}${match[2]}`
      : match[0]
    try {
      const parsed = new URL(candidate)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue
      return parsed.toString()
    } catch {
      continue
    }
  }
  return null
}

/**
 * 从 URL 推出 host（用于界面展示）。
 *
 * 解析失败时返回空串而不是抛错——URL 可能来自用户手输。
 */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
