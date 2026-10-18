#!/usr/bin/env node
/**
 * 架构边界静态校验。
 *
 * ## 为什么需要它
 *
 * 本仓库擅长把「静默失败」变成 CI 红叉（lint:ipc / lint:icons / lint:website /
 * lint:docs / audit:provenance），唯独**架构边界**一直只写在文档里靠自觉维持。
 *
 * 而边界恰恰最容易悄悄腐化：随手 import 'electron' 到本该纯净的模块里，
 * 类型检查通过、单测通过、桌面端跑得好好的 —— 只有容器镜像会在运行时炸，
 * 而容器 CI 要几分钟才跑到那一步。
 *
 * ## 校验对象在 2026-10 变了
 *
 * 早先这套规则守护的是 core/（一个「桌面端与容器端共用纯 Node 核心」的目录）。
 * 但 Wails 方案落地后，**真正可复用的核心是 Go 的 app/internal/**——
 * 那个 core/ 从来没被任何代码 import 过，是个空壳，已删除。
 *
 * 所以现在做两类校验。
 *
 * ### A. Go 侧分层（新的主要职责）
 *
 * | # | 规则 | 违规后果 |
 * |---|---|---|
 * | G1 | internal 包之间**不得互相 import** | 单包不再能独立测试/替换，锁死成泥球 |
 * | G2 | internal 不得 import cmd | 核心耦合具体入口，桌面端与容器端分不开 |
 *
 * G1 是最值得守住的性质：14 个包现在互相零依赖，破坏它**不会有任何编译错误**，
 * 只会让「换个传输层」（Wails 绑定 → 容器 WebSocket）越来越难。
 *
 * ### B. TS 侧旧边界（Electron 退役前仍需守住）
 *
 * | # | 规则 | 违规后果 |
 * |---|---|---|
 * | 3 | src 不得 import docker | 前端感知到部署形态 |
 * | 4 | src 不得 import electron（类型除外） | 前端耦合主进程实现 |
 * | 5 | electron 不得 import docker | 桌面端被镜像改动牵连 |
 * | 6 | docker/server 只能 import shared/node/三方 | 容器端依赖 Electron 适配层 |
 * | 7 | 只有 electron 可以 import 'electron' | 出现第二个 shim |
 *
 * 规则 6 / 7 默认 warning：docker/server/index.ts 还有 13 处 electron import
 * （靠 electron-shim.ts 兜住）。一上来就报错等于没有校验。
 *
 *   默认：Go 两条 + TS 规则 3-5 为 error，规则 6-7 为 warning
 *   --strict：全部为 error
 *
 * 用法：
 *   node scripts/lint-boundaries.mjs
 *   node scripts/lint-boundaries.mjs --strict
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const STRICT = process.argv.includes('--strict')

const SKIP_DIRS = new Set(['node_modules', '.git', 'release', 'build', 'data', '.vercel'])
/** 构建产物前缀（`docker/dist-web` 是打出来的前端，不是源码） */
const isBuildOutput = (name) => name === 'dist' || name === 'dist-electron' || name.startsWith('dist-')

const SOURCE_EXT = new Set(['.ts', '.vue', '.mjs', '.js'])

const problems = []
const warnings = []

const toPosix = (p) => p.split(/[\\/]/).join('/')

// ===== 收集源码文件 =====

/** @type {Map<string, string>} relPath(posix) -> source text */
const files = new Map()
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || isBuildOutput(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { walk(full); continue }
    if (!SOURCE_EXT.has(path.extname(entry.name))) continue
    const rel = toPosix(path.relative(ROOT, full))
    try { files.set(rel, fs.readFileSync(full, 'utf8')) } catch {}
  }
}
walk(ROOT)

// ===== 提取 import 说明符 =====

