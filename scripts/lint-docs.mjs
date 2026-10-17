#!/usr/bin/env node
/**
 * 文档一致性校验（AGENTS.md ↔ CLAUDE.md ↔ 代码）。
 *
 * 这个仓库最擅长做「静态校验」：IPC 三处同步、图标名、官网词条、设置入口……
 * 唯独**自己那两份最重要的文档**一直靠人肉同步，而 AGENTS.md 里白纸黑字写着
 * 「改其一时必须同步另一份」。现实是它们已经漂了：
 *
 *   - 两处还在引用早已删除的 `test.yml`（工作流已拆成 ci-linux/macos/windows）
 *   - AGENTS.md 说检测总时限 70 秒，实际是 80（Electron 侧还硬编码 --timeout 70 覆盖它）
 *   - CLAUDE.md 的 Commands 少列了四个测试脚本，AGENTS.md 一个都没列
 *
 * 这类漂移的共同点是**不报错**：文档写错不会让任何测试变红，只会在某天误导
 * 一个（人或 AI）改错地方。所以把它变成 CI 里的一次红叉。
 *
 * 校验分四类，都只针对「能客观判定真假」的事实，不碰措辞与排版
 * （措辞一致没法自动判定，强行 diff 只会产生噪音，反而让人想关掉这个检查）：
 *
 *   1. **文件引用真实存在**：两份文档里以仓库相对路径写的文件名必须存在。
 *      文档里提到的文件被删除/改名后，读到的人会去找一个不存在的文件。
 *   2. **两份文档提到的文件名集合一致**：AGENTS.md 与 CLAUDE.md 是同一份知识的
 *      两个语言版本，一方提到 `foo.ts` 另一方没提，说明只有一份被更新了。
 *   3. **提到的 workflow 真实存在**：`.github/workflows/*.yml` 被删/改名后，
 *      文档里指路的那句话会把人带向不存在的文件（本仓库真实发生过）。
 *   4. **文档里的关键数字与代码常量一致**：如「检测总时限 80 秒」对应
 *      `rt.DetectTimeout`。数字最容易手抄漂移，也最难靠肉眼发现。
 *
 * 用法：node scripts/lint-docs.mjs
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const DOCS = ['AGENTS.md', 'CLAUDE.md']

const problems = []
const notes = []

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const exists = (p) => fs.existsSync(path.join(ROOT, p))

// 文档里以 `code` 包裹的文件名。要求带扩展名，且不含空格/通配符。
// 允许以点开头（`.github/workflows/ci-linux.yml`、`.gitattributes`）。
const FILE_REF = /`(\.?[A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:ts|vue|go|mjs|js|json5|json|yml|yaml|sh|md|html|txt))`/g

/**
 * 仓库里真实存在的「文件名 → 完整路径」索引。
 *
 * 同时建一份「路径后缀 → 完整路径」的索引：文档里常写相对某个源目录的短路径
 * （`utils/cookies.ts` 实际是 `electron/utils/cookies.ts`），
 * 只按完整路径判定会满屏误报。
 */
function buildRepoIndex() {
  const byName = new Map()
  const bySuffix = new Set()
  // 文档里的路径一律用正斜杠。这里同时处理两种分隔符（而不是 path.sep），
  // 因为**这个差异只在 Windows 检出时暴露**：写死 '/' 在 macOS/Linux 上
  // 一直是对的，CI 的 windows job 才会报出一堆「引用了不存在的路径」。
  // 用 [\/] 归一化后，本地也能验证。
  const toPosix = (p) => p.split(/[\\/]/).join('/')
  const SKIP = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'release', 'build', '.vercel'])
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else {
        // 归一化成文档里的写法（正斜杠）后再建索引
        const rel = toPosix(path.relative(ROOT, full))
        if (!byName.has(entry.name)) byName.set(entry.name, rel)
        // 记录每一级后缀，供 `utils/cookies.ts` 这类短路径匹配
        const parts = rel.split('/')
        for (let i = 0; i < parts.length; i++) bySuffix.add(parts.slice(i).join('/'))
      }
    }
  }
  walk(ROOT)
  return { byName, bySuffix }
}

const repoIndex = buildRepoIndex()
const docs = Object.fromEntries(DOCS.map((d) => [d, read(d)]))

