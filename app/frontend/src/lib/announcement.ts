/**
 * 公告 = 作者的话，不是更新日志。
 *
 * 内容源文件：
 *   app/frontend/src/announcements/author.zh.md
 *   app/frontend/src/announcements/author.en.md
 *
 * 正式应用里公告从远端读取，并且要做镜像降级——国内直连
 * raw.githubusercontent.com 经常超时/404，如果只有这一条路，用户会永远
 * 看不到作者写了什么（和更新通道坏掉是同一类问题）。
 *
 * 读取顺序（任一成功即停止）：
 *   1. GitHub raw
 *   2. jsDelivr（CDN 镜像）
 *   3. gh-proxy（公共反代）
 *   4. 上面全挂 → 使用构建时打进包里的 md（离线兜底）
 *
 * 演示为了离线可靠，直接用打包内置文件；fetchAnnouncement() 保留给真实接入。
 */
import authorZh from '../announcements/author.zh.md?raw'
import authorEn from '../announcements/author.en.md?raw'
import type { Locale } from './i18n.svelte'
import { mirrorUrls } from './remote'

/**
 * 行内片段：普通文字或链接。
 *
 * 公告正文原来只当纯文本渲染，于是 `[文字](https://…)` 会原样显示成一串
 * Markdown，用户点不了。这里把链接拆出来单独渲染，正文其余部分仍按纯文本走
 * （不引入完整 Markdown 渲染器：公告是我们自己写的，不需要那份复杂度，
 * 也不值得为此多一个 XSS 面）。
 */
export interface AnnouncementSpan {
  text: string
  /** 非空表示这一段是链接（只接受 http/https） */
  href?: string
}

export interface AnnouncementBlock {
  type: 'p' | 'h2' | 'li'
  /** 纯文本形式（保留给测试与无障碍读取） */
  text: string
  /** 行内片段，界面按段渲染以便链接可点 */
  spans?: AnnouncementSpan[]
}

export interface AnnouncementDoc {
  title: string
  date: string
  signature: string
  blocks: AnnouncementBlock[]
}

const LOCAL_SOURCES: Record<Locale, string> = {
  'zh-CN': authorZh,
  'en-US': authorEn,
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const text = raw.replace(/\r\n/g, '\n')
  const lines = text.split('\n')
  if (lines[0]?.trim() !== '---') return { meta: {}, body: text }
  const meta: Record<string, string> = {}
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      return { meta, body: lines.slice(i + 1).join('\n') }
    }
    const match = lines[i].match(/^([\w-]+):\s*(.*)$/)
    if (match) meta[match[1]] = match[2].trim()
  }
  return { meta, body: text }
}

/**
 * 把一行文字拆成「文字 + 链接」片段。
 *
 * 只认 `[文字](url)` 这一种形态，且 url 必须是 http(s)。
 * 不是 http(s) 的一律当普通文字——公告内容会被渲染进界面，
 * 放行 `javascript:` 等于给公告文件一个注入点。
 */
export function parseSpans(line: string): AnnouncementSpan[] {
  const spans: AnnouncementSpan[] = []
  const re = /\[([^\]]+)\]\(([^)\s]+)\)/g
  let last = 0
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) spans.push({ text: line.slice(last, m.index) })
    const href = m[2]
    if (/^https?:\/\//i.test(href)) {
      spans.push({ text: m[1], href })
    } else {
      // 不安全的协议：原样保留成文字，不生成链接
      spans.push({ text: m[0] })
    }
    last = m.index + m[0].length
  }
  if (last < line.length) spans.push({ text: line.slice(last) })
  return spans.length ? spans : [{ text: line }]
}

