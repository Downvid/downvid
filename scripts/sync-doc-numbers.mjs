#!/usr/bin/env node
/**
 * 文档里的「当前值类」数字自动同步。
 *
 * ## 为什么单独做这个
 *
 * `lint-docs.mjs` 已经有「关键数字与代码常量一致」的规则，但只有 **1 条**
 * （检测总时限 80 秒）。而实测发现文档里另有 6 处数字已经漂了：
 *
 *   | 位置 | 文档写的 | 实测 |
 *   | --- | --- | --- |
 *   | docs/server-mode.md | 254 条词条 | 286 |
 *   | docs/development.md | 22 文件 / 242 用例 | 28 / 334 |
 *   | docs/standards.md | settings 7 个字段 | 13 |
 *   | AGENTS.md / standards.md | 5 个广播事件 | 6 |
 *   | docs/project-structure.md | scripts 表 | 漏 8 个 |
 *   | verify-release.mjs | 校验 3 个清单 | 实际写 4 个 |
 *
 * 这些漂移的共同点：**不报错**，只是让读文档的人被误导。
 *
 * ## 为什么这批能自动修，而别的不行
 *
 * 只处理**「当前值」**语义的句子——「共有 N 条词条」「N 个用例」这类陈述当下事实的
 * 表述。它们的唯一来源是代码，改错就是错的。
 *
 * **不碰**历史陈述（CHANGELOG 里的「当时 254 条」是对的）、不碰措辞、不碰
 * 「应该有多少」这类判断。判断类的东西强行自动化只会制造噪音（见
 * docs/provenance/decisions.md ADR-005）。
 *
 * ## 用法
 *
 *   node scripts/sync-doc-numbers.mjs            # 只报告
 *   node scripts/sync-doc-numbers.mjs --fix      # 就地修正
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
const FIX = process.argv.includes('--fix')

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const write = (p, s) => fs.writeFileSync(path.join(ROOT, p), s)

// ===== 从代码里量出当前的「真值」 =====

/** i18n 词条数：解析 src/i18n/index.ts 里每个 locale 块的键数量 */
function countI18nKeys() {
  const src = read('src/i18n/index.ts')
  const counts = []
  // 每个 locale 块形如 `'zh-CN': { ... },` / `'en-US': { ... },`
  for (const m of src.matchAll(/'(zh-CN|en-US)':\s*\{/g)) {
    // 从 `{` 开始做花括号配对，取出这一块
    let i = m.index + m[0].length - 1
    let depth = 0
    let end = i
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') {
        depth--
        if (depth === 0) { end = i; break }
      }
    }
    const block = src.slice(m.index, end)
    counts.push([...block.matchAll(/^\s*'[A-Za-z0-9_.]+':/gm)].length)
  }
  return counts.length ? Math.max(...counts) : 0
}