/**
 * 只做「够用」的提取，不引 TypeScript 编译器 API。
 *
 * 理由：这个脚本要在 CI 的 frontend job 里跑，而那里的依赖装得越少越稳。
 * 边界违规的形态高度一致（`from 'xxx'` / `import('xxx')` / `require('xxx')`），
 * 正则足够；漏掉的极端写法（如动态拼接说明符）本来也无法静态判定。
 */
function importSpecifiers(source) {
  const out = []
  // 静态 import / export ... from
  for (const m of source.matchAll(/(?:^|\n)\s*(?:import|export)\s[\s\S]{0,500}?from\s*['"]([^'"]+)['"]/g)) out.push(m[1])
  // 副作用 import：import 'x'
  for (const m of source.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) out.push(m[1])
  // 动态 import('x') / require('x')
  for (const m of source.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1])
  return out
}

/** 注释里提到的 import 不算违规（本仓库注释里大量解释「为什么不这么写」） */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n')
}

const isUnder = (rel, dir) => rel === dir || rel.startsWith(`${dir}/`)
const isElectronModule = (spec) => spec === 'electron' || spec.startsWith('electron/')

// ===== 逐条检查 =====

function addIssue(rel, spec, message, strictDefault) {
  const entry = `${rel} → '${spec}'：${message}`
  if (strictDefault) problems.push(entry)
  else warnings.push(entry)
}

for (const [rel, raw] of files) {
  const source = stripComments(raw)
  const specs = importSpecifiers(source)

  for (const spec of specs) {
    // ---- 规则 3 / 4：前端不得依赖部署形态，也不得直接用 Electron ----
    //
    // 规则 4 有两种形态，都要拦：
    //   a) `import { app } from 'electron'`（裸模块名）—— 变异测试里发现只写相对路径判定
    //      会漏掉它，而那正是最容易发生的一种（随手补个粘贴就写出来了）
    //   b) `import { parseWithYtdlp } from '../electron/parsers/ytdlp'`（相对路径）
    if (isUnder(rel, 'src') && isElectronModule(spec)) {
      addIssue(rel, spec, '前端不得直接使用 Electron（规则 4）；类型请走 src/env.d.ts 的内联 import', true)
    }
    if (isUnder(rel, 'src') && spec.startsWith('.')) {
      const target = toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)))
      if (isUnder(target, 'docker')) addIssue(rel, spec, '前端不得感知部署形态（规则 3）', true)
      // ---- 规则 4：前端不得 import 主进程实现 ----
      if (isUnder(target, 'electron')) {
        addIssue(rel, spec, '前端不得直接 import 主进程实现（规则 4）；类型请走 src/env.d.ts 的内联 import', true)
      }
    }

    // ---- 规则 5：桌面端不得 import docker ----
    if (isUnder(rel, 'electron') && spec.startsWith('.')) {
      const target = toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)))
      if (isUnder(target, 'docker')) addIssue(rel, spec, '桌面端不得依赖容器实现（规则 5）', true)
    }

    // ---- 规则 6：容器服务端只能依赖 core / shared / node / 三方 ----
    if (isUnder(rel, 'docker/server') && spec.startsWith('.')) {
      const target = toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)))
      const allowed = isUnder(target, 'shared') || isUnder(target, 'docker/server')
      if (!allowed && (isUnder(target, 'electron') || isUnder(target, 'src'))) {
        addIssue(
          rel, spec,
          `容器端只能依赖 shared/（规则 6，Electron 退役后收紧为 error）`,
          STRICT,
        )
      }
    }

    // ---- 规则 7：只有 electron/** 可以 import electron ----
    if (isElectronModule(spec) && !isUnder(rel, 'electron')) {
      // 唯一的已知例外：容器的 electron 替身自己（它要实现这个模块的形状）
      const isShim = rel === 'docker/server/electron-shim.ts'
      if (!isShim) {
        addIssue(rel, spec, `只有 electron/** 可以 import 'electron'（规则 7）`, STRICT)
      }
    }
  }
}

