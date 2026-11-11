import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'

/**
 * 发布完整性校验的 `--allow-missing` 语义。
 *
 * 这条链路上最容易写错的是：Release 已经创建、只是某个平台 runner 挂了，
 * 校验却判红 → 后面的 Gitee / CNB 同步步骤全部被跳过，镜像永远停在上一版。
 * v1.11.0 就是这样：macOS runner 失败，release job 在 verify 处退出 1，
 * 两个同步步骤全是 skipped。
 */

const SCRIPT = path.resolve(import.meta.dirname, '../scripts/verify-release.mjs')

const BASE = {
  draft: false,
  prerelease: false,
  published_at: '2026-11-11T00:00:00Z',
}

const fullAssets = [
  'DownVid-Wails-mac-universal-1.9.0.zip',
  'DownVid-Wails-windows-x64-1.9.0.zip',
  'DownVid-Wails-linux-x64-1.9.0.tar.gz',
].map((name) => ({ name }))

let server: http.Server
let api = ''
let payload: Record<string, unknown> = { ...BASE, assets: fullAssets }

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json')
    // 不保持连接：脚本进程在 fetch 完成后要能自然退出，否则测试会等 keep-alive 超时
    res.setHeader('Connection', 'close')
    res.end(JSON.stringify(payload))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  api = `http://127.0.0.1:${port}`
})

afterAll(
  () =>
    new Promise<void>((resolve) => {
      // fetch 默认 keep-alive：不主动断开的话 server.close 会等到超时
      server.closeAllConnections()
      server.close(() => resolve())
    }),
)

/**
 * 必须用异步的 execFile：execFileSync 会阻塞当前 worker 的事件循环，
 * 而 mock API server 就跑在这个 worker 里——子进程请求会永远等不到响应。
 */
function run(args: string[] = []): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [SCRIPT, '--tag', 'v1.9.0', ...args],
      {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_API: api, GITHUB_TOKEN: 'test' },
      },
      (err, stdout, stderr) => {
        resolve({
          status: err ? ((err as { code?: number }).code ?? 1) : 0,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
        })
      },
    )
  })
}

describe('verify-release', () => {
  it('三个平台齐全时通过', async () => {
    payload = { ...BASE, assets: fullAssets }
    const res = await run()
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('三个平台齐全')
  })

  it('缺少平台时 --allow-missing 只警告、不阻断后续同步', async () => {
    payload = {
      ...BASE,
      assets: fullAssets.filter((a) => !a.name.includes('mac-universal')),
    }
    const res = await run(['--allow-missing'])
    expect(res.status).toBe(0)
    expect(res.stderr).toContain('--allow-missing')
    expect(res.stdout).toContain('已允许')
  })

  it('缺少平台且没有 --allow-missing 时失败', async () => {
    payload = {
      ...BASE,
      assets: fullAssets.filter((a) => !a.name.includes('mac-universal')),
    }
    const res = await run()
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('发布不完整')
  })

  it('draft Release 即使带 --allow-missing 也失败', async () => {
    payload = { ...BASE, draft: true, assets: fullAssets }
    const res = await run(['--allow-missing'])
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('draft')
  })
})
