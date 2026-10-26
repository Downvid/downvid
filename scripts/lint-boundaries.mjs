#!/usr/bin/env node
/**
 * 架构边界静态校验（Go 侧）。
 *
 * ## 为什么需要它
 *
 * 边界最容易悄悄腐化：随手 import 一个兄弟包，编译、单测、桌面端全都正常，
 * 只有「换个传输层」的那天才会发现拆不开。
 *
 * ## 校验项
 *
 * | # | 规则 | 违规后果 |
 * |---|---|---|
 * | G1 | `app/internal` 的包之间**不得互相 import** | 单包不再能独立测试/替换，锁死成泥球 |
 * | G2 | `internal` 不得 import `cmd` | 核心耦合具体入口，桌面端与无头端分不开 |
 *
 * G1 是最值得守住的性质：internal 下的包现在互相零依赖，破坏它**不会有任何编译错误**。
 *
 * 用法：node scripts/lint-boundaries.mjs
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const GO_INTERNAL = path.join(ROOT, 'app', 'internal')
const GO_MODULE = 'github.com/Downvid/downvid/app'

const problems = []
const toPosix = (p) => p.split(/[\\/]/).join('/')

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

let packageCount = 0
if (fs.existsSync(GO_INTERNAL)) {
  const packages = fs
    .readdirSync(GO_INTERNAL, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
  packageCount = packages.length

  for (const pkg of packages) {
    for (const file of goFiles(path.join(GO_INTERNAL, pkg))) {
      const relFile = toPosix(path.relative(ROOT, file))
      for (const spec of goImports(file)) {
        const parts = spec.slice(GO_MODULE.length + 1).split('/')

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
              `反向依赖会让核心耦合具体入口。`,
          )
        }
      }
    }
  }
}

if (problems.length) {
  console.error('\n架构边界校验未通过：')
  for (const problem of problems) console.error(`  ✗ ${problem}`)
  console.error(`\n共 ${problems.length} 处。这些违规不会让编译或单测失败，只会让包拆不开。`)
  process.exit(1)
}

console.log(`架构边界校验通过：扫描 ${packageCount} 个 Go 内部包，无跨包依赖。`)
