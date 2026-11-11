#!/usr/bin/env node
/**
 * 生成 Release Notes 的下载引导区。
 *
 * 目标形状：
 * - 顶部三枚「大徽章」：GitHub / Gitee / CNB，各带平台 logo，分别直链
 *   macOS / Windows / Linux 的主推包（不跳 Release 页面，点击即下载）；
 * - 下方按「平台 + 架构」自动生成的下载徽章，列出其余格式与架构；
 *   不再生成下载对照表——表格在小屏上难读，而且和徽章重复；
 * - 平台/架构从产物文件名里解析，新增 arm64 等架构时不需要改脚本。
 *
 * 徽章链接只列出实际存在的产物，避免出现指向 404 的链接（历史上产物名变更时
 * 正是这样踩过坑）。
 *
 * 用法：
 *   node scripts/gen-release-notes.mjs <artifacts 目录> <版本号> [<changelog 文件>]
 *
 * 输出：完整的 Release 正文到 stdout。CI 直接写入 release body。
 */

import fs from 'node:fs'
import path from 'node:path'

const OWNER = 'Downvid'
const REPO = 'downvid'
const GITEE_REPO = 'Xynrin/downvid'
const CNB_REPO = 'yxxbc/downvid'

const [artifactsDir, version, changelogFile] = process.argv.slice(2)
if (!artifactsDir || !version) {
  console.error('用法: node scripts/gen-release-notes.mjs <artifacts 目录> <版本号> [<changelog 文件>]')
  process.exit(1)
}

const tag = `v${version}`

const ROOT = path.resolve(import.meta.dirname, '..')
const SHARED_APP = fs.readFileSync(path.join(ROOT, 'shared/app.ts'), 'utf8')
const QQ_GROUP_URL = SHARED_APP.match(/export const QQ_GROUP_URL = '([^']+)'/)?.[1] ?? ''
if (!QQ_GROUP_URL) throw new Error('shared/app.ts 缺少 QQ_GROUP_URL')

/** 递归列出所有文件 */
function listFiles(root) {
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name)
    return entry.isDirectory() ? listFiles(full) : [full]
  })
}

// 文件名排序后再扫描：同一类产物出现多个时，徽章选择是确定的
const all = listFiles(artifactsDir)
  .map((f) => path.basename(f))
  .sort()

/** 某个镜像上的资产直链（资产名相同，Release 由发布流程同步）。 */
function downloadUrl(mirror, filename) {
  const name = encodeURIComponent(filename)
  const base = {
    github: `https://github.com/${OWNER}/${REPO}/releases/download/${tag}`,
    gitee: `https://gitee.com/${GITEE_REPO}/releases/download/${tag}`,
    cnb: `https://cnb.cool/${CNB_REPO}/-/releases/download/${tag}`,
  }[mirror]
  return `${base}/${name}`
}

/**
 * 三个镜像的品牌样式。
 *
 * 三个「快速下载」入口把三个平台分到三个镜像上：macOS → GitHub，
 * Windows → Gitee，Linux → CNB。每个入口都直链资产，不跳 Release 页面。
 */
const MIRRORS = {
  github: { label: 'GitHub', logo: 'github', color: '238636' },
  gitee: { label: 'Gitee', logo: 'gitee', color: 'C71D23' },
  cnb: { label: 'CNB', logo: 'cloudnativebuild', color: 'C2410C' },
}

const PLATFORM_MIRROR = {
  mac: 'github',
  windows: 'gitee',
  linux: 'cnb',
}

/**
 * shields.io 的 for-the-badge 徽章，点击跳转。
 *
 * `logo` 既可以是 Simple Icons 的 slug，也可以是 data URI——Windows 的图标
 * 已经从 Simple Icons 移除，只能用内联 SVG 保住「每个平台都有图标」。
 */
function badge({ label, message, color, url, logo, labelColor = 'black', logoColor = 'white' }) {
  if (!url) return ''
  const params = new URLSearchParams({
    style: 'for-the-badge',
    label,
    message,
    labelColor,
    color,
  })
  if (logo) params.set('logo', logo)
  if (logoColor) params.set('logoColor', logoColor)
  const img = `https://img.shields.io/static/v1?${params.toString()}`
  return `[![${label} ${message}](${img})](${url})`
}

// ===== 产物名解析：DownVid-Wails-<platform>-<arch>-<version><suffix> =====

const WINDOWS_LOGO =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="white" d="M0 0h11v11H0zM13 0h11v11H13zM0 13h11v11H0zM13 13h11v11H13z"/></svg>',
  ).toString('base64')

const PLATFORM_META = {
  mac: { name: 'macOS', color: '1F1F1F', logo: 'apple' },
  windows: { name: 'Windows', color: '0078D6', logo: WINDOWS_LOGO },
  linux: { name: 'Linux', color: 'B45309', logo: 'linux' },
}