/** 测试文件数与用例数：直接问 vitest（比解析源码准，能反映 it.each 之类） */
function countTests() {
  const tmp = path.join(ROOT, '.vitest-doc-numbers.json')
  try {
    // 用 --outputFile 而不是读 stdout：vitest 的 json reporter 只在 stdout 打一行提示，
    // 报告本身写文件（实测：stdout 里没有 JSON 主体）。
    execFileSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${tmp}`], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 300_000,
    })
    const json = JSON.parse(fs.readFileSync(tmp, 'utf8'))
    // `numTotalTestSuites` 包含每个 describe 块（实测 105），不是文件数；
    // 文件数要数 `testResults` 的长度（实测 28）。
    return { files: json.testResults?.length ?? 0, tests: json.numTotalTests ?? 0 }
  } catch {
    return null
  } finally {
    try { fs.rmSync(tmp, { force: true }) } catch {}
  }
}

/** settings 字段数：从 DEFAULT_SETTINGS 的键数量得出 */
function countSettingsFields() {
  const src = read('src/stores/settings.ts')
  const block = /export const DEFAULT_SETTINGS[\s\S]*?\{([\s\S]*?)\n\}/.exec(src)?.[1] ?? ''
  return [...block.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*):/gm)].map((m) => m[1])
}

/** 广播事件数：preload 里注册的 ipcRenderer.on 数量 */
function countBroadcastEvents() {
  const src = read('electron/preload.ts')
  return [...new Set([...src.matchAll(/ipcRenderer\.on\(\s*'([^']+)'/g)].map((m) => m[1]))]
}

/** IPC 通道数 */
function countIpcChannels() {
  const src = read('electron/preload.ts')
  return [...new Set([...src.matchAll(/ipcRenderer\.(?:invoke)\(\s*'([^']+)'/g)].map((m) => m[1]))]
}

/** scripts 数量 */
function countScripts() {
  return fs.readdirSync(path.join(ROOT, 'scripts')).filter((f) => f.endsWith('.mjs') || f.endsWith('.sh')).length
}

// ===== 规则表 =====
//
// 每条规则：在哪个文件、用什么正则匹配「当前值」句子、替换成什么。
// 正则必须**带捕获组包住数字**，且周围上下文足够唯一，避免误伤历史陈述。
const i18nCount = countI18nKeys()
const settings = countSettingsFields()
const events = countBroadcastEvents()
const channels = countIpcChannels()
const scripts = countScripts()
const tests = countTests()

/**
 * 统一补全局标志。
 *
 * `String.prototype.matchAll` **要求**正则带 `g`，而规则表里很容易漏写——
 * 第一版就是这么崩的。集中处理比在 6 条正则里逐条记得更可靠。
 */
function withGlobal(re) {
  return re.global ? re : new RegExp(re.source, re.flags + 'g')
}

const rules = [
  {
    label: 'i18n 词条数',
    file: 'docs/server-mode.md',
    pattern: /(\d+)( 条词条 × 2 语言)/g,
    actual: i18nCount,
  },
  {
    label: 'i18n 词条数（复用句）',
    file: 'docs/server-mode.md',
    pattern: /的 (\d+) 条词条也直接复用/g,
    actual: i18nCount,
  },
  {
    label: 'settings 字段列表',
    file: 'docs/standards.md',
    // 整行替换：字段清单变了就整句重写，不比数量（数量对但名字错了同样误导）
    pattern: /当前字段：`[^`]+`(?:、`[^`]+`)*/,
    actual: settings.length ? `当前字段：${settings.map((f) => `\`${f}\``).join('、')}` : null,
    staticValue: true,
  },
  {
    label: '广播事件数',
    file: 'AGENTS.md',
    pattern: /现有事件：(?:`[^`]+`、)*`[^`]+`/,
    actual: events.length ? `现有事件：${events.map((e) => `\`${e}\``).join('、')}` : null,
    staticValue: true,
  },
  {
    // CLAUDE.md 是 AGENTS.md 的英文镜像，同一份清单必须两边都新——
    // 而 `lint-docs.mjs` 只比文件**名**集合，比不出「清单内容不同步」。
    // 这条规则补的正是那个缺口。
    label: '广播事件（CLAUDE 英文镜像）',
    file: 'CLAUDE.md',
    pattern: /Existing: (?:`[^`]+`, )*`[^`]+`\./,
    actual: events.length ? `Existing: ${events.map((e) => `\`${e}\``).join(', ')}.` : null,
    staticValue: true,
  },
  {
    label: '广播事件数（standards）',
    file: 'docs/standards.md',
    pattern: /现有事件：(?:`[^`]+`、)*`[^`]+`/,
    actual: events.length ? `现有事件：${events.map((e) => `\`${e}\``).join('、')}` : null,
    staticValue: true,
  },
  {
    label: 'scripts 数量',
    file: 'docs/project-structure.md',
    pattern: /`scripts\/`（(\d+) 个/g,
    actual: scripts,
    optional: true,
  },
]

if (tests) {
  rules.push({
    label: '测试文件/用例数',
    file: 'docs/development.md',
    pattern: /pnpm test\s+# (\d+) 个文件 \/ (\d+) 个用例/,
    actual: null,
    custom: (line) => line.replace(/(\d+) 个文件 \/ (\d+) 个用例/, `${tests.files} 个文件 / ${tests.tests} 个用例`),
  })
}

// ===== 执行 =====

const drift = []
for (const rule of rules) {
  const full = path.join(ROOT, rule.file)
  if (!fs.existsSync(full)) continue
  let text = read(rule.file)
  rule.pattern = withGlobal(rule.pattern)
  const matches = [...text.matchAll(rule.pattern)]
  if (matches.length === 0) continue

  for (const m of matches) {
    let ok, expected, found
    if (rule.custom) {
      const replaced = rule.custom(m[0])
      ok = replaced === m[0]
      expected = replaced
      found = m[0]
    } else if (rule.staticValue) {
      ok = m[0] === rule.actual
      expected = rule.actual
      found = m[0]
    } else {
      found = Number(m[1])
      expected = rule.actual
      ok = found === expected
    }
    if (ok || expected == null) continue

    drift.push({ rule, file: rule.file, found, expected })
    if (FIX) {
      text = rule.custom
        ? text.split(m[0]).join(rule.custom(m[0]))
        : rule.staticValue
          ? text.split(m[0]).join(rule.actual)
          : text.replace(m[0], m[0].replace(String(m[1]), String(rule.actual)))
    }
  }
  if (FIX && drift.some((d) => d.file === rule.file)) write(rule.file, text)
}

// ===== 输出 =====

if (drift.length === 0) {
  console.log(
    `文档数字校验通过：词条 ${i18nCount}、settings ${settings.length} 字段、` +
      `广播事件 ${events.length}、IPC 通道 ${channels.length}、scripts ${scripts}` +
      `${tests ? `、测试 ${tests.files} 文件 / ${tests.tests} 用例` : ''}。`,
  )
  process.exit(0)
}

const verb = FIX ? '已修正' : '发现漂移'
console.log(`${verb} ${drift.length} 处：`)
for (const d of drift) {
  console.log(`  ${FIX ? '✓' : '✗'} ${d.file}：${d.rule.label} ${d.found} → ${d.expected}`)
}

if (!FIX) {
  console.error('\n这些数字与代码里的实测值不一致。它们不会让任何测试变红，只会误导读文档的人。')
  console.error('运行 node scripts/sync-doc-numbers.mjs --fix 自动修正。')
  process.exit(1)
}
console.log('\n已写入。请复核 diff 后再提交。')
