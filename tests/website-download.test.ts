import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 官网（website/app.js）下载区的分发逻辑。
 *
 * 官网是无构建的多文件静态站，脚本在 app.js。这里把标注为「>>> 纯逻辑」的那一段
 * （不碰 DOM）从脚本里抽出来单独执行，用**真实的** Release 产物列表做输入，断言
 * 「哪个系统该拿哪个包」。选错了用户会下到装不上的包（Windows 的 zip 给 macOS），
 * 而线上没有任何报错——只能靠这一层拦住。
 */
const SCRIPT = readFileSync(path.resolve(import.meta.dirname, '../website/app.js'), 'utf8')

const BLOCK = /\/\/ >>> 纯逻辑[^\n]*\n([\s\S]*?)\n\/\/ <<< 纯逻辑/.exec(SCRIPT)?.[1]
if (!BLOCK) throw new Error('website/app.js 里没有找到「>>> 纯逻辑」标记块')

type Variant = { name: string; key: string; arch: string; primary?: boolean }
type Asset = { name: string; url: string; size: number }
type Release = { tag: string; assets: Asset[] }
type Picked = { primary: { asset: Asset; variant: Variant } | null; others: { asset: Asset; variant: Variant }[] }
type Group = { os: string; items: { asset: Asset; variant: Variant }[] }

const api = new Function(
  BLOCK +
    '\nreturn { detectOS, archOf, archFromClientHints, templateToRegex, normalizeRelease, selectDownload, listDownloads, formatSize, buildFallbackRelease, ARTIFACTS, PLATFORMS, REPO }',
)() as {
  detectOS: (nav: Record<string, unknown>) => string
  archOf: (nav: Record<string, unknown>, os: string) => string
  archFromClientHints: (uad: unknown) => Promise<string | null>
  templateToRegex: (template: string) => RegExp
  normalizeRelease: (json: unknown) => Release | null
  selectDownload: (release: Release | null, os: string | null, arch: string) => Picked
  listDownloads: (release: Release | null, preferredOS?: string | null) => Group[]
  formatSize: (bytes: number) => string
  buildFallbackRelease: (versionTag: string) => Release
  ARTIFACTS: Record<string, Variant[]>
  PLATFORMS: { os: string; key: string }[]
  REPO: { owner: string; repo: string }
}

/**
 * 真实产物列表（v1.6.0 的 Wails 产物形态）。
 * 刻意保留 `latest*.yml`、旧的 Electron 产物名这些**干扰项**：
 * 模板少一个 `$` 锚点就会挑中旧包或更新清单。
 */
const ASSET_NAMES: [string, number][] = [
  ['DownVid-Wails-linux-x64-1.6.0.deb', 19_200_000],
  ['DownVid-Wails-linux-x64-1.6.0.tar.gz', 18_400_000],
  ['DownVid-Wails-mac-arm64-1.6.0.zip', 21_300_000],
  ['DownVid-Wails-mac-universal-1.6.0.dmg', 43_100_000],
  ['DownVid-Wails-mac-universal-1.6.0.zip', 42_600_000],
  ['DownVid-Wails-mac-x64-1.6.0.zip', 21_500_000],
  ['DownVid-Wails-windows-x64-1.6.0-installer.exe', 24_500_000],
  ['DownVid-Wails-windows-x64-1.6.0.zip', 19_100_000],
  // 干扰项：旧架构产物与更新清单，都不该被挑中
  ['DownVid-Setup-1.6.0.exe', 116_966_487],
  ['DownVid-arm64-Mac-1.6.0.dmg', 134_242_182],
  ['latest-linux.yml', 687],
  ['latest-mac.yml', 821],
  ['latest.yml', 343],
]

