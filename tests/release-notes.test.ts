import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { QQ_GROUP_URL } from '../shared/app'

// 下载入口按系统和架构分组，同一行的每个下载源必须指向同一份资产。
const SCRIPT = path.resolve(import.meta.dirname, '../scripts/gen-release-notes.mjs')

const ARTIFACTS = [
  'DownVid-Wails-mac-universal-1.9.0.dmg',
  'DownVid-Wails-mac-universal-1.9.0.zip',
  'DownVid-Wails-windows-x64-1.9.0-installer.exe',
  'DownVid-Wails-windows-x64-1.9.0.zip',
  'DownVid-Wails-windows-arm64-1.9.0-installer.exe',
  'DownVid-Wails-linux-x64-1.9.0.deb',
  'DownVid-Wails-linux-x64-1.9.0.tar.gz',
  'DownVid-Wails-linux-arm64-1.9.0.deb',
]

const BASE = {
  github: 'https://github.com/Downvid/downvid/releases/download/v1.9.0',
  gitee: 'https://gitee.com/Xynrin/downvid/releases/download/v1.9.0',
  cnb: 'https://cnb.cool/yxxbc/downvid/-/releases/download/v1.9.0',
}

function render(artifacts: string[], ...args: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'downvid-notes-'))
  try {
    for (const name of artifacts) fs.writeFileSync(path.join(dir, name), 'x')
    return execFileSync(process.execPath, [SCRIPT, dir, '1.9.0', ...args], { encoding: 'utf8' })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

describe('gen-release-notes', () => {
  it('每个系统、架构和格式都提供同一份包的三个下载源', () => {
    const body = render(ARTIFACTS, '--sources=github,gitee,cnb')
    expect(body.match(/^#### .+$/gm)).toEqual(['#### macOS', '#### Windows', '#### Linux'])
    for (const name of ARTIFACTS) {
      const rows = body.split('\n').filter((line) => line.includes(name))
      expect(rows, name).toHaveLength(1)
      const urls = [...rows[0].matchAll(/\]\((https:\/\/[^)]+\/releases\/download\/[^)]+)\)/g)]
      expect(urls.map((m) => m[1]), name).toEqual(
        Object.values(BASE).map((base) => `${base}/${name}`),
      )
    }
    expect(body).toContain('Universal（Apple 芯片 / Apple silicon + Intel）')
    expect(body.match(/\*\*ARM64（ARM）\*\*/g)).toHaveLength(2)
    expect(body).toContain('logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2C')
    expect(body).not.toContain('/releases/tag/')
  })

  it('只展示就绪的下载源，各镜像以自己的地址为先且保留 GitHub', () => {
    const github = render(ARTIFACTS)
    for (const name of ARTIFACTS) expect(github).toContain(`${BASE.github}/${name}`)
    expect(github).not.toContain(BASE.gitee)
    expect(github).not.toContain(BASE.cnb)

    for (const source of ['gitee', 'cnb'] as const) {
      const other = source === 'gitee' ? 'cnb' : 'gitee'
      const body = render(ARTIFACTS, `--sources=${source},github`)
      expect(body).not.toContain(BASE[other])
      for (const name of ARTIFACTS) {
        const line = body.split('\n').find((row) => row.includes(name)) ?? ''
        expect(line).toContain(`${BASE[source]}/${name}`)
        expect(line).toContain(`${BASE.github}/${name}`)
        expect(line.indexOf(BASE[source])).toBeLessThan(line.indexOf(BASE.github))
      }
    }
  })

  it('缺系统、缺架构或某种格式时明确区分，不生成不存在的包', () => {
    const body = render([
      'DownVid-Wails-mac-arm64-1.9.0.dmg',
      'DownVid-Wails-windows-x64-1.9.0.zip',
      'DownVid-Wails-linux-x64-1.9.0-rc.1.deb',
      'DownVid-Wails-windows-arm64-1.9.0-rc.1-installer.exe',
      'DownVid-Wails-windows-arm64-1.8.9-installer.exe',
      'DownVid-Wails-linux-x64-1.9.0.deb.sha256',
    ], '--sources=github,gitee,cnb')
    const [, mac, windows, linux] = body.split(/^#### (?:macOS|Windows|Linux)$/m)
    expect(mac).toContain('**ARM64（Apple 芯片 / Apple silicon）**')
    expect(mac).toContain('Not in this release: x64（Intel）')
    expect(windows).toContain('Not in this release: ARM64（ARM）')
    expect(linux).toContain('No package in this release.')
    expect(windows).toContain('**便携版 ZIP / Portable**（推荐 / Recommended）')
    expect(body).not.toContain('-rc.1')
    expect(body).not.toContain('1.8.9-installer.exe')
    expect(body).not.toContain('.deb.sha256')
    expect(body).not.toContain('windows-x64-1.9.0-installer.exe')
    expect(body).not.toContain('linux-arm64-1.9.0.tar.gz')
  })

  it('没有构建时不声称可以下载，保留安装说明和交流群', () => {
    const body = render([])
    expect(body.match(/No package in this release\./g)).toHaveLength(3)
    expect(body).not.toContain('/releases/download/')
    expect(body).toContain('Platform Notes')
    expect(body).toContain(QQ_GROUP_URL)
    expect(body).toContain('logo=qq')
  })

  it('非镜像脚本支持的格式只链接 GitHub，不捏造镜像链接', () => {
    const file = 'DownVid-Wails-linux-x64-1.9.0.rpm'
    const body = render([file], '--sources=cnb,github')
    expect(body).toContain(`${BASE.github}/${file}`)
    expect(body).not.toContain(BASE.cnb)
  })
})
