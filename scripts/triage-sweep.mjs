#!/usr/bin/env node
/**
 * 对**已有的** Issue 批量分类：打标签、（必要时）关闭。
 *
 * ## 为什么需要它
 *
 * `.github/workflows/triage.yml` 只在 Issue **被创建/编辑/重开**时触发，
 * 对已经躺在仓库里的历史 Issue 完全不管 —— 实测 4 条 open Issue **一个标签都没有**，
 * 其中还混着应用自动生成的空报告。项目越火，积压越多，手工翻太麻烦。
 *
 * ## 与实时 triage 的关系
 *
 * 分类规则**共用同一份实现**（`scripts/lib/issue-triage.ts`），
 * 所以「新提交的」和「历史积压的」判定标准完全一致，不会出现两套口径。
 *
 * ## 安全约束
 *
 * - **默认 dry-run**：只打印计划，不改任何东西。必须显式 `--apply` 才动手。
 * - **幂等**：已经带 `self-service` / `needs-info` 标签的跳过，不重复评论。
 * - 拿不准的一律只打标签、不关闭（`classifyIssue` 的 `ok` 分支）。
 *
 * ## 用法
 *
 *   node scripts/triage-sweep.mjs                # 预演（默认，安全）
 *   node scripts/triage-sweep.mjs --apply        # 真的执行
 *
 * 需要 `GITHUB_TOKEN`（CI 里用 `secrets.GITHUB_TOKEN`）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { loader } from './lib/load-source.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const load = loader()
const { classifyIssue, commentFor, isParseIssue } = load('scripts/lib/issue-triage.ts')

const APPLY = process.argv.includes('--apply')
const TOKEN = process.env.GITHUB_TOKEN

// 仓库坐标的唯一来源是 shared/app.ts
const sharedApp = fs.readFileSync(path.join(ROOT, 'shared/app.ts'), 'utf8')
const OWNER = sharedApp.match(/owner:\s*'([^']+)'/)?.[1]
const REPO = sharedApp.match(/repo:\s*'([^']+)'/)?.[1]
if (!OWNER || !REPO) {
  console.error('无法从 shared/app.ts 解析出 owner/repo')
  process.exit(1)
}
if (!TOKEN) {
  console.error('缺少 GITHUB_TOKEN')
  process.exit(1)
}

const api = async (endpoint, options = {}) => {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${endpoint}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${TOKEN}`,
      'User-Agent': 'downvid-triage-sweep',
      ...(options.headers || {}),
    },
  })
  if (!res.ok) throw new Error(`${endpoint} → ${res.status} ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}

/** 已经被处理过的标签——重复运行时不重复评论、不重复关闭 */
const HANDLED_LABELS = new Set(['self-service', 'needs-info'])

// ===== 拉取全部 open Issue（分页）=====
const issues = []
for (let page = 1; ; page++) {
  const batch = await api(`/issues?state=open&per_page=100&page=${page}`)
  // PR 也会出现在 issues 接口里，按有无 pull_request 字段排除
  issues.push(...batch.filter((i) => !i.pull_request))
  if (batch.length < 100) break
}

console.log(`扫描 ${issues.length} 条 open Issue${APPLY ? '' : '（预演模式，不会改动任何东西）'}\n`)

const plan = []
for (const issue of issues) {
  const verdict = classifyIssue(issue.body || '')
  const labels = issue.labels.map((l) => (typeof l === 'string' ? l : l.name))
  const alreadyHandled = labels.some((l) => HANDLED_LABELS.has(l))

  // 标签：自助/缺信息由分类决定；解析类问题另打 parse-error 便于筛选
  const addLabels = []
  if (verdict.close) {
    // 两种「没信息」都打 needs-info；自助类打 self-service
    addLabels.push(verdict.reason === 'self-service' ? 'self-service' : 'needs-info')
  } else if (isParseIssue(issue.title, issue.body || '')) {
    // 用报告形态判定，而不是要求 kind 被识别出来：
    // `no such table: meta` 这类 yt-dlp 内部报错归不到具体类别，
    // 但它显然仍是解析失败报告，值得打标签便于筛选
    addLabels.push('parse-error')
  }

  plan.push({
    number: issue.number,
    title: issue.title.slice(0, 56),
    close: verdict.close,
    reason: verdict.reason,
    kind: verdict.kind,
    addLabels: addLabels.filter((l) => !labels.includes(l)),
    skipComment: alreadyHandled,
  })
}

// ===== 打印计划 =====
for (const item of plan) {
  const action = item.close ? '关闭' : '保留'
  const labels = item.addLabels.length ? ` +标签 ${item.addLabels.join(',')}` : ''
  console.log(`  ${action} #${item.number} [${item.reason}/${item.kind}]${labels}  ${item.title}`)
}

const toClose = plan.filter((i) => i.close)
const toLabel = plan.filter((i) => i.addLabels.length)
console.log(`\n合计：${plan.length} 条；将关闭 ${toClose.length} 条，打标签 ${toLabel.length} 条`)

if (!APPLY) {
  console.log('\n预演结束。确认无误后加 --apply 执行。')
  process.exit(0)
}

// ===== 执行 =====
let closed = 0
let labeled = 0
for (const item of plan) {
  // 先评论再关闭，顺序反了会让评论出现在关闭之后，用户不容易看到
  if (item.close && !item.skipComment) {
    const issue = issues.find((i) => i.number === item.number)
    const body = commentFor(classifyIssue(issue.body || ''))
    if (body) {
      await api(`/issues/${item.number}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      })
    }
  }
  if (item.addLabels.length) {
    await api(`/issues/${item.number}/labels`, {
      method: 'POST',
      body: JSON.stringify({ labels: item.addLabels }),
    })
    labeled++
  }
  if (item.close) {
    await api(`/issues/${item.number}`, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'closed', state_reason: 'not_planned' }),
    })
    closed++
  }
}

console.log(`\n完成：关闭 ${closed} 条，打标签 ${labeled} 条。`)
