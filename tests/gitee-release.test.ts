import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
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
