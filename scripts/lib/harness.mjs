#!/usr/bin/env node
/**
 * 集成测试脚本的公共骨架。
 *
 * 为什么需要它：`scripts/test-*.mjs` 是「起真实进程、跑真实文件 IO」的回归脚本，
 * 每个都自己写一套 try/catch 与计数，失败时的输出格式各不相同，CI 日志里
 * 很难一眼看出「哪一层、哪个用例、什么现象」。这个模块把三件事固定下来：
 *
 *   1. **每个用例都有名字**，失败时打印名字 + 断言详情 + 现场（临时目录、命令行）
 *   2. **失败不中断**：一个用例挂了仍跑完其余用例，一次跑出全部问题
 *      （CI 上最贵的成本是「修一个 → 重跑 → 又发现一个」）
 *   3. **退出码严格**：只要有失败就是 1；`--filter <子串>` 可只跑部分用例
 *
 * 用法：
 *
 *   import { createSuite } from './lib/harness.mjs'
 *
 *   const suite = createSuite('下载集成回归')
 *   suite.case('断点续传保留逐段进度', async (t) => {
 *     t.ok(cond, '说明')
 *     t.equal(a, b, '说明')
 *   })
 *   await suite.run()
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR
const c = (code, s) => (COLOR ? `\u001b[${code}m${s}\u001b[0m` : s)
const green = (s) => c('32', s)
const red = (s) => c('31', s)
const yellow = (s) => c('33', s)
const dim = (s) => c('2', s)

/** 断言失败。带上足够现场信息，CI 日志里不用再翻上下文 */
class AssertionFailure extends Error {}

function formatValue(v) {
  if (typeof v === 'string') return JSON.stringify(v)
  if (v instanceof Error) return v.message
  try {
    const s = JSON.stringify(v)
    return s === undefined ? String(v) : s
  } catch {
    return String(v)
  }
}

/**
 * 单个用例的断言上下文。
 *
 * 只提供最小集合（ok/equal/notEqual/deepEqual/match/fail），够用且不需要
 * 引入断言库——边车与前端都不引第三方依赖，测试脚本同样保持零依赖。
 */
function createAsserter() {
  const failures = []
  const notes = []

  const api = {
    /** 记录一条现场信息（命令行、路径、耗时），失败时一并打印 */
    note(label, value) {
      notes.push(`${label}: ${formatValue(value)}`)
    },
    ok(cond, message) {
      if (!cond) failures.push(message || '断言失败：期望为真')
    },
    equal(actual, expected, message) {
      if (actual !== expected) {
        failures.push(`${message || '值不相等'}\n      实际: ${formatValue(actual)}\n      期望: ${formatValue(expected)}`)
      }
    },
    notEqual(actual, unexpected, message) {
      if (actual === unexpected) {
        failures.push(`${message || '值不应相等'}\n      两者都是: ${formatValue(actual)}`)
      }
    },
    deepEqual(actual, expected, message) {
      const a = JSON.stringify(actual)
      const b = JSON.stringify(expected)
      if (a !== b) {
        failures.push(`${message || '结构不相等'}\n      实际: ${a}\n      期望: ${b}`)
      }
    },
    match(value, pattern, message) {
      const re = pattern instanceof RegExp ? pattern : new RegExp(pattern)
      if (!re.test(String(value))) {
        failures.push(`${message || '未匹配期望的模式'}\n      值: ${formatValue(value)}\n      模式: ${re}`)
      }
    },
    /** 明确失败，用于走到不该走到的分支 */
    fail(message) {
      failures.push(message || '显式失败')
    },
    get failures() {
      return failures
    },
    get notes() {
      return notes
    },
  }
  return api
}