/** 收集一段文本里提到的所有文件名 */
function fileRefs(text) {
  const out = new Set()
  for (const m of text.matchAll(FILE_REF)) out.add(m[1])
  return out
}

// 运行时路径（用户数据目录、下载目录……）：文档里出现是正常的，但仓库里当然
// 没有这个文件。识别几个前缀跳过，而不是要求文档把路径写全。
const RUNTIME_PATH = /^(userData|resources|\.downvid-aria2)\//

/**
 * 构建产物路径：文档里提到它们是正常的（解释「打包成什么」），
 * 但它们不入库（`.gitignore`），要求存在必然误报。
 *
 * 曾经 `docker/dist-server/index.js` 就是把 CI 弄红的那一处——
 * 而它恰恰是文档需要解释的产物名。
 */
const BUILD_OUTPUT = /^(dist|dist-electron|backend\/build|docker\/dist-web|docker\/dist-server|release)\//
const isRuntimePath = (ref) => RUNTIME_PATH.test(ref)

/**
 * 是否是「运行时产物」而非仓库文件。
 *
 * `.part.json` / `.part` 这类是下载过程中的临时文件，只在用户机器上出现；
 * 仓库里真实存在的点文件（`.gitattributes`、`.gitignore`）走存在性判定，
 * 所以「点开头且不存在」＝运行时产物。
 */
const isRuntimeArtifact = (ref) => ref.startsWith('.') && !exists(ref)

/** 是否是构建产物（不入库，不要求存在） */
const isBuildOutput = (ref) => BUILD_OUTPUT.test(ref)

/** 该引用在文档里是否只是「历史 / 反面」提及（存在性本就不该成立） */
function isNegatedMention(text, ref) {
  for (const line of text.split('\n')) {
    if (!line.includes(ref)) continue
    // 同一行里出现这些词，说明是在说「曾经有 / 不应该有 / 已删除 / 不能用」
    if (/(曾经|历史|已删除|不再|不要|不能|不得|禁止|没有|无\s|used to|no longer|deleted|must not|do not|never|gone|there is no|—\s*no)/.test(line)) {
      return true
    }
  }
  return false
}

/** 该路径是否真实存在（支持完整路径与后缀匹配） */
function pathExists(ref) {
  return exists(ref) || repoIndex.bySuffix.has(ref)
}

// ===== 1. 文件引用真实存在 =====
//
// 文档里可能写完整相对路径（`src/stores/settings.ts`）也可能只写文件名
// （`settings.ts`）。前者要求路径存在，后者只要求仓库里某处有这个文件名——
// 否则光靠文件名没法判定，会误报。
for (const [doc, text] of Object.entries(docs)) {
  for (const ref of fileRefs(text)) {
    if (isRuntimePath(ref)) continue
    if (isRuntimeArtifact(ref)) continue
    if (isBuildOutput(ref)) continue
    if (isNegatedMention(text, ref)) continue
    if (ref.includes('/')) {
      if (!pathExists(ref)) problems.push(`${doc} 引用了不存在的路径：${ref}`)
    } else if (!repoIndex.byName.has(ref)) {
      problems.push(`${doc} 引用了仓库里不存在的文件名：${ref}`)
    }
  }
}

// ===== 2. 两份文档提到的文件名集合一致 =====
//
// 归一化成 basename 再比：AGENTS 写 `electron/store.ts`、CLAUDE 写 `store.ts`
// 是风格差异，不算漂移；一方提了另一方完全没提才是真的漏同步。
const basenames = Object.fromEntries(
  Object.entries(docs).map(([doc, text]) => [
    doc,
    new Set([...fileRefs(text)].map((r) => r.split('/').pop())),
  ]),
)
{
  const [a, b] = DOCS
  for (const name of basenames[a]) {
    if (!basenames[b].has(name)) {
      problems.push(`${a} 提到了 ${name}，但 ${b} 没有（两份文档必须同步）`)
    }
  }
  for (const name of basenames[b]) {
    if (!basenames[a].has(name)) {
      problems.push(`${b} 提到了 ${name}，但 ${a} 没有（两份文档必须同步）`)
    }
  }
}

