#!/usr/bin/env node
/**
 * 插件索引自动收录。
 *
 * ## 它做什么
 *
 * 扫描 GitHub 上打了 `downvid-plugin` topic 的公开仓库，逐个校验，把合格的写进
 * 索引仓库的 `index.json`。
 *
 * ## 为什么用 topic 而不是让人提 Issue
 *
 * 提 Issue 收录的瓶颈在人：每条都要手工核对，收录几个就停了。而 topic 是作者
 * **自己声明**「我是 DownVid 插件」的方式，仓库是现成的，只缺一层校验。
 * 校验自动化之后，收录退化成「作者打一个 topic」。
 *
 * ## 自动收录 ≠ 放弃审核
 *
 * 这里只做**机器可判**的部分（manifest 合法、契约对、repo 形态正确、不在
 * blocklist 里）。人只看两类：
 *   1. 被 blocklist 命中的（已下架，不再自动加回）
 *   2. 校验失败的（原因写进报告，作者据此修）
 *
 * 真正的恶意行为（外传 Cookie 等）机器判不了，所以 `removed.json` 是**手写**的，
 * 一旦进了 blocklist 就再也不会被自动收录。
 *
 * 用法：
 *   node scripts/update-plugin-index.mjs            # 扫描并写入
 *   node scripts/update-plugin-index.mjs --dry-run  # 只报告，不写文件
 *   node scripts/update-plugin-index.mjs --topic x  # 换 topic
 */

import fs from 'node:fs'
import path from 'node:path'

const TOPIC = 'downvid-plugin'
const CONTRACT = 'downvid-parser'
/** 索引里 id 的形态，与 Go 侧 pluginhost.ValidPluginID 保持一致 */
const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

// 参数**每次调用时读**，理由同 rootDir：模块只加载一次，
// 顶层求值会让第二个用例继续沿用第一个用例的参数。
const argv = () => process.argv.slice(2)
const isDryRun = () => argv().includes('--dry-run')
const topicName = () => {
  const a = argv()
  const i = a.indexOf('--topic')
  return i >= 0 ? a[i + 1] : TOPIC
}
/**
 * 索引仓库根目录：默认当前目录，CI 里 checkout 索引仓库后即为它。
 *
 * **必须每次调用时读**，不能在模块顶层求值：模块只会被加载一次，
 * 顶层值会把「换一个目录再跑」变成「仍然操作上一次那个目录」。
 * 测试里为此踩过一次——多个用例读写的都是第一个临时目录，
 * 于是本该失败的用例虚假通过。
 */
const rootDir = () => path.resolve(process.env.PLUGIN_INDEX_DIR || '.')

const problems = []
const notes = []

const read = (p) => fs.readFileSync(path.join(rootDir(), p), 'utf8')
const exists = (p) => fs.existsSync(path.join(rootDir(), p))

/**
 * GitHub API 根地址。
 *
 * 可被 `GITHUB_API` 覆盖：测试要用本地服务替身，否则每次回归都要打真实
 * GitHub——慢、会限流、结果随别人的仓库变化而不稳定。
 */
const apiBase = () => process.env.GITHUB_API || 'https://api.github.com'

