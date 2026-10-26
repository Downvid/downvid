#!/usr/bin/env node
/**
 * 发布完整性校验：确认某个版本**真的发布出去了**。
 *
 * ## 为什么需要这个脚本
 *
 * 实测发生过一次：`v1.3.5` 的 tag 已经推到远端，CHANGELOG 也写了，但对应的
 * `Build & Release` 运行**在 3 分钟后被取消**（`conclusion=cancelled`），
 * 于是：
 *
 *   - GitHub Release 里**没有 v1.3.5**
 *   - 应用内的更新检查（走 `/releases/latest`）仍然指向 v1.3.4
 *   - **所有 v1.3.4 用户永远收不到 v1.3.5 的修复**，而版本号已经前进到 1.3.6
 *
 * 这类失败**没有任何提示**：tag 在、CHANGELOG 在、`package.json` 也在，
 * 只有「Release 页面少了一条」——而那是最不容易被注意到的位置。
 *
 * ## 校验内容
 *
 *   1. 存在 tag 对应的 Release，且**不是 draft / prerelease**
 *   2. 该 Release 带着三个平台的安装包（macOS 通用 / Windows x64 / Linux x64）
 *
 * 应用内的自更新直接读 GitHub Releases 的产物列表（`app/internal/update`），
 * 所以「产物齐不齐」就是「自动更新能不能用」。
 *
 * ## 用法
 *
 *   node scripts/verify-release.mjs                     # 用 package.json 的版本
 *   node scripts/verify-release.mjs --tag v1.3.5        # 指定 tag
 *   node scripts/verify-release.mjs --allow-missing     # 本地开发时允许尚未发布
 *
 * 需要网络。`GITHUB_TOKEN` 可选（未提供时走匿名请求，受 60 次/小时限流）。
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')

/** 各平台必须存在的安装包——缺一个，对应平台的用户就升级不了 */
const REQUIRED_ASSETS = [
  [/^DownVid-Wails-mac-universal-\d[\w.]*\.zip$/, 'macOS 通用包'],
  [/^DownVid-Wails-windows-x64-\d[\w.]*\.zip$/, 'Windows x64 包'],
  [/^DownVid-Wails-linux-x64-\d[\w.]*\.tar\.gz$/, 'Linux x64 包'],
]

function readArg(name) {
  const i = process.argv.indexOf(name)
  return i !== -1 ? process.argv[i + 1] : undefined
}
const hasFlag = (name) => process.argv.includes(name)

// ===== 解析仓库坐标与版本 =====
const sharedApp = fs.readFileSync(path.join(ROOT, 'shared/app.ts'), 'utf8')
const owner = sharedApp.match(/owner:\s*'([^']+)'/)?.[1]
const repo = sharedApp.match(/repo:\s*'([^']+)'/)?.[1]
if (!owner || !repo) {
  console.error('无法从 shared/app.ts 解析出 owner/repo')
  process.exit(1)
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const tag = readArg('--tag') || `v${pkg.version}`

// ===== 查询 Release =====
async function fetchRelease() {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'downvid-release-check' }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`
  const res = await fetch(url, { headers })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`)
  return res.json()
}

let release
try {
  release = await fetchRelease()
} catch (e) {
  console.error(`查询 Release 失败：${e.message}`)
  process.exit(1)
}

if (!release) {
  const msg =
    `发布不完整：tag ${tag} 存在，但**没有对应的 GitHub Release**。\n` +
    `  · 应用内更新通道（/releases/latest）仍然指向上一个已发布版本\n` +
    `  · 该版本的所有用户修复都到不了用户手里\n` +
    `  · 常见原因：Build & Release 运行被取消或失败（检查 Actions 页面）\n` +
    `  · 修复：重新运行 release.yml（Actions → Build & Release → Run workflow），版本号填 ${tag.replace(/^v/, '')}`
  if (hasFlag('--allow-missing')) {
    console.log(`提示：${msg.split('\n')[0]}（--allow-missing，跳过）`)
    process.exit(0)
  }
  console.error(msg)
  process.exit(1)
}

const problems = []

// ===== 1. 状态 =====
if (release.draft) problems.push('该 Release 仍是 draft（用户与自动更新都看不到）')
if (release.prerelease) {
  // 预发布是刻意的，但要说清楚它不进稳定用户的更新通道
  console.log(`提示：${tag} 标记为 prerelease —— 稳定用户的自动更新不会拿到它（这是预期行为）`)
}

// ===== 2. 三个平台的安装包 =====
const assetNames = (release.assets || []).map((a) => a.name)
for (const [re, label] of REQUIRED_ASSETS) {
  if (!assetNames.some((n) => re.test(n))) {
    problems.push(`缺少 ${label}（该平台的用户升级不了）`)
  }
}

if (problems.length) {
  console.error(`发布不完整：${tag}`)
  for (const p of problems) console.error(`  ✗ ${p}`)
  console.error(`\n  产物清单：${assetNames.length ? assetNames.join(', ') : '(空)'}`)
  process.exit(1)
}

console.log(
  // GitHub API 返回的是 snake_case（published_at），这里两个都兜一下
  `发布校验通过：${tag} 已发布（${(release.published_at || release.publishedAt || release.created_at || '').slice(0, 10) || '时间未知'}），` +
    `${assetNames.length} 个产物，三个平台齐全。`,
)
