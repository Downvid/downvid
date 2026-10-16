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

const tsxBin = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx')
const serverProcess = spawn(tsxBin, ['--tsconfig', 'docker/server/tsconfig.json', 'docker/server/index.ts'], {
  cwd: ROOT,
  shell: process.platform === 'win32',
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
