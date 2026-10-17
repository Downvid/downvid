import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { DEP_MIRROR_IDS, normalizeDepMirror } from '../shared/acceleration'

/**
 * 依赖下载源（镜像）契约。
 *
 * 背景：yt-dlp / ffmpeg / ffprobe 的资产全部托管在 `github.com/.../releases/download/...`。
 * 国内网络下这个域名经常连不上，而「连不上」的表现是**依赖装不上 → 整个应用不可用**
 * （比「更新检查失败」严重得多：那个只是版本落后）。
 *
 * 这些用例钉住三件**出错时不会报错**的事：
 *   1. 前端的镜像 ID 与 Go 侧 `Mirrors` 一致（拼错只是「选了却还是走直连」）
 *   2. 非法值回退 `auto`（回退成「一个源都不试」会永久失败）
 *   3. 镜像表里确实有能用的公共反代，且顺序里直连排第一
 */

const ROOT = path.resolve(import.meta.dirname, '..')
const GO_MIRROR = fs.readFileSync(path.join(ROOT, 'backend/internal/fetch/mirror.go'), 'utf8')

/** 从 Go 源码里读出 `Mirrors` 表的 ID 与 Prefix（顺序保留） */
function goMirrors(): Array<{ id: string; prefix: string }> {
  const block = /var Mirrors = \[\]Mirror\{([\s\S]*?)\n\}/.exec(GO_MIRROR)?.[1] || ''
  return [...block.matchAll(/\{ID:\s*"([^"]+)",\s*Name:\s*"([^"]*)",\s*Prefix:\s*"([^"]*)"\}/g)].map((m) => ({
    id: m[1],
    prefix: m[3],
  }))
}

describe('依赖下载源的 ID 契约', () => {
  it('前端的固定 ID 与 Go 的 Mirror.ID 一一对应（多了 auto）', () => {
    const goIds = goMirrors().map((m) => m.id)
    const frontIds = DEP_MIRROR_IDS.filter((id) => id !== 'auto')
    expect(frontIds).toEqual(goIds)
  })

  it('Go 侧真的维护了镜像表（只剩直连等于国内用户永远装不上依赖）', () => {
    const mirrors = goMirrors()
    expect(mirrors.length).toBeGreaterThan(1)
    expect(mirrors[0].id).toBe('direct')
    expect(mirrors[0].prefix).toBe('')
  })

  it('每个镜像的 Prefix 都是 http(s) 且以 / 结尾（否则拼接后主机与路径粘连）', () => {
    for (const m of goMirrors().filter((m) => m.prefix)) {
      expect(m.prefix).toMatch(/^https?:\/\/.+\/$/)
    }
  })
})

describe('normalizeDepMirror', () => {
  it('合法值原样保留', () => {
    for (const id of DEP_MIRROR_IDS) expect(normalizeDepMirror(id)).toBe(id)
  })

  it('非法值回退 auto（回退成「不试任何源」会让下载永久失败）', () => {
    for (const bad of [undefined, null, '', 'AUTO', 'ghproxy ', 42, {}, [], 'jsdelivr']) {
      expect(normalizeDepMirror(bad)).toBe('auto')
    }
  })
})

describe('镜像回退的可观察信号', () => {
  it('Go 侧换源时会发 mirror 事件（界面据此显示「正在切换下载源」）', () => {
    expect(GO_MIRROR).toBeTruthy()
    const download = fs.readFileSync(path.join(ROOT, 'backend/internal/fetch/download.go'), 'utf8')
    expect(download).toContain('"mirror"')
  })

  it('渲染进程订阅了 mirror 事件（否则用户只看到进度条卡住）', () => {
    const store = fs.readFileSync(path.join(ROOT, 'src/stores/deps.ts'), 'utf8')
    expect(store).toContain("case 'mirror'")
  })
})

