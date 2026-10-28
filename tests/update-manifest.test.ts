import { describe, it, expect } from 'vitest'
import {
  buildManifest,
  classifyAsset,
  normalizeVersion,
} from '../scripts/lib/update-manifest.mjs'

/**
 * wmlUpdate static manifest 的生成规则。
 *
 * 这份文件是 jsDelivr / Gitee / 官网三个更新源的同一份内容；产物分类写错、
 * SHA-256 漏填，都会让用户端「检查更新成功、下载校验失败」——所以每个平台
 * 的现有产物名各留一个断言。
 */

describe('classifyAsset', () => {
  const cases: Array<[string, { os: string; arch: string; format: string }]> = [
    ['DownVid-Wails-mac-universal-1.7.3.zip', { os: 'darwin', arch: 'universal', format: 'zip' }],
    ['DownVid-Wails-mac-universal-1.7.3.dmg', { os: 'darwin', arch: 'universal', format: 'dmg' }],
    [
      'DownVid-Wails-windows-x64-1.7.3-installer.exe',
      { os: 'windows', arch: 'amd64', format: 'exe' },
    ],
    ['DownVid-Wails-windows-x64-1.7.3.zip', { os: 'windows', arch: 'amd64', format: 'zip' }],
    ['DownVid-Wails-linux-x64-1.7.3.tar.gz', { os: 'linux', arch: 'amd64', format: 'tar.gz' }],
    ['DownVid-Wails-linux-x64-1.7.3.deb', { os: 'linux', arch: 'amd64', format: '' }],
  ]

  for (const [name, want] of cases) {
    it(name, () => {
      expect(classifyAsset(name)).toEqual(want)
    })
  }

  it('忽略 Electron 产物与校验文件', () => {
    expect(classifyAsset('DownVid-Setup-1.7.3.exe')).toBeNull()
    expect(classifyAsset('DownVid-Portable-1.7.3.exe')).toBeNull()
    expect(classifyAsset('checksums.txt')).toBeNull()
  })
})

describe('buildManifest', () => {
  const sha = 'a'.repeat(64)
  const base = {
    appId: 'com.downvid.downvid',
    version: 'v1.7.3',
    tag: 'v1.7.3',
    repo: 'Downvid/downvid',
    publishedAt: '2026-10-28T00:00:00Z',
    notes: 'notes',
    assets: [
      { name: 'DownVid-Wails-windows-x64-1.7.3.zip', sha256: sha, size: 10 },
      { name: 'DownVid-Wails-mac-universal-1.7.3.zip', sha256: `sha256:${sha}`, size: 20 },
      { name: 'checksums.txt', sha256: sha, size: 1 },
    ],
  }

  it('只保留 Wails 产物，去掉 v 前缀并按名字排序', () => {
    const m = buildManifest(base)
    expect(m.version).toBe('1.7.3')
    expect(m.schema_version).toBe(1)
    expect(m.app_id).toBe('com.downvid.downvid')
    expect(m.assets.map((a: { name: string }) => a.name)).toEqual([
      'DownVid-Wails-mac-universal-1.7.3.zip',
      'DownVid-Wails-windows-x64-1.7.3.zip',
    ])
  })

  it('拼出可下载的 GitHub 直链，并规范化 sha256', () => {
    const m = buildManifest(base)
    const mac = m.assets.find((a: { os: string }) => a.os === 'darwin')
    expect(mac.url).toBe(
      'https://github.com/Downvid/downvid/releases/download/v1.7.3/DownVid-Wails-mac-universal-1.7.3.zip',
    )
    expect(mac.sha256).toBe(sha)
    expect(mac.size).toBe(20)
  })

  it('支持镜像自己的产物地址', () => {
    const m = buildManifest({
      ...base,
      releaseBase: 'https://gitee.com/Xynrin/downvid/releases/download/v1.7.3',
    })
    const mac = m.assets.find((a: { os: string }) => a.os === 'darwin')
    expect(mac.url).toBe(
      'https://gitee.com/Xynrin/downvid/releases/download/v1.7.3/DownVid-Wails-mac-universal-1.7.3.zip',
    )
  })

  it('缺少 SHA-256 直接失败', () => {
    expect(() =>
      buildManifest({
        ...base,
        assets: [{ name: 'DownVid-Wails-mac-universal-1.7.3.zip', sha256: '', size: 1 }],
      }),
    ).toThrow(/SHA-256/)
  })

  it('没有 Wails 产物直接失败', () => {
    expect(() =>
      buildManifest({ ...base, assets: [{ name: 'checksums.txt', sha256: sha, size: 1 }] }),
    ).toThrow(/DownVid-Wails/)
  })
})

describe('normalizeVersion', () => {
  it('接受 v 前缀', () => {
    expect(normalizeVersion('v1.7.3')).toBe('1.7.3')
  })
  it('拒绝非 SemVer', () => {
    expect(() => normalizeVersion('latest')).toThrow(/SemVer/)
    expect(() => normalizeVersion('1')).toThrow(/SemVer/)
  })
})
