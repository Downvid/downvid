#!/usr/bin/env node
/**
 * 插件索引自动收录的回归测试。
 *
 * 重点不在「能扫描」，而在**不该收的绝不收**：自动收录一旦把不合格仓库写进索引，
 * 用户点安装就会装上坏插件，而这一步没有任何人工介入。所以每个拒绝条件都要有用例。
 *
 * ## 为什么在同一进程里跑，而不是 execFileSync
 *
 * 实测本机的子进程里 `fetch('http://127.0.0.1:...')` 也会挂到超时（网络策略），
 * 于是 7 个用例全部失败，而脚本本身完全正常。改成同进程调用后，
 * 既快又不依赖外部网络环境。
 *
 * 用法：node scripts/test-plugin-index.mjs
 */

import { createSuite } from './lib/harness.mjs'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const suite = createSuite('插件索引自动收录')

/** 造一个临时索引仓库目录 */
function tempIndex(plugins = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-index-'))
  fs.writeFileSync(
    path.join(dir, 'index.json'),
    JSON.stringify({ version: 1, updated: '2026-01-01', plugins }, null, 2) + '\n',
  )
  fs.writeFileSync(path.join(dir, 'removed.json'), JSON.stringify({ version: 1, removed: [] }))
  return dir
}

const GOOD_README = `# demo plugin

<!-- DownVid-Plugin-Disclaimer: 1 -->

本插件由插件作者独立开发与维护。使用本插件产生的风险由插件作者与使用者承担，
与 DownVid 项目无关。
`

const readIndex = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'))

/**
 * 起一个假 GitHub：只有一个仓库 alice/dv-test，manifest 由参数决定，
 * 跑一次收录脚本。返回脚本的输出。
 */
/** 默认给一份合规 README；用例可通过 opts.readme 覆盖 */
let README = GOOD_README

async function runWithManifest(dir, manifest, extraArgs = [], opts = {}) {
  const srv = await new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const port = s.address().port
      if (req.url.startsWith('/__raw/readme')) {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(README)
        return
      }
      if (req.url === '/__raw/manifest') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(manifest))
        return
      }
      // README 走 raw 地址：脚本请求 /<repo>/HEAD/README.md
      if (req.url.endsWith('/README.md') || req.url.endsWith('/readme.md')) {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(README)
        return
      }
      if (req.url.startsWith('/search/repositories')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ items: [{ full_name: 'alice/dv-test' }] }))
        return
      }
      if (req.url === '/repos/alice/dv-test/contents/plugin.json') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ download_url: `http://127.0.0.1:${port}/__raw/manifest` }))
        return
      }
      res.writeHead(404)
      res.end('{}')
    })
    s.listen(0, '127.0.0.1', () => resolve(s))
  })

  const prevDir = process.env.PLUGIN_INDEX_DIR
  const prevAPI = process.env.GITHUB_API
  const prevRaw = process.env.GITHUB_RAW
  const prevArgs = process.argv.slice()
  README = opts.readme ?? GOOD_README
  process.env.PLUGIN_INDEX_DIR = dir
  process.env.GITHUB_API = `http://127.0.0.1:${srv.address().port}`
  // README 也走同一个替身
  process.env.GITHUB_RAW = `http://127.0.0.1:${srv.address().port}`
  process.argv = [process.argv[0], 'update-plugin-index.mjs', ...extraArgs]

  // 同一份模块复用（import() 会缓存）：脚本的参数与目录都在**调用时**读，
  // 不依赖模块顶层求值，所以不需要每次重新 import。
  const mod = await import('./update-plugin-index.mjs')
  const out = await captureConsole(async () => {
    try {
      await mod.main()
    } catch (e) {
      console.log('ERR', e?.message || e)
    }
  })

  process.argv = prevArgs
  if (prevDir === undefined) delete process.env.PLUGIN_INDEX_DIR
  else process.env.PLUGIN_INDEX_DIR = prevDir
  if (prevAPI === undefined) delete process.env.GITHUB_API
  else process.env.GITHUB_API = prevAPI
  if (prevRaw === undefined) delete process.env.GITHUB_RAW
  else process.env.GITHUB_RAW = prevRaw

  srv.close()
  return out
}

