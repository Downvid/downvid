import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  AUTO_CHAIN,
  UPDATE_SOURCE_IDS,
  classifyHttpStatus,
  compareVersions,
  latestCandidates,
  normalizeUpdateSource,
  parseLatestPayload,
  type UpdateSourceId,
} from '../shared/update-sources'
import { lookupLatestRelease, summarizeFailures, type FetchLike } from '../shared/update-check'
import { assetsFor, normalizePlatform, parseManifest } from '../scripts/deps-asset.mjs'

/**
 * 更新源链路与依赖资产解析。
 *
 * 这两块的共同点是：**错了不会报错**。
 *   - 更新源拼错域名 → 表现为「永远已是最新」，用户永远收不到修复；
 *   - 资产表解析错 → 镜像里装的是别的版本，或者干脆漏装一个依赖。
 *
 * 所以这里钉的是「形状」而不只是「有没有返回值」：URL 必须指向正确的主机与
 * 仓库、各源的响应必须归一化成同一个 `LatestRelease`、非法设置必须回退到
 * 会自动降级的 `auto` 而不是「一个源都不试」。
 */

const ROOT = path.resolve(import.meta.dirname, '..')

describe('更新源候选', () => {
  it('auto 展开成完整链路，且顺序就是优先级', () => {
    const sources = latestCandidates('auto').map((c) => c.source)
    expect(sources).toEqual([...AUTO_CHAIN])
  })

  it('auto 是唯一会展开的取值；其余只给一个候选', () => {
    for (const id of UPDATE_SOURCE_IDS.filter((s) => s !== 'auto')) {
      const list = latestCandidates(id as UpdateSourceId)
      expect(list).toHaveLength(1)
      expect(list[0].source).toBe(id)
    }
  })

  it('每个源的 URL 都指向正确的主机与仓库（拼错=永远已是最新）', () => {
    const bySource = new Map(latestCandidates('auto').map((c) => [c.source, c.url]))
    expect(bySource.get('github')).toBe('https://api.github.com/repos/Downvid/downvid/releases/latest')
    expect(bySource.get('jsdelivr')).toContain('data.jsdelivr.com')
    expect(bySource.get('jsdelivr')).toContain('Downvid/downvid')
    expect(bySource.get('ghproxy')).toContain('gh-proxy')
    expect(bySource.get('ghproxy')).toContain('api.github.com/repos/Downvid/downvid/releases/latest')
    expect(bySource.get('gitee')).toContain('gitee.com')
    expect(bySource.get('website')).toMatch(/^https:\/\//)
  })

  it('官网排在链路最后：它给不出安装包，只是最后的兜底', () => {
    expect(AUTO_CHAIN[AUTO_CHAIN.length - 1]).toBe('website')
  })
})

describe('响应归一化', () => {
  it('GitHub 的 tag_name / body / published_at', () => {
    const r = parseLatestPayload('github', {
      tag_name: 'v1.4.1',
      body: '更新内容\n- 修了一处',
      published_at: '2026-10-16T00:00:00Z',
    })
    expect(r).toMatchObject({ version: '1.4.1', releaseNotes: '更新内容\n- 修了一处', source: 'github' })
  })

  it('Gitee 返回的是数组', () => {
    const r = parseLatestPayload('gitee', [{ tag_name: 'v1.5.0', body: '正文', created_at: 'X' }])
    expect(r?.version).toBe('1.5.0')
  })

  it('jsDelivr 从 versions 里挑最大的稳定版，并跳过预发布', () => {
    const r = parseLatestPayload('jsdelivr', {
      versions: [
        { version: '1.3.9' },
        { version: '1.5.0' },
        // 预发布不能经这条通道推给稳定用户：数字段比较会把它当成「更大」
        { version: '2.0.0-beta.1' },
      ],
    })
    expect(r?.version).toBe('1.5.0')
  })

  it('jsDelivr 只有预发布时返回 null（换下一个源），而不是推一个 beta', () => {
    const r = parseLatestPayload('jsdelivr', { versions: [{ version: '2.0.0-beta.1' }] })
    expect(r).toBeNull()
  })

  it('官网是纯文本版本号', () => {
    expect(parseLatestPayload('website', 'v1.4.0\n')?.version).toBe('1.4.0')
  })

  it('解析不出可信版本号时返回 null，不猜', () => {
    // 这类响应是真实可能出现的：限流页、门户页、CDN 的错误页
    for (const bad of [{}, [], null, { tag_name: 'latest' }, 'not a version', { versions: [] }]) {
      expect(parseLatestPayload('github', bad)).toBeNull()
    }
  })
})

describe('HTTP 状态分类', () => {
  it('限流 / 不存在 / 服务端错误分得开', () => {
    expect(classifyHttpStatus(403)).toBe('rate-limited')
    expect(classifyHttpStatus(429)).toBe('rate-limited')
    expect(classifyHttpStatus(404)).toBe('not-found')
    expect(classifyHttpStatus(503)).toBe('server')
  })
})

describe('链路执行与降级', () => {
  /** 造一个按 URL 返回固定结果的假 fetch */
  function fetcher(routes: Record<string, () => Promise<any>>, calls: string[] = []): FetchLike {
    return async (url) => {
      calls.push(url)
      for (const [key, value] of Object.entries(routes)) {
        if (url.includes(key)) return value()
      }
      throw new Error('ECONNREFUSED')
    }
  }

  const ok = (payload: unknown, isJson = true) => async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => String(payload),
  })
  const fail = (status: number) => async () => ({ ok: false, status, json: async () => ({}), text: async () => '' })

  it('第一个源失败时自动换下一个（github 403 → jsdelivr 成功）', async () => {
    const calls: string[] = []
    const { release, attempts } = await lookupLatestRelease({
      fetch: fetcher({
        'api.github.com': fail(403),
        'data.jsdelivr.com': ok({ versions: [{ version: '1.6.0' }] }),
      }, calls),
    })
    expect(release?.version).toBe('1.6.0')
    expect(release?.source).toBe('jsdelivr')
    expect(attempts[0]).toMatchObject({ source: 'github', ok: false, failure: 'rate-limited' })
    expect(calls).toHaveLength(2)
  })

  it('网络整体不可达时不抛异常，而是如实返回全挂轨迹', async () => {
    const { release, attempts } = await lookupLatestRelease({ fetch: fetcher({}) })
    expect(release).toBeNull()
    expect(attempts).toHaveLength(AUTO_CHAIN.length)
    expect(attempts.every((a) => !a.ok)).toBe(true)
  })

  it('固定某个源时只发一个请求（不回退）', async () => {
    const calls: string[] = []
    const { release } = await lookupLatestRelease({
      source: 'gitee',
      fetch: fetcher({ 'gitee.com': fail(404) }, calls),
    })
    expect(release).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it('失败的说明是人话，不含 HTTP 码', async () => {
    const { attempts } = await lookupLatestRelease({ fetch: fetcher({}) })
    const text = summarizeFailures(attempts)
    expect(text).not.toMatch(/\b(403|404|500)\b/)
    expect(text.length).toBeGreaterThan(0)
  })
})

describe('设置里的更新源清洗', () => {
  it('合法值原样保留', () => {
    for (const id of UPDATE_SOURCE_IDS) expect(normalizeUpdateSource(id)).toBe(id)
  })

  it('非法值回退 auto（回退到「不试任何源」会让更新永久失灵）', () => {
    for (const bad of [undefined, null, '', 'github ', 'GITHUB', 42, {}, []]) {
      expect(normalizeUpdateSource(bad)).toBe('auto')
    }
  })
})

describe('版本比较', () => {
  it('段数不同、带 v 前缀、预发布都能比较', () => {
    expect(compareVersions('1.4.0', '1.3.9')).toBeGreaterThan(0)
    expect(compareVersions('v1.4.0', '1.4')).toBe(0)
    expect(compareVersions('1.4', '1.4.1')).toBeLessThan(0)
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0)
  })
})

