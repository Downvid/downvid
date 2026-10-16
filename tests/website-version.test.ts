import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

/**
 * 官网版本号的刷新脚本（scripts/sync-website-version.mjs）。
 *
 * 背景：官网是单文件、无构建，页面上的版本号只能是硬编码的。脚本拉到
 * `releases/latest` 会把它覆盖成真实 tag，但离线 / 被限流 / 禁用 sessionStorage
 * 时会退回那个写死的值 —— 于是「页面上写着 v1.3.4，实际最新版是 v1.4.0」
 * 这种过期**不会报错**，只能靠发布流程刷新 + 这里钉住刷新逻辑本身。
 *
 * 两个曾经真实存在的坑，各留一个用例：
 *   1. 替换时把 `</p>` 的 `<` 一起吃掉了（`match[0]` 含捕获组 3），
 *      结果写出来是 `v1.4.0p>` —— 标签被破坏，界面上跟着一段原始标记
 *   2. 匹配放宽成裸的 `>v1.2.3<` 会改错地方（页面里还有 Release tag 等版本串）
 */

const SOURCE = fs.readFileSync(path.resolve(import.meta.dirname, '../scripts/sync-website-version.mjs'), 'utf8')

/** 在临时目录里跑一遍脚本，返回「退出码 + stdout/stderr + 文件内容」 */
function run(args: string[], html: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'downvid-site-version-'))
  fs.mkdirSync(path.join(dir, 'website'))
  fs.mkdirSync(path.join(dir, 'scripts'))
  fs.writeFileSync(path.join(dir, 'website/index.html'), html)
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.4.0' }))

  // import.meta.dirname 指向脚本所在目录，这里改写后放进临时目录，其余逻辑照跑
  const patched = SOURCE.replace(/path\.resolve\(import\.meta\.dirname, '\.\.'\)/, JSON.stringify(dir))
  const code = ts.transpileModule(patched, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText

  const out: string[] = []
  const err: string[] = []
  const sandbox = {
    module: { exports: {} },
    exports: {},
    require: createRequire(import.meta.url),
    process: {
      argv: ['node', 'sync-website-version.mjs', ...args],
      exitCode: 0,
      // 脚本用 process.exit(1) 表示失败；这里转成退出码而不是真的结束测试进程
      exit(code: number) {
        sandbox.process.exitCode = code
        throw Object.assign(new Error('__exit__'), { __exit: true })
      },
    },
    console: { log: (...a: unknown[]) => out.push(a.join(' ')), error: (...a: unknown[]) => err.push(a.join(' ')) },
    fs,
    path,
  }

  try {
    vm.runInNewContext(code, sandbox, { filename: 'sync-website-version.mjs' })
  } catch (e: any) {
    if (!e?.__exit) throw e
  }

  return {
    exitCode: sandbox.process.exitCode,
    stdout: out.join('\n'),
    stderr: err.join('\n'),
    html: fs.readFileSync(path.join(dir, 'website/index.html'), 'utf8'),
  }
}

const PAGE = (version: string) =>
  [
    '<!doctype html>',
    '<html><body>',
    `  <p class="dv-about-version" id="dvAboutVersion" data-version>v${version}</p>`,
    '  <script>',
    "    if (aboutVersion) aboutVersion.textContent = release ? release.tag : 'v" + version + "';",
    '  </script>',
    '</body></html>',
  ].join('\n')

