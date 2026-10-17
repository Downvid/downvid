#!/usr/bin/env node
/**
 * 贡献者名单生成：从 git 历史推出「谁在 main 上留过代码」，写进关于页。
 *
 * ## 为什么需要脚本
 *
 * 名单在仓库里有 **3 份副本**，全靠人肉同步：
 *   1. `src/components/AboutView.vue` 的 `CONTRIBUTORS`（界面展示）
 *   2. `tests/about-contributors.test.ts` 的 `EXPECTED_LOGINS`（快照）
 *   3. `tests/about-contributors.test.ts` 的 `HUMAN_IDENTITY_TOKENS`（署名 token 表）
 *
 * 实测代价：容器镜像作者 `@Glaroday` 提交了一整个功能（#70），名单里却没有他——
 * 漏人不会报错，只会让那位贡献者从界面上消失。这类事靠自觉维持不了。
 *
 * ## 为什么不能只靠 git 邮箱
 *
 * 实测（2026-08-23 起的历史）：13 个署名身份里，只有 7 个可用
 * `users.noreply.github.com` 格式反解出 GitHub login。另外几个用的是真实邮箱
 * （`jwfstars@gmail.com`、`linuztx@gmail.com`、`htmlhao@gmail.com`、`mycitu@163.com`），
 * **从数据本身无法推出账号名**。
 *
 * 所以方案是 `.mailmap`：把「显示名 <email>」映射到「规范名 <noreply 邮箱>」，
 * 一次性人工确认，之后脚本就能稳定工作。这正是 git 官方为此提供的机制。
 *
 * ## 用法
 *
 *   node scripts/gen-contributors.mjs                 # 只报告差异（默认，安全）
 *   node scripts/gen-contributors.mjs --write         # 写入 3 处
 *   node scripts/gen-contributors.mjs --include-bots  # 也列出 bot（默认排除）
 *
 * 默认 dry-run：删人/加人应当是**一次显式决定**（附理由的提交），
 * 而不是顺手改模板时被带走——这条约定来自 tests/about-contributors.test.ts 的注释。
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
const WRITE = process.argv.includes('--write')
const INCLUDE_BOTS = process.argv.includes('--include-bots')

const ABOUT = path.join(ROOT, 'src/components/AboutView.vue')
const TEST = path.join(ROOT, 'tests/about-contributors.test.ts')

/**
 * 不是「人」的署名：自动化账号与 AI 助手。
 *
 * `tests/about-contributors.test.ts` 的「不把机器人与 AI 助手列进去」用例
 * 也断言了这一条，两处必须一致。
 */
const NON_HUMAN = [/\[bot\]/i, /github-actions/i, /dependabot/i, /^anthropic$/i, /^claude$/i]

function isHuman(email, name) {
  if (INCLUDE_BOTS) return true
  return !NON_HUMAN.some((re) => re.test(email) || re.test(name))
}

// ===== 从 git 读出署名 =====

/**
 * `--use-mailmap` 让 git 应用 `.mailmap`，把同一人的多个署名折叠成一条规范身份。
 * 没有 .mailmap 时退化为原始署名，此时多数真实邮箱无法反解出 login（脚本会提示）。
 */
function readAuthors() {
  try {
    // 显式给 mailmap.file：
    // 实测 `.mailmap` 放在仓库根目录且**已提交**时 git 才会自动应用，
    // 而脚本可能在未提交的改动上运行（那时自动应用失效）。
    // 显式指定后行为稳定，也不依赖仓库状态。
    // 必须用**大写**的 %aN / %aE：
    // git 的 --use-mailmap 只作用于大写占位符，小写的 %an / %ae 永远返回原始署名。
    // 实测（git 2.56）：同一个作者 `git log --use-mailmap --format='%aN'` 得到
    // 规范名，`--format='%an'` 得到原名——两者都不报错，只是结果不同。
    // 这条曾被误判成「.mailmap 不生效」，实际是占位符写错了。
    const mailmap = path.join(ROOT, '.mailmap')
    const args = ['log', '--use-mailmap', '--format=%aN%x00%aE']
    const out = execFileSync(
      'git',
      fs.existsSync(mailmap) ? ['-c', `mailmap.file=${mailmap}`, ...args] : args,
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    )
    const people = new Map() // login 或 email -> { name, emails:Set }
    for (const line of out.split('\n')) {
      if (!line.trim()) continue
      const [name, email] = line.split('\x00')
      if (!name || !email) continue
      if (!isHuman(email, name)) continue
      const key = email.toLowerCase()
      if (!people.has(key)) people.set(key, { name, emails: new Set() })
      people.get(key).emails.add(key)
    }
    return [...people.values()]
  } catch {
    return null
  }
}

/**
 * 从署名推出 GitHub login。
 *
 * 只认 `users.noreply.github.com` 的两种形态：
 *   `123456+login@users.noreply.github.com`（gh 默认）
 *   `login@users.noreply.github.com`（老格式）
 * 真实邮箱无从推断——那必须靠 `.mailmap` 映射。
 */
function loginFromEmail(email) {
  const m = /^(?:\d+\+)?([A-Za-z0-9][A-Za-z0-9-]*)@users\.noreply\.github\.com$/i.exec(email)
  return m ? m[1] : null
}

// ===== 读现有名单 =====

function readExistingLogins() {
  const src = fs.readFileSync(ABOUT, 'utf8')
  const block = /const CONTRIBUTORS = \[([\s\S]*?)\n\]/.exec(src)?.[1] ?? ''
  return [...block.matchAll(/login:\s*'([^']+)'/g)].map((m) => m[1])
}

// ===== 主流程 =====

