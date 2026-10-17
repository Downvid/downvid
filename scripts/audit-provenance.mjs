#!/usr/bin/env node
/**
 * 代码来源审计（DownVid ↔ 上游 Videdown）。
 *
 * 为什么需要这个检查
 * ------------------
 * DownVid 是从 [Videdown](https://github.com/cshuangyy/videdown) 分叉来的，README 与
 * `LICENSE` 都写了「substantially modified」，但只要没有可复算的凭据，这句话
 * 就永远是一句**自述**。审计文档里的每个百分比都靠人肉抄一遍 diff 得出，
 * 下一次改动之后没人会重算 —— 于是文档写 48%、真实是 71%，谁也不知道。
 *
 * 这类漂移的共同点是**不报错**：数字写错不会让任何测试变红。
 * 本脚本把它变成 CI 里的一次红叉，做法与 `lint-docs.mjs` 校验关键数字同一思路。
 *
 * 判定方法（为什么是「逐字行存活率」而不是 git blame）
 * --------------------------------------------------
 * 上游 `electron/main.ts` 是 2756 行的单文件。DownVid 把它拆成 20 多个模块，
 * 于是 git blame 只能告诉你「这行来自拆分那次提交」，无法告诉你「这行是上游写的」。
 *
 * 所以判定单位是**去掉空白差异的源码行**：
 *   - 上游保留一份逐字快照（`scripts/data/provenance/upstream/`）；
 *   - 对上游每个文件的「有效行」（归一化后 ≥12 字符、且不是纯括号/标签）统计它
 *     在**当前仓库任意文件**里的逐字命中数；
 *   - 同时反向统计每个当前文件有多少行能逐字命中上游 —— 这就是「该文件有多少
 *     上游成分」，用于判断它是否属于「上游衍生」，必须登记。
 *
 * 局限（文档里必须照实写）：逐字命中说明「这行与上游相同」，不说明「这行是抄来的」。
 * 像 `import fs from 'node:fs'`、`export default {` 这类行任何项目都会出现，
 * 所以阈值只用来**挑出需要人工复核的文件**，不是法律意义上的相似度判定。
 *
 * 用法：
 *   node scripts/audit-provenance.mjs            # 校验（CI）
 *   node scripts/audit-provenance.mjs --write    # 重算并写入登记表
 *   node scripts/audit-provenance.mjs --report   # 只打印当前指标
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SNAPSHOT_DIR = path.join(ROOT, 'scripts/data/provenance/upstream')
const REGISTRY_FILE = path.join(ROOT, 'scripts/data/provenance/registry.json')

const MODE = process.argv.includes('--write')
  ? 'write'
  : process.argv.includes('--report')
    ? 'report'
    : 'check'

/**
 * 一个当前文件里「上游成分」超过这个比例，就必须在登记表里出现。
 *
 * 定 15% 而不是更高：`electron/ipc/deps.ts` 这类文件里有大量独立编写的逻辑，
 * 但仍有约 1/5 的行与上游 main.ts 逐字相同（IPC 通道名、参数形状本来就是
 * 由同一个产品需求决定的）。登记表的用途是**强制人复核**，宁可多登记。
 */
const DERIVED_THRESHOLD_PCT = 15

/**
 * 同时要求**绝对行数**下限。
 *
 * 只看比例会把 `src/vite-env.d.ts`（1 行，`/// <reference types="vite/client" />`）
 * 判成 100% 上游衍生 —— 实际上那是 Vite 模板的固定一行，任何 Vite 项目都有。
 * 登记表的价值在于「让人去复核真正的问题文件」，噪声会直接摧毁它。
 */
const DERIVED_MIN_LINES = 8

/** 逐字命中率 ≥ 这个比例的文件归类为「上游逐字保留」，否则是「上游衍生」。 */
const VERBATIM_THRESHOLD_PCT = 90

const SOURCE_EXT = new Set(['.ts', '.vue', '.go', '.css', '.js', '.html'])

/**
 * 不参与审计的目录。
 *
 * `scripts/data/provenance/upstream` 是**上游快照本身**，把它算进「当前仓库」
 * 会让每个上游文件的自匹配率都是 100%，整张表归零。
 */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'release', 'build', 'data', '.vercel', 'upstream',
])

/**
 * 构建产物目录。写成前缀判断是因为 `docker/dist-web` / `docker/dist-server`
 * 是**打出来的前端与单文件服务**，里面有真实的 HTML/JS，但它们不是源码：
 * 把它们算进来，`docker/dist-web/index.html` 会以 60% 的「上游成分」占据榜首。
 */
