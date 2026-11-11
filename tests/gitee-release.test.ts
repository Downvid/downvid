import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFile, execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'

/**
 * Gitee 同步脚本的 dry-run 分支。
 *
 * 真正上传需要 Gitee token，不适合放进单测；但「清单里的资产 URL 必须指向
 * Gitee 自己」是这条镜像链路的关键，用 dry-run 对着本地产物钉住它。
 */

const SCRIPT = path.resolve(import.meta.dirname, '../scripts/sync-gitee-release.mjs')

describe('sync-gitee-release dry-run', () => {
  it('生成指向 Gitee Release 的资产 URL', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'downvid-gitee-'))
    const artifacts = path.join(dir, 'artifacts')
    fs.mkdirSync(artifacts)
    const payload = Buffer.from('downvid gitee mirror test')
    fs.writeFileSync(path.join(artifacts, 'DownVid-Wails-mac-universal-1.8.0.zip'), payload)
    // 非 Wails 产物应被忽略
    fs.writeFileSync(path.join(artifacts, 'checksums.txt'), 'ignored')

    const out = path.join(dir, 'manifest.gitee.json')
    execFileSync(process.execPath, [
      SCRIPT,
      '--dry-run',
      '--version',
      '1.8.0',
      '--tag',
      'v1.8.0',
      '--artifacts',
      artifacts,
      '--out',
      out,
    ])

    const manifest = JSON.parse(fs.readFileSync(out, 'utf8'))
    expect(manifest.version).toBe('1.8.0')
    expect(manifest.assets).toHaveLength(1)
    expect(manifest.assets[0].url).toBe(
      'https://gitee.com/Xynrin/downvid/releases/download/v1.8.0/DownVid-Wails-mac-universal-1.8.0.zip',
    )
    expect(manifest.assets[0].sha256).toBe(
      crypto.createHash('sha256').update(payload).digest('hex'),
    )

    fs.rmSync(dir, { recursive: true, force: true })
  })
})

/**
 * 真正的上传分支：用本地 mock API 跑「查询 Release → 列附件 → 上传 → 写清单」。
 *
 * 这条用例钉住的是 multipart 流式上传本身——v1.11.0 的 Gitee 同步在 5 分钟处
 * 失败，原因是 Node fetch 的默认 bodyTimeout；改成 https.request 后必须确认
 * 文件字节、boundary 与 Content-Length 都是对的。
 */
describe('sync-gitee-release upload', () => {
  let server: http.Server
  let api = ''
  let uploadedBody = Buffer.alloc(0)
  let uploadedPath = ''
  let uploadedContentLength = ''

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        const body = Buffer.concat(chunks)
        res.setHeader('Content-Type', 'application/json')
        // 不保持连接：脚本里的 fetch 连接关闭后进程才能自然退出
        res.setHeader('Connection', 'close')
        const url = req.url || ''

        if (req.method === 'GET' && url.includes('/releases/tags/')) {
          res.end(JSON.stringify({ id: 1, tag_name: 'v1.8.0' }))
          return
        }
        if (req.method === 'GET' && url.includes('/attach_files')) {
          res.end('[]')
          return
        }
        if (req.method === 'POST' && url.includes('/attach_files')) {
          uploadedBody = body
          uploadedPath = url
          uploadedContentLength = String(req.headers['content-length'] || '')
          res.statusCode = 201
          res.end(JSON.stringify({ id: 2, name: 'uploaded' }))
          return
        }
        res.statusCode = 404
        res.end('{}')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    api = `http://127.0.0.1:${port}/api/v5`
  })

  afterAll(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  )

  it('用流式 multipart 上传资产，Content-Length 与文件大小一致', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'downvid-gitee-upload-'))
    const artifacts = path.join(dir, 'artifacts')
    fs.mkdirSync(artifacts)
    const payload = 'downvid gitee upload test'
    fs.writeFileSync(path.join(artifacts, 'DownVid-Wails-mac-universal-1.8.0.zip'), payload)
    const out = path.join(dir, 'manifest.gitee.json')

    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      execFile(
        process.execPath,
        [SCRIPT, '--version', '1.8.0', '--tag', 'v1.8.0', '--artifacts', artifacts, '--out', out],
        {
          encoding: 'utf8',
          env: { ...process.env, GITEE_API: api, GITEE_TOKEN: 'test' },
        },
        (err, stdout, stderr) => {
          resolve({
            code: err ? ((err as { code?: number }).code ?? 1) : 0,
            stdout: String(stdout ?? ''),
            stderr: String(stderr ?? ''),
          })
        },
      )
    })

    expect(result.stderr).not.toContain('同步 Gitee 失败')
    expect(result.code).toBe(0)
    expect(uploadedPath).toContain('/repos/Xynrin/downvid/releases/1/attach_files')
    expect(uploadedBody.toString('utf8')).toContain('filename="DownVid-Wails-mac-universal-1.8.0.zip"')
    expect(uploadedBody.toString('utf8')).toContain(payload)
    expect(Number(uploadedContentLength)).toBe(uploadedBody.length)
    expect(fs.existsSync(out)).toBe(true)

    fs.rmSync(dir, { recursive: true, force: true })
  })
})
