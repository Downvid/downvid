// 贡献者统计：GitHub /contributors 接口不含匿名作者，也完全不统计 Co-authored-by 署名，
// 这里合并 contributors(anon=1) 与提交记录中的共同作者，得到完整名单

import { DEVELOPER_LOGINS } from '../../shared/app'

export interface Contributor {
  login: string
  avatarUrl: string
  htmlUrl: string
  contributions: number
  isBot: boolean
  isAI: boolean
  isDeveloper: boolean
  /** 真人贡献者（非 Bot、非 AI）：界面据此打 CONTRIBUTOR 标 */
  isContributor: boolean
}


// 常见 AI 编程助手的共同作者邮箱 → 展示信息（头像取对应组织的 GitHub 头像）
const AI_COAUTHORS: Record<string, { name: string; org: string; url: string }> = {
  'noreply@anthropic.com': { name: 'Claude', org: 'anthropics', url: 'https://claude.ai' },
  'noreply@openai.com': { name: 'ChatGPT', org: 'openai', url: 'https://chatgpt.com' },
  'noreply@google.com': { name: 'Gemini', org: 'google-gemini', url: 'https://gemini.google.com' },
  'noreply@cursor.sh': { name: 'Cursor', org: 'cursor', url: 'https://cursor.com' },
  'noreply@codeium.com': { name: 'Windsurf', org: 'Exafunction', url: 'https://windsurf.com' },
  'noreply@github.com': { name: 'GitHub Copilot', org: 'github', url: 'https://github.com/features/copilot' },
}

const HEADERS = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'DownVid-App' }

/**
 * GitHub 未认证请求的限额是 **60 次/小时，且按来源 IP 共享**。
 * 一次贡献者刷新要 3 个请求（contributors 1 页 + commits 2 页），
 * 多人共用出口 IP 时很容易耗尽，表现为 403。
 */
export class RateLimitError extends Error {
  constructor() {
    super('GitHub API 请求次数已达上限（未认证请求为 60 次/小时）')
    this.name = 'RateLimitError'
  }
}

function isRateLimited(e: unknown): boolean {
  const msg = String((e as any)?.message || '')
  return /\b403\b|\b429\b|rate limit/i.test(msg)
}
const PER_PAGE = 100
const MAX_PAGES = 10

// 逐页拉取直到不满一页；首页失败抛错，后续页失败则保留已拿到的部分
async function fetchAllPages(url: string): Promise<any[]> {
  const items: any[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    let batch: any[]
    try {
      const response = await fetch(`${url}&page=${page}`, { headers: HEADERS })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      batch = await response.json()
    } catch (e) {
      // 限额耗尽（403/429）时**不要继续翻页**：后面每一页都会再消耗一次限额，
      // 让恢复时间更晚。直接停下，保留已拿到的部分。
      if (isRateLimited(e)) {
        if (page === 1) throw new RateLimitError()
        break
      }
      if (page === 1) throw e
      break
    }
    items.push(...batch)
    if (batch.length < PER_PAGE) break
  }
  return items
}

// 12345+login@users.noreply.github.com / login@users.noreply.github.com → login
function loginFromNoreply(email: string): string | null {
  const m = email.match(/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i)
  return m ? m[1] : null
}

function parseCoAuthors(message: string): Array<{ name: string; email: string }> {
  const result: Array<{ name: string; email: string }> = []
  for (const m of message.matchAll(/^co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$/gim)) {
    result.push({ name: m[1], email: m[2].toLowerCase() })
  }
  return result
}

export async function fetchAllContributors(owner: string, repo: string): Promise<Contributor[]> {
  const base = `https://api.github.com/repos/${owner}/${repo}`
  const [contributors, commits] = await Promise.all([
    fetchAllPages(`${base}/contributors?per_page=${PER_PAGE}&anon=1`),
    // 提交记录只用于补充共同作者，失败时不影响主名单
    fetchAllPages(`${base}/commits?per_page=${PER_PAGE}`).catch(() => [] as any[]),
  ])

  const byKey = new Map<string, Contributor>()

  for (const c of contributors) {
    if (c.type === 'Anonymous') {
      const login = c.name || c.email || 'anonymous'
      const key = `anon:${(c.email || login).toLowerCase()}`
      const existing = byKey.get(key)
      if (existing) { existing.contributions += c.contributions; continue }
      byKey.set(key, {
        login, avatarUrl: '', htmlUrl: '', contributions: c.contributions,
        isBot: false, isAI: false, isDeveloper: false, isContributor: true,
      })
      continue
    }
    byKey.set(`user:${c.login.toLowerCase()}`, {
      login: c.login,
      avatarUrl: c.avatar_url,
      htmlUrl: c.html_url,
      contributions: c.contributions,
      isBot: c.type === 'Bot',
      isAI: false,
      isDeveloper: DEVELOPER_LOGINS.includes(c.login),
      // 非 Bot 即真人（AI 共同作者在下面单独标出）
      isContributor: c.type !== 'Bot',
    })
  }

  for (const commit of commits) {
    const primaryEmail = (commit.commit?.author?.email || '').toLowerCase()
    for (const { name, email } of parseCoAuthors(commit.commit?.message || '')) {
      if (email === primaryEmail) continue

      const ai = AI_COAUTHORS[email]
      if (ai) {
        const key = `ai:${email}`
        const existing = byKey.get(key)
        if (existing) { existing.contributions++; continue }
        byKey.set(key, {
          login: ai.name,
          avatarUrl: `https://github.com/${ai.org}.png?size=112`,
          htmlUrl: ai.url,
          contributions: 1,
          isBot: true, isAI: true, isDeveloper: false, isContributor: false,
        })
        continue
      }

      const login = loginFromNoreply(email)
      const key = login ? `user:${login.toLowerCase()}` : `anon:${email}`
      const existing = byKey.get(key)
      if (existing) { existing.contributions++; continue }
      byKey.set(key, {
        login: login || name,
        avatarUrl: login ? `https://github.com/${login}.png?size=112` : '',
        htmlUrl: login ? `https://github.com/${login}` : '',
        contributions: 1,
        isBot: /\[bot\]$/i.test(login || name), isAI: false,
        isDeveloper: !!login && DEVELOPER_LOGINS.includes(login),
        isContributor: !/\[bot\]$/i.test(login || name),
      })
    }
  }

  // 开发者 → 真人贡献者 → Bot → AI，各组内按贡献次数降序
  const rank = (c: Contributor) => c.isDeveloper ? 0 : c.isAI ? 3 : c.isBot ? 2 : 1
  return [...byKey.values()].sort((a, b) => rank(a) - rank(b) || b.contributions - a.contributions)
}
