#!/usr/bin/env node
/**
 * 把 package.json 的版本号写进官网（website/index.html）。
 *
 * ## 为什么需要它
 *
 * 官网是无构建的多文件静态站，由 Vercel 从 `main` 直接发布；版本号占位在
 * index.html 中，因此只能是硬编码的。页面脚本会在加载后请求 `releases/latest` 并覆盖成真实 tag，
 * 但那条路径有三个前提：能联网、没被 GitHub 限流、访问者没禁用 sessionStorage。
 * 任何一条不成立，`<noscript>` 与首屏显示的都是**写死的那个数字**——它不会报错，
 * 只会安静地过期，于是页面上写着「v1.3.4」而实际最新版是 v1.4.0。
 *
 * 所以硬编码值必须每次发布时刷新，而不是靠人记得。
 *
 * ## 时机：发布**之后**
 *
 * `release.yml` 在 Release 真正创建成功（且通过 `verify-release.mjs` 自检）之后
 * 才调用本脚本并提交回 `main`。放在发布前会让「发布被取消」时官网抢先指向一个
 * 不存在的版本；放在发布后，写入的版本一定已经在 Releases 里。
 *
 * ## 与「不写死版本号」的约定如何共存
 *
 * `website/README.md` 写着「不写死具体产物名与版本号」，指的是**不要手写产物直链**
 * ——那条链路至今仍是运行时按 `ARTIFACTS` 模板 + 最新 Release 拼出来的，本脚本不碰。
 * 这里刷新的只是一个**离线兜底值**，是同一个约定的延伸：凡是硬编码就可能过期，
 * 就必须有东西盯着它。`pnpm lint:website` 会校验这个值真的存在，钉住它别被删掉。
 *
 * 用法：
 *   node scripts/sync-website-version.mjs            # 用 package.json 的版本
 *   node scripts/sync-website-version.mjs 1.4.0      # 指定版本（发布流程用这个）
 *   node scripts/sync-website-version.mjs --check    # 只核对，不写入（CI）
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const INDEX = path.join(ROOT, 'website', 'index.html')

/**
 * 只认这一种形态：`data-version` 属性 + 一个 `v<数字>` 文本。
 *
 * `[^<]*` 允许里面带前置文案（如 `最新版本 v1.3.4`），脚本会整段替换成
 * `v<新版本>`。**不要**把它放宽成裸的 `>v1.2.3<`：页面里还有 Release tag 之类的
 * 其它版本串，模糊匹配会改错地方，而且改错了也不报错——正是本项目最怕的形态。
 */
const VERSION_RE = /(<[a-z][^>]*\bdata-version\b[^>]*>)(v[0-9][^<]*)(<\/)/

/** 语义化版本号（发布流程传入的值必须长这样，避免把 `v1.3.4` 拼成 `vv1.3.4`） */
const SEMVER_RE = /^[0-9]+(?:\.[0-9]+)+$/

/**
 * 就地替换版本号文本，**保留其余每一个字符**（含 `</p>` 的 `<`）。
 *
 * 早期写法是 `html.slice(0, match.index) + match[1] + new + html.slice(match.index + match[0].length)`，
 * 而 `match[0]` 把捕获组 3 的那个 `<` 也算进去了，于是替换后变成 `v1.4.0p>`——
 * 标签被破坏，页面上版本号后紧跟一段原始标记。这里改成按捕获组 2 的**偏移**替换，
 * 边界不再靠算长度。
 */
function withVersion(html, match, version) {
  const start = match.index + match[1].length
  const end = start + match[2].length
  return html.slice(0, start) + `v${version}` + html.slice(end)
}

function readTarget() {
  const html = fs.readFileSync(INDEX, 'utf8')
  const match = VERSION_RE.exec(html)
  if (!match) {
    console.error(
      `未能从 ${path.relative(ROOT, INDEX)} 找到版本占位。\n` +
        '期望形如 <p class="…" id="dvAboutVersion" data-version>v1.0.0</p>；' +
        '占位被删掉后官网会永远显示同一个过期版本，所以这里直接失败。',
    )
    process.exit(1)
  }
  return { html, match }
}

const args = process.argv.slice(2)
const check = args.includes('--check')
const rest = args.filter((a) => a !== '--check')
// 显式传了空串（`node script ""`，例如工作流里变量拼错）不能静默退回 package.json 的版本：
// 那样会把一个「发布流程传错了参数」的失误变成一个看起来正常的刷新
if (rest.length > 1 || (rest.length === 1 && !rest[0].trim())) {
  console.error(`版本号参数无效：${JSON.stringify(rest[0] ?? '')}`)
  process.exit(1)
}
const explicit = rest[0]
const pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
const version = explicit || pkgVersion

if (!SEMVER_RE.test(version)) {
  console.error(`版本号 "${version}" 不是 MAJOR.MINOR[.PATCH] 形态，拒绝写入官网`)
  process.exit(1)
}

const { html, match } = readTarget()
const current = match[2].trim().replace(/^v/, '')

if (current === version) {
  console.log(`官网版本号已是 v${version}，无需改动`)
  process.exit(0)
}

if (check) {
  console.error(
    `官网版本号落后：website/index.html 写的是 v${current}，package.json 是 v${version}。\n` +
      '发布流程会在 Release 创建成功后自动刷新它（scripts/sync-website-version.mjs）。',
  )
  process.exit(1)
}

// 只替换版本号文本，属性、缩进与闭合标签都保持原样
fs.writeFileSync(INDEX, withVersion(html, match, version))
console.log(`官网版本号已更新：v${current} → v${version}`)