/** 带 token 与重试的 GitHub API 调用 */
async function gh(pathname) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'downvid-index-bot' }
  if (token) headers.Authorization = `Bearer ${token}`

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${apiBase()}${pathname}`, { headers })
    if (res.ok) return res.json()
    // 404 是「没有」，不是错误：topic 下搜到一个刚删掉的仓库很常见
    if (res.status === 404) return null
    if (res.status === 403 || res.status === 429) {
      // 限流：等一会儿再来。无 token 时 GitHub 只给 60 次/小时，扫描几十个仓库
      // 很容易撞上，所以这里必须退避而不是直接失败
      const wait = Number(res.headers.get('retry-after')) || attempt * 5
      await new Promise((r) => setTimeout(r, wait * 1000))
      continue
    }
    throw new Error(`GitHub API ${pathname} -> ${res.status}`)
  }
  throw new Error(`GitHub API ${pathname} 连续失败`)
}

/** 列出某个 topic 下的仓库（最多 100 个，够用且省配额） */
async function listRepos() {
  const q = encodeURIComponent(`topic:${topicName()} is:public`)
  const json = await gh(`/search/repositories?q=${q}&per_page=100&sort=updated`)
  return (json?.items || []).map((r) => r.full_name)
}

/**
 * 读仓库里的插件目录。
 *
 * 约定：仓库根目录就是插件目录（plugin.json 在根），或根下的 `plugin/`。
 * 只支持这两种，不做递归搜索——递归会让「随便一个业务仓库」被误判成插件。
 */
async function findPluginDir(repo) {
  for (const dir of ['', 'plugin']) {
    const manifest = await gh(`/repos/${repo}/contents/${dir ? dir + '/' : ''}plugin.json`)
    if (manifest && manifest.download_url) {
      return { dir, manifestURL: manifest.download_url }
    }
  }
  return null
}

/** 取 manifest 内容并校验 */
async function readManifest(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'downvid-index-bot' } })
  if (!res.ok) return { error: `取 plugin.json 失败：HTTP ${res.status}` }
  let m
  try {
    m = JSON.parse(await res.text())
  } catch {
    return { error: 'plugin.json 不是合法 JSON' }
  }
  if (!m || typeof m !== 'object') return { error: 'plugin.json 不是对象' }
  if (typeof m.playback !== 'string' || m.playback !== CONTRACT) {
    return { error: `playback 是 ${JSON.stringify(m.playback)}，不是 ${CONTRACT}` }
  }
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) {
    return { error: `id ${JSON.stringify(m.id)} 不合法（小写字母数字连字符）` }
  }
  if (typeof m.name !== 'string' || !m.name.trim()) {
    return { error: '缺少 name' }
  }
  const net = m.permissions?.network
  if (Array.isArray(net) && net.includes('*')) {
    // 不拒绝，只提醒：`*` 是合法配置，但值得人来复核一次
    notes.push(`${m.id}：permissions.network 含 *（任意域名），建议人工确认`)
  }
  return { manifest: m }
}

/** 从仓库描述或 manifest 里猜支持站点，仅用于展示 */
function sitesOf(m) {
  const s = m?.sites
  if (Array.isArray(s) && s.every((x) => typeof x === 'string')) return s.slice(0, 8)
  return []
}

/**
 * 取图标。只接受 emoji 短串或 http(s) 地址。
 *
 * 与 Go 侧 validIcon 同一判据：icon 会直接进界面，放行 `javascript:` 或带标签的
 * 字符串等于把索引文件变成注入点。这里不通过就丢弃，而不是把整条插件拒掉——
 * 图标只是装饰。
 */
function iconOf(m, prev) {
  const raw = typeof m?.icon === 'string' ? m.icon.trim() : ''
  if (!raw) return prev?.icon || ''
  if (/^https?:\/\//i.test(raw)) return raw
  if ([...raw].length > 8 || /[<>"'&]/.test(raw)) return ''
  return raw
}

/** 版本号：取自 plugin.json，界面用它判断「可更新」 */
function versionOf(m, prev) {
  const v = typeof m?.version === 'string' ? m.version.trim() : ''
  return v || prev?.version || ''
}

async function main() {
  const DRY = isDryRun()
  if (!exists('index.json')) {
    problems.push(`找不到 ${path.join(rootDir(), 'index.json')}（用 PLUGIN_INDEX_DIR 指向索引仓库）`)
    report()
    return 1
  }

  const index = JSON.parse(read('index.json'))
  const removed = exists('removed.json') ? JSON.parse(read('removed.json')) : { removed: [] }
  const blocked = new Set((removed.removed || []).map((r) => r.id))
  const before = new Map(index.plugins.map((p) => [p.id, p]))

  const repos = await listRepos()
  if (repos.length === 0) {
    console.log(`topic:${topicName()} 下没有仓库，索引保持不变。`)
    report()
    return 0
  }
  console.log(`发现 ${repos.length} 个 topic:${topicName()} 仓库`)

  const next = []
  for (const repo of repos) {
    if (!REPO_RE.test(repo)) {
      problems.push(`${repo}：不是 owner/name 形态，跳过`)
      continue
    }
    const found = await findPluginDir(repo)
    if (!found) {
      problems.push(`${repo}：根目录没有 plugin.json，跳过`)
      continue
    }
    const { manifest, error } = await readManifest(found.manifestURL)
    if (error) {
      problems.push(`${repo}：${error}`)
      continue
    }
    const id = manifest.id
    if (blocked.has(id)) {
      notes.push(`${id}：在 blocklist 中，不收录（${repo}）`)
      continue
    }
    if (next.some((p) => p.id === id)) {
      problems.push(`${repo}：id ${id} 与另一个仓库重复，跳过`)
      continue
    }
    // 保留已有人工填写的字段（sites/added），避免每次扫描把它们覆盖掉
    const prev = before.get(id)
    next.push({
      id,
      name: manifest.name,
      description: manifest.description || prev?.description || '',
      repo,
      author: manifest.author || prev?.author || '',
      sites: sitesOf(prev).length ? sitesOf(prev) : sitesOf(manifest),
      // 人工填过的 icon 优先（作者可能只在索引里指定过）；否则跟随 manifest
      icon: iconOf(manifest, prev),
      version: versionOf(manifest, prev),
      added: prev?.added || new Date().toISOString().slice(0, 10),
    })
  }

  next.sort((a, b) => a.id.localeCompare(b.id))
  const changed = JSON.stringify(next) !== JSON.stringify(index.plugins)

  if (!changed) {
    console.log('索引无变化。')
    report()
    return 0
  }
  index.plugins = next
  index.updated = new Date().toISOString().slice(0, 10)

  if (DRY) {
    console.log('--dry-run：不写文件。将要写入：')
    console.log(JSON.stringify(index, null, 2))
  } else {
    fs.writeFileSync(path.join(rootDir(), 'index.json'), JSON.stringify(index, null, 2) + '\n')
    console.log(`已写入 index.json：${next.length} 个插件`)
  }
  report()
  return 0
}

function report() {
  if (notes.length) {
    console.log('\n提示：')
    for (const n of notes) console.log('  · ' + n)
  }
  if (problems.length) {
    console.log('\n跳过（不影响其他条目）：')
    for (const p of problems) console.log('  ✗ ' + p)
  }
}

// 作为 CLI 直接运行时才执行；被测试 import 时只导出函数。
//
// 这样测试就能在**同一进程**里调用（起本地假服务 + 直接调 main），
// 不必 execFileSync 起子进程——某些环境下子进程里的 fetch 连 127.0.0.1
// 都会挂住（实测本机如此，7 个用例全部等到超时，而脚本本身没问题）。
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)

if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error('自动收录失败：', e?.message || e)
      process.exit(1)
    })
}

export { main }
