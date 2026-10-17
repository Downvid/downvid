#!/usr/bin/env node
/**
 * 工具链版本一致性：Go / Node / pnpm 各自只有一个来源。
 *
 * ## 为什么
 *
 * 实测升级 Go 1.24 → 1.25 时，要改 **20 处**：`ci-linux/macos/windows` 各 2–3 处、
 * `release.yml` 6 处、`codeql.yml`、`update-deps.yml`、`docker/Dockerfile`、`backend/go.mod`。
 * 漏改一处不会报错——CI 只是用旧版本编译，而 Wails 要求 Go ≥ 1.25，
 * 表现为「本地能编、CI 编不过」或者更糟：两个版本编出来的二进制行为不同。
 *
 * 这与 `lint-docs.mjs` 校验「检测总时限 80 秒」是同一类问题：手抄的数字会漂。
 *
 * ## 唯一来源
 *
 * | 工具 | 唯一来源 | 镜像位置 |
 * | --- | --- | --- |
 * | Go  | `backend/go.mod` 的 `go 1.x`（最低版本） | 各 workflow 的 `go-version`、Dockerfile 的 `GO_VERSION` |
 * | Node | `package.json` 的 `engines.node` | 各 workflow 的 `node-version` |
 * | pnpm | `package.json` 的 `packageManager`（`pnpm@11`） | 各 workflow 的 `version:` |
 *
 * ## 用法
 *
 *   node scripts/sync-toolchain-versions.mjs            # 报告
 *   node scripts/sync-toolchain-versions.mjs --fix      # 就地修正
 */

import fs from 'node:fs'
import path from 'node:path'
import glob from 'node:fs'

const ROOT = path.resolve(import.meta.dirname, '..')
const FIX = process.argv.includes('--fix')

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const write = (p, s) => fs.writeFileSync(path.join(ROOT, p), s)

// ===== 唯一来源 =====
const goMod = read('backend/go.mod')
const goMin = /^go\s+(\d+\.\d+)/m.exec(goMod)?.[1]
const pkg = JSON.parse(read('package.json'))
const nodeMin = /(\d+)/.exec(pkg.engines?.node ?? '')?.[1]
const pnpmMajor = /pnpm@(\d+)/.exec(pkg.packageManager ?? '')?.[1]

const problems = []
const fixes = []

if (!goMin) problems.push('backend/go.mod：找不到 `go 1.x` 声明')
if (!nodeMin) problems.push('package.json：缺少 engines.node')
if (!pnpmMajor) problems.push('package.json：缺少 packageManager（形如 "pnpm@11"）')

/** 匹配 workflow 里的版本行，返回 {file, lineNo, current, expected, kind} */
function scan(file) {
  const text = read(file)
  const lines = text.split('\n')
  const found = []
  lines.forEach((line, i) => {
    let m
    if ((m = /^(\s*go-version:\s*')([^']+)(')/.exec(line))) {
      found.push({ i, kind: 'go', current: m[2], expected: goMin })
    } else if ((m = /^(\s*node-version:\s*'?)([^'\s]+)('?)/.exec(line))) {
      found.push({ i, kind: 'node', current: m[2], expected: nodeMin })
    } else if (/^\s*version:\s*'?\d+'?\s*$/.test(line)) {
      // pnpm/action-setup 的 `with: version: 11` —— **现在应该一处都没有**。
      //
      // `package.json` 有了 `packageManager` 之后，action-setup 会自动读它；
      // 再在 CI 里写 version 会直接报错退出：
      //   Error: Multiple versions of pnpm specified:
      //     - version 11 in the GitHub Action config with the key "version"
      //     - version pnpm@11.0.0 in the package.json with the key "packageManager"
      // 这个冲突本地完全发现不了（本机不跑 action-setup），只有 CI 会红。
      const before = lines.slice(Math.max(0, i - 6), i).join('\n')
      if (/pnpm\/action-setup/.test(before)) {
        found.push({ i, kind: 'pnpm-conflict', current: line.trim(), expected: '__REMOVE__' })
      }
    }
  })
  return found
}

const workflows = fs
  .readdirSync(path.join(ROOT, '.github/workflows'))
  .filter((f) => f.endsWith('.yml'))
  .map((f) => `.github/workflows/${f}`)

for (const file of workflows) {
  const hits = scan(file)
  const bad = hits.filter((h) => h.current !== h.expected)
  if (bad.length === 0) continue
  for (const b of bad) {
    if (b.kind === 'pnpm-conflict') {
      problems.push(
        `${file}:${b.i + 1}  写了 ${b.current}，但 package.json 的 packageManager 已经在管版本 → ` +
          'action-setup 会报「Multiple versions of pnpm specified」直接退出（本地发现不了，只有 CI 红）',
      )
    } else {
      problems.push(`${file}:${b.i + 1}  ${b.kind} ${b.current} → 应为 ${b.expected}`)
    }
  }
  if (FIX) {
    const lines = read(file).split('\n')
    // 倒序删，避免下标错位
    for (const b of [...bad].sort((x, y) => y.i - x.i)) {
      if (b.kind === 'pnpm-conflict') {
        lines.splice(b.i, 1)
        // 顺手删掉上面那行孤零零的 `with:`
        if (/^\s*with:\s*$/.test(lines[b.i - 1] ?? '')) lines.splice(b.i - 1, 1)
      } else {
        lines[b.i] = lines[b.i].replace(String(b.current), String(b.expected))
      }
    }
    fixes.push({ file, lines })
  }
}

// Dockerfile 的 GO_VERSION（补丁版，只要求主次与 go.mod 一致）
const dockerPath = 'docker/Dockerfile'
const docker = read(dockerPath)
const dv = /ARG GO_VERSION=(\d+\.\d+)(\.\d+)?/.exec(docker)
if (dv) {
  if (dv[1] !== goMin) {
    problems.push(`${dockerPath}  ARG GO_VERSION=${dv[1]} → 主次版本应为 ${goMin}（与 backend/go.mod 一致）`)
    if (FIX) {
      write(dockerPath, docker.replace(/ARG GO_VERSION=[\d.]+/, `ARG GO_VERSION=${dv[1] === goMin ? dv[1] : `${goMin}${dv[2] ?? ''}`}`))
    }
  }
} else {
  problems.push(`${dockerPath}：找不到 ARG GO_VERSION`)
}

// ===== 输出 =====
if (problems.length === 0) {
  console.log(
    `工具链版本一致：Go ${goMin}、Node ${nodeMin}、pnpm ${pnpmMajor}（扫描 ${workflows.length} 个工作流 + Dockerfile）。`,
  )
  process.exit(0)
}

if (!FIX) {
  console.error(`工具链版本不一致 ${problems.length} 处（唯一来源：backend/go.mod、package.json）：`)
  for (const p of problems) console.error(`  ✗ ${p}`)
  console.error('\n漏改一处不会报错，只会让 CI 用旧版本编译——Wails 据此要求 Go ≥ 1.25。')
  console.error('运行 node scripts/sync-toolchain-versions.mjs --fix 自动修正。')
  process.exit(1)
}

for (const f of fixes) write(f.file, f.lines.join('\n'))
console.log(`已修正 ${fixes.length} 个工作流。请复核 diff 后再提交。`)
