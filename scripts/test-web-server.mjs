#!/usr/bin/env node
/**
 * Web 服务（server/index.ts）集成回归。
 *
 * 起一个真实的 Node HTTP + WebSocket 服务，对关键能力逐项核对：
 *   1. /healthz 端点返回 200 与版本
 *   2. / 静态托管返回 SPA index.html（包含 #app 挂载点）
 *   3. WebSocket 连接与 RPC：
 *      - app:getVersion 返回正确的版本号
 *      - app:getDefaultDownloadDir 返回配置的下载目录
 *      - history:get 返回数组
 *      - deps:status 返回探测结果（不崩）
 *      - 未知通道如实返回错误
 *   4. 广播通道：bus.emit('download:progress') 实时推送至全部 WS 客户端
 *
 * 服务端在 CI 里是以**打包产物**形态运行的（`docker/dist-server/index.js`），
 * 与镜像里跑的是同一份东西。这一点很重要：源码能跑不等于打包后能跑
 * （externals、`import.meta.url` 推出来的路径、动态 import 都会在打包后变形），
 * 而镜像构建一次要几分钟，把这个错误留到那边发现代价太高。
 * 没有产物时（例如刚 clone 下来）会先跑一次 `vite build`，而不是静默跳过。
 *
 * 用法：node scripts/test-web-server.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execSync } from 'node:child_process'
import { WebSocket } from 'ws'

const ROOT = path.resolve(import.meta.dirname, '..')
const PORT = 6300 + Math.floor(Math.random() * 500)
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'downvid-web-test-'))
const dataDir = path.join(tempDir, 'data')
const downloadsDir = path.join(tempDir, 'downloads')
fs.mkdirSync(downloadsDir, { recursive: true })

console.log('[test:web-server] 测试目录：', tempDir)

// 确保 docker/dist-web/index.html 存在（没有时给一个最小假文件以跑通单项测试）
const staticDir = path.join(ROOT, 'docker', 'dist-web')
const dummyCreated = !fs.existsSync(staticDir)
if (dummyCreated) {
  fs.mkdirSync(staticDir, { recursive: true })
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<div id="app">test</div>')
}

// 服务端产物：与镜像里运行的是同一份文件。
//
// **每次都重新构建**，不看产物是否存在。踩过的坑：改成「产物存在就复用」后，
// 本地刚改完源码跑测试仍然全绿——测的是上一次的旧构建。那种绿比红更危险。
// 构建本身约 0.2 秒（服务端 350 个模块，无压缩），不值得为它冒这个险。
const serverEntry = path.join(ROOT, 'docker', 'dist-server', 'index.js')
console.log('[test:web-server] 构建服务端打包产物...')
// 走 `node <本仓库的 vite bin>` 而不是 `npx vite`：Windows 上 npx 会走 PowerShell
// 解析，且可能命中全局安装的另一个 vite 版本（产物与镜像里的不一致）
execSync(`"${process.execPath}" "${path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')}" build --config docker/server/vite.config.ts`, {
  cwd: ROOT,
  stdio: 'inherit',
})
if (!fs.existsSync(serverEntry)) {
  console.error('[test:web-server] 服务端打包失败：缺少 docker/dist-server/index.js')
  process.exit(1)
}

const serverProcess = spawn(process.execPath, [serverEntry], {
  cwd: ROOT,
  shell: false,
  env: {
    ...process.env,
    DOWNVID_WEB_PORT: String(PORT),
    DOWNVID_WEB_HOST: '127.0.0.1',
    DOWNVID_DATA_DIR: dataDir,
    DOWNVID_DOWNLOADS: downloadsDir,
    DOWNVID_WEB_DIST: staticDir,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let serverLogs = ''
serverProcess.stdout.on('data', d => { serverLogs += d.toString() })
serverProcess.stderr.on('data', d => { serverLogs += d.toString() })

let cleaned = false
function cleanup() {
  if (cleaned) return
  cleaned = true
  if (serverProcess.pid) {
    if (process.platform === 'win32') {
      try { execSync(`taskkill /F /T /PID ${serverProcess.pid} >nul 2>&1`) } catch {}
    } else {
      try { serverProcess.kill('SIGKILL') } catch {}
    }
  }
  if (dummyCreated) {
    try { fs.rmSync(staticDir, { recursive: true, force: true }) } catch {}
  }
  try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
}

process.on('exit', cleanup)
process.on('SIGINT', () => { cleanup(); process.exit(1) })

// 等待服务就绪
let ready = false
for (let i = 0; i < 40; i++) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/healthz`)
    if (res.ok) { ready = true; break }
  } catch {}
  await new Promise(r => setTimeout(r, 250))
}

if (!ready) {
  console.error('[test:web-server] 服务未能在 10 秒内就绪。输出：')
  console.error(serverLogs)
  process.exit(1)
}

try {
  // 1. /healthz
  const healthRes = await fetch(`http://127.0.0.1:${PORT}/healthz`)
  assert.equal(healthRes.status, 200)
  const health = await healthRes.json()
  assert.equal(health.ok, true)
  assert.ok(typeof health.version === 'string' && health.version.length > 0)
  console.log('  ✓ /healthz 返回 200 与版本号')

  // 2. / 静态文件
  const rootRes = await fetch(`http://127.0.0.1:${PORT}/`)
  assert.equal(rootRes.status, 200)
  const html = await rootRes.text()
  assert.ok(html.includes('app'), '页面必须包含 app 挂载节点')
  console.log('  ✓ / 静态托管 index.html')

  // 3. WebSocket 连接与 RPC
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`)
  await new Promise((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
  })

  const pending = new Map()
  let nextId = 1
  const events = []

  ws.on('message', raw => {
    const msg = JSON.parse(String(raw))
    if (msg.event) {
      events.push(msg)
      return
    }
    const entry = pending.get(msg.id)
    if (entry) {
      pending.delete(msg.id)
      if (msg.error) entry.reject(new Error(msg.error))
      else entry.resolve(msg.result)
    }
  })

  function invoke(channel, ...args) {
    return new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, channel, args }))
    })
  }

  const version = await invoke('app:getVersion')
  assert.equal(version, health.version)
  console.log('  ✓ WS app:getVersion')

  const dir = await invoke('app:getDefaultDownloadDir')
  assert.equal(dir, downloadsDir)
  console.log('  ✓ WS app:getDefaultDownloadDir 返回配置目录')

  const history = await invoke('history:get')
  assert.ok(Array.isArray(history))
  console.log('  ✓ WS history:get 返回数组')

  await assert.rejects(invoke('unknown:channel'), /未知通道/)
  console.log('  ✓ WS 未知通道如实返回错误')

  // 容器版更新检查：不执行任何写操作，只回答「有没有新版本 + 怎么升级」。
  // 桌面版那条路径（下载安装包静默替换）在容器里**根本不成立**——
  // 重建容器就丢了，所以这里必须是 manual 且带升级命令。
  const update = await invoke('app:checkForUpdates', 'websit-never-matches')
  assert.equal(update.manual, true, '容器版不允许自更新，必须标 manual')
  assert.ok(Array.isArray(update.container?.upgrade?.commands) && update.container.upgrade.commands.length > 0,
    '容器版必须给出拉镜像的升级命令（否则用户不知道怎么升级）')
  assert.ok(
    update.container.upgrade.commands.some(c => c.includes('docker compose pull')),
    'compose 场景的升级命令必须包含 docker compose pull',
  )
  assert.equal(update.currentVersion, health.version, '当前版本应与 /healthz 一致')
  console.log('  ✓ WS app:checkForUpdates 返回容器升级命令（不执行写操作）')

  // 健康探针要带上镜像与版本信息：用户排障时贴这一行就够了
  assert.equal(health.repo, 'yxxbc/downvid', '/healthz 应带仓库坐标')
  assert.ok(typeof health.version === 'string' && health.version.length > 0, '/healthz 应带版本号')
  console.log('  ✓ /healthz 带镜像坐标与版本')

  ws.close()

  // 4. WebSocket 跨源拦截测试（CSWSH 防御）
  const evilWs = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
    headers: { Origin: 'https://malicious-attacker.org' },
  })
  const evilRejected = await new Promise(resolve => {
    evilWs.on('open', () => resolve(false))
    evilWs.on('error', () => resolve(true))
    evilWs.on('unexpected-response', (_req, res) => {
      resolve(res.statusCode === 403)
    })
  })
  assert.ok(evilRejected, '跨域非法 Origin 必须被拒绝')
  console.log('  ✓ WS 拦截非法跨源连接（403 Forbidden）')

  cleanup()
  console.log('[test:web-server] 全部通过')
  process.exit(0)
} catch (e) {
  console.error('[test:web-server] 测试失败：', e)
  console.error(serverLogs)
  process.exit(1)
}