const PLATFORM_ORDER = ['mac', 'windows', 'linux']
const ARCH_ORDER = ['universal', 'x64', 'arm64', 'x86']

const PREFIX = 'DownVid-Wails-'
const VERSION_MARKER = `-${version}`

function normalizeArch(raw) {
  const arch = raw.toLowerCase()
  if (arch === 'aarch64') return 'arm64'
  return arch
}

function displayArch(arch) {
  if (arch === 'universal') return 'Universal'
  return arch
}

/** 从文件名后缀判断产物类型；不认识的产物直接跳过，不猜。 */
function classify(platform, suffix) {
  const s = suffix.toLowerCase()
  if (platform === 'mac') {
    if (s === '.dmg') return { id: 'dmg', label: 'DMG', rank: 1 }
    if (s === '.pkg') return { id: 'pkg', label: 'PKG', rank: 2 }
    if (s === '.zip') return { id: 'zip', label: 'ZIP', rank: 3 }
  }
  if (platform === 'windows') {
    if (s.endsWith('-installer.exe')) return { id: 'installer', label: 'Installer', rank: 1 }
    if (s === '.exe') return { id: 'exe', label: 'EXE', rank: 2 }
    if (s === '.zip') return { id: 'zip', label: 'Portable', rank: 3 }
  }
  if (platform === 'linux') {
    if (s === '.deb') return { id: 'deb', label: 'DEB', rank: 1 }
    if (s === '.rpm') return { id: 'rpm', label: 'RPM', rank: 2 }
    if (s === '.appimage') return { id: 'appimage', label: 'AppImage', rank: 3 }
    if (s === '.tar.gz') return { id: 'tarball', label: 'tar.gz', rank: 4 }
  }
  return null
}

const groups = new Map()

for (const file of all) {
  if (!file.startsWith(PREFIX)) continue
  const rest = file.slice(PREFIX.length)
  const marker = rest.indexOf(VERSION_MARKER)
  if (marker <= 0) continue

  const head = rest.slice(0, marker)
  const suffix = rest.slice(marker + VERSION_MARKER.length)
  const bits = head.split('-')
  const platform = bits.shift()
  const arch = normalizeArch(bits.join('-'))
  // hasOwn 而不是直接取值：产物名由 CI 生成，但别让 `constructor` 之类的
  // 原型属性混进来（`PLATFORM_META['constructor']` 是个函数，真值）
  if (!Object.hasOwn(PLATFORM_META, platform) || !arch) continue

  const kind = classify(platform, suffix)
  if (!kind) continue

  const key = `${platform}|${arch}`
  if (!groups.has(key)) groups.set(key, { platform, arch, items: new Map() })
  const group = groups.get(key)
  // 同一类型出现多个文件时只留排序后的第一个，避免同类徽章重复
  if (!group.items.has(kind.id)) group.items.set(kind.id, { file, label: kind.label, rank: kind.rank })
}

const platformRank = (platform) => {
  const index = PLATFORM_ORDER.indexOf(platform)
  return index === -1 ? 99 : index
}
const archRank = (arch) => {
  const index = ARCH_ORDER.indexOf(arch)
  return index === -1 ? 99 : index
}

const sortedGroups = [...groups.values()].sort(
  (a, b) =>
    platformRank(a.platform) - platformRank(b.platform) ||
    archRank(a.arch) - archRank(b.arch) ||
    a.arch.localeCompare(b.arch),
)

// ===== 顶部三个快速下载：每个平台的主推包，分别直链三个镜像 =====
const quickItems = new Set()
const quickBadges = []

for (const platform of PLATFORM_ORDER) {
  const firstGroup = sortedGroups.find((group) => group.platform === platform)
  if (!firstGroup) continue
  const primary = [...firstGroup.items.values()].sort((a, b) => a.rank - b.rank)[0]
  if (!primary) continue
  const meta = PLATFORM_META[platform]
  const mirror = MIRRORS[PLATFORM_MIRROR[platform]]
  quickItems.add(primary.file)
  quickBadges.push(
    badge({
      label: mirror.label,
      message: `${meta.name} ${displayArch(firstGroup.arch)} · ${primary.label}`,
      color: mirror.color,
      url: downloadUrl(PLATFORM_MIRROR[platform], primary.file),
      logo: mirror.logo,
    }),
  )
}

// ===== 其余架构与格式：同一平台沿用同一个镜像，全部直链 =====
const moreBadges = sortedGroups
  .flatMap((group) => {
    const meta = PLATFORM_META[group.platform]
    const mirror = MIRRORS[PLATFORM_MIRROR[group.platform]]
    const label = `${meta.name} ${displayArch(group.arch)} · ${mirror.label}`
    return [...group.items.values()]
      .filter((item) => !quickItems.has(item.file))
      .sort((a, b) => a.rank - b.rank)
      .map((item) =>
        badge({
          label,
          message: item.label,
          color: meta.color,
          url: downloadUrl(PLATFORM_MIRROR[group.platform], item.file),
          logo: meta.logo,
        }),
      )
  })
  .join('\n')