const isBuildOutput = (name) => name === 'dist' || name === 'dist-electron' || name.startsWith('dist-')

const problems = []

// ===== 归一化与有效行判定 =====

/** 去掉首尾空白并把内部连续空白压成一个空格 —— 缩进/换行风格不算改动。 */
const normalizeLine = (line) => line.replace(/\s+/g, ' ').trim()

/**
 * 是否算「有效行」。
 *
 * 太短的行（`}`、`})`、`export default {`、`</template>`）在任何项目里都会出现，
 * 计入统计会让相似度虚高 —— 上游 *HelloWorld.vue* 就曾靠一堆标签行刷出可观命中。
 */
const PUNCT_ONLY = /^[{}()[\]<>;,./\\|=+\-*:&"`'$#@!\s]*$/
function isSignificant(normalized) {
  if (normalized.length < 12) return false
  if (PUNCT_ONLY.test(normalized)) return false
  if (/^<\/?[a-z-]+>$/.test(normalized)) return false
  return true
}

const toPosix = (p) => p.split(/[\\/]/).join('/')

/** 读文件并按 LF 切行：仓库统一 LF（`.gitattributes`），Windows 检出若变 CRLF 会误判。 */
function readLines(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n')
}

// ===== 建立索引 =====

/** 上游快照：{ relPath: Set<signature> } */
function loadUpstream() {
  const out = new Map()
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (entry.name === '_SOURCE.txt') continue
      if (!SOURCE_EXT.has(path.extname(entry.name))) continue
      const rel = toPosix(path.relative(SNAPSHOT_DIR, full))
      const sigs = new Set()
      for (const line of readLines(full)) {
        const n = normalizeLine(line)
        if (isSignificant(n)) sigs.add(n)
      }
      out.set(rel, sigs)
    }
  }
  walk(SNAPSHOT_DIR)
  return out
}

/** 当前仓库：{ relPath: { sigs:Set, count:number } } */
function loadCurrent() {
  const out = new Map()
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name) || isBuildOutput(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!SOURCE_EXT.has(path.extname(entry.name))) continue
      let lines
      try { lines = readLines(full) } catch { continue }
      const sigs = new Set()
      for (const line of lines) {
        const n = normalizeLine(line)
        if (isSignificant(n)) sigs.add(n)
      }
      if (sigs.size === 0) continue
      out.set(toPosix(path.relative(ROOT, full)), sigs)
    }
  }
  walk(ROOT)
  return out
}

const upstream = loadUpstream()
const current = loadCurrent()
if (upstream.size === 0) {
  console.error(`上游快照为空：${path.relative(ROOT, SNAPSHOT_DIR)}`)
  console.error('请按 _SOURCE.txt 的说明放入上游源码。')
  process.exit(1)
}

/** 全仓库行集合：用于「上游这一行现在还在不在仓库里（可能在别的文件）」。 */
const currentAll = new Set()
for (const sigs of current.values()) for (const sig of sigs) currentAll.add(sig)

/** 上游全行集合：用于「当前这个文件有多少行来自上游」。 */
const upstreamAll = new Set()
for (const sigs of upstream.values()) for (const sig of sigs) upstreamAll.add(sig)

const pct = (part, whole) => (whole === 0 ? 0 : Math.round((part * 1000) / whole) / 10)

// ===== 上游视角：每个上游文件还有多少行活着，活在哪里 =====