// ===== 3. 提到的 workflow 真实存在 =====
//
// 只认**反引号包裹**的引用：正文里裸写的 `latest.yml` 是更新清单产物名，
// 不是工作流，按裸词匹配会误报。
const workflowDir = path.join(ROOT, '.github/workflows')
const realWorkflows = new Set(
  fs.existsSync(workflowDir) ? fs.readdirSync(workflowDir).filter((f) => f.endsWith('.yml')) : [],
)
const WORKFLOW_REF = /`(?:\.github\/workflows\/)?([a-z0-9-]+\.yml)`/g
for (const [doc, text] of Object.entries(docs)) {
  for (const m of text.matchAll(WORKFLOW_REF)) {
    const name = m[1]
    if (name.startsWith('latest')) continue // 更新清单产物，不是工作流
    if (!realWorkflows.has(name)) {
      problems.push(`${doc} 提到了不存在的工作流：.github/workflows/${name}`)
    }
  }
}

// ===== 3b. README 徽章引用的 workflow 必须存在 =====
//
// 首页徽章是一个 `shields.io/.../actions/workflow/status/<owner>/<repo>/<file>.yml`
// 的 URL。工作流被改名或删除后，徽章会**静默变成灰色**（"no status"），
// 而不是报错——首页看起来就像项目没人维护。两个 README 都要查。
for (const readme of ['README.md', 'README.zh-CN.md']) {
  if (!exists(readme)) continue
  const text = read(readme)
  // 注意是 `actions/workflow/status/`（单数 workflow）——shields.io 的路径就是这样
  for (const m of text.matchAll(/actions\/workflow\/status\/[^/]+\/[^/]+\/([a-z0-9-]+\.yml)/g)) {
    if (!realWorkflows.has(m[1])) {
      problems.push(`${readme} 的 CI 徽章引用了不存在的工作流 ${m[1]}（徽章会静默变灰）`)
    }
  }
}

// ===== 4. 关键数字与代码常量一致 =====
//
// 每条规则：从某个源文件里读出真实值，再确认两份文档都写了这个值。
// 加规则时只加「改错了会静默误导人」的数字——总时限正是典型：
// 它被 Electron 侧硬编码覆盖过一次（文档 80、实际 70），没人发现。
const numberRules = [
  {
    label: '检测总时限',
    source: 'backend/internal/runtime/find.go',
    pattern: /DetectTimeout\s*=\s*(\d+)\s*\*\s*time\.Second/,
    // 文档里必须出现「80 秒」这样的字样
    docPattern: (n) => new RegExp(`${n}\\s*秒|\\b${n}\\s*s\\b`),
  },
]
for (const rule of numberRules) {
  const src = read(rule.source)
  const value = src.match(rule.pattern)?.[1]
  if (!value) {
    problems.push(`无法从 ${rule.source} 解析出「${rule.label}」，请检查正则是否与代码同步`)
    continue
  }
  for (const [doc, text] of Object.entries(docs)) {
    if (!rule.docPattern(value).test(text)) {
      problems.push(`${doc} 未写「${rule.label} = ${value}」，或与 ${rule.source} 的常量不一致`)
    }
  }
}

// ===== 5. Electron 侧不得自己传 --timeout（会覆盖 Go 侧的唯一来源） =====
//
// 只看真正的代码行：注释里出现 `--timeout` 是在解释「为什么不能传」，
// 不该被当成违规。
{
  const runtimeSrc = read('electron/utils/runtime.ts')
  const codeLines = runtimeSrc
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')
  if (/--timeout/.test(codeLines)) {
    problems.push(
      'electron/utils/runtime.ts 传了 --timeout，会覆盖 rt.DetectTimeout 这个唯一来源' +
        '（曾硬编码 70，让文档写的 80 静默失效）',
    )
  }
}

// ===== 输出 =====
if (notes.length) {
  console.log('提示：')
  for (const note of notes) console.log(`  - ${note}`)
}

if (problems.length) {
  console.error('\n文档一致性校验未通过：')
  for (const problem of problems) console.error(`  ✗ ${problem}`)
  console.error(`\n共 ${problems.length} 处。AGENTS.md 与 CLAUDE.md 是同一份知识的两个语言版本，`)
  console.error('改其一时必须同步另一份（见 AGENTS.md 开头）。')
  process.exit(1)
}

console.log(
  `文档一致性校验通过：${DOCS.join(' / ')} 引用的文件与工作流均存在，` +
    `两份文档的文件引用一致，关键数字与代码常量一致。`,
)