describe('官网版本号刷新', () => {
  it('把占位里的版本号改成目标版本', () => {
    const result = run(['1.5.2'], PAGE('1.3.4'))
    expect(result.exitCode).toBe(0)
    expect(result.html).toContain('data-version>v1.5.2</p>')
  })

  it('闭合标签与其余内容一字不动（曾经吃掉了 </p> 的 <）', () => {
    const before = PAGE('1.3.4')
    const result = run(['1.5.2'], before)
    expect(result.html).not.toContain('v1.5.2p>')
    expect(result.html).toBe(before.replace('>v1.3.4</p>', '>v1.5.2</p>'))
  })

  it('不碰页面脚本里 fallback 的版本号（那是另一处，改错会静默改错地方）', () => {
    const result = run(['1.5.2'], PAGE('1.3.4'))
    expect(result.html).toContain("release ? release.tag : 'v1.3.4'")
  })

  it('版本号已是最新时不写文件（发布流程会重复调用）', () => {
    const before = PAGE('1.4.0')
    const result = run([], before)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('无需改动')
    expect(result.html).toBe(before)
  })

  it('缺省用 package.json 的版本', () => {
    const result = run([], PAGE('1.3.4'))
    expect(result.html).toContain('data-version>v1.4.0</p>')
  })

  it('--check 在落后时报错且不改文件', () => {
    const before = PAGE('1.3.4')
    const result = run(['--check'], before)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('落后')
    expect(result.html).toBe(before)
  })

  it('--check 在一致时通过', () => {
    const result = run(['--check'], PAGE('1.4.0'))
    expect(result.exitCode).toBe(0)
  })

  it('拒绝非 MAJOR.MINOR[.PATCH] 形态的版本号（否则会拼出 vv1.4.0）', () => {
    for (const bad of ['v1.4.0', 'latest', '1.4.0-beta.1', '', 'v']) {
      const result = run([bad], PAGE('1.3.4'))
      expect(result.exitCode, `"${bad}" 应被拒绝`).toBe(1)
    }
  })

  it('接受 MAJOR.MINOR（不带 PATCH）', () => {
    const result = run(['1.4'], PAGE('1.3.4'))
    expect(result.exitCode).toBe(0)
    expect(result.html).toContain('data-version>v1.4</p>')
  })

  it('占位被删掉时直接失败，而不是安静地什么都不做', () => {
    const result = run(['1.5.2'], '<html><body><p id="dvAboutVersion">v1.3.4</p></body></html>')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('data-version')
  })

  it('占位不在第一处：只改带 data-version 的那个', () => {
    const html = [
      '<html><body>',
      '<p class="other">v1.0.0</p>',
      '<p class="dv-about-version" id="dvAboutVersion" data-version>v1.3.4</p>',
      '</body></html>',
    ].join('\n')
    const result = run(['1.5.2'], html)
    expect(result.html).toContain('<p class="other">v1.0.0</p>')
    expect(result.html).toContain('data-version>v1.5.2</p>')
  })
})

describe('官网只有一处版本号字面量', () => {
  const html = fs.readFileSync(path.resolve(import.meta.dirname, '../website/index.html'), 'utf8')

  it('页面脚本不得再写一份版本号字面量', () => {
    // 真实踩过：HTML 里是 `data-version>v1.3.4`，而脚本里另有一份 `'v1.3.4'` 兜底。
    // 刷新脚本只改 HTML，脚本那份会在每次切到「关于软件」标签页或切语言时把它覆盖回去，
    // 于是「发了新版，官网显示的还是旧版号」，且**没有任何报错**。
    // 现在脚本必须读占位里的值，而不是自带一份。
    const script = html.slice(html.indexOf('<script>'))
    expect(script).not.toMatch(/release\s*\?\s*release\.tag\s*:\s*'v[0-9]/)
    expect(script).toContain('aboutVersionFallback')
    expect(script).toMatch(/aboutVersion\.textContent\s*=\s*release\s*\?\s*release\.tag\s*:\s*aboutVersionFallback/)
  })

  it('HTML 里只有一个 v<版本> 字面量，且它就在 data-version 占位上', () => {
    // 多出来的字面量不会被刷新脚本碰到，只会安静地停在旧值上。
    // 这里只钉**结构**（数量 + 位置），不把版本号写死：占位每次发布都会被刷新，
    // 写死等于让这条检查在发布成功后自己变红（v1.4.0 就是这么红的）。
    const literals = [...html.matchAll(/>v[0-9][0-9.]*</g)].map((m) => m[0])
    expect(literals).toHaveLength(1)
    const marker = html.indexOf('data-version')
    const at = html.indexOf(literals[0])
    expect(marker).toBeGreaterThan(-1)
    expect(at).toBeGreaterThan(marker)
    expect(at).toBeLessThan(html.indexOf('</p>', marker))
  })
})
