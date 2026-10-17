/**
 * 公告 = 作者的话，不是更新日志。
 *
 * 内容源文件：
 *   app/frontend/demo/announcements/author.zh.md
 *   app/frontend/demo/announcements/author.en.md
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
import { REPO_URL } from './mock'
import type { Locale } from './i18n.svelte'

export interface AnnouncementBlock {
  type: 'p' | 'h2' | 'li'
  text: string
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

export function parseAnnouncement(raw: string): AnnouncementDoc {
  const { meta, body } = parseFrontmatter(raw)
  const blocks: AnnouncementBlock[] = []
  const paragraph: string[] = []
  const flush = (): void => {
    if (paragraph.length) {
      blocks.push({ type: 'p', text: paragraph.join(' ').trim() })
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
      blocks.push({ type: 'h2', text: line.slice(3).trim() })
      continue
    }
    if (line.startsWith('- ')) {
      flush()
      blocks.push({ type: 'li', text: line.slice(2).trim() })
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

const REPO_PATH = REPO_URL.replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '')

function mirrorSources(locale: Locale): string[] {
  const lang = locale === 'zh-CN' ? 'zh' : 'en'
  const path = 'app/frontend/demo/announcements/author.' + lang + '.md'
  const raw = 'https://raw.githubusercontent.com/' + REPO_PATH + '/main/' + path
  return [
    raw,
    'https://cdn.jsdelivr.net/gh/' + REPO_PATH + '@main/' + path,
    'https://ghproxy.com/' + raw,
  ]
}

/**
 * 真实接入：按镜像链拉取公告，全失败才退回本地。
 * 演示没有调用它（避免首屏被网络拖慢/离线时干等）。
 */
export async function fetchAnnouncement(
  locale: Locale,
  fetcher: typeof fetch = fetch,
): Promise<AnnouncementDoc> {
  for (const url of mirrorSources(locale)) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(4000) })
      if (!response.ok) continue
      const text = await response.text()
      if (text.trim()) return parseAnnouncement(text)
    } catch {
      // 这一跳失败，继续下一跳；最后用本地文件兜底
    }
  }
  return loadLocalAnnouncement(locale)
}
