#!/usr/bin/env node
/**
 * GitHub Actions 工作流健全性校验。
 *
 * ## 为什么需要
 *
 * 工作流的错误**只在 CI 上暴露**，本地无论跑什么都发现不了——写错一步，
 * 推上去等几分钟才看到红叉。实测踩过的两个（都是同一天）：
 *
 *   1. `triage.yml` 里跑了 `pnpm install` 却**没装 pnpm**，
 *      runner 直接 `pnpm: command not found`（exit 127）失败
 *   2. 用了 `node` 却没 `actions/setup-node`，拿到的是 runner 自带的旧版本
 *
 * 这类问题有固定形态：**「用了某个工具」与「装该工具」必须成对出现**。
 * 完全可以静态查出来，不必靠人肉记。
 *
 * ## 校验项
 *
 *   1. `run` 里出现 `pnpm` → 必须有 `pnpm/action-setup`
 *   2. `run` 里出现 `node` / `pnpm` / `npx` → 必须有 `actions/setup-node`
 *   3. `run` 里出现 `go ` → 必须有 `actions/setup-go`
 *   4. 每个 job 必须有 `timeout-minutes`：卡住的 job 会占满 6 小时配额
 *      （runner 默认 360 分钟），仓库里所有 job 都显式设了超时，保持一致
 *
 * 用法：node scripts/lint-workflows.mjs
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const DIR = path.join(ROOT, '.github/workflows')

const problems = []
const notes = []

/** 极简的「按缩进切 job」解析——不引入 YAML 依赖（仓库刻意零依赖） */
function jobsOf(text) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l))
  if (start === -1) return []
  const jobs = []
  let current = null
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (/^\S/.test(line)) break // 回到顶层键，jobs 段结束
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (m) {
      if (current) jobs.push(current)
      current = { name: m[1], body: '' }
      continue
    }
    if (current) current.body += line + '\n'
  }
  if (current) jobs.push(current)
  return jobs
}

/** 该 job 是否使用了某个 action */
const usesAction = (body, name) => new RegExp(`uses:\\s*${name.replace('/', '\\/')}@`).test(body)

/** 收集 job 里所有 `run:` 块的文本 */
function runText(body) {
  const out = []
  const lines = body.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(-\s*)?run:\s*/.test(lines[i])) {
      const indent = lines[i].match(/^\s*/)[0].length
      out.push(lines[i])
      // 继续收集缩进更深的续行（多行 run: | 块）
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j]
        if (l.trim() === '') {
          out.push(l)
          continue
        }
        if (l.match(/^\s*/)[0].length <= indent) break
        out.push(l)
      }
    }
  }
  return out.join('\n')
}

const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.yml')) : []
if (!files.length) {
  console.error('没有找到任何工作流文件')
  process.exit(1)
}

for (const file of files) {
  const text = fs.readFileSync(path.join(DIR, file), 'utf8')
  const jobs = jobsOf(text)
  if (!jobs.length) {
    notes.push(`${file}：未解析出 job（可能格式特殊，本脚本跳过）`)
    continue
  }
  for (const job of jobs) {
    const runs = runText(job.body)
    if (!runs.trim()) continue
    const where = `${file} → job \`${job.name}\``

    // 只在**命令位置**匹配，避免注释里提到 pnpm 就误报
    const commandLines = runs
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n')

    if (/\bpnpm\s+(install|run|exec|--)/.test(commandLines)) {
      if (!usesAction(job.body, 'pnpm/action-setup')) {
        problems.push(`${where} 用了 pnpm 但没有 pnpm/action-setup（runner 上会 command not found）`)
      }
      // pnpm 自己跑在 Node 上，所以用了 pnpm 就必须同时有 setup-node——
      // 只查「有没有 node 命令」是不够的：`pnpm vue-tsc` / `pnpm test`
      // 这类命令字面上没有 `node`，却同样依赖 Node 版本。
      if (!usesAction(job.body, 'actions/setup-node')) {
        problems.push(`${where} 用了 pnpm 但没有 actions/setup-node（pnpm 依赖 Node，版本不可控）`)
      }
    }
    if (/\b(node|npx)\s+[\w./-]/.test(commandLines) && !usesAction(job.body, 'actions/setup-node')) {
      problems.push(`${where} 用了 node 但没有 actions/setup-node（会用 runner 自带的旧版本）`)
    }
    if (/\bgo\s+(build|test|vet|version)\b/.test(commandLines) && !usesAction(job.body, 'actions/setup-go')) {
      problems.push(`${where} 用了 go 但没有 actions/setup-go`)
    }
    if (!/timeout-minutes:/.test(job.body)) {
      problems.push(`${where} 没有 timeout-minutes（卡住会占满默认 6 小时配额）`)
    }

    // `docker exec <容器> <命令>` 不走 shell：`command` / `test` / `[` 这些是
    // **shell 内建命令，没有可执行文件**。Docker 会去 PATH 里找同名程序，
    // 必然失败（exit 127），报错却长成「依赖不在 PATH 中」的样子
    // ——docker 工作流的冒烟曾因此长期红，而镜像其实完全正常。
    for (const m of commandLines.matchAll(/docker\s+exec\s+(?:[^\n]*?)\s(?:-u\s+\S+\s+)?(command|test|\/usr\/bin\/test)\b/g)) {
      problems.push(
        `${where} 用了 \`docker exec ... ${m[1]}\`：${m[1]} 是 shell 内建命令，` +
          '容器里没有对应可执行文件，必然 exit 127。改成 `docker exec <容器> sh -c "…"`。',
      )
    }
  }
}

if (notes.length) {
  console.log('提示：')
  for (const n of notes) console.log(`  - ${n}`)
}

if (problems.length) {
  console.error('\n工作流健全性校验未通过：')
  for (const p of problems) console.error(`  ✗ ${p}`)
  process.exit(1)
}

console.log(`工作流健全性校验通过：${files.length} 个工作流，工具与安装步骤成对、job 均设了超时。`)