describe('镜像依赖资产解析', () => {
  const source = fs.readFileSync(path.join(ROOT, 'backend/internal/manifest/assets.gen.go'), 'utf8')

  it('amd64 与 arm64 都解析出三件资产', () => {
    for (const platform of ['amd64', 'arm64']) {
      const assets = assetsFor(source, platform)
      expect(assets.map((a) => a.kind)).toEqual(['yt-dlp', 'ffmpeg', 'ffprobe'])
      for (const a of assets) {
        expect(a.sha256).toMatch(/^[0-9a-f]{64}$/)
        expect(a.url).toMatch(/^https:\/\//)
      }
    }
  })

  it('容器用自包含包，而不是需要 python3 的 zipapp', () => {
    // 桌面端首选 zipapp（启动 0.4s vs 9~10s），但**容器里必须用自包含包**：
    // 镜像刻意不装 python3（省 27MB），zipapp 会直接 "python3: not found"。
    // deps-asset.mjs 因此对每个平台都挑 Bundled 那份。
    for (const platform of ['amd64', 'arm64']) {
      const ytdlp = assetsFor(source, platform).find((a) => a.kind === 'yt-dlp')!
      expect(ytdlp.name).toMatch(/^yt-dlp_linux/)
      expect(ytdlp.gzip).toBe(false)
    }
  })

  it('桌面清单同时记录 zipapp 与回退包（否则没 python3 的机器装不上）', () => {
    // 主用 = zipapp（快），回退 = PyInstaller（一定跑得起来）
    for (const platform of ['darwin/arm64', 'linux/x64']) {
      const entry = new RegExp(`"${platform}": \\{[\\s\\S]*?Name: "(yt-dlp)", SHA256: "([0-9a-f]{64})",\\s*Bundled: "(yt-dlp_[a-z0-9_]+)", BundledSHA256: "([0-9a-f]{64})",\\s*ZipApp: true`, 'm')
      expect(source).toMatch(entry)
    }
  })

  it('校验的是 .gz 本身（与边车 fetch 行为一致）', () => {
    const ffmpeg = assetsFor(source, 'amd64').find((a) => a.kind === 'ffmpeg')!
    expect(ffmpeg.url.endsWith('.gz')).toBe(true)
    expect(ffmpeg.gzip).toBe(true)
  })

  it('TARGETARCH 与清单键的映射覆盖 Docker 的两种取值', () => {
    expect(normalizePlatform('amd64')).toBe('linux/x64')
    expect(normalizePlatform('arm64')).toBe('linux/arm64')
    // 直接透传 TARGETARCH 会得到 linux/amd64，在清单里查不到 → 静默少装资产
    expect(() => normalizePlatform('unknown-arch')).toThrow()
  })

  it('清单缺字段时抛错，而不是安静地少解析出几条', () => {
    expect(() => parseManifest('package manifest\n')).toThrow()
  })
})

/**
 * yt-dlp 首选 **Python zipapp**（`yt-dlp`），而不是 PyInstaller 独立包。
 *
 * ## 为什么这条值得一个测试
 *
 * 实测同一台机器、同一个 bilibili 视频：
 *
 * | 形态 | `--version` | 真实解析 |
 * | --- | --- | --- |
 * | `yt-dlp_macos`（PyInstaller） | 9.5~10.5s | 11.4s |
 * | `yt-dlp`（zipapp） | 0.41s | **2.2s** |
 *
 * PyInstaller 的单文件包每次启动都要把 ~72MB 解压到临时目录，这 9 秒是纯开销。
 * 它不报错、不影响正确性，只让人觉得「这个应用很慢」—— 所以最容易在某次
 * 「换个更稳的二进制」的改动里被悄悄改回去，而没人会发现速度掉了 5 倍。
 */
describe('yt-dlp 选型（启动速度）', () => {
  const source = fs.readFileSync(path.join(ROOT, 'backend/internal/manifest/assets.gen.go'), 'utf8')

  it('Linux / macOS 主用 zipapp，并记录自包含回退包', () => {
    for (const platform of ['darwin/arm64', 'darwin/x64', 'linux/x64', 'linux/arm64']) {
      const entry = new RegExp(`"${platform}": \\{[\\s\\S]*?Name: "yt-dlp",[\\s\\S]*?Bundled: "yt-dlp_[a-z0-9_]+",[\\s\\S]*?ZipApp: true`).exec(source)
      expect(entry, `${platform} 应当主用 zipapp 且带回退包`).not.toBeNull()
    }
  })

  it('Windows 用自包含 exe（那边 python3 不普遍）', () => {
    expect(source).toMatch(/"win32\/x64": \{[\s\S]*?Name: "yt-dlp\.exe",[\s\S]*?ZipApp: false/)
  })

  it('两条路径的哈希都在清单里（zipapp 与独立包不是同一份字节）', () => {
    const darwin = /"darwin\/arm64": \{[\s\S]*?SHA256: "([0-9a-f]{64})",[\s\S]*?BundledSHA256: "([0-9a-f]{64})"/.exec(source)
    expect(darwin).not.toBeNull()
    expect(darwin![1]).not.toBe(darwin![2])
  })
})

describe('探测不再为版本号多付一次启动', () => {
  it('成功解析路径上不单独跑 --version', () => {
    // 每次 spawn yt-dlp 要 0.4s（zipapp）到 10s（独立包）。为诊断用的版本号
    // 多跑一次，等于把解析时间翻倍 —— 只在**失败**路径才值得付。
    const src = fs.readFileSync(path.join(ROOT, 'electron/parsers/ytdlp.ts'), 'utf8')
    // 取到 dumpInfo 函数体（到下一个顶层函数为止）：单靠 `\n}` 会提前截断，
    // 因为这个函数内部有缩进的块
    const start = src.indexOf('async function dumpInfo')
    // 截到 dumpInfo 自己的结束（下一个顶层声明之前）。注意 readYtdlpVersion
    // 就在它下面、且**确实**会跑 --version（那是失败路径的设计），
    // 所以要精确切到 dumpInfo 的 `}` 为止。
    const after = src.indexOf('\n}\n', start)
    const dumpInfo = start >= 0 && after > start ? src.slice(start, after + 3) : ''
    // 去掉注释行再断言：注释里正是写着「为什么不再跑 --version」，
    // 直接匹配会被自己的说明文字命中（这条检查刚写完就踩了一次）
    const codeOnly = dumpInfo
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n')
    expect(codeOnly).not.toMatch(/runYtdlp\(\['--ignore-config', '--version'\]\)/)
    // 失败分支仍然要带版本号（Issue 里有用）
    expect(src).toContain('readYtdlpVersion')
  })
})