// ===== A. Go 侧分层（新的主要职责）=====
//
// 校验的是 `app/internal/*` 之间**不得互相 import**。
//
// 为什么这条值得守：14 个包现在互相零依赖，这是当前的真实状态，也是
// 最容易被无意识破坏的性质 —— 破坏它不会有任何编译错误，只会让
// 「换个传输层」（Wails 绑定 → 容器 WebSocket）变得越来越难。
// 每个包都能独立测试、独立替换，正是这个架构最大的价值。

const GO_INTERNAL = path.join(ROOT, 'app', 'internal')
const GO_MODULE = 'github.com/Downvid/downvid/app'

/** 读一个目录下的所有 .go 文件（不含子目录） */
function goFiles(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.go'))
    .map((e) => path.join(dir, e.name))
}

/** 从一个 .go 文件里抽出全部 `github.com/Downvid/downvid/app/...` import */
function goImports(file) {
  const source = fs.readFileSync(file, 'utf8')
  const out = []
  // 只认 import 块和单行 import，不认注释（Go 的注释里常举例写路径）
  const importBlock = source.match(/import\s*\(([\s\S]*?)\)/g) || []
  const single = source.match(/import\s+(?:\w+\s+)?"([^"]+)"/g) || []
  for (const chunk of [...importBlock, ...single]) {
    for (const m of chunk.matchAll(/"([^"]+)"/g)) out.push(m[1])
  }
  return out.filter((p) => p.startsWith(GO_MODULE))
}

let goPackageCount = 0
if (fs.existsSync(GO_INTERNAL)) {
  const packages = fs.readdirSync(GO_INTERNAL, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
  goPackageCount = packages.length

  for (const pkg of packages) {
    const dir = path.join(GO_INTERNAL, pkg)
    for (const file of goFiles(dir)) {
      const relFile = toPosix(path.relative(ROOT, file))
      for (const spec of goImports(file)) {
        const rest = spec.slice(GO_MODULE.length + 1) // 'internal/xxx' / 'cmd/xxx'
        const parts = rest.split('/')

        // ---- G1：internal 包之间不得互相 import ----
        if (parts[0] === 'internal' && parts[1] && parts[1] !== pkg) {
          problems.push(
            `${relFile} → '${spec}'：internal 包之间不得互相依赖（规则 G1）。` +
              `每个包都要能独立测试、独立替换 —— 需要共享的代码请下沉成新包或复制少量逻辑。`,
          )
        }

        // ---- G2：internal 不得反向依赖入口 ----
        if (parts[0] === 'cmd') {
          problems.push(
            `${relFile} → '${spec}'：internal 不得依赖 cmd（规则 G2）。` +
              `反向依赖会让核心耦合具体入口，容器端与桌面端就分不开了。`,
          )
        }
      }
    }
  }
}

// ===== 输出 =====

if (warnings.length) {
  console.log(`边界提示（${warnings.length} 处，迁移计划 C6 完成后收紧为 error）：`)
  const byRule = new Map()
  for (const w of warnings) {
    const key = w.split('：').pop()
    if (!byRule.has(key)) byRule.set(key, [])
    byRule.get(key).push(w)
  }
  for (const [rule, list] of byRule) {
    console.log(`  · ${rule} —— ${list.length} 处`)
    for (const line of list.slice(0, 3)) console.log(`      ${line}`)
    if (list.length > 3) console.log(`      … 另有 ${list.length - 3} 处`)
  }
  console.log('')
}

if (problems.length) {
  console.error('\n架构边界校验未通过：')
  for (const problem of problems) console.error(`  ✗ ${problem}`)
  console.error(`\n共 ${problems.length} 处。规则说明见 docs/provenance/architecture.md §3.2。`)
  console.error('这些违规不会让类型检查或单测变红，只会在容器/前端运行时静默失效。')
  process.exit(1)
}

console.log(
  `架构边界校验通过：扫描 ${files.size} 个 TS 源文件 + ${goPackageCount} 个 Go 内部包` +
    `${warnings.length ? `，${warnings.length} 处待收紧的提示` : ''}。`,
)
