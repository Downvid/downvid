import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Release 正文的下载对照表必须同时给出三个镜像。
 *
 * 这些链接在 Release 创建时生成，Gitee / CNB 的资产由随后的工作流上传；
 * 三列都缺失或写错不会报错，只会让用户点到一个 404。
 */

const SCRIPT = path.resolve(import.meta.dirname, '../scripts/gen-release-notes.mjs')

describe('gen-release-notes', () => {
  it('下载对照表包含 GitHub / Gitee / CNB 三个链接', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'downvid-notes-'))
    const artifacts = path.join(dir, 'artifacts')
    fs.mkdirSync(artifacts)
    for (const name of [
      'DownVid-Wails-mac-universal-1.9.0.dmg',
      'DownVid-Wails-mac-universal-1.9.0.zip',
      'DownVid-Wails-windows-x64-1.9.0-installer.exe',
      'DownVid-Wails-windows-x64-1.9.0.zip',
      'DownVid-Wails-linux-x64-1.9.0.deb',
      'DownVid-Wails-linux-x64-1.9.0.tar.gz',
    ]) {
      fs.writeFileSync(path.join(artifacts, name), 'x')
    }

    const body = execFileSync(process.execPath, [SCRIPT, artifacts, '1.9.0'], {
      encoding: 'utf8',
    })
    expect(body).toContain('| 下载 / Download |')
    expect(body).toContain('https://github.com/Downvid/downvid/releases/download/v1.9.0/')
    expect(body).toContain('https://gitee.com/Xynrin/downvid/releases/download/v1.9.0/')
    expect(body).toContain('https://cnb.cool/yxxbc/downvid/-/releases/download/v1.9.0/')
    expect(body).toContain('[GitHub](')
    expect(body).toContain('[Gitee](')
    expect(body).toContain('[CNB](')

    fs.rmSync(dir, { recursive: true, force: true })
  })
})