const upstreamRows = []
let totalSignificant = 0
let totalRetained = 0
for (const [rel, sigs] of [...upstream.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const retained = [...sigs].filter((s) => currentAll.has(s))
  totalSignificant += sigs.size
  totalRetained += retained.length

  // 活下来的行落在哪些当前文件（用于说明「main.ts 被拆到哪去了」）
  const homes = new Map()
  for (const sig of retained) {
    for (const [curRel, curSigs] of current) {
      if (curSigs.has(sig)) homes.set(curRel, (homes.get(curRel) || 0) + 1)
    }
  }
  const topHomes = [...homes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)

  upstreamRows.push({
    upstreamPath: rel,
    significantLines: sigs.size,
    retainedLines: retained.length,
    retainedPct: pct(retained.length, sigs.size),
    presentAtSamePath: current.has(rel),
    topHomes: topHomes.map(([p, n]) => `${p}(${n})`),
  })
}

// ===== 当前视角：每个当前文件的上游成分 =====

const currentRows = []
for (const [rel, sigs] of [...current.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const overlap = [...sigs].filter((s) => upstreamAll.has(s)).length
  currentRows.push({
    path: rel,
    significantLines: sigs.size,
    upstreamLines: overlap,
    upstreamPct: pct(overlap, sigs.size),
  })
}

const isDerived = (r) => r.upstreamPct >= DERIVED_THRESHOLD_PCT && r.upstreamLines >= DERIVED_MIN_LINES
const derived = currentRows.filter(isDerived)

// ===== 来源分类 =====

/**
 * 分类口径（文档 docs/provenance/audit.md 里逐条解释）：
 *
 * - `upstream-verbatim`：上游有同名文件，且 ≥90% 的上游有效行原封不动还在。
 *   这类文件**几乎等于上游代码**，改它时要意识到自己在改上游实现。
 * - `upstream-derived` ：上游有同名文件，或文件里 ≥15% 的行能逐字命中上游。
 *   属于「拿上游代码继续改出来的」。
 * - `downvid-original` ：不含上游行（<15%），且不是三方依赖。
 * - `third-party`      ：第三方代码或生成物，由依赖清单 / 生成脚本负责，不在本审计范围。
 */
function classify(row) {
  if (row.path.startsWith('backend/') || row.path.startsWith('docker/')) return 'downvid-original'
  const samePath = upstreamRows.find((u) => u.upstreamPath === row.path)
  if (samePath && samePath.retainedPct >= VERBATIM_THRESHOLD_PCT) return 'upstream-verbatim'
  if (samePath || isDerived(row)) return 'upstream-derived'
  return 'downvid-original'
}

// ===== 期望结果 =====

function buildRegistry() {
  const files = new Map()
  for (const row of currentRows) {
    // 只登记「有上游成分」或「上游有同名文件」的，其余一律 downvid-original 由脚本推导，
    // 避免一改代码就要维护几百行登记表 —— 登记表要小到能被人读完。
    const samePath = upstreamRows.find((u) => u.upstreamPath === row.path)
    if (!samePath && !isDerived(row)) continue
    files.set(row.path, {
      origin: classify(row),
      upstreamPath: samePath ? samePath.upstreamPath : null,
      significantLines: row.significantLines,
      upstreamLines: row.upstreamLines,
      upstreamPct: row.upstreamPct,
    })
  }
  // 上游文件即便在仓库里已不存在，也要留记录（说明这段代码去哪了）
  for (const u of upstreamRows) {
    if (files.has(u.upstreamPath) || u.presentAtSamePath) continue
    if (u.retainedLines === 0) continue
    files.set(u.upstreamPath, {
      origin: 'upstream-relocated',
      upstreamPath: u.upstreamPath,
      significantLines: 0,
      upstreamLines: 0,
      upstreamPct: 0,
      retainedElsewhere: u.retainedPct,
      homes: u.topHomes,
    })
  }
  return {
    upstream: {
      origin: 'https://github.com/cshuangyy/videdown',
      commit: '0c620c1b5b487e2ab735c929dd0127419e5cb963',
      forkPoint: '1d7b041^',
    },
    thresholds: { derivedPct: DERIVED_THRESHOLD_PCT, verbatimPct: VERBATIM_THRESHOLD_PCT },
    totals: {
      upstreamSignificantLines: totalSignificant,
      retainedVerbatimLines: totalRetained,
      retainedPct: pct(totalRetained, totalSignificant),
      registryFiles: files.size,
    },
    files: Object.fromEntries([...files.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
  }
}

const expected = buildRegistry()

// ===== 输出 =====

function printReport() {
  console.log('上游快照：cshuangyy/videdown @ 0c620c1（2026-08-22 分叉基线）')
  console.log(`上游有效行 ${totalSignificant}，逐字存活 ${totalRetained}（${pct(totalRetained, totalSignificant)}%）`)
  console.log(`\n上游文件存活情况：`)
  const pad = (s, n) => String(s).padEnd(n)
  console.log(`  ${pad('上游文件', 40)}${pad('有效行', 8)}${pad('存活', 8)}${pad('比例', 8)}活在哪`)
  for (const r of upstreamRows) {
    console.log(
      `  ${pad(r.upstreamPath, 40)}${pad(r.significantLines, 8)}${pad(r.retainedLines, 8)}` +
        `${pad(r.retainedPct + '%', 8)}${r.presentAtSamePath ? '同路径 ' : ''}${r.topHomes.join(' ')}`,
    )
  }
  console.log(`\n上游成分 ≥${DERIVED_THRESHOLD_PCT}% 的当前文件（${derived.length} 个）：`)
  for (const r of derived) {
    console.log(`  ${pad(r.upstreamPct + '%', 7)}${pad(r.upstreamLines + '/' + r.significantLines, 12)}${r.path}`)
  }
}

if (MODE === 'report') {
  printReport()
  process.exit(0)
}

if (MODE === 'write') {
  fs.mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true })
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(expected, null, 2) + '\n')
  printReport()
  console.log(`\n已写入 ${path.relative(ROOT, REGISTRY_FILE)}（${expected.totals.registryFiles} 个文件）`)
  process.exit(0)
}

// ===== check：登记表必须覆盖且数字必须对得上 =====

const notes = []

if (!fs.existsSync(REGISTRY_FILE)) {
  problems.push(
    `缺少来源登记表 ${path.relative(ROOT, REGISTRY_FILE)}。` +
      '运行 node scripts/audit-provenance.mjs --write 生成后审阅并提交。',
  )
} else {
  const actual = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'))

  if (actual.upstream?.commit !== expected.upstream.commit) {
    problems.push(
      `登记表记录的上游 commit（${actual.upstream?.commit}）与快照不一致（应为 ${expected.upstream.commit}）。` +
        '换上游快照时必须整体重算，不能在旧表上挑几个数字改。',
    )
  }

  // 1. 未登记的上游衍生文件
  for (const [rel, rec] of Object.entries(expected.files)) {
    if (!actual.files?.[rel]) {
      problems.push(
        `${rel} 有 ${rec.upstreamPct}% 的行逐字来自上游，但没有登记在 registry.json。` +
          '新增上游衍生文件必须在登记表里写明来源（这是审计清单的唯一入口）。',
      )
    }
  }

  // 2. 登记了但已不再是上游衍生（说明代码已经重写掉，文档里的数字就过期了）
  for (const rel of Object.keys(actual.files || {})) {
    if (!expected.files[rel]) {
      notes.push(`${rel} 已不含上游成分，可以从 registry.json 移除`)
    }
  }

  // 3. 数字漂移
  for (const [rel, rec] of Object.entries(expected.files)) {
    const old = actual.files?.[rel]
    if (!old) continue
    for (const key of ['upstreamLines', 'significantLines', 'upstreamPct', 'origin']) {
      if (old[key] !== rec[key]) {
        problems.push(
          `${rel} 的 ${key} 变了：登记 ${old[key]} → 实测 ${rec[key]}。` +
            '如果这是有意的改动，运行 --write 重算并同步 docs/provenance/audit.md 里的数字。',
        )
      }
    }
  }

  // 4. 总体数字
  if (actual.totals?.retainedPct !== expected.totals.retainedPct) {
    problems.push(
      `上游逐字存活率变了：登记 ${actual.totals?.retainedPct}% → 实测 ${expected.totals.retainedPct}%。` +
        'docs/provenance/audit.md 与 README 里的「substantially modified」都依赖这个数，必须同步。',
    )
  }
}

// ===== 5. 审计文档里的数字必须与实测一致 =====
//
// 与 lint-docs.mjs 校验「检测总时限 80 秒」同一个思路：文档里手抄的数字最容易漂，
// 而漂移**不会让任何测试变红**。这里只校验三个最能代表全局的数字，不逐格比对表格
// （表格是给人读的，强 diff 会产生大量噪音，反而让人想关掉这个检查）。
{
  const docPath = path.join(ROOT, 'docs/provenance/audit.md')
  if (!fs.existsSync(docPath)) {
    problems.push('缺少 docs/provenance/audit.md（来源审计的正文），数字没有地方可对照')
  } else {
    const doc = fs.readFileSync(docPath, 'utf8')
    const mustHave = [
      [String(totalSignificant), '上游有效行数'],
      [String(totalRetained), '逐字存活行数'],
      [`${pct(totalRetained, totalSignificant)}%`, '逐字存活率'],
    ]
    for (const [needle, label] of mustHave) {
      if (!doc.includes(needle)) {
        problems.push(
          `docs/provenance/audit.md 里找不到「${label} = ${needle}」。` +
            '改了代码就必须同步这份文档（--write 会打印现成的表格）。',
        )
      }
    }
  }
}

if (notes.length) {
  console.log('提示：')
  for (const note of notes) console.log(`  - ${note}`)
}

if (problems.length) {
  console.error('\n代码来源审计未通过：')
  for (const problem of problems) console.error(`  ✗ ${problem}`)
  console.error(`\n共 ${problems.length} 处。见 docs/provenance/audit.md。`)
  process.exit(1)
}

console.log(
  `代码来源审计通过：上游 ${totalSignificant} 有效行中 ${totalRetained} 行（${pct(totalRetained, totalSignificant)}%）` +
    `仍逐字保留，${expected.totals.registryFiles} 个文件已登记来源。`,
)