/** 抓取 console.log 输出，供断言「原因有没有写清楚」 */
async function captureConsole(fn) {
  const lines = []
  const orig = console.log
  console.log = (...a) => lines.push(a.join(' '))
  try {
    await fn()
  } finally {
    console.log = orig
  }
  return lines.join('\n')
}

// ===== 用例 =====

suite.case('合格的插件被收录，字段齐全', async (t) => {
  const dir = tempIndex()
  await runWithManifest(dir, {
    id: 'bilibili', name: '哔哩哔哩', description: 'B站',
    playback: 'downvid-parser', author: 'alice',
    permissions: { network: ['api.bilibili.com'] },
  })
  const idx = readIndex(dir)
  t.equal(idx.plugins.length, 1, '应收录 1 个插件')
  if (!idx.plugins.length) return
  const p = idx.plugins[0]
  t.equal(p.id, 'bilibili')
  t.equal(p.repo, 'alice/dv-test', 'repo 必须记成 owner/name')
  t.equal(p.name, '哔哩哔哩')
  t.ok(/^\d{4}-\d{2}-\d{2}$/.test(p.added || ''), 'added 应写成日期')
})

suite.case('playback 不是 downvid-parser 的不收录', async (t) => {
  const dir = tempIndex()
  const out = await runWithManifest(dir, { id: 'music', name: '音乐', playback: 'stream' })
  t.equal(readIndex(dir).plugins.length, 0, '契约不符的必须拒绝：它 resolve 语义完全不同')
  t.ok(/playback/.test(out), '报告里要写清原因，作者才修得对')
})

suite.case('id 不合法的不收录（会拼进文件路径）', async (t) => {
  for (const bad of ['Bad/Id', '..', 'Upper', 'a b', '']) {
    const dir = tempIndex()
    await runWithManifest(dir, { id: bad, name: 'x', playback: 'downvid-parser' })
    t.equal(readIndex(dir).plugins.length, 0, `id ${JSON.stringify(bad)} 必须被拒绝`)
  }
})

suite.case('缺 name 的不收录（界面会显示空白）', async (t) => {
  const dir = tempIndex()
  await runWithManifest(dir, { id: 'ok', playback: 'downvid-parser' })
  t.equal(readIndex(dir).plugins.length, 0)
})

suite.case('blocklist 里的插件不会被自动加回', async (t) => {
  const dir = tempIndex()
  fs.writeFileSync(
    path.join(dir, 'removed.json'),
    JSON.stringify({ version: 1, removed: [{ id: 'evil', date: '2026-01-01', reason: '外传凭据' }] }),
  )
  await runWithManifest(dir, { id: 'evil', name: '坏的', playback: 'downvid-parser' })
  t.equal(readIndex(dir).plugins.length, 0, '下架过的插件不能因为作者重新打 topic 就回来')
})

suite.case('added 与人工填写的 sites 不被每次扫描重置', async (t) => {
  const dir = tempIndex([
    { id: 'bilibili', name: '旧名', repo: 'alice/dv-test', sites: ['bilibili.com'], added: '2025-01-01' },
  ])
  await runWithManifest(dir, { id: 'bilibili', name: '新名', playback: 'downvid-parser' })
  const p = readIndex(dir).plugins[0]
  t.equal(p.name, '新名', '名字应跟随 manifest 更新')
  t.equal(p.added, '2025-01-01', 'added 是收录日期，不该被每次扫描重置')
  t.equal((p.sites || [])[0], 'bilibili.com', '人工填的 sites 应保留')
})

