#!/usr/bin/env node
/**
 * 署名合规校验：LICENSE 里的上游版权声明必须与「仓库里实际还有多少上游代码」匹配。
 *
 * ## 为什么需要它
 *
 * MIT 许可的硬性要求是：
 *
 *   The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 *
 * 也就是说，只要仓库里还有**实质比例**的上游代码，就必须保留上游的版权声明。
 * 实测当前是 45.8%（1239/2707 行逐字存活，见 `pnpm audit:provenance`）——
 * 这个比例下删掉声明会直接导致许可证失效，项目失去合法分发权（包括已发布的安装包）。
 *
 * 反过来，等 Go 重写完成、上游代码归零后，这条义务才自然消失。
 *
 * 这类事不能靠自觉：删一行 LICENSE 不会有任何测试变红，而后果是不可逆的。
 *
 * ## 判定规则
 *
 * | 上游逐字存活率 | LICENSE 必须包含 | 说明 |
 * | --- | --- | --- |
 * | > 0%            | 上游版权声明       | 还有上游代码 |
 * | = 0%            | 不再强制，但会提示 | 可以移除，需要人确认 |
 *
 * 上游标识从 `scripts/data/provenance/upstream/_SOURCE.txt` 读取（唯一来源），
 * 不在本脚本里硬编码作者名。
 *
 * 用法：node scripts/lint-attribution.mjs
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')

/**
 * 上游版权声明里必须出现的关键词。
 *
 * 从 `_SOURCE.txt` 的 `https://github.com/<owner>/<repo>` 取 owner/repo，
 * 再要求 LICENSE 里出现 owner 这个名字。这样换上游时不用改本脚本。
 */
function upstreamIdentity() {
  const srcFile = path.join(ROOT, 'scripts/data/provenance/upstream/_SOURCE.txt')
  if (!fs.existsSync(srcFile)) return null
  const text = fs.readFileSync(srcFile, 'utf8')
  const m = /github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)/.exec(text)
  if (!m) return null
  return { owner: m[1], repo: m[2] }
}

const identity = upstreamIdentity()
if (!identity) {
  console.log('署名校验跳过：找不到上游标识（scripts/data/provenance/upstream/_SOURCE.txt）')
  process.exit(0)
}

// 从来源审计的登记表读「上游还有多少」
const registryFile = path.join(ROOT, 'scripts/data/provenance/registry.json')
if (!fs.existsSync(registryFile)) {
  console.error('署名校验无法进行：缺少 scripts/data/provenance/registry.json')
  console.error('先运行 pnpm audit:provenance --write')
  process.exit(1)
}
const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'))
const retained = registry.totals?.retainedVerbatimLines ?? 0
const total = registry.totals?.upstreamSignificantLines ?? 0
const pct = registry.totals?.retainedPct ?? 0

const licenseFile = path.join(ROOT, 'LICENSE')
const license = fs.readFileSync(licenseFile, 'utf8')

/**
 * 判断 LICENSE 是否保留了上游声明。
 *
 * 只认「Copyright ... <owner>」这种形态：仅仅在正文里提到项目名不算履行义务
 * （MIT 要求的是 copyright notice，不是任何提及）。
 */
function hasUpstreamNotice(text, owner) {
  const re = new RegExp(`Copyright[^\\n]*${owner}`, 'i')
  return re.test(text)
}

const hasNotice = hasUpstreamNotice(license, identity.owner)

if (retained > 0 && !hasNotice) {
  console.error('署名合规校验未通过：\n')
  console.error(`  ✗ 仓库里仍有 ${retained}/${total} 行（${pct}%）上游代码逐字存活，`)
  console.error(`    但 LICENSE 里找不到 "${identity.owner}" 的版权声明。`)
  console.error('')
  console.error('  MIT 要求「all copies or substantial portions」附带版权声明与许可全文。')
  console.error('  删掉它 = 许可证失效，项目失去合法分发权（含已发布的安装包）。')
  console.error('')
  console.error('  正确顺序：先把上游代码重写掉（pnpm audit:provenance 归零），再删声明。')
  process.exit(1)
}

if (retained === 0 && hasNotice) {
  console.log(
    `署名提示：上游代码已归零（0/${total}），LICENSE 里的 "${identity.owner}" 声明` +
      '不再由本条规则强制。是否保留是一个显式决定（保留更稳妥），本脚本不替你删。',
  )
  process.exit(0)
}

console.log(
  `署名合规通过：上游 ${retained}/${total} 行（${pct}%）仍在，` +
    `LICENSE 保留了 ${identity.owner} 的版权声明。`,
)