const RAW_RELEASE = {
  tag_name: 'v1.6.0',
  assets: ASSET_NAMES.map(([name, size]) => ({
    name,
    size,
    browser_download_url:
      'https://github.com/Downvid/downvid/releases/download/v1.6.0/' + encodeURIComponent(name),
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

  it('Android 归到 other —— UA 里也带 Linux，不能顺手给个 Linux 包', () => {
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

  it('ChromeOS 归到 other（装不了 Linux 包）', () => {
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
  it('macOS 拿不到架构时默认 Apple 芯片', () => {
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
    expect(
      api.templateToRegex('DownVid-Wails-windows-x64-{version}.zip').test('DownVid-Wails-windows-x64-1.6.0.zip'),
    ).toBe(true)
    expect(
      api.templateToRegex('DownVid-Wails-linux-x64-{version}.tar.gz').test('DownVid-Wails-linux-x64-1.6.0.tar.gz'),
    ).toBe(true)
  })

  it('不吃附产物 / 更新清单（少一个 $ 锚点就会挑错）', () => {
    expect(api.templateToRegex('DownVid-Wails-windows-x64-{version}.zip').test('latest.yml')).toBe(false)
    expect(
      api.templateToRegex('DownVid-Wails-windows-x64-{version}.zip').test('DownVid-Wails-windows-x64-1.6.0.zip.blockmap'),
    ).toBe(false)
  })

  it('不跨平台匹配（Windows 模板不能命中 macOS 包）', () => {
    expect(
      api.templateToRegex('DownVid-Wails-windows-x64-{version}.zip').test('DownVid-Wails-mac-x64-1.6.0.zip'),
    ).toBe(false)
  })
})

describe('normalizeRelease', () => {
  it('保留产物名、直链与体积', () => {
    expect(RELEASE.tag).toBe('v1.6.0')
    expect(RELEASE.assets).toHaveLength(ASSET_NAMES.length)
    const win = RELEASE.assets.find((a) => a.name === 'DownVid-Wails-windows-x64-1.6.0.zip')
    expect(win?.size).toBe(19_100_000)
    expect(win?.url).toContain('/releases/download/v1.6.0/DownVid-Wails-windows-x64-1.6.0.zip')
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
  it('Windows 给 windows-x64 的安装器（不是旧架构的 .exe、不是 macOS 包）', () => {
    const picked = api.selectDownload(RELEASE, 'windows', 'x64')
    expect(primaryName(picked)).toBe('DownVid-Wails-windows-x64-1.6.0-installer.exe')
    expect(otherNames(picked)).toContain('DownVid-Wails-windows-x64-1.6.0.zip')
  })

  it('macOS 两种芯片都给 universal dmg 安装器', () => {
    expect(primaryName(api.selectDownload(RELEASE, 'macos', 'arm64'))).toBe('DownVid-Wails-mac-universal-1.6.0.dmg')
    expect(primaryName(api.selectDownload(RELEASE, 'macos', 'x64'))).toBe('DownVid-Wails-mac-universal-1.6.0.dmg')
    expect(otherNames(api.selectDownload(RELEASE, 'macos', 'arm64'))).toContain('DownVid-Wails-mac-universal-1.6.0.zip')
  })

  it('Linux 给 deb 安装包', () => {
    expect(primaryName(api.selectDownload(RELEASE, 'linux', 'x64'))).toBe('DownVid-Wails-linux-x64-1.6.0.deb')
    expect(otherNames(api.selectDownload(RELEASE, 'linux', 'x64'))).toContain('DownVid-Wails-linux-x64-1.6.0.tar.gz')
  })

  it('产物缺失时返回 null，交给调用方退回 Releases 页面（不留死链）', () => {
    const noLinux = { tag: 'v1.6.0', assets: RELEASE.assets.filter((a) => !a.name.includes('linux')) }
    expect(primaryName(api.selectDownload(noLinux, 'linux', 'x64'))).toBeNull()
    expect(otherNames(api.selectDownload(noLinux, 'linux', 'x64'))).toEqual([])
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
      'DownVid-Wails-linux-x64-1.6.0.deb',
      'DownVid-Wails-linux-x64-1.6.0.tar.gz',
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
    const noMac = { tag: 'v1.6.0', assets: RELEASE.assets.filter((a) => !a.name.includes('mac')) }
    expect(api.listDownloads(noMac, 'macos').map((g) => g.os)).toEqual(['windows', 'linux'])
  })

  it('PLATFORMS 里的词条名与 HTML 里用的 plat.* 对得上', () => {
    expect(api.PLATFORMS.map((p) => p.os)).toEqual(['windows', 'macos', 'linux'])
    expect(api.PLATFORMS.map((p) => p.key)).toEqual(['plat.windows', 'plat.macos', 'plat.linux'])
  })
})

describe('formatSize', () => {
  it('换算成 MB（界面上的「约 19 MB」）', () => {
    expect(api.formatSize(19_100_000)).toBe('18 MB')
    expect(api.formatSize(116_966_487)).toBe('112 MB')
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

describe('buildFallbackRelease（离线/网络受阻兜底）', () => {
  it('为各平台构造产物与直链', () => {
    const fallback = api.buildFallbackRelease('v1.6.0')
    expect(fallback.tag).toBe('v1.6.0')
    expect(fallback.assets).toHaveLength(6)

    expect(api.selectDownload(fallback, 'windows', 'x64').primary?.asset.name).toBe(
      'DownVid-Wails-windows-x64-1.6.0-installer.exe',
    )
    expect(api.selectDownload(fallback, 'macos', 'arm64').primary?.asset.name).toBe(
      'DownVid-Wails-mac-universal-1.6.0.dmg',
    )
    const linux = api.selectDownload(fallback, 'linux', 'x64')
    expect(linux.primary?.asset.name).toBe('DownVid-Wails-linux-x64-1.6.0.deb')
    expect(linux.primary?.asset.url).toContain('/download/v1.6.0/DownVid-Wails-linux-x64-1.6.0.deb')
  })
})