const authors = readAuthors()
if (authors === null) {
  console.error('无法读取 git 历史（不在仓库里？浅检出？）')
  process.exit(1)
}

const resolved = new Map() // login -> { name, emails:Set }
const unresolved = []      // 有署名但推不出 login 的人

for (const person of authors) {
  let login = null
  for (const email of person.emails) {
    login = loginFromEmail(email)
    if (login) break
  }
  if (login) {
    if (!resolved.has(login)) resolved.set(login, { name: person.name, emails: new Set() })
    for (const e of person.emails) resolved.get(login).emails.add(e)
  } else {
    unresolved.push(person)
  }
}

const existing = readExistingLogins()
const fromGit = [...resolved.keys()]

/**
 * 新名单 = 现有名单 ∪ git 推出的。
 *
 * **只增不减**：git 里没有某人不代表他不该在名单里——可能他的提交在
 * 更早的历史里（浅检出）、或是文档/设计类贡献没有代码提交。
 * 删人是显式决定，由人手工做，脚本不擅自删。
 */
// GitHub login **大小写不敏感**：名单里写 `Glaroday`、git 邮箱里是 `glaroday`，
// 是同一人。严格比较会误报「新增一人」，进而写出一份重复条目。
//
// 新增时**保留 git 里的原始大小写**：那是 commit 邮箱里记录的形态，
// 也是唯一有据可查的写法（GitHub 账号的真实大小写要查 API，脚本不联网）。
const lowerExisting = new Set(existing.map((l) => l.toLowerCase()))
const merged = [...existing]
for (const login of fromGit) {
  if (!lowerExisting.has(login.toLowerCase())) {
    merged.push(login)
    lowerExisting.add(login.toLowerCase())
  }
}

// 新增 = 按大小写不敏感算，git 里有、名单里没有的
const added = merged.filter((l) => !existing.some((e) => e.toLowerCase() === l.toLowerCase()))

// ===== 报告 =====

console.log(`git 历史里的真人身份：${authors.length} 个`)
console.log(`  可反解出 GitHub login：${fromGit.length} 个 — ${fromGit.join(', ')}`)
if (unresolved.length) {
  console.log(`  无法反解（需要 .mailmap）：${unresolved.length} 个`)
  for (const p of unresolved) {
    console.log(`      ${p.name} <${[...p.emails][0]}>`)
  }
}
console.log(`\n现有名单：${existing.length} 人 — ${existing.join(', ')}`)
if (added.length) {
  console.log(`git 里发现但名单没有：${added.length} 人 — ${added.join(', ')}`)
} else {
  console.log('git 里没有遗漏的贡献者。')
}

if (unresolved.length) {
  console.log(`
提示：上面 ${unresolved.length} 个人用的是真实邮箱，从数据本身推不出 GitHub 账号。
      在仓库根目录建 \`.mailmap\` 一次性映射即可，之后本脚本就能稳定识别：

        Canonical Name <login@users.noreply.github.com>  Original Name <real@email>

      .mailmap 是 git 官方机制，也让 \`git shortlog -sne\` 归并同一人的多个身份。`)
}

if (added.length === 0) {
  console.log('\n名单已是最新，无需写入。')
  process.exit(0)
}

if (!WRITE) {
  console.log('\n未写入（默认 dry-run）。确认后加 --write。')
  console.log('只增不减：脚本不会删人，删人是需要理由的显式决定。')
  process.exit(0)
}

// ===== 写入 =====

// 1) AboutView.vue：只加缺的人，保留现有顺序与 role
let about = fs.readFileSync(ABOUT, 'utf8')
const insertAt = /const CONTRIBUTORS = \[([\s\S]*?)\n\]/.exec(about)
if (!insertAt) {
  console.error('AboutView.vue 里找不到 CONTRIBUTORS 数组 —— 结构变了？')
  process.exit(1)
}
const newLines = added
  .map((login) => `  { login: '${login}', url: 'https://github.com/${login}', role: 'CONTRIBUTOR' },`)
  .join('\n')
about = about.replace(
  /(const CONTRIBUTORS = \[[\s\S]*?)(\n\])/,
  `$1\n${newLines}$2`,
)
fs.writeFileSync(ABOUT, about)

// 2) 测试快照 + token 表
let test = fs.readFileSync(TEST, 'utf8')
test = test.replace(
  /const EXPECTED_LOGINS = \[[^\]]*\]/,
  `const EXPECTED_LOGINS = [${merged.map((l) => `'${l}'`).join(', ')}]`,
)
// token 表：为每个新增 login 补两条（login 本身 + noreply 前缀形式）
const tokenBlock = /const HUMAN_IDENTITY_TOKENS = \[([\s\S]*?)\n\]/
const tb = tokenBlock.exec(test)
if (tb) {
  const body = tb[1]
  const missing = []
  for (const login of added) {
    if (!body.includes(`'${login}'`)) missing.push(`  '${login}',`)
    const withPrefix = [...(resolved.get(login)?.emails ?? [])].find((e) => /^\d+\+/.test(e))
    if (withPrefix && !body.includes(`'${withPrefix.split('@')[0]}'`)) {
      missing.push(`  '${withPrefix.split('@')[0]}',`)
    }
  }
  if (missing.length) {
    test = test.replace(tokenBlock, `const HUMAN_IDENTITY_TOKENS = [$1\n${missing.join('\n')}\n]`)
  }
}
fs.writeFileSync(TEST, test)

console.log(`\n已写入 ${added.length} 人：AboutView 的 CONTRIBUTORS、测试快照与 token 表。`)
console.log('请复核 diff 后提交。如果名单里该有某人但 git 推不出来，先补 .mailmap 再跑一次。')
