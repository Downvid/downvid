#!/usr/bin/env node
/**
 * 仓库坐标迁移：把一处改完，其余全部同步。
 *
 * ## 为什么需要这个脚本
 *
 * 换仓库（`yxxbc/downvid` → `Downvid/Downvid`）是这个项目**唯一的 MAJOR 级操作**：
 * 仓库坐标散落在 20+ 个文件里，漏改任意一处，后果是**存量用户收不到更新** ——
 * 而这是唯一一类「发新版也修不好」的故障（修好的代码要走的就是那条坏掉的通道）。
 *
 * 坐标的唯一来源是 `shared/app.ts` 的 `APP`；其余位置都应该是它的**镜像**。
 * 本脚本把「镜像与来源不一致」变成可机械检查、可一步修复的事。
 *
 * ## 存量用户为什么不会断
 *
 * 实测（2026-10-17）：GitHub 对**转移/改名**的仓库返回 **301 永久重定向**
 * （`api.github.com/repos/Homebrew/homebrew` → `301` → `/repositories/206084`，
 * release 资产下载走 `-L` 也是 200）。
 *
 * 也就是说：装 1.4.0 的那批用户，其 `app-update.yml` 里烧死的 `yxxbc/downvid`
 * 在转移后仍会被 GitHub 重定向到新仓库，更新检查继续可用。
 *
 * **但这只在「转移（Transfer）」时成立，不是「新建一个仓库」**。
 * 新建仓库 + 旧仓库删除 = 老用户永久失联。这个区别必须写进迁移手册。
 *
 * ## 用法
 *
 *   node scripts/sync-repo-coords.mjs --check          # 只报告（CI 用）
 *   node scripts/sync-repo-coords.mjs --target Downvid/Downvid   # 预览将要改什么
 *   node scripts/sync-repo-coords.mjs --target Downvid/Downvid --write   # 实际写入
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const CHECK = args.includes('--check') || args.length === 0
const WRITE = args.includes('--write')
const targetArg = args.find((a) => a.startsWith('--target='))?.split('=')[1]
  ?? (args.includes('--target') ? args[args.indexOf('--target') + 1] : undefined)

// ===== 读取唯一来源 =====

const APP_TS = fs.readFileSync(path.join(ROOT, 'shared/app.ts'), 'utf8')
const owner = /owner:\s*'([^']+)'/.exec(APP_TS)?.[1]
const repo = /repo:\s*'([^']+)'/.exec(APP_TS)?.[1]
if (!owner || !repo) {
  console.error('无法从 shared/app.ts 解析出 owner / repo —— 那里的写法变了？')
  process.exit(1)
}
const CURRENT = `${owner}/${repo}`

// ===== 需要同步的位置 =====

/**
 * 每一条都是「写错了不会报错、只会让部分用户失联」的位置。
 *
 * `required: true` 表示**必须**出现（缺失说明结构变了，要人看一眼）；
 * `optional` 的位置（文档正文）只做提示，不强制——历史文档里提到旧仓库是正常的。
 */
