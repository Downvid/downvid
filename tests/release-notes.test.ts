import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { QQ_GROUP_URL } from '../shared/app'

/**
 * Release 正文的下载引导区。
 *
 * 模板是「三个直链大徽章 + 其余架构/格式」：
 *   - 顶部三个徽章分别直链 macOS / Windows / Linux 的主推包，而且分别放在
 *     GitHub / Gitee / CNB 上——点击即下载，不经过 Release 页面；
 *   - 下方列出其余格式与架构，链接仍是资产直链。
 *
 * 最容易坏的两点：镜像/平台的对应关系，以及「只给实际存在的产物生成链接」。
 */

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

let body = ''
let tmp = ''

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'downvid-notes-'))
  const artifacts = path.join(tmp, 'artifacts')
  fs.mkdirSync(artifacts)
  for (const name of ARTIFACTS) fs.writeFileSync(path.join(artifacts, name), 'x')
  body = execFileSync(process.execPath, [SCRIPT, artifacts, '1.9.0'], { encoding: 'utf8' })
})

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('gen-release-notes', () => {
  it('三个大徽章分别直链不同平台、不同镜像的资产', () => {
    // macOS → GitHub
    expect(body).toContain(
      'https://github.com/Downvid/downvid/releases/download/v1.9.0/DownVid-Wails-mac-universal-1.9.0.dmg',
    )
    // Windows x64 → Gitee
    expect(body).toContain(
      'https://gitee.com/Xynrin/downvid/releases/download/v1.9.0/DownVid-Wails-windows-x64-1.9.0-installer.exe',
    )
    // Linux x64 → CNB
    expect(body).toContain(
      'https://cnb.cool/yxxbc/downvid/-/releases/download/v1.9.0/DownVid-Wails-linux-x64-1.9.0.deb',
    )

    // 不再跳到 Release 页面让用户自己找
    expect(body).not.toContain('/releases/tag/')
  })

  it('三个大徽章带各自平台的 logo', () => {
    expect(body).toContain('logo=github')
    expect(body).toContain('logo=gitee')
    // CNB 在 Simple Icons 里的 slug 是 cloudnativebuild（其全称）
    expect(body).toContain('logo=cloudnativebuild')
  })

  it('其余架构与格式也保持资产直链，并按平台沿用同一个镜像', () => {
    expect(body).toContain('label=Windows+arm64')
    expect(body).toContain(
      'https://gitee.com/Xynrin/downvid/releases/download/v1.9.0/DownVid-Wails-windows-arm64-1.9.0-installer.exe',
    )
    expect(body).toContain('label=Linux+arm64')
    expect(body).toContain(
      'https://cnb.cool/yxxbc/downvid/-/releases/download/v1.9.0/DownVid-Wails-linux-arm64-1.9.0.deb',
    )

    expect(body).toContain(
      'https://github.com/Downvid/downvid/releases/download/v1.9.0/DownVid-Wails-mac-universal-1.9.0.zip',
    )
    expect(body).toContain(
      'https://gitee.com/Xynrin/downvid/releases/download/v1.9.0/DownVid-Wails-windows-x64-1.9.0.zip',
    )
    expect(body).toContain(
      'https://cnb.cool/yxxbc/downvid/-/releases/download/v1.9.0/DownVid-Wails-linux-x64-1.9.0.tar.gz',
    )
  })

  it('只给实际存在的产物生成徽章', () => {
    // 这台夹具没有 linux-arm64 的 tar.gz
    expect(body).not.toContain('linux-arm64-1.9.0.tar.gz')
    expect(body).not.toContain('windows-arm64-1.9.0.zip')
  })

  it('Windows 徽章用内联 SVG 图标（Simple Icons 已移除 windows）', () => {
    // URLSearchParams 会把 data:image/svg+xml;base64, 编码成这样的前缀
    expect(body).toContain('logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2C')
  })

  it('带 QQ 交流群入口', () => {
    expect(body).toContain(QQ_GROUP_URL)
    expect(body).toContain('logo=qq')
  })

  it('不再生成下载对照表', () => {
    expect(body).not.toContain('| 平台 / Platform |')
    expect(body).not.toContain('Download Matrix')
    expect(body).not.toContain('[GitHub](')
    expect(body).not.toContain('[Gitee](')
    expect(body).not.toContain('[CNB](')
  })
})