describe('依赖下载必须带上下载源', () => {
  it('渲染进程把设置里的 depMirror 传给主进程（漏了等于选择器无效）', () => {
    const store = fs.readFileSync(path.join(ROOT, 'src/stores/deps.ts'), 'utf8')
    expect(store).toMatch(/mirror:\s*depMirror/)
  })

  it('主进程把它变成 --mirror 参数（漏了等于主进程忽略设置）', () => {
    const runtime = fs.readFileSync(path.join(ROOT, 'electron/utils/runtime.ts'), 'utf8')
    expect(runtime).toContain("'--mirror'")
  })

  it('Go CLI 声明了 --mirror 并透传给 fetch.Options', () => {
    const main = fs.readFileSync(path.join(ROOT, 'backend/cmd/downvid-deps/main.go'), 'utf8')
    expect(main).toContain('"mirror"')
    expect(main).toContain('Mirror:')
  })
})

describe('错误后重试不再白等', () => {
  it('4xx / 校验失败不重试（同一地址再要一次还是同样的结果）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backend/internal/fetch/download.go'), 'utf8')
    const fn = /func retryable\(err error\) bool \{([\s\S]*?)\n\}/.exec(src)?.[1] || ''
    expect(fn).toContain('校验失败')
    expect(fn).toContain('http 4')
  })
})

/**
 * aria2 必须**三端都能一键下载**。
 *
 * 这条是补一个真实的判断错误：一开始只找到 Homebrew bottle（它链接到
 * `@@HOMEBREW_PREFIX@@/opt/openssl@4/...`，单独拷出来跑不了），于是得出
 * 「macOS 没有可用静态构建」的结论，UI 上给的是「复制 brew install 命令」。
 * 实际上社区有真正的自包含构建 —— 五个平台都有。
 *
 * 所以这里逐个平台断言「清单里有 URL 且归档格式正确」，而不是只测有没有 aria2 这一项：
 * 少一个平台时，该平台用户会看到一条永远装不上的依赖。
 */
describe('aria2 五平台覆盖', () => {
  const manifest = fs.readFileSync(path.join(ROOT, 'backend/internal/manifest/assets.gen.go'), 'utf8')
  const block = /var aria2Assets = map\[string\]aria2Asset\{([\s\S]*?)\n\}/.exec(manifest)?.[1] || ''

  const platforms = ['linux/x64', 'linux/arm64', 'win32/x64', 'darwin/arm64', 'darwin/x64']

  it('五个平台都在清单里（缺一个 = 该平台装不上）', () => {
    for (const platform of platforms) {
      expect(block, `${platform} 缺少 aria2 资产`).toContain(`"${platform}"`)
    }
  })

  it('每个平台都带 URL / SHA256 / 归档格式', () => {
    for (const platform of platforms) {
      const entry = new RegExp(`"${platform}": \\{[\\s\\S]*?URL: "(https://[^"]+)", SHA256: "([0-9a-f]{64})",\\s*Archive: "([a-z.]+)", Inner: "([^"]*)"`).exec(block)
      expect(entry, `${platform} 的条目格式不对`).not.toBeNull()
      expect(entry![1]).toMatch(/^https:\/\//)
      expect(entry![1]).toMatch(/\.(zip|tar\.gz|darwin)$/)
    }
  })

  it('归档格式与源匹配（用错格式只会报「解压失败」，看不出是判断错了）', () => {
    const expectArchive: Record<string, string> = {
      'linux/x64': 'zip',       // abcfy2
      'linux/arm64': 'zip',
      'win32/x64': 'zip',
      'darwin/arm64': 'tar.gz', // ricode-labs
      'darwin/x64': 'raw',      // static-build，裸 Mach-O
    }
    for (const [platform, archive] of Object.entries(expectArchive)) {
      const entry = new RegExp(`"${platform}": \\{[\\s\\S]*?Archive: "([a-z.]+)"`).exec(block)
      expect(entry?.[1], `${platform} 的归档格式`).toBe(archive)
    }
  })

  it('不要用 Homebrew bottle 当下载源', () => {
    // bottle 链接到 HOMEBREW_PREFIX 下的库，拷出来 dyld 直接失败
    expect(block).not.toContain('ghcr.io/v2/homebrew')
  })

  it('UI 不再出现「复制 brew 安装命令」这类平台特判', () => {
    // 五个平台都能下载后，这段逻辑是多余的；留着会让人以为 macOS 不行
    const panel = fs.readFileSync(path.join(ROOT, 'src/components/DepPanel.vue'), 'utf8')
    expect(panel).not.toContain('copySystemInstall')
    expect(panel).not.toContain('SYSTEM_PACKAGE_BY_OS')
  })
})