const TARGETS = [
  // --- 运行时真正决定更新源的三处 ---
  { file: 'shared/app.ts', kind: 'source', note: '唯一来源' },
  { file: 'package.json', kind: 'json', required: false, note: 'repository 字段（若存在）' },

  // --- 构建与发布流水线 ---
  // release.yml 用 GITHUB_TOKEN 自动推断仓库，**不写坐标才是对的**（写死反而会在改名后失配）
  { file: '.github/workflows/release.yml', kind: 'text', required: false, note: '用 GITHUB_TOKEN 自动推断，通常不需写坐标' },
  { file: '.github/workflows/release-audit.yml', kind: 'text', required: false },
  { file: '.github/workflows/codeql.yml', kind: 'text', required: false },

  // --- 生成脚本里的硬编码（应改用 shared/app.ts 派生）---
  { file: 'scripts/gen-release-notes.mjs', kind: 'text', required: true },
  { file: 'scripts/gen-deps-manifest.mjs', kind: 'text', required: false },
  { file: 'scripts/verify-release.mjs', kind: 'text', required: false },

  // --- 用户可见的入口 ---
  { file: 'website/index.html', kind: 'text', required: true, note: '官网 HTML 里的仓库资源地址' },
  { file: 'website/app.js', kind: 'text', required: true, note: '官网下载按钮拼 API 地址' },

  // --- 测试里的快照（改了会红，必须同步）---
  { file: 'tests/about-contributors.test.ts', kind: 'text', required: false },
  { file: 'tests/update-sources.test.ts', kind: 'text', required: false },
  { file: 'tests/website-download.test.ts', kind: 'text', required: false },

  // --- 文档（只提示）---
  { file: 'README.md', kind: 'text', required: false, docs: true },
  { file: 'README.zh-CN.md', kind: 'text', required: false, docs: true },
  { file: 'SECURITY.md', kind: 'text', required: false, docs: true },
  { file: 'TRADEMARKS.md', kind: 'text', required: false, docs: true },
  { file: 'docs/installation.md', kind: 'text', required: false, docs: true },
  { file: 'docs/troubleshooting.md', kind: 'text', required: false, docs: true },
  { file: 'docs/faq.md', kind: 'text', required: false, docs: true },
]

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 找到「构成仓库坐标」的全部位置。
 *
 * 有**两种写法**，必须都认：
 *   a) 拼接形式：`yxxbc/downvid`、`https://github.com/yxxbc/downvid`
 *   b) 分开字段：`owner: 'yxxbc', repo: 'downvid'`（`shared/app.ts` 是这种）
 *
 * 只认 (a) 会漏掉决定更新源的那一处。
 */
function findOccurrences(text, [o, r]) {
  const hits = []
  const joined = new RegExp(`${esc(o)}/${esc(r)}`, 'gi')
  let m
  while ((m = joined.exec(text)) !== null) hits.push({ index: m.index, text: m[0], form: 'joined' })
  // 分开字段：owner 与 repo 各自出现（限制在同一行或紧邻行内，避免跨文件误报）
  const pair = new RegExp(`(?:"?(?:owner|repo)"?\\s*[:=]\\s*['"])(${esc(o)}|${esc(r)})(['"])`, 'gi')
  while ((m = pair.exec(text)) !== null) hits.push({ index: m.index, text: m[0], form: 'field' })
  return hits
}

// ===== check 模式 =====

if (CHECK) {
  const problems = []
  const notes = []

  for (const t of TARGETS) {
    const full = path.join(ROOT, t.file)
    if (!fs.existsSync(full)) {
      if (t.required) problems.push(`${t.file}：文件不存在（结构变了？）`)
      continue
    }
    const text = fs.readFileSync(full, 'utf8')
    const hits = findOccurrences(text, CURRENT.split('/'))

    if (t.kind === 'source') {
      // 唯一来源本身就是「字段形式」，这里只确认两个字段都在
      if (!/owner:\s*'[^']+'/.test(text) || !/repo:\s*'[^']+'/.test(text)) {
        problems.push('shared/app.ts：找不到 owner / repo 定义')
      }
      continue
    }

    if (t.required && hits.length === 0) {
      problems.push(`${t.file}：应当引用仓库坐标 ${CURRENT}，但没有找到${t.note ? `（${t.note}）` : ''}`)
    }
    // 字段形式的自检：`owner:` / `repo:` 的值必须与 shared/app.ts 一致。
    //
    // 这一条防的是迁移脚本自己的 bug：往返迁移时曾把 `repo:` 也替换成 owner
    // （因为按「值」而不是「字段名」判断），于是更新源的坐标变成 `Downvid/Downvid`，
    // 用户检查更新 404，且没有任何报错。
    if (t.file === 'shared/app.ts') {
      const fieldOwner = /\b"?(owner)"?\s*[:=]\s*['"]([^'"]+)['"]/.exec(text)?.[2]
      const fieldRepo = /\b"?(repo)"?\s*[:=]\s*['"]([^'"]+)['"]/.exec(text)?.[2]
      if (fieldOwner && fieldOwner !== owner) {
        problems.push(`${t.file}：owner 字段是 "${fieldOwner}"，与 shared/app.ts 的 "${owner}" 不一致`)
      }
      if (fieldRepo && fieldRepo !== repo) {
        problems.push(`${t.file}：repo 字段是 "${fieldRepo}"，与 shared/app.ts 的 "${repo}" 不一致（大小写也要一致）`)
      }
    }

    if (t.docs && hits.length > 0) notes.push(`${t.file}：文档里出现 ${hits.length} 处旧坐标（历史提及可保留）`)
  }

  if (notes.length) {
    console.log('提示（文档正文，不强制）：')
    for (const n of notes) console.log(`  · ${n}`)
    console.log('')
  }
  if (problems.length) {
    console.error('仓库坐标校验未通过：')
    for (const p of problems) console.error(`  ✗ ${p}`)
    console.error('\n坐标的唯一来源是 shared/app.ts。漏改任一处的后果是：存量用户收不到更新，')
    console.error('而这是唯一一类「发新版也修不好」的故障。')
    process.exit(1)
  }
  console.log(`仓库坐标校验通过：唯一来源 ${CURRENT}，${TARGETS.length - 1} 处镜像一致。`)
  process.exit(0)
}