export function createSuite(name, { timeoutMs = 15 * 60 * 1000 } = {}) {
  const cases = []
  const tempDirs = []

  const suite = {
    name,

    /**
     * 注册一个用例。
     *
     * @param title 用例名，会直接出现在 CI 日志里，请写清「验证的是什么行为」
     * @param fn    (t) => void | Promise<void>，t 是断言上下文
     * @param opts  { skip?: boolean|string } 跳过并说明原因
     */
    case(title, fn, opts = {}) {
      cases.push({ title, fn, opts })
      return suite
    },

    /** 建一个本次运行结束会清理的临时目录 */
    tempDir(prefix = 'downvid-test-') {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
      tempDirs.push(dir)
      return dir
    },

    async run() {
      const filter = (() => {
        const i = process.argv.indexOf('--filter')
        return i === -1 ? null : process.argv[i + 1]
      })()

      const selected = filter ? cases.filter((t) => t.title.includes(filter)) : cases
      if (filter) console.log(dim(`（--filter ${filter}：${selected.length}/${cases.length} 个用例）`))

      const failures = []
      let passed = 0
      let skipped = 0
      const startedAll = Date.now()

      for (const [index, item] of selected.entries()) {
        const label = `[${index + 1}/${selected.length}] ${item.title}`
        if (item.opts.skip) {
          skipped++
          console.log(`${yellow('○')} ${label} ${dim(`— ${typeof item.opts.skip === 'string' ? item.opts.skip : '跳过'}`)}`)
          continue
        }

        const t = createAsserter()
        const started = Date.now()
        let crashed = null
        try {
          await Promise.race([
            Promise.resolve(item.fn(t)),
            new Promise((_, reject) => setTimeout(() => reject(new Error(`用例超时（${timeoutMs} ms）`)), timeoutMs).unref?.()),
          ])
        } catch (error) {
          crashed = error
        }
        const elapsed = Date.now() - started

        if (!crashed && t.failures.length === 0) {
          passed++
          console.log(`${green('✓')} ${label} ${dim(`${elapsed} ms`)}`)
          for (const note of t.notes) console.log(dim(`      ${note}`))
          continue
        }

        failures.push(item.title)
        console.log(`${red('✗')} ${label} ${dim(`${elapsed} ms`)}`)
        if (crashed) {
          console.log(red(`      抛出异常: ${crashed.message}`))
          if (crashed.stack) {
            for (const line of crashed.stack.split('\n').slice(1, 4)) console.log(dim(`      ${line.trim()}`))
          }
        }
        for (const f of t.failures) console.log(red(`      ${f}`))
        for (const note of t.notes) console.log(dim(`      ${note}`))
      }

      // 清理临时目录：失败时**保留**，便于人工复现
      if (failures.length === 0) {
        for (const dir of tempDirs) {
          try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
        }
      } else if (tempDirs.length) {
        console.log(dim(`\n失败时保留临时目录以便复现：`))
        for (const dir of tempDirs) console.log(dim(`  ${dir}`))
      }

      const total = selected.length
      const elapsed = ((Date.now() - startedAll) / 1000).toFixed(1)
      console.log('')
      if (failures.length === 0) {
        console.log(green(`✓ ${name}：${passed}/${total} 通过${skipped ? `（跳过 ${skipped}）` : ''}，${elapsed}s`))
        return
      }
      console.log(red(`✗ ${name}：${passed}/${total} 通过，${failures.length} 个失败，${elapsed}s`))
      for (const f of failures) console.log(red(`  · ${f}`))
      process.exitCode = 1
    },
  }

  return suite
}

/** 当前平台的说明，方便用例决定是否跳过 */
export const platform = {
  isWindows: process.platform === 'win32',
  isMac: process.platform === 'darwin',
  isLinux: process.platform === 'linux',
  name: process.platform,
  arch: process.arch,
}

/** 在 PATH 里找一个可执行文件；找不到返回 null */
export function which(cmd) {
  const exts = platform.isWindows ? ['', '.exe', '.cmd', '.bat'] : ['']
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const full = path.join(dir, cmd + ext)
      try {
        fs.accessSync(full, fs.constants.X_OK)
        return full
      } catch {}
    }
  }
  return null
}

/** 写一个可执行的假二进制（POSIX 用 shell 脚本，Windows 用 .bat） */
export function writeFakeBinary(dir, name, output, { mode = 'version' } = {}) {
  fs.mkdirSync(dir, { recursive: true })
  if (platform.isWindows) {
    const file = path.join(dir, `${name}.bat`)
    const body = mode === 'error' ? `@echo ${output} 1>&2\r\n@exit /b 1\r\n` : `@echo ${output}\r\n`
    fs.writeFileSync(file, body)
    return file
  }
  const file = path.join(dir, name)
  const body = mode === 'error'
    ? `#!/bin/sh\necho '${output}' >&2\nexit 1\n`
    : `#!/bin/sh\necho '${output}'\n`
  fs.writeFileSync(file, body, { mode: 0o755 })
  return file
}

export { AssertionFailure }
