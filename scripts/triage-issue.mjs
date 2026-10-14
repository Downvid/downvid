#!/usr/bin/env node
/**
 * Issue 分类的命令行入口（供 `.github/workflows/triage.yml` 调用）。
 *
 * 单独成脚本而不是把逻辑塞进 `github-script`：`actions/github-script` 跑的是
 * 一段被包起来的脚本，**没法直接 require `.ts`**，而分类逻辑必须与界面、
 * 回归用例共用同一份实现（复制一份就等于没测）。
 * 这里复用 `lib/load-source.mjs` 的 TS 转译加载器，拿到的是**同一份**代码。
 *
 * 用法（CI 里这样调用）：
 *   node scripts/triage-issue.mjs --body-file /tmp/issue-body.txt
 *
 * 输出（写到 $GITHUB_OUTPUT，本地运行时直接打印 JSON）：
 *   close=true|false
 *   reason=template-only|self-service|ok
 *   comment<<EOF … EOF      （多行，自动关闭时的回复正文）
 */

import fs from 'node:fs'
import { loader } from './lib/load-source.mjs'

const load = loader()
const { classifyIssue, commentFor } = load('scripts/lib/issue-triage.ts')

function readBody() {
  const i = process.argv.indexOf('--body-file')
  if (i !== -1 && process.argv[i + 1]) {
    return fs.readFileSync(process.argv[i + 1], 'utf8')
  }
  // 也支持从 stdin 读，方便本地调试：echo "..." | node scripts/triage-issue.mjs
  try {
    return fs.readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

const verdict = classifyIssue(readBody())
const comment = commentFor(verdict)

const out = {
  close: String(verdict.close),
  reason: verdict.reason,
  comment,
}

const outputFile = process.env.GITHUB_OUTPUT
if (outputFile) {
  // 多行值必须用 heredoc 语法写进 $GITHUB_OUTPUT，否则会被截断在第一行
  const lines = [`close=${out.close}`, `reason=${out.reason}`, 'comment<<TRIAGE_EOF', comment, 'TRIAGE_EOF']
  fs.appendFileSync(outputFile, lines.join('\n') + '\n')
} else {
  console.log(JSON.stringify(out, null, 2))
}