// ===== write 模式（迁移用）=====

if (!targetArg || !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(targetArg)) {
  console.error('用法：node scripts/sync-repo-coords.mjs --target <owner>/<repo> [--write]')
  console.error(`当前坐标：${CURRENT}`)
  process.exit(1)
}

const [newOwner, newRepo] = targetArg.split('/')
console.log(`迁移仓库坐标：${CURRENT} → ${targetArg}${WRITE ? '' : '（预览，未写入；加 --write 生效）'}\n`)

let totalFiles = 0
let totalHits = 0
for (const t of TARGETS) {
  const full = path.join(ROOT, t.file)
  if (!fs.existsSync(full)) continue
  const text = fs.readFileSync(full, 'utf8')
  const hits = findOccurrences(text, [owner, repo])
  if (hits.length === 0) continue

  // 用带捕获组的方式整体替换，保留原有大小写风格是不必要的（GitHub 大小写不敏感），
  // 但必须避免误伤 owner 与 repo 恰好是常见词的场景——故整段 `${owner}/${repo}` 一起换。
  // 两种形态都要换：拼接形式整体替换，字段形式**按字段名**决定替换成什么。
  //
  // 这里踩过一个坑：早先按「值」判断（值等于旧 owner 就换成新 owner），
  // 于是在 owner 与 repo 同名时（往返迁移会出现 `Downvid/Downvid`）两个字段
  // 都被换成 owner，`shared/app.ts` 的 `repo:` 变成 `Downvid` 而不是 `downvid`。
  // 结果：更新源的坐标变成 `Downvid/Downvid`，用户检查更新 404。
  // **按字段名判断**才是唯一可靠的依据。
  let next = text.replace(new RegExp(`${esc(owner)}/${esc(repo)}`, 'gi'), `${newOwner}/${newRepo}`)
  next = next.replace(
    new RegExp(`(\\b"?(owner|repo)"?\\s*[:=]\\s*['"])(${esc(owner)}|${esc(repo)})(['"])`, 'gi'),
    (whole, pre, field, _value, post) => {
      const replacement = field.toLowerCase() === 'owner' ? newOwner : newRepo
      return `${pre}${replacement}${post}`
    },
  )
  totalFiles++
  totalHits += hits.length
  console.log(`  ${t.file}：${hits.length} 处${t.note ? `（${t.note}）` : ''}`)
  if (WRITE) fs.writeFileSync(full, next)
}

console.log(`\n共 ${totalFiles} 个文件、${totalHits} 处。`)
if (!WRITE) {
  console.log('未写入。确认后加 --write 执行。')
  process.exit(0)
}

console.log(`
已写入。接下来**必须**人工完成：
  1. 在 GitHub 上对旧仓库执行 **Transfer**（不是新建仓库再删旧的）——
     转移会保留 301 永久重定向，装 1.4.0 的存量用户才能继续收到更新。
  2. 同步 upload-release 的凭据（GHCR 镜像坐标、secrets）。
  3. 跑 pnpm lint:ipc && pnpm lint:website && pnpm test && pnpm verify:release。
  4. 观察旧仓库的 releases.atom 是否仍能被拉到（转移后应 301 到新仓库）。
`)
