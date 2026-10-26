#!/usr/bin/env node
/**
 * 生成 Release Notes 的下载引导区与双语对照表。
 *
 * 背景：Release 正文里的 CHANGELOG 内容较长，很多用户拉到页面后不知道
 * 该点哪里下载。这里在正文顶部生成一排可点击的下载徽章与双语对照表，
 * 明确「哪个平台、装哪个文件」。
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

const OWNER = 'Downvid'
const REPO = 'downvid'

const [artifactsDir, version, changelogFile] = process.argv.slice(2)
if (!artifactsDir || !version) {
  console.error('用法: node scripts/gen-release-notes.mjs <artifacts 目录> <版本号> [<changelog 文件>]')
  process.exit(1)
}

/** 递归列出所有文件 */
function listFiles(root) {
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name)
    return entry.isDirectory() ? listFiles(full) : [full]
  })
}

const all = listFiles(artifactsDir).map((f) => path.basename(f))

/** 产物在仓库里的下载地址 */
function downloadUrl(filename) {
  return `https://github.com/${OWNER}/${REPO}/releases/download/v${version}/${encodeURIComponent(filename)}`
}

function find(pattern) {
  const file = all.find((f) => pattern.test(f))
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

// ===== 按平台收集实际产物（包含安装器与便携包/更新包） =====
const vEsc = version.replace(/\./g, '\\.')

// macOS
const macDmg = find(new RegExp(`^DownVid-Wails-mac-universal-${vEsc}\\.dmg$`))
const macZip = find(new RegExp(`^DownVid-Wails-mac-universal-${vEsc}\\.zip$`))

// Windows
const winExe = find(new RegExp(`^DownVid-Wails-windows-x64-${vEsc}-installer\\.exe$`))
const winZip = find(new RegExp(`^DownVid-Wails-windows-x64-${vEsc}\\.zip$`))

// Linux
const linuxDeb = find(new RegExp(`^DownVid-Wails-linux-x64-${vEsc}\\.deb$`))
const linuxTar = find(new RegExp(`^DownVid-Wails-linux-x64-${vEsc}\\.tar\\.gz$`))

const primaryMac = macDmg || macZip
const primaryWin = winExe || winZip
const primaryLinux = linuxDeb || linuxTar

const primaryBadges = [
  primaryMac ? badge('macOS', macDmg ? '下载 DMG 安装器' : '下载通用版 (Zip)', '000000', primaryMac.url, 'apple') : null,
  primaryWin ? badge('Windows', winExe ? '下载 EXE 安装向导' : '下载 x64 绿色版', '0078D6', primaryWin.url, 'windows') : null,
  primaryLinux ? badge('Linux', linuxDeb ? '下载 DEB 安装包' : '下载 x64 便携包', 'FFB300', primaryLinux.url, 'linux') : null,
].filter(Boolean)

// ===== 双语下载对照表 =====
const rows = []
const pushRow = (platform, arch, type, entry, descZh, descEn) => {
  if (entry) {
    rows.push(`| ${platform} | ${arch} | ${type} | [${entry.file}](${entry.url}) | ${descZh} / ${descEn} |`)
  }
}

// macOS rows
pushRow('macOS', 'Universal (Apple / Intel)', '安装器 / Installer', macDmg, '推荐，挂载后拖入「应用程序」', 'Recommended DMG installer')
pushRow('macOS', 'Universal (Apple / Intel)', '更新便携 / Update', macZip, '解压即用，应用内自更新使用', 'Portable & auto-update zip')

// Windows rows
pushRow('Windows', 'x64', '安装器 / Installer', winExe, '推荐安装向导，创建快捷方式与静默更新', 'Recommended NSIS installer')
pushRow('Windows', 'x64', '便携版 / Portable', winZip, '绿色免安装版，解压即用', 'Portable standalone zip')

// Linux rows
pushRow('Linux', 'x64', '安装包 / Deb Package', linuxDeb, 'Debian / Ubuntu 推荐安装包', 'Recommended deb package')
pushRow('Linux', 'x64', '便携包 / Portable', linuxTar, '解压后赋予执行权限即可运行', 'Portable tar.gz archive')

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

const notesTable = `| 🇨🇳 中文说明 | 🇺🇸 English Notes |
|:---|:---|
| **macOS**：推荐下载 \`.dmg\` 安装。应用未购买商业证书签名，首次打开若提示未受信任，请在「系统设置 → 隐私与安全性」中点击「仍要打开」。 | **macOS**: Recommended \`.dmg\`. Build is unsigned; if prompted about an untrusted developer, allow it in System Settings → Privacy & Security. |
| **Windows**：推荐下载 \`-installer.exe\`，安装后自动创建快捷方式并支持应用内静默更新；亦可下载 \`.zip\` 免安装版。 | **Windows**: Recommended \`-installer.exe\` NSIS installer with shortcuts and silent in-app update; portable \`.zip\` is also available. |
| **Linux**：Debian / Ubuntu 推荐安装 \`.deb\`；其他发行版可下载 \`.tar.gz\` 便携包，解压后执行 \`chmod +x downvid && ./downvid\`。 | **Linux**: \`.deb\` recommended for Debian/Ubuntu; other distros can extract \`.tar.gz\` and run \`chmod +x downvid && ./downvid\`. |
| **运行依赖**：yt-dlp 与 ffmpeg **不随安装包分发**。软件会自动检测系统已有环境，若缺失可在「设置 → 运行依赖」中一键下载。 | **Dependencies**: yt-dlp & ffmpeg are not bundled. Existing system installations are reused; missing tools can be downloaded in Settings → Dependencies. |
| **自动更新**：软件内置更新机制，可在「关于」页面检查更新并自动应用，无需手动重装。 | **Auto Update**: Built-in updater allows seamless updates without manual re-installation. |`

const downloadTable = rows.length > 0
  ? `| 平台 / Platform | 架构 / Arch | 类型 / Type | 安装包 / Package | 说明 / Description |
|:---|:---|:---|:---|:---|
${rows.join('\n')}`
  : `_产物生成中或未检测到可用安装包 / Generating artifacts or no packages found_`

const body = `<!-- 此正文由 scripts/gen-release-notes.mjs 生成，请勿手动编辑 -->
<div align="center">

### ⬇️ 点击直接下载 / Direct Downloads

${primaryBadges.join('\n')}

<sub>选择对应系统的主推版本直接下载 · 更多格式参见下方对照表</sub><br>
<sub>Select your platform to download · See table below for portable & update packages</sub>

</div>

---

## 📦 下载对照表 / Download Matrix

${downloadTable}

> 运行依赖 **yt-dlp / ffmpeg 不随安装包分发**：启动后会自动识别机器上已安装的版本并复用，识别不到时在「设置 → 运行依赖」里一键下载即可。<br>
> **Dependencies are not bundled**: Installed tools on your machine will be detected automatically; one-click download is available in Settings → Dependencies.

---

### ⚠️ 各平台说明 / Platform Notes

${notesTable}

---

## 📝 更新内容 / Changelog

${changelogBody || `DownVid v${version} 发布。详见 [CHANGELOG.md](https://github.com/${OWNER}/${REPO}/blob/main/CHANGELOG.md)。`}

---

<sub>完整历史见 [CHANGELOG.md](https://github.com/${OWNER}/${REPO}/blob/main/CHANGELOG.md) · 遇到问题请先看 [故障排除 / Troubleshooting](https://github.com/${OWNER}/${REPO}/blob/main/docs/troubleshooting.md)</sub>
`

process.stdout.write(body)
