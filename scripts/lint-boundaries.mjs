#!/usr/bin/env node
/**
 * 架构边界静态校验（docs/provenance/architecture.md §3.2 的七条规则）。
 *
 * ## 为什么需要它
 *
 * 本仓库最擅长把「静默失败」变成 CI 红叉：IPC 三处同步（lint:ipc）、图标名（lint:icons）、
 * 官网词条（lint:website）、文档数字（lint:docs）、代码来源（audit:provenance）。
 * 唯独**架构边界**一直只写在文档里靠自觉维持。
 *
 * 而边界恰恰是最容易悄悄腐化的东西：随手 `import { app } from 'electron'` 到本该纯净的
 * 模块里，类型检查通过、单测通过、桌面端跑得好好的 —— 只有容器镜像会在运行时炸，
 * 而容器 CI 要几分钟才跑到那一步。等发现时，往往已经有十几个模块这么写了。
 *
 * ## 七条规则（与架构文档一一对应）
 *
 * | # | 规则 | 违规后果 |
 * |---|---|---|
 * | 1 | `core/**` 不得 import 'electron' | core 不再可在无 Electron 环境复用 |
 * | 2 | `core/**` 不得 import `src/**` / `docker/**` / `electron/**` | core 依赖了界面或适配层 |
 * | 3 | `src/**` 不得 import `docker/**` | 前端感知到部署形态 |
 * | 4 | `src/**` 不得 import `electron/**`（类型除外） | 前端耦合主进程实现 |
 * | 5 | `electron/**` 不得 import `docker/**` | 桌面端被镜像改动牵连 |
 * | 6 | `docker/server/**` 只能 import core/shared/node/三方 | 容器端依赖 Electron 适配层 |
 * | 7 | 只有 `electron/**` 可以 import 'electron' | 出现第二个 shim |
 *
 * ## 为什么规则 6 / 7 默认是 warning
 *
 * 当前 `docker/server/index.ts` 还有 13 处 `electron/*` import（靠 electron-shim.ts 兜住），
 * 规则 7 也因为 shim 而破例。迁移计划 C4–C6 做完才能收紧。
 * 若一上来就报错，CI 从第一天就是红的 —— 那等于没有校验。
 *
 *   默认：规则 1–5 为 error，规则 6–7 为 warning
 *   `--strict`：全部为 error（C6 完成后开启）
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
    // ---- 规则 1：core 不得 import electron ----
    if (isUnder(rel, 'core') && isElectronModule(spec)) {
      addIssue(rel, spec, 'core 必须是纯 Node（规则 1），Electron 能力请通过端口注入', true)
      continue
    }

    // ---- 规则 2：core 不得依赖界面 / 适配层 / 部署层 ----
    if (isUnder(rel, 'core')) {
      const target = spec.startsWith('.') ? toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec))) : spec
      if (isUnder(target, 'src') || isUnder(target, 'docker') || isUnder(target, 'electron')) {
        addIssue(rel, spec, `core 不能依赖 ${target.split('/')[0]}/（规则 2）`, true)
      }
    }

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
      const allowed = isUnder(target, 'core') || isUnder(target, 'shared') || isUnder(target, 'docker/server')
      if (!allowed && (isUnder(target, 'electron') || isUnder(target, 'src'))) {
        addIssue(
          rel, spec,
          `容器端只能依赖 core/ 与 shared/（规则 6，迁移计划 C6 完成后收紧为 error）`,
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

const coreFiles = [...files.keys()].filter((f) => isUnder(f, 'core')).length
console.log(
  `架构边界校验通过：扫描 ${files.size} 个源文件（core/ ${coreFiles} 个）` +
    `${warnings.length ? `，${warnings.length} 处待收紧的提示` : ''}。`,
)
