import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 官网（website/index.html）下载区的分发逻辑。
 *
 * 官网是单文件、无构建，脚本内联。这里把标注为「>>> 纯逻辑」的那一段（不碰 DOM）
 * 从 HTML 里抽出来单独执行，用**真实的** Release 产物列表做输入，断言
 * 「哪个系统该拿哪个包」。选错了用户会下到装不上的包（Intel 版装到 Apple 芯片、
 * Linux 版装到 Windows），而线上没有任何报错——只能靠这一层拦住。
 */
const HTML = readFileSync(path.resolve(import.meta.dirname, '../website/index.html'), 'utf8')

const BLOCK = /\/\/ >>> 纯逻辑[^\n]*\n([\s\S]*?)\n\/\/ <<< 纯逻辑/.exec(HTML)?.[1]
if (!BLOCK) throw new Error('website/index.html 里没有找到「>>> 纯逻辑」标记块')

type Variant = { name: string; key: string; arch: string; primary?: boolean }
type Asset = { name: string; url: string; size: number }
type Release = { tag: string; assets: Asset[] }
type Picked = { primary: { asset: Asset; variant: Variant } | null; others: { asset: Asset; variant: Variant }[] }
type Group = { os: string; items: { asset: Asset; variant: Variant }[] }

const api = new Function(
  BLOCK +
    '\nreturn { detectOS, archOf, archFromClientHints, templateToRegex, normalizeRelease, selectDownload, listDownloads, formatSize, ARTIFACTS, PLATFORMS, REPO }',
)() as {
  detectOS: (nav: Record<string, unknown>) => string
  archOf: (nav: Record<string, unknown>, os: string) => string
  archFromClientHints: (uad: unknown) => Promise<string | null>
  templateToRegex: (template: string) => RegExp
  normalizeRelease: (json: unknown) => Release | null
  selectDownload: (release: Release | null, os: string | null, arch: string) => Picked
  listDownloads: (release: Release | null, preferredOS?: string | null) => Group[]
  formatSize: (bytes: number) => string
  ARTIFACTS: Record<string, Variant[]>
  PLATFORMS: { os: string; key: string }[]
  REPO: { owner: string; repo: string }
}

/**
 * 真实产物列表（v1.3.4，取自 GitHub Releases API）。
 * 刻意保留 .blockmap / .zip / .tar.gz / latest*.yml 这些**干扰项**：
 * 模板少一个 $ 锚点就会挑中升级包或校验文件。
 */
const ASSET_NAMES: [string, number][] = [
  ['DownVid-amd64-Linux-1.3.4.deb', 105020908],
  ['DownVid-arm64-Linux-1.3.4.AppImage', 132238535],
  ['DownVid-arm64-Linux-1.3.4.tar.gz', 125596357],
  ['DownVid-arm64-Mac-1.3.4.dmg', 134242182],
  ['DownVid-arm64-Mac-1.3.4.dmg.blockmap', 141459],
  ['DownVid-arm64-Mac-1.3.4.zip', 133928592],
  ['DownVid-arm64-Mac-1.3.4.zip.blockmap', 141981],
  ['DownVid-Portable-1.3.4.exe', 116623908],
  ['DownVid-Setup-1.3.4.exe', 116966487],
  ['DownVid-Setup-1.3.4.exe.blockmap', 121881],
  ['DownVid-x64-Linux-1.3.4.tar.gz', 125016469],
  ['DownVid-x64-Mac-1.3.4.dmg', 138353132],
  ['DownVid-x64-Mac-1.3.4.dmg.blockmap', 145833],
  ['DownVid-x64-Mac-1.3.4.zip', 138099742],
  ['DownVid-x64-Mac-1.3.4.zip.blockmap', 145824],
  ['DownVid-x86_64-Linux-1.3.4.AppImage', 131352891],
  ['DownVid-x86_64-Linux-1.3.4.rpm', 94105057],
  ['latest-linux-arm64.yml', 365],
  ['latest-linux.yml', 687],
  ['latest-mac.yml', 821],
  ['latest.yml', 343],
]

