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
const vEsc = version.replace(/\./g, '\\.')

// Wails（全新架构 · 推荐）产物
const wailsMacUniversal = find(new RegExp(`^DownVid-Wails-mac-universal-${vEsc}\\.zip$`))
const wailsMacArm = find(new RegExp(`^DownVid-Wails-mac-arm64-${vEsc}\\.zip$`))
const wailsMacX64 = find(new RegExp(`^DownVid-Wails-mac-x64-${vEsc}\\.zip$`))
const wailsWin = find(new RegExp(`^DownVid-Wails-windows-x64-${vEsc}\\.zip$`))
const wailsLinux = find(new RegExp(`^DownVid-Wails-linux-x64-${vEsc}\\.tar\\.gz$`))
const wailsMac = wailsMacUniversal || wailsMacArm || wailsMacX64

// 经典版本（Electron）产物
const winSetup = find(new RegExp(`^DownVid-Setup-${vEsc}\\.exe$`))
const winPortable = find(new RegExp(`^DownVid-Portable-${vEsc}\\.exe$`))
const macArmDmg = find(new RegExp(`^DownVid-arm64-Mac-${vEsc}\\.dmg$`))
const macX64Dmg = find(new RegExp(`^DownVid-x64-Mac-${vEsc}\\.dmg$`))
const linuxAppImage = find(new RegExp(`^DownVid-x86_64-Linux-${vEsc}\\.AppImage$`))
const linuxArmAppImage = find(new RegExp(`^DownVid-arm64-Linux-${vEsc}\\.AppImage$`))
const linuxDeb = find(new RegExp(`^DownVid-amd64-Linux-${vEsc}\\.deb$`))
const linuxRpm = find(new RegExp(`^DownVid-x86_64-Linux-${vEsc}\\.rpm$`))

// 首选下载：优先突出 Wails 新架构（推荐体验），同时保留传统版本入口
const primaryBadges = [
  wailsMac ? badge('macOS', '新架构通用版（推荐）', '000000', wailsMac.url, 'apple') : null,
  wailsWin ? badge('Windows', '新架构绿色版（预览推荐）', '0078D6', wailsWin.url, 'windows') : null,
  wailsLinux ? badge('Linux', '新架构便携包（预览推荐）', 'FFB300', wailsLinux.url, 'linux') : null,
  badge('Windows', '下载 x64 安装版（传统）', '0078D6', winSetup?.url, 'windows'),
  !wailsMac ? badge('macOS', '下载 Apple 芯片版', '000000', macArmDmg?.url, 'apple') : null,
  !wailsMac ? badge('macOS', '下载 Intel 版', '000000', macX64Dmg?.url, 'apple') : null,
  badge('Linux', '下载 x64 AppImage', 'FFB300', linuxAppImage?.url, 'linux'),
  badge('Linux', '下载 arm64 AppImage', 'FFB300', linuxArmAppImage?.url, 'linux'),
].filter(Boolean).filter(line => !line.startsWith('<!--'))

// ===== 详细对照表 =====
const rows = []
const push = (platform, arch, label, entry, note = '') => {
  if (entry) {
    const desc = note ? ` (${note})` : ''
    rows.push(`| ${platform} | ${arch} | [${label}](${entry.url})${desc} |`)
  }
}

// 1. 全新架构（Go + Wails · 推荐体验）
push('macOS', '通用架构（Apple 芯片 / Intel）', 'DownVid-Wails-mac-universal.zip', wailsMacUniversal, '全新架构 · 强烈推荐 · 解压即用')
push('macOS', 'Apple 芯片（M 系列）', 'DownVid-Wails-mac-arm64.zip', wailsMacArm, '全新架构 · 专为 M 芯片')
push('macOS', 'Intel', 'DownVid-Wails-mac-x64.zip', wailsMacX64, '全新架构 · 专为 Intel')
push('Windows', 'x64', 'DownVid-Wails-windows-x64.zip', wailsWin, '新架构绿色便携版 · 解压即用')
push('Linux', 'x64', 'DownVid-Wails-linux-x64.tar.gz', wailsLinux, '新架构绿色便携包 · 解压即用')

// 2. 经典版本（Electron）
push('Windows', 'x64', '安装版 `.exe`（经典版）', winSetup)
push('Windows', 'x64', '便携版 `.exe`（经典版）', winPortable)
push('macOS', 'Apple 芯片（M 系列）', '`.dmg`（经典版）', macArmDmg)
push('macOS', 'Intel', '`.dmg`（经典版）', macX64Dmg)
push('Linux', 'x64', '`.AppImage`（经典版）', linuxAppImage)
push('Linux', 'x64', '`.deb`（经典版）', linuxDeb)
push('Linux', 'x64', '`.rpm`（经典版）', linuxRpm)
push('Linux', 'arm64', '`.AppImage`（经典版）', linuxArmAppImage)

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
  '- **🚀 全新架构（Go + Wails）**：体积缩减 70%（仅约 18MB），极速启动，内存减半。',
  '  - **macOS**：推荐直接使用全新架构通用版，解压后拖入「应用程序」即可；存量老版本已默认开启无缝自更新过渡。',
  '  - **Windows 迁移引导**：提供绿色免安装版 `.zip`，解压后直接双击 `downvid.exe` 运行即可抢先体验；NSIS 安装器正在开发中，经典安装包仍保留提供。',
  '  - **Linux 迁移引导**：提供便携包 `.tar.gz`，解压后赋予执行权限即可直接运行；AppImage 独立包正在适配中。',
  '- **📦 经典版本（Electron）**：保留传统 Windows 安装版与 Linux deb/rpm/AppImage，存量自动更新通道正常服务。',
  '- **macOS 权限提示**：应用未做付费商业证书签名，首次打开如提示未受信任，请在「系统设置 → 隐私与安全性」中点击「仍要打开」。',
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

### 🐳 Docker / NAS 用户

容器镜像发布在 GHCR（amd64 + arm64 多架构），不需要下载上面的安装包：

\`\`\`bash
docker pull ghcr.io/${OWNER}/${REPO}:latest
# 或升级已有的容器
docker compose pull downvid && docker compose up -d downvid
\`\`\`

容器版**不能自更新**（进程跑在只读镜像层上），升级方式就是上面这两条命令；
界面里检测到新版本时也会给出它们。详见 [docs/docker.md](https://github.com/${OWNER}/${REPO}/blob/main/docs/docker.md)。

### ⚠️ 各平台注意事项

${platformNote}

---

## 📝 更新内容

${changelogBody || `DownVid v${version} 发布。详见 [CHANGELOG.md](https://github.com/${OWNER}/${REPO}/blob/main/CHANGELOG.md)。`}

---

<sub>完整历史见 [CHANGELOG.md](https://github.com/${OWNER}/${REPO}/blob/main/CHANGELOG.md) · 遇到问题请先看 [故障排除](https://github.com/${OWNER}/${REPO}/blob/main/docs/troubleshooting.md)</sub>
`

process.stdout.write(body)
