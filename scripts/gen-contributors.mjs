#!/usr/bin/env node
/**
 * 生成贡献者快照 `shared/contributors.json`。
 *
 * ## 为什么不用运行时调 API
 *
 * 原先应用启动时直接请求 GitHub 的 `/contributors` 与 `/commits`。未认证请求的限额是
 * **60 次/小时，且按来源 IP 共享** —— 一次刷新要 3 个请求，多人共用出口 IP 时很容易
 * 耗尽，表现就是界面报 403、贡献者列表拿不到。
 *
 * 这个限额无法在客户端绕开（带 token 意味着把凭据打进安装包，不可行）。因此改为
 * **构建期生成快照、随包分发**（做法参考 Mystic-Stars/Axolotl）：
 *
 *   本脚本（CI 里带 GITHUB_TOKEN，限额 5000/小时）→ shared/contributors.json → 应用直接读
 *
 * 于是运行时**完全不碰 API**，403 从架构上消失；离线也能看到贡献者。
 * 代价是名单只在发版时更新 —— 对"关于页展示贡献者"这个用途完全够用。
 *
 * 用法：
 *   node scripts/gen-contributors.mjs           # 生成/更新快照
 *   node scripts/gen-contributors.mjs --check   # 只校验是否落后（CI 用，不写文件）
 */

import fs from 'node:fs'
import path from 'node:path'

const REPO = 'yxxbc/downvid'
const PER_PAGE = 100
const MAX_PAGES = 10
const OUT = path.resolve(import.meta.dirname, '../shared/contributors.json')

/** 开发者（维护者）——界面打 DEV 标；与 shared/app.ts 的 owner 一致 */
const DEVELOPER_LOGINS = ['yxxbc']

/** AI 共同作者：按邮箱识别，展示为 AI 标 */
const AI_COAUTHORS = {
  'noreply@anthropic.com': { name: 'Claude', org: 'anthropics', url: 'https://claude.ai' },
  'noreply@openai.com': { name: 'ChatGPT', org: 'openai', url: 'https://chatgpt.com' },
  'noreply@google.com': { name: 'Gemini', org: 'google-gemini', url: 'https://gemini.google.com' },
  'noreply@github.com': { name: 'GitHub Copilot', org: 'github', url: 'https://github.com/features/copilot' },
  'noreply@cursor.com': { name: 'Cursor', org: 'cursor', url: 'https://cursor.com' },
  'noreply@windsurf.com': { name: 'Windsurf', org: 'windsurf', url: 'https://windsurf.com' },
}

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')

function headers() {
  const h = { Accept: 'application/vnd.github+json', 'User-Agent': 'DownVid-Contributors-Sync' }
  // CI 里用 GITHUB_TOKEN（5000/小时）；本地没有也能跑，只是限额低
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

async function fetchPage(url, page) {
  const target = new URL(url)
  target.searchParams.set('per_page', String(PER_PAGE))
  target.searchParams.set('page', String(page))

  let lastError
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(target, { headers: headers(), signal: AbortSignal.timeout(30_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (e) {
      lastError = e
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 1000))
    }
  }
  throw new Error(`请求 ${target} 失败：${lastError?.message}`)
}

async function fetchAllPages(url) {
  const items = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await fetchPage(url, page)
    if (!Array.isArray(batch)) break
    items.push(...batch)
    if (batch.length < PER_PAGE) break
  }
  return items
}

/** 12345+login@users.noreply.github.com → login */
function loginFromNoreply(email) {
  const m = email.match(/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i)
  return m ? m[1] : null
}

function parseCoAuthors(message) {
  const out = []
  for (const m of message.matchAll(/^co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$/gim)) {
    out.push({ name: m[1], email: m[2].toLowerCase() })
  }
  return out
}

function avatar(login) {
  return `https://github.com/${login}.png?size=112`
}