// ===== 交流群 =====
const qqBadge = badge({
  label: 'QQ',
  message: 'DownVid 交流群',
  color: '1EBAFC',
  url: QQ_GROUP_URL,
  logo: 'qq',
})

// ===== 平台说明（保留双语对照，但不再放下载矩阵） =====

const notesTable = `| 🇨🇳 中文说明 | 🇺🇸 English Notes |
|:---|:---|
| **macOS**：推荐下载 \`.dmg\` 安装。应用未购买商业证书签名，首次打开若提示未受信任，请在「系统设置 → 隐私与安全性」中点击「仍要打开」。 | **macOS**: Recommended \`.dmg\`. Build is unsigned; if prompted about an untrusted developer, allow it in System Settings → Privacy & Security. |
| **Windows**：推荐下载 \`-installer.exe\`，安装后自动创建快捷方式并支持应用内静默更新；亦可下载 \`.zip\` 免安装版。 | **Windows**: Recommended \`-installer.exe\` NSIS installer with shortcuts and silent in-app update; portable \`.zip\` is also available. |
| **Linux**：Debian / Ubuntu 推荐安装 \`.deb\`；其他发行版可下载 \`.tar.gz\` 便携包，解压后执行 \`chmod +x downvid && ./downvid\`。 | **Linux**: \`.deb\` recommended for Debian/Ubuntu; other distros can extract \`.tar.gz\` and run \`chmod +x downvid && ./downvid\`. |
| **运行依赖**：yt-dlp 与 ffmpeg **不随安装包分发**。软件会自动检测系统已有环境，若缺失可在「设置 → 运行依赖」中一键下载。 | **Dependencies**: yt-dlp & ffmpeg are not bundled. Existing system installations are reused; missing tools can be downloaded in Settings → Dependencies. |
| **自动更新**：软件内置更新机制，可在「关于」页面检查更新并自动应用，无需手动重装。 | **Auto Update**: Built-in updater allows seamless updates without manual re-installation. |`

// ===== CHANGELOG 正文 =====
function extractChangelog() {
  if (!changelogFile || !fs.existsSync(changelogFile)) return ''
  const text = fs.readFileSync(changelogFile, 'utf8')
  const lines = text.split('\n')
  const out = []
  let found = false
  for (const line of lines) {
    if (new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`).test(line)) {
      found = true
      continue
    }
    if (found && /^## \[/.test(line)) break
    if (found) out.push(line)
  }
  // 版本段没写时退回 Unreleased
  if (!out.some((l) => l.trim())) {
    found = false
    for (const line of lines) {
      if (/^## \[Unreleased\]/.test(line)) {
        found = true
        continue
      }
      if (found && /^## \[/.test(line)) break
      if (found) out.push(line)
    }
  }
  return out.join('\n').trim()
}

const changelogBody = extractChangelog()

const body = `<!-- 此正文由 scripts/gen-release-notes.mjs 生成，请勿手动编辑 -->
<div align="center">

### ⬇️ 直接下载 / Direct Downloads

${quickBadges.join('\n') || '_产物生成中或未检测到可用安装包 / Generating artifacts or no packages found_'}

<sub>v${version} · macOS → GitHub · Windows → Gitee · Linux → CNB · 点击即下载<br>v${version} · macOS → GitHub · Windows → Gitee · Linux → CNB · click to download</sub>

${moreBadges ? `\n<br>\n\n### 📦 其他架构与格式 / More Builds & Formats\n\n${moreBadges}\n` : ''}
</div>

---

### ⚠️ 各平台说明 / Platform Notes

${notesTable}

---

### 💬 交流群 / Community

${qqBadge}

<sub><a href="${QQ_GROUP_URL}">点击链接加入群聊【Downvid交流群】</a> / <a href="${QQ_GROUP_URL}">Click to join the DownVid QQ group</a></sub>

---

## 📝 更新内容 / Changelog

${changelogBody || `DownVid v${version} 发布。详见 [CHANGELOG.md](https://github.com/${OWNER}/${REPO}/blob/main/CHANGELOG.md)。`}

---

<sub>完整历史见 [CHANGELOG.md](https://github.com/${OWNER}/${REPO}/blob/main/CHANGELOG.md) · 遇到问题请先看 [故障排除 / Troubleshooting](https://github.com/${OWNER}/${REPO}/blob/main/docs/troubleshooting.md)</sub>
`

process.stdout.write(body)
