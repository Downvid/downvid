/**
 * URL 提取与校验 —— 纯逻辑（无框架、无 DOM）。
 *
 * ## 为什么把这段从组件里搬出来
 *
 * 旧版 `DownloadView.vue` 把这套逻辑写在视图脚本里（`extractUrl` +
 * 协议校验），于是：
 *   - 容器端要复用就得复制一份（复制就会漂移）
 *   - 无法单测（组件依赖 IPC 与 DOM）
 *   - 「分享文案里夹着链接」这种常见输入，出问题时只能手动点一遍
 *
 * 搬出来之后有 20 条用例覆盖，且两端共用同一份。
 */

/**
 * 从一段**文本**里提取 URL。
 *
 * 用户实际粘贴的往往不是干净链接，而是分享文案：
 *
 *   7.92 复制打开抖音，看看【xxx】的作品 https://v.douyin.com/abc123/ 一起来看
 *   【标题】 https://www.bilibili.com/video/BV1xx411c7mD/?share_source=copy_web
 *
 * 所以顺序很重要：**先匹配具体站点的形态**（能精准裁掉尾部的追踪参数），
 * 最后才退回「任意 http(s) URL」。
 *
 * ## 为什么清洗「锟斤拷」
 *
 * 那是 GBK → UTF-8 的经典乱码。有些 Windows 客户端复制链接时会带上，
 * 而它就夹在 URL 前面，不做处理会让整段变成无效链接。
 */
export function extractUrl(text: string): string {
  // 去掉经典乱码残留
  const clean = text.replace(/锟斤拷|锟|斤|拷/g, '').trim()
  if (!clean) return ''

  const patterns: RegExp[] = [
    // 抖音短链：唯一的形态，不会带参数
    /https:\/\/v\.douyin\.com\/[a-zA-Z0-9_-]+/i,
    // 小红书：去掉尾部空白与反引号（分享文案常用反引号包链接）
    /https:\/\/www\.xiaohongshu\.com\/discovery\/item\/[a-zA-Z0-9]+[^\s`]*/i,
    /https:\/\/www\.bilibili\.com\/video\/[a-zA-Z0-9]+[^\s`]*/i,
    /https:\/\/b23\.tv\/[a-zA-Z0-9]+/i,
    /https:\/\/(www\.)?(youtube\.com\/watch\?v=[a-zA-Z0-9_-]+|youtu\.be\/[a-zA-Z0-9_-]+)/i,
    /https:\/\/(www\.)?instagram\.com\/[^\s]+/i,
    // 兜底：任意 http(s) URL，但要**排除中文与中文标点**。
    //
    // 只排除 \u4e00-\u9fa5（汉字）不够：「，」「。」「（）」在 U+3000 区，
    // 不排除的话 `https://example.com/v/1，看看这个` 会把逗号带进 URL，
    // 后端拿到的是一个不存在的地址——而错误信息只会说「解析失败」。
    /https?:\/\/[^\s\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]+/i,
  ]

  for (const p of patterns) {
    const match = clean.match(p)
    if (!match) continue
    // YouTube 的匹配里有两层捕获组，拼回去
    if (p.source.includes('youtube') && match[1] && match[2]) {
      return `https://${match[1]}${match[2]}`
    }
    return match[0]
  }
  return clean
}

/** 校验结果：空串表示通过，否则是 i18n 词条的键 */
export type UrlError = '' | 'download.invalidLink' | 'download.badProtocol'

/**
 * 校验 URL 能否解析。
 *
 * 返回**词条键**而不是文案：调用方决定怎么展示（桌面弹窗 / 容器内联提示）。
 * 直接返回中文会让这个函数把文案硬编码进来，i18n 就漏了。
 */
export function validateUrl(raw: string): UrlError {
  const url = extractUrl(raw)
  if (!url) return 'download.invalidLink'

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'download.invalidLink'
  }

  // 只接受 http(s)：file:// / javascript: 之类既下不了，也可能是用户被误导
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'download.badProtocol'
  }
  return ''
}

/**
 * 把后端的原始错误转成可行动的说明。
 *
 * 后端会给带标记的消息（`[[parse-error:network]]` / `[[deps-missing:yt-dlp]]`），
 * 这里只做**最小**归一化：把标记去掉、保留人类可读的部分。
 * 真正的分类在 Go 侧（`internal/parse`），前端不重复实现——两处各判一次
 * 必然漂移。
 */
export function describeParseError(raw: string): string {
  if (!raw) return ''

  // `[[parse-error:xxx]]具体说明\n\n提示：...` —— 去掉标记，保留说明
  let text = raw
    .replace(/\[\[parse-error:[\w-]+\]\]/g, '')
    .replace(/\[\[deps-missing:[\w-]+\]\]/g, '')
    .trim()

  // 多行说明只取前两行：错误弹窗里塞十行日志没人看
  const lines = text.split('\n').filter((l) => l.trim())
  if (lines.length > 2) text = lines.slice(0, 2).join('\n')

  return text || raw
}

/** 从 URL 判断平台（用于决定要不要显示 Cookie 提示） */
export function platformOf(url: string): 'youtube' | 'bilibili' | 'douyin' | 'kuaishou' | 'other' {
  const u = url.toLowerCase()
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube'
  if (u.includes('bilibili.com') || u.includes('b23.tv')) return 'bilibili'
  if (u.includes('douyin.com')) return 'douyin'
  if (u.includes('kuaishou.com')) return 'kuaishou'
  return 'other'
}
