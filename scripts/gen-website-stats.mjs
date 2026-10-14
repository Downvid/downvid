#!/usr/bin/env node
/**
 * 刷新官网 hero 里的「已被下载 N 次」。
 *
 * 数字来自 GitHub Releases 各产物 `download_count` 的**总和**（不是 shields 的
 * 月度口径，也不是克隆数）——它是最能说明「有多少人真的装了」的公开指标。
 *
 * 为什么是写死而不是实时拉取：
 *   - 官网约定零第三方依赖，不引 shields.io 的图片请求
 *   - 未认证的 GitHub API 限额是 **60 次/小时且按出口 IP 共享**（见 1.3.3 的
 *     贡献者列表 403 事故），前端 fetch 得为 403 写一套降级 UI，不值得
 * 代价是数字会停留在上次刷新的时刻，所以把它做成一条命令 + 发布流程里的自检。
 *
 * 用法：
 *   node scripts/gen-website-stats.mjs            # 取 API 并写回 index.html
 *   node scripts/gen-website-stats.mjs --check     # 只比对，落后就非零退出（CI 用）
 *   node scripts/gen-website-stats.mjs --total 4646   # 离线写入指定值（无网络/测试）
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const INDEX = path.join(ROOT, 'website/index.html')

const argv = process.argv.slice(2)
const CHECK = argv.includes('--check')
const totalIndex = argv.indexOf('--total')
// 注意：indexOf 找不到时返回 -1，直接 argv[-1 + 1] 会取到 argv[0]（曾经就是这么错的）
const totalArg = totalIndex === -1 ? undefined : argv[totalIndex + 1]

const sharedApp = fs.readFileSync(path.join(ROOT, 'shared/app.ts'), 'utf8')
const owner = sharedApp.match(/owner:\s*'([^']+)'/)?.[1]
const repo = sharedApp.match(/repo:\s*'([^']+)'/)?.[1]
if (!owner || !repo) {
  console.error('shared/app.ts 未能解析出 owner/repo')
  process.exit(1)
}

const html = fs.readFileSync(INDEX, 'utf8')
const MARK = /(<b data-download-count>)([\d,]+)(<\/b>)/
const current = html.match(MARK)?.[2]
if (!current) {
  console.error('website/index.html 里找不到 <b data-download-count>N</b> 标记')
  process.exit(1)
}

/** 取全部 Release 的产物下载量总和 */
async function fetchTotal() {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100`
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `DownVid-website-stats/${owner}-${repo}`,
    },
  })
  if (!res.ok) {
    // 限额与网络故障都会走到这里，直接说明原因，不要静默写个 0
    throw new Error(`GitHub API ${res.status} ${res.statusText}（限额 60 次/小时且按出口 IP 共享）`)
  }
  const releases = await res.json()
  if (!Array.isArray(releases)) throw new Error('GitHub API 返回的不是数组')
  return releases.reduce(
    (sum, r) => sum + (r.assets ?? []).reduce((n, a) => n + (a.download_count ?? 0), 0),
    0,
  )
}

const total = totalArg ? Number(totalArg) : await fetchTotal()
if (!Number.isFinite(total) || total < 0) {
  console.error(`下载量不合法：${total}`)
  process.exit(1)
}
const formatted = total.toLocaleString('en-US')

if (CHECK) {
  if (formatted !== current) {
    console.error(`官网下载量已落后：页面 ${current}，实际 ${formatted}`)
    console.error('请运行 pnpm website:stats 刷新后一并提交。')
    process.exit(1)
  }
  console.log(`✓ 官网下载量最新（${current}）`)
} else if (formatted === current) {
  console.log(`✓ 无需更新（${current}）`)
} else {
  fs.writeFileSync(INDEX, html.replace(MARK, `$1${formatted}$3`))
  console.log(`✓ 官网下载量 ${current} → ${formatted}`)
}
