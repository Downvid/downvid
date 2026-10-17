#!/usr/bin/env node
/**
 * 把仓库根部的 CHANGELOG.md 同步到 app/internal/changelog/。
 *
 * ## 为什么需要拷贝而不是直接 embed 根目录的文件
 *
 * `//go:embed` **只能包含本包目录（含子目录）下的文件**，不能写 `../../CHANGELOG.md`。
 * 所以要么把 CHANGELOG 移进包目录（那样 GitHub 首页就看不到了），
 * 要么拷贝一份。
 *
 * ## 为什么必须有这个脚本
 *
 * 拷贝出来的副本会**静默过期**：改了根部的 CHANGELOG、忘了同步，
 * 应用里的「更新日志」还停在旧内容，而 `go build` / `go test` / 类型检查
 * 全都不报错（只有 `TestEmbeddedLocalWorks` 会在版本数上兜个底，
 * 但它看不出「内容旧了」）。
 *
 * 用法：
 *   node scripts/sync-changelog.mjs           # 同步
 *   node scripts/sync-changelog.mjs --check   # 只校验（CI 用）
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = path.join(ROOT, 'CHANGELOG.md')
const DEST = path.join(ROOT, 'app/internal/changelog/CHANGELOG.md')

if (!fs.existsSync(SRC)) {
  console.error(`找不到 ${path.relative(ROOT, SRC)}`)
  process.exit(1)
}

const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const source = read(SRC)
const checkOnly = process.argv.includes('--check')

// 只比「版本段落」：文件头与空行差异不该让 CI 变红。
//
// 这个函数存在的理由：Go 侧的解析只认 `## [版本]` 段落，文件头、
// 空行数量、行尾空格对它毫无影响。逐字节比较会让「在根文件里调了一下
// 空行」这种无害改动把 CI 弄红，而真正在意的东西（版本内容）反而淹没在噪音里。
function versionBody(text) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => /^## \[/.test(l))
  return start === -1 ? '' : lines.slice(start).join('\n').trimEnd()
}

if (checkOnly) {
  if (!fs.existsSync(DEST)) {
    console.error(
      '✗ app/internal/changelog/CHANGELOG.md 不存在。\n' +
        '  应用里的「更新日志」会读不到任何内容（构建与测试都不会报错）。\n' +
        '  修法：node scripts/sync-changelog.mjs',
    )
    process.exit(1)
  }
  const dest = read(DEST)
  if (versionBody(source) !== versionBody(dest)) {
    console.error(
      '✗ app/internal/changelog/CHANGELOG.md 与根部 CHANGELOG.md 不一致。\n' +
        '  应用里的「更新日志」会停留在旧内容。\n' +
        '  修法：node scripts/sync-changelog.mjs',
    )
    process.exit(1)
  }
  console.log('CHANGELOG 副本一致（版本段落逐字相同）')
  process.exit(0)
}

// --write：内容相同就不落盘，避免把 mtime 也改掉（会让增量构建失效）
if (fs.existsSync(DEST) && read(DEST) === source) {
  console.log(`CHANGELOG 已是最新：${path.relative(ROOT, DEST)}`)
  process.exit(0)
}

fs.mkdirSync(path.dirname(DEST), { recursive: true })
fs.writeFileSync(DEST, source)
const versions = (source.match(/^## \[/gm) || []).length
console.log(
  `已同步 ${path.relative(ROOT, DEST)}（${versions} 个版本段落，${source.length} 字节）`,
)