async function build() {
  const base = `https://api.github.com/repos/${REPO}`
  const [contributors, commits] = await Promise.all([
    fetchAllPages(`${base}/contributors`),
    // 提交记录只用于补充 Co-authored-by 共同作者，失败不影响主名单
    fetchAllPages(`${base}/commits`).catch(() => []),
  ])

  const byKey = new Map()
  const upsert = (key, make) => {
    const existing = byKey.get(key)
    if (existing) { existing.contributions += 1; return }
    byKey.set(key, make())
  }

  for (const c of contributors) {
    if (!c || !c.login) continue
    const isBot = c.type === 'Bot'
    byKey.set(`user:${c.login.toLowerCase()}`, {
      login: c.login,
      avatarUrl: c.avatar_url || avatar(c.login),
      htmlUrl: c.html_url || `https://github.com/${c.login}`,
      contributions: c.contributions || 1,
      isBot,
      isAI: false,
      isDeveloper: DEVELOPER_LOGINS.includes(c.login),
      isContributor: !isBot,
    })
  }

  for (const commit of commits) {
    const primaryEmail = (commit.commit?.author?.email || '').toLowerCase()
    for (const { name, email } of parseCoAuthors(commit.commit?.message || '')) {
      if (email === primaryEmail) continue

      const ai = AI_COAUTHORS[email]
      if (ai) {
        upsert(`ai:${email}`, () => ({
          login: ai.name,
          avatarUrl: `https://github.com/${ai.org}.png?size=112`,
          htmlUrl: ai.url,
          contributions: 1,
          isBot: true, isAI: true, isDeveloper: false, isContributor: false,
        }))
        continue
      }

      const login = loginFromNoreply(email)
      const isBot = /\[bot\]$/i.test(login || name)
      upsert(login ? `user:${login.toLowerCase()}` : `anon:${email}`, () => ({
        login: login || name,
        avatarUrl: login ? avatar(login) : '',
        htmlUrl: login ? `https://github.com/${login}` : '',
        contributions: 1,
        isBot,
        isAI: false,
        isDeveloper: !!login && DEVELOPER_LOGINS.includes(login),
        isContributor: !isBot,
      }))
    }
  }

  // 开发者 → 真人贡献者 → Bot → AI，各组内按贡献次数降序
  const rank = (c) => (c.isDeveloper ? 0 : c.isAI ? 3 : c.isBot ? 2 : 1)
  return [...byKey.values()].sort((a, b) => rank(a) - rank(b) || b.contributions - a.contributions)
}

function render(list) {
  return JSON.stringify(list, null, 2) + '\n'
}

/**
 * 校验快照本身是否可用 —— **不请求 API**。
 *
 * CI 上不能请求：未认证限额 60 次/小时（这正是本方案要解决的问题），
 * 而且 CI 的出口 IP 是共享的，几乎必然 403。因此只做本地结构校验。
 */
function checkSnapshot() {
  const rel = path.relative(process.cwd(), OUT)
  if (!fs.existsSync(OUT)) {
    console.error(`::error::缺少 ${rel}，请运行 pnpm contributors:sync 生成后提交`)
    process.exit(1)
  }

  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(OUT, 'utf8'))
  } catch (e) {
    console.error(`::error::${rel} 不是合法 JSON：${e.message}`)
    process.exit(1)
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    console.error(`::error::${rel} 为空或不是数组`)
    process.exit(1)
  }

  // 字段完整性：界面依赖这几个字段渲染身份标与头像
  const required = ['login', 'avatarUrl', 'htmlUrl', 'contributions', 'isBot', 'isDeveloper', 'isContributor']
  const bad = []
  parsed.forEach((c, i) => {
    for (const key of required) {
      if (!(key in c)) bad.push(`第 ${i} 项缺少 ${key}`)
    }
  })
  if (bad.length) {
    console.error(`::error::${rel} 字段不完整（可能是旧格式）：`)
    bad.slice(0, 5).forEach((m) => console.error(`  ${m}`))
    process.exit(1)
  }

  // 至少要有一位真人贡献者，否则说明生成逻辑有问题
  if (!parsed.some((c) => c.isContributor || c.isDeveloper)) {
    console.error(`::error::${rel} 里没有任何真人贡献者，生成逻辑可能有误`)
    process.exit(1)
  }

  console.log(`贡献者快照有效（${parsed.length} 位）。`)
}

async function main() {
  // --check 只校验本地文件，不碰网络（CI 的限额必然不够）
  if (checkOnly) return checkSnapshot()

  console.log(`从 ${REPO} 拉取贡献者...`)
  const list = await build()
  if (list.length === 0) throw new Error('未取到任何贡献者，中止（避免用空快照覆盖）')

  const next = render(list)
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''

  if (current === next) {
    console.log(`贡献者无变化（${list.length} 位）。`)
    return
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, next)
  console.log(`已写入 ${path.relative(process.cwd(), OUT)}（${list.length} 位贡献者）。`)
}

main().catch((e) => {
  console.error(`生成失败：${e.message}`)
  process.exit(1)
})
