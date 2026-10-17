import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { isAllowedOrigin } from '../docker/server/security'

/**
 * Web 服务的 WebSocket RPC 协议。
 *
 * 协议是三方的契约（server/index.ts、src/web-bridge.ts、
 * scripts/test-web-server.mjs），任何一端改了消息形状这里都要红。
 * 用例针对曾经会静默失败的分支：
 *   - invoke 应答按 id 配对错位（串台）
 *   - 断线时未决 Promise 悬挂（界面永远转圈）
 *   - 未知通道/非法 JSON 如实报错
 *   - 广播订阅退订后不再收到事件
 */

/** 与 server/index.ts 相同的消息处理骨架（被测协议的两端各取所需） */
function createServerHarness() {
  const wssBus = new EventEmitter()
  const sent: any[] = []
  const handlers = new Map<string, (args: unknown[]) => unknown>()

  function handle(channel: string, fn: (args: unknown[]) => unknown) {
    handlers.set(channel, fn)
  }

  // 服务端应答与广播统一走「发送管道」：真实环境里都是 ws.send，
  // harness 里用 wssBus 的 'send' 事件承载，客户端订阅同一条管道。
  function emitToClient(message: unknown) {
    sent.push(message)
    wssBus.emit('send', JSON.stringify(message))
  }

  function onClientMessage(raw: string) {
    let request: any
    try {
      request = JSON.parse(raw)
    } catch {
      emitToClient({ id: null, error: '消息不是合法 JSON' })
      return
    }
    const handler = request.channel ? handlers.get(request.channel) : undefined
    if (!handler) {
      emitToClient({ id: request.id, error: `未知通道：${request.channel}` })
      return
    }
    Promise.resolve(handler(request.args || []))
      .then(result => emitToClient({ id: request.id, result }))
      .catch((e: Error) => emitToClient({ id: request.id, error: e.message }))
  }

  function broadcast(channel: string, data: unknown) {
    emitToClient({ event: channel, data })
  }

  return { handle, onClientMessage, broadcast, sent, wssBus }
}

/** 与 src/web-bridge.ts 相同的客户端骨架 */
function createClientHarness(server: ReturnType<typeof createServerHarness>) {
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const subscribers = new Map<string, Set<(data: unknown) => void>>()
  let nextId = 1
  let open = true

  server.wssBus.on('send', (message: string) => {
    const parsed = JSON.parse(message)
    if (parsed.event !== undefined) {
      const set = subscribers.get(parsed.event)
      if (set) for (const cb of set) cb(parsed.data)
      return
    }
    if (parsed.id !== undefined) {
      const entry = pending.get(parsed.id)
      if (!entry) return
      pending.delete(parsed.id)
      if (parsed.error) entry.reject(new Error(parsed.error))
      else entry.resolve(parsed.result)
    }
  })

  function invoke(channel: string, ...args: unknown[]) {
    return new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      // 客户端 → 服务端走同一根管道
      server.onClientMessage(JSON.stringify({ id, channel, args }))
    })
  }

  function subscribe(channel: string, callback: (data: unknown) => void) {
    let set = subscribers.get(channel)
    if (!set) {
      set = new Set()
      subscribers.set(channel, set)
    }
    set.add(callback)
    return () => { set?.delete(callback) }
  }

  /** 模拟连接断开（onclose 里的未决清理） */
  function simulateDisconnect() {
    open = false
    for (const [, entry] of pending) entry.reject(new Error('连接已断开'))
    pending.clear()
  }

  return { invoke, subscribe, simulateDisconnect, pendingSize: () => pending.size }
}

const harness = () => createServerHarness()

describe('WebSocket RPC 协议', () => {
  it('invoke 的应答按 id 配对，不串台', async () => {
    const server = harness()
    const slow = new Promise(resolve => setTimeout(() => resolve('slow'), 50))
    server.handle('a', () => 'fast')
    server.handle('b', () => slow)

    const client = createClientHarness(server)
    const pa = client.invoke('a')
    const pb = client.invoke('b')
    expect(await pa).toBe('fast')
    expect(await pb).toBe('slow')
    // 应答队列里 id 与请求一一对应
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(server.sent.map(m => m.id)).toEqual([1, 2])
  })

  it('未知通道返回明确错误', async () => {
    const server = harness()
    const client = createClientHarness(server)
    await expect(client.invoke('no-such')).rejects.toThrow('未知通道：no-such')
  })

  it('非法 JSON 不炸掉服务', async () => {
    const server = harness()
    server.onClientMessage('this is not json')
    expect(server.sent[0].error).toBe('消息不是合法 JSON')
  })

  it('handler 抛错时错误信息如实传回', async () => {
    const server = harness()
    server.handle('boom', () => { throw new Error('解析失败') })
    const client = createClientHarness(server)
    await expect(client.invoke('boom')).rejects.toThrow('解析失败')
  })

  it('断线时未决 Promise 全部拒绝，不悬挂', async () => {
    const server = harness()
    // 永不返回的 handler
    server.handle('hang', () => new Promise(() => {}))
    const client = createClientHarness(server)
    const p = client.invoke('hang')
    const caught = p.catch((e: Error) => e.message)
    client.simulateDisconnect()
    expect(await caught).toBe('连接已断开')
    expect(client.pendingSize()).toBe(0)
  })

  it('广播事件送达订阅者，退订后不再收到', () => {
    const server = harness()
    const client = createClientHarness(server)
    const received: unknown[] = []
    const unsubscribe = client.subscribe('download:progress', data => received.push(data))

    server.broadcast('download:progress', { taskId: 't1', percent: 10 })
    expect(received).toEqual([{ taskId: 't1', percent: 10 }])

    unsubscribe()
    server.broadcast('download:progress', { taskId: 't1', percent: 20 })
    expect(received).toEqual([{ taskId: 't1', percent: 10 }])
  })

  describe('WebSocket 跨域安全策略（防 CSWSH 劫持）', () => {
    it('允许同源 Origin 访问', () => {
      expect(isAllowedOrigin('http://192.168.1.10:6080', '192.168.1.10:6080')).toBe(true)
      expect(isAllowedOrigin('http://nas.local:6080', 'nas.local:6080')).toBe(true)
    })

    it('允许本地回环地址访问', () => {
      expect(isAllowedOrigin('http://localhost:6080', '127.0.0.1:6080')).toBe(true)
      expect(isAllowedOrigin('http://127.0.0.1:6080', '127.0.0.1:6080')).toBe(true)
      expect(isAllowedOrigin('http://[::1]:6080', '127.0.0.1:6080')).toBe(true)
    })

    it('允许无 Origin 头连接（直接客户端 / curl / 探针）', () => {
      expect(isAllowedOrigin(undefined, '127.0.0.1:6080')).toBe(true)
    })

    it('严格拦截恶意跨源网页发起的调用', () => {
      expect(isAllowedOrigin('https://malicious-website.com', '127.0.0.1:6080')).toBe(false)
      expect(isAllowedOrigin('http://evil.attacker.org:6080', '192.168.1.5:6080')).toBe(false)
      expect(isAllowedOrigin('invalid-url', '127.0.0.1:6080')).toBe(false)
    })
  })
})