suite.case('icon 与 version 被收录进索引', async (t) => {
  const dir = tempIndex()
  await runWithManifest(dir, {
    id: 'bilibili', name: 'B站', playback: 'downvid-parser',
    version: '1.4.2', icon: '🧩', sites: ['bilibili.com'],
  })
  const p = readIndex(dir).plugins[0]
  t.equal(p.version, '1.4.2', '版本要进索引，界面靠它判断能否更新')
  t.equal(p.icon, '🧩', 'emoji 图标应保留')
  t.equal((p.sites || [])[0], 'bilibili.com')
})

suite.case('http(s) 图片图标被保留', async (t) => {
  const dir = tempIndex()
  await runWithManifest(dir, {
    id: 'img', name: 'Img', playback: 'downvid-parser',
    icon: 'https://example.com/logo.png',
  })
  t.equal(readIndex(dir).plugins[0].icon, 'https://example.com/logo.png')
})

suite.case('危险 icon 被丢弃（索引会进界面，不能当注入点）', async (t) => {
  for (const bad of ['javascript:alert(1)', '<svg onload=alert(1)>', 'x'.repeat(40)]) {
    const dir = tempIndex()
    await runWithManifest(dir, { id: 'bad', name: 'Bad', playback: 'downvid-parser', icon: bad })
    const p = readIndex(dir).plugins[0]
    // 插件本身仍被收录，只是图标丢掉——图标是装饰，不该让整条消失
    t.equal(p.id, 'bad', `插件应仍被收录（icon=${JSON.stringify(bad)}）`)
    t.equal(p.icon || '', '', `危险 icon 必须丢弃：${JSON.stringify(bad)}`)
  }
})

// ===== 风险声明是硬门槛 =====
//
// 不达标就不收录。三条用例对应三种真实写法：没写、只写标记、版本过旧。
suite.case('README 没有风险声明 → 不收录', async (t) => {
  const dir = tempIndex()
  const out = await runWithManifest(
    dir,
    { id: 'no-disc', name: '没声明', playback: 'downvid-parser' },
    [],
    { readme: '# 一个插件\n\n就是好用。\n' },
  )
  t.equal(readIndex(dir).plugins.length, 0, '没有声明不能收录')
  t.ok(/声明/.test(out), '报告里要写清原因，作者才知道去补')
})

suite.case('只有标记、正文没交代 → 不收录', async (t) => {
  const dir = tempIndex()
  await runWithManifest(
    dir,
    { id: 'marker-only', name: '只有标记', playback: 'downvid-parser' },
    [],
    { readme: '<!-- DownVid-Plugin-Disclaimer: 1 -->\n\n# 插件\n' },
  )
  t.equal(readIndex(dir).plugins.length, 0, '渲染不可见的注释不能算同意：用户看不到风险归属')
})

suite.case('声明版本过旧 → 不收录', async (t) => {
  const dir = tempIndex()
  await runWithManifest(
    dir,
    { id: 'old-ver', name: '旧版本声明', playback: 'downvid-parser' },
    [],
    { readme: '<!-- DownVid-Plugin-Disclaimer: 0 -->\n\n风险由作者承担，与 DownVid 无关。\n' },
  )
  t.equal(readIndex(dir).plugins.length, 0, '责任条款变了就不该默认沿用旧同意')
})

suite.case('英文声明同样可以', async (t) => {
  const dir = tempIndex()
  await runWithManifest(
    dir,
    { id: 'en-disc', name: 'English', playback: 'downvid-parser' },
    [],
    {
      readme:
        '<!-- DownVid-Plugin-Disclaimer: 1 -->\n\n' +
        'Any risk from using this plugin is borne by its author and the user; ' +
        'this project is not responsible and not affiliated with it.\n',
    },
  )
  t.equal(readIndex(dir).plugins.length, 1, '英文作者不该被拒')
})

suite.case('--dry-run 不写文件', async (t) => {
  const dir = tempIndex()
  const before = fs.readFileSync(path.join(dir, 'index.json'), 'utf8')
  await runWithManifest(dir, { id: 'newone', name: '新', playback: 'downvid-parser' }, ['--dry-run'])
  t.equal(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'), before, 'dry-run 必须一个字节都不改')
})

await suite.run()
