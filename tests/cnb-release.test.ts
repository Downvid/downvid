import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** CNB 同步脚本的 dry-run：清单里的资产 URL 必须指向 CNB Release。 */

const SCRIPT = path.resolve(import.meta.dirname, '../scripts/sync-cnb-release.mjs')

describe('sync-cnb-release dry-run', () => {
  it('生成指向 CNB Release 的资产 URL', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'downvid-cnb-'))
    const artifacts = path.join(dir, 'artifacts')
    fs.mkdirSync(artifacts)
    fs.writeFileSync(
      path.join(artifacts, 'DownVid-Wails-mac-universal-1.9.0.zip'),
      'downvid cnb mirror test',
    )

    const out = path.join(dir, 'manifest.cnb.json')
    execFileSync(process.execPath, [
      SCRIPT,
      '--dry-run',
      '--version',
      '1.9.0',
      '--tag',
      'v1.9.0',
      '--artifacts',
      artifacts,
      '--out',
      out,
    ])

    const manifest = JSON.parse(fs.readFileSync(out, 'utf8'))
    expect(manifest.version).toBe('1.9.0')
    expect(manifest.assets).toHaveLength(1)
    expect(manifest.assets[0].url).toBe(
      'https://cnb.cool/yxxbc/downvid/-/releases/download/v1.9.0/DownVid-Wails-mac-universal-1.9.0.zip',
    )

    fs.rmSync(dir, { recursive: true, force: true })
  })
})