const RAW_RELEASE = {
  tag_name: 'v1.3.4',
  assets: ASSET_NAMES.map(([name, size]) => ({
    name,
    size,
    browser_download_url:
      'https://github.com/Downvid/downvid/releases/download/v1.3.4/' + encodeURIComponent(name),
  })),
}

const RELEASE = api.normalizeRelease(RAW_RELEASE)
if (!RELEASE) throw new Error('normalizeRelease 没能解析测试用的产物列表')

const MAC_SAFARI = {
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  platform: 'MacIntel',
  maxTouchPoints: 0,
}
const WINDOWS_CHROME = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  platform: 'Win32',
  maxTouchPoints: 0,
}
const LINUX_CHROME = {
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  platform: 'Linux x86_64',
  maxTouchPoints: 0,
}

const primaryName = (picked: Picked) => (picked.primary ? picked.primary.asset.name : null)
const otherNames = (picked: Picked) => picked.others.map((o) => o.asset.name)

describe('detectOS', () => {
  it('Windows 判成 windows', () => {
    expect(api.detectOS(WINDOWS_CHROME)).toBe('windows')
  })

  it('macOS 判成 macos', () => {
    expect(api.detectOS(MAC_SAFARI)).toBe('macos')
  })

  it('Linux 判成 linux', () => {
    expect(api.detectOS(LINUX_CHROME)).toBe('linux')
  })

  it('Android 归到 other —— UA 里也带 Linux，不能顺手给个 Linux 版', () => {
    expect(
      api.detectOS({
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
        platform: 'Linux armv8l',
        maxTouchPoints: 5,
      }),
    ).toBe('other')
  })

  it('iPadOS（平台伪装成 Mac + 多点触控）归到 other', () => {
    expect(api.detectOS({ userAgent: MAC_SAFARI.userAgent, platform: 'MacIntel', maxTouchPoints: 5 })).toBe('other')
  })

  it('ChromeOS 归到 other（装不了 Linux 版）', () => {
    expect(
      api.detectOS({
        userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        platform: 'Linux x86_64',
        maxTouchPoints: 0,
      }),
    ).toBe('other')
  })
})

describe('archOf', () => {
  it('macOS 拿不到架构时默认 Apple 芯片（Intel 版会列在「其他格式」里）', () => {
    expect(api.archOf(MAC_SAFARI, 'macos')).toBe('arm64')
  })

  it('UA 里写了 aarch64 就用 arm64', () => {
    expect(api.archOf({ userAgent: 'Mozilla/5.0 (X11; Linux aarch64)' }, 'linux')).toBe('arm64')
  })

  it('Windows 只有 x64', () => {
    expect(api.archOf(WINDOWS_CHROME, 'windows')).toBe('x64')
  })
})

describe('archFromClientHints', () => {
  it('Client Hints 说 arm 就是 arm64', async () => {
    const uad = { getHighEntropyValues: () => Promise.resolve({ architecture: 'arm', bitness: '64' }) }
    expect(await api.archFromClientHints(uad)).toBe('arm64')
  })

  it('Client Hints 说 x86 就是 x64', async () => {
    const uad = { getHighEntropyValues: () => Promise.resolve({ architecture: 'x86', bitness: '64' }) }
    expect(await api.archFromClientHints(uad)).toBe('x64')
  })

  it('浏览器没有这个 API（Safari / Firefox）返回 null，调用方保持默认', async () => {
    expect(await api.archFromClientHints(undefined)).toBeNull()
    expect(await api.archFromClientHints({})).toBeNull()
  })

  it('接口抛错时返回 null，不要连累整个页面', async () => {
    const uad = { getHighEntropyValues: () => Promise.reject(new Error('blocked')) }
    expect(await api.archFromClientHints(uad)).toBeNull()
  })
})