export function parseAnnouncement(raw: string): AnnouncementDoc {
  const { meta, body } = parseFrontmatter(raw)
  const blocks: AnnouncementBlock[] = []
  const paragraph: string[] = []
  const flush = (): void => {
    if (paragraph.length) {
      const text = paragraph.join(' ').trim()
      blocks.push({ type: 'p', text, spans: parseSpans(text) })
      paragraph.length = 0
    }
  }

  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      flush()
      continue
    }
    if (line.startsWith('## ')) {
      flush()
      const text = line.slice(3).trim()
      blocks.push({ type: 'h2', text, spans: parseSpans(text) })
      continue
    }
    if (line.startsWith('- ')) {
      flush()
      const text = line.slice(2).trim()
      blocks.push({ type: 'li', text, spans: parseSpans(text) })
      continue
    }
    paragraph.push(line)
  }
  flush()

  return {
    title: meta.title || 'Announcement',
    date: meta.date || '',
    signature: meta.signature || '',
    blocks,
  }
}

export function loadLocalAnnouncement(locale: Locale): AnnouncementDoc {
  return parseAnnouncement(LOCAL_SOURCES[locale] ?? LOCAL_SOURCES['zh-CN'])
}

/**
 * 公告的三级镜像链（GitHub raw → jsDelivr → 公共反代）。
 *
 * 镜像为什么这么多、为什么不能只靠 GitHub raw：见 `remote.ts`。
 * 这里只负责把「语言」拼成仓库里的路径。
 */
export function mirrorSources(locale: Locale): string[] {
  const lang = locale === 'zh-CN' ? 'zh' : 'en'
  return mirrorUrls('announcements/author.' + lang + '.md')
}

/**
 * 判断拿到的是不是一篇公告，而不是代理的错误页 / 首页 HTML。
 *
 * 必须有这条：公共代理失效时**不会报错**，而是返回 200 + 一段 HTML。
 * 只看 `response.ok` 的话，用户会看到「标题是 `<html lang="">`」的公告，
 * 而且那个结果还会被当成「远端成功」缓存下来，不显示离线标记。
 *
 * 判据刻意宽松（公告是 Markdown，可能以 `---` frontmatter 或 `#` 开头）：
 *   - 出现 HTML 文档特征（`<!doctype` / `<html`）→ 不是公告
 *   - 出现路径相对引用（如 `../`）→ 不是公告（可能是未展开的 symlink）
 *   - 长度太短（< 20 字符）→ 基本是错误页
 */
function looksLikeMarkdown(text: string): boolean {
  const head = text.trimStart().slice(0, 200).toLowerCase()
  if (head.startsWith('<!doctype') || head.startsWith('<html')) return false
  if (head.startsWith('../') || head.startsWith('./')) return false
  return text.trim().length >= 20 && (text.includes('---') || text.includes('## ') || text.includes('\n\n'))
}

/**
 * 按镜像链拉取公告，全失败才退回本地；并**如实报告内容来自哪里**。
 *
 * 返回 `source: 'remote'` 说明拿到的是远端最新内容；`'local'` 说明
 * 三级镜像全挂、用了打包时那份副本。
 *
 * ## 为什么要返回来源而不是只返回文档
 *
 * 早先只返回 `AnnouncementDoc`，调用方**无法区分**「远端拿到的」
 * 与「本地兜底」——两者都是合法的文档对象。于是界面没法如实告诉用户
 * 「你看到的是离线副本，作者可能更新了」，用户会以为作者很久没写东西。
 */
export interface AnnouncementFetchResult {
  doc: AnnouncementDoc
  source: 'remote' | 'local'
  /** 命中的镜像 URL（source 为 local 时为空） */
  via?: string
}

export async function fetchAnnouncement(
  locale: Locale,
  fetcher: typeof fetch = fetch,
): Promise<AnnouncementFetchResult> {
  for (const url of mirrorSources(locale)) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(4000) })
      if (!response.ok) continue
      const text = await response.text()
      // 内容不像公告就跳过这一跳（代理可能返回 200 + 首页 HTML）
      if (looksLikeMarkdown(text)) {
        return { doc: parseAnnouncement(text), source: 'remote', via: url }
      }
    } catch {
      // 这一跳失败，继续下一跳；最后用本地文件兜底
    }
  }
  return { doc: loadLocalAnnouncement(locale), source: 'local' }
}
