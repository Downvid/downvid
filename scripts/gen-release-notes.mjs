#!/usr/bin/env node
/**
 * 生成 Release Notes 的下载引导区。
 *
 * 背景：Release 正文里的 CHANGELOG 内容较长，很多用户拉到页面后不知道
 * 该点哪里下载。这里在正文顶部生成一排可点击的下载徽章与一张对照表，
 * 明确「哪个平台、哪种架构、装哪个文件」。
 *
 * 徽章链接与表格只列出**实际存在的产物**——按 artifacts 目录扫描，
 * 避免出现指向 404 的链接（历史上产物名变更时正是这样踩过坑）。
 *
 * 用法：
 *   node scripts/gen-release-notes.mjs <artifacts 目录> <版本号> [<changelog 文件>]
 *
 * 输出：完整的 Release 正文到 stdout。CI 直接写入 release body。
 */

import fs from 'node:fs'
import path from 'node:path'

const OWNER = 'yxxbc'
const REPO = 'downvid'

const [artifactsDir, version, changelogFile] = process.argv.slice(2)
if (!artifactsDir || !version) {
  console.error('用法: node scripts/gen-release-notes.mjs <artifacts 目录> <版本号> [<changelog 文件>]')
  process.exit(1)
}

/** 递归列出所有文件 */
function listFiles(root) {
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(root, entry.name)
    return entry.isDirectory() ? listFiles(full) : [full]
  })
}

const all = listFiles(artifactsDir).map(f => path.basename(f))

/** 产物在仓库里的下载地址 */
function downloadUrl(filename) {
  return `https://github.com/${OWNER}/${REPO}/releases/download/v${version}/${encodeURIComponent(filename)}`
}

function find(pattern) {
  const file = all.find(f => pattern.test(f))
  return file ? { file, url: downloadUrl(file) } : null
}

/** shields.io 徽章，点击即下载 */
function badge(label, message, color, url, logo) {
  if (!url) return `<!-- ${label} 产物缺失，已跳过 -->`
  const params = new URLSearchParams({ style: 'for-the-badge', label, labelColor: 'black', color })
  if (logo) params.set('logo', logo)
  const img = `https://img.shields.io/static/v1?${params.toString()}&message=${encodeURIComponent(message)}`
  return `[![${label}](${img})](${url})`
}

// ===== 按平台收集实际产物 =====
const winSetup = find(new RegExp(`^DownVid-Setup-${version.replace(/\./g, '\\.')}\\.exe$`))
const winPortable = find(new RegExp(`^DownVid-Portable-${version.replace(/\./g, '\\.')}\\.exe$`))
const macArmDmg = find(new RegExp(`^DownVid-arm64-Mac-${version.replace(/\./g, '\\.')}\\.dmg$`))
const macX64Dmg = find(new RegExp(`^DownVid-x64-Mac-${version.replace(/\./g, '\\.')}\\.dmg$`))
const linuxAppImage = find(new RegExp(`^DownVid-x86_64-Linux-${version.replace(/\./g, '\\.')}\\.AppImage$`))
const linuxArmAppImage = find(new RegExp(`^DownVid-arm64-Linux-${version.replace(/\./g, '\\.')}\\.AppImage$`))
const linuxDeb = find(new RegExp(`^DownVid-amd64-Linux-${version.replace(/\./g, '\\.')}\\.deb$`))
const linuxRpm = find(new RegExp(`^DownVid-x86_64-Linux-${version.replace(/\./g, '\\.')}\\.rpm$`))

// 首选下载：每个平台一个，避免选择困难
const primaryBadges = [
  badge('Windows', '下载 x64 安装版', '0078D6', winSetup?.url, 'windows'),
  badge('macOS', '下载 Apple 芯片版', '000000', macArmDmg?.url, 'apple'),
  badge('macOS', '下载 Intel 版', '000000', macX64Dmg?.url, 'apple'),
  badge('Linux', '下载 x64 AppImage', 'FFB300', linuxAppImage?.url, 'linux'),
  badge('Linux', '下载 arm64 AppImage', 'FFB300', linuxArmAppImage?.url, 'linux'),
].filter(line => !line.startsWith('<!--'))

// ===== 详细对照表 =====
const rows = []
const push = (platform, arch, label, entry) => {
  if (entry) rows.push(`| ${platform} | ${arch} | [${label}](${entry.url}) |`)
}
push('Windows', 'x64', '安装版 `.exe`（推荐）', winSetup)
push('Windows', 'x64', '便携版 `.exe`', winPortable)
push('macOS', 'Apple 芯片（M 系列）', '`.dmg`（推荐）', macArmDmg)
push('macOS', 'Intel', '`.dmg`（推荐）', macX64Dmg)
push('Linux', 'x64', '`.AppImage`（推荐）', linuxAppImage)
push('Linux', 'x64', '`.deb`', linuxDeb)
push('Linux', 'x64', '`.rpm`', linuxRpm)
push('Linux', 'arm64', '`.AppImage`', linuxArmAppImage)

// ===== CHANGELOG 正文 =====
function extractChangelog() {
  if (!changelogFile || !fs.existsSync(changelogFile)) return ''
  const text = fs.readFileSync(changelogFile, 'utf8')
  const lines = text.split('\n')
  const out = []
  let found = false
  for (const line of lines) {
    if (new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`).test(line)) { found = true; continue }
    if (found && /^## \[/.test(line)) break
    if (found) out.push(line)
  }
  // 版本段没写时退回 Unreleased
  if (!out.some(l => l.trim())) {
    found = false
    for (const line of lines) {
      if (/^## \[Unreleased\]/.test(line)) { found = true; continue }
      if (found && /^## \[/.test(line)) break
      if (found) out.push(line)
    }
  }
  return out.join('\n').trim()
}

const changelogBody = extractChangelog()

const platformNote = [
  '- **Windows**：安装版会创建开始菜单与桌面快捷方式；便携版解压即用，但**不支持自动更新**',
  '- **macOS**：应用未做代码签名，首次打开需在「系统设置 → 隐私与安全性」中允许；Apple 芯片请勿选 Intel 版',
  '- **Linux**：`.AppImage` 需先 `chmod +x`；`.deb` / `.rpm` 可通过包管理器安装',
].join('\n')

const body = `<!-- 此正文由 scripts/gen-release-notes.mjs 生成，请勿手动编辑 -->
<div align="center">

### ⬇️ 点击徽章直接下载

${primaryBadges.join('\n')}

<sub>不知道选哪个？见下方对照表 · 首次使用请留意各平台注意事项</sub>

</div>

---

## 📦 下载对照表

| 平台 | 架构 | 安装包 |
|------|------|--------|
${rows.join('\n')}

> 运行依赖 **yt-dlp / ffmpeg 不随安装包分发**：启动后会自动识别机器上已安装的版本并复用，
> 识别不到时在「设置 → 运行依赖」里一键下载即可，无需提前手动安装。

### ⚠️ 各平台注意事项

${platformNote}

---

## 📝 更新内容

> 在应用内的更新弹窗里，只会显示这一节的内容；上面的下载引导区只在发布页有用。

${changelogBody || `DownVid v${version} 发布。详见 [CHANGELOG.md](https://github.com/${OWNER}/${REPO}/blob/main/CHANGELOG.md)。`}

---

<sub>完整历史见 [CHANGELOG.md](https://github.com/${OWNER}/${REPO}/blob/main/CHANGELOG.md) · 遇到问题请先看 [故障排除](https://github.com/${OWNER}/${REPO}/blob/main/docs/troubleshooting.md)</sub>
`

process.stdout.write(body)