describe('templateToRegex', () => {
  it('按版本号匹配真实产物名', () => {
    expect(api.templateToRegex('DownVid-Setup-{version}.exe').test('DownVid-Setup-1.3.4.exe')).toBe(true)
    expect(api.templateToRegex('DownVid-x86_64-Linux-{version}.AppImage').test('DownVid-x86_64-Linux-1.3.4.AppImage')).toBe(true)
  })

  it('不吃 .blockmap 这类附产物（少一个 $ 锚点就会挑错）', () => {
    expect(api.templateToRegex('DownVid-Setup-{version}.exe').test('DownVid-Setup-1.3.4.exe.blockmap')).toBe(false)
  })

  it('不跨名字匹配（安装版模板不能命中便携版）', () => {
    expect(api.templateToRegex('DownVid-Setup-{version}.exe').test('DownVid-Portable-1.3.4.exe')).toBe(false)
  })
})

describe('normalizeRelease', () => {
  it('保留产物名、直链与体积', () => {
    expect(RELEASE.tag).toBe('v1.3.4')
    expect(RELEASE.assets).toHaveLength(ASSET_NAMES.length)
    const setup = RELEASE.assets.find((a) => a.name === 'DownVid-Setup-1.3.4.exe')
    expect(setup?.size).toBe(116966487)
    expect(setup?.url).toContain('/releases/download/v1.3.4/DownVid-Setup-1.3.4.exe')
  })

  it('缺少 assets / tag 时返回 null（调用方退回 Releases 页面）', () => {
    expect(api.normalizeRelease(null)).toBeNull()
    expect(api.normalizeRelease({})).toBeNull()
    expect(api.normalizeRelease({ tag_name: 'v1.0.0', assets: [] })).toBeNull()
    expect(api.normalizeRelease({ tag_name: '', assets: [{ name: 'a', browser_download_url: 'b' }] })).toBeNull()
  })

  it('丢弃字段不完整的条目', () => {
    const release = api.normalizeRelease({
      tag_name: 'v1.0.0',
      assets: [{ name: 'ok', browser_download_url: 'https://example.com/ok', size: 10 }, { name: 42 }, null],
    })
    expect(release?.assets.map((a) => a.name)).toEqual(['ok'])
  })
})

describe('selectDownload', () => {
  it('Windows 给安装版，便携版作为备选', () => {
    const picked = api.selectDownload(RELEASE, 'windows', 'x64')
    expect(primaryName(picked)).toBe('DownVid-Setup-1.3.4.exe')
    expect(otherNames(picked)).toEqual(['DownVid-Portable-1.3.4.exe'])
  })

  it('Apple 芯片 Mac 给 arm64 的 dmg（不是 Intel 版）', () => {
    const picked = api.selectDownload(RELEASE, 'macos', 'arm64')
    expect(primaryName(picked)).toBe('DownVid-arm64-Mac-1.3.4.dmg')
    expect(otherNames(picked)).toContain('DownVid-x64-Mac-1.3.4.dmg')
  })

  it('Intel Mac 给 x64 的 dmg', () => {
    expect(primaryName(api.selectDownload(RELEASE, 'macos', 'x64'))).toBe('DownVid-x64-Mac-1.3.4.dmg')
  })

  it('macOS 架构未知时退回 Apple 芯片版，Intel 版仍列在备选里', () => {
    const picked = api.selectDownload(RELEASE, 'macos', '')
    expect(primaryName(picked)).toBe('DownVid-arm64-Mac-1.3.4.dmg')
    expect(otherNames(picked)).toContain('DownVid-x64-Mac-1.3.4.dmg')
  })

  it('Linux x64 给 x86_64 的 AppImage（不是 arm64、不是 deb）', () => {
    const picked = api.selectDownload(RELEASE, 'linux', 'x64')
    expect(primaryName(picked)).toBe('DownVid-x86_64-Linux-1.3.4.AppImage')
    expect(otherNames(picked)).toEqual([
      'DownVid-arm64-Linux-1.3.4.AppImage',
      'DownVid-amd64-Linux-1.3.4.deb',
      'DownVid-x86_64-Linux-1.3.4.rpm',
    ])
  })

  it('Linux arm64 给 arm64 的 AppImage', () => {
    expect(primaryName(api.selectDownload(RELEASE, 'linux', 'arm64'))).toBe('DownVid-arm64-Linux-1.3.4.AppImage')
  })

  it('产物缺失时返回 null，交给调用方退回 Releases 页面（不留死链）', () => {
    const onlyZip = { tag: 'v1.3.4', assets: RELEASE.assets.filter((a) => a.name.endsWith('.zip')) }
    expect(primaryName(api.selectDownload(onlyZip, 'macos', 'arm64'))).toBeNull()
    expect(otherNames(api.selectDownload(onlyZip, 'macos', 'arm64'))).toEqual([])
  })

  it('没拿到 Release、或系统未识别（其他平台 / 手机）时不选任何东西', () => {
    expect(primaryName(api.selectDownload(null, 'windows', 'x64'))).toBeNull()
    expect(primaryName(api.selectDownload(RELEASE, null, 'x64'))).toBeNull()
    expect(primaryName(api.selectDownload(RELEASE, 'other', 'x64'))).toBeNull()
  })

  it('产物表里每个模板都能在真实产物里命中（模板写错会静默挑不到）', () => {
    const missed: string[] = []
    for (const os of Object.keys(api.ARTIFACTS)) {
      for (const variant of api.ARTIFACTS[os]) {
        const re = api.templateToRegex(variant.name)
        if (!RELEASE.assets.some((a) => re.test(a.name))) missed.push(os + ' ' + variant.name)
      }
    }
    expect(missed).toEqual([])
  })
})

describe('listDownloads（展开菜单里的全量列表）', () => {
  it('按平台分组列出全部产物，识别出的平台排在最前面', () => {
    const groups = api.listDownloads(RELEASE, 'linux')
    expect(groups.map((g) => g.os)).toEqual(['linux', 'windows', 'macos'])
    expect(groups[0].items.map((i) => i.asset.name)).toEqual([
      'DownVid-x86_64-Linux-1.3.4.AppImage',
      'DownVid-arm64-Linux-1.3.4.AppImage',
      'DownVid-amd64-Linux-1.3.4.deb',
      'DownVid-x86_64-Linux-1.3.4.rpm',
    ])
  })

  it('识别不出系统时保持 windows / macos / linux 的默认顺序', () => {
    expect(api.listDownloads(RELEASE, null).map((g) => g.os)).toEqual(['windows', 'macos', 'linux'])
    expect(api.listDownloads(RELEASE, 'other').map((g) => g.os)).toEqual(['windows', 'macos', 'linux'])
  })

  it('没有 Release 时返回空数组，菜单只留「全部版本与产物」', () => {
    expect(api.listDownloads(null, 'macos')).toEqual([])
  })

  it('某个平台产物缺失时整组不出现（而不是留一个空组）', () => {
    const noMac = { tag: 'v1.3.4', assets: RELEASE.assets.filter((a) => a.name.indexOf('Mac') < 0) }
    expect(api.listDownloads(noMac, 'macos').map((g) => g.os)).toEqual(['windows', 'linux'])
  })

  it('PLATFORMS 里的词条名与 HTML 里用的 plat.* 对得上', () => {
    expect(api.PLATFORMS.map((p) => p.os)).toEqual(['windows', 'macos', 'linux'])
    expect(api.PLATFORMS.map((p) => p.key)).toEqual(['plat.windows', 'plat.macos', 'plat.linux'])
  })
})

describe('formatSize', () => {
  it('换算成 MB（界面上的「约 125 MB」）', () => {
    expect(api.formatSize(131352891)).toBe('125 MB')
    expect(api.formatSize(116966487)).toBe('112 MB')
  })

  it('拿不到体积时返回空串，提示里就不显示体积', () => {
    expect(api.formatSize(0)).toBe('')
    expect(api.formatSize(10)).toBe('')
  })
})

describe('页面与仓库坐标', () => {
  it('REPO 指向 shared/app.ts 里的仓库（lint:website 也会比对，这里再兜一层）', () => {
    expect(api.REPO).toEqual({ owner: 'Downvid', repo: 'downvid' })
  })
})
