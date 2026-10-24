// 根据实际发布的安装包重新生成 electron-updater 更新清单（latest*.yml）。
//
// 各平台/架构在不同 CI job 中构建，各自生成的 latest*.yml 在汇总时会互相覆盖，
// 曾导致清单与实际上传文件不一致（如 Windows 便携版覆盖安装包后 sha512 校验失败）。
// 这里对最终要上传的文件逐个计算 sha512/size，保证清单与文件一致；旧版本客户端
// 读取的也是这些清单，因此同样能正常升级。
//
// 用法: node scripts/gen-update-manifests.mjs <artifacts 目录> <版本号>

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const [dir, version] = process.argv.slice(2)
if (!dir || !version) {
  console.error('用法: node scripts/gen-update-manifests.mjs <artifacts 目录> <版本号>')
  process.exit(1)
}

function listFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(e => {
    const full = path.join(root, e.name)
    return e.isDirectory() ? listFiles(full) : [full]
  })
}

const all = listFiles(dir)
const releaseDate = new Date().toISOString()

function entry(pattern) {
  const matches = all.filter(f => pattern.test(path.basename(f)))
  if (matches.length === 0) return null
  // 多个 job 可能产出同名文件，取第一个即可（内容相同）
  const file = matches[0]
  const data = fs.readFileSync(file)
  return {
    url: path.basename(file),
    sha512: crypto.createHash('sha512').update(data).digest('base64'),
    size: data.length,
  }
}

function writeManifest(name, patterns) {
  const files = patterns.map(entry).filter(Boolean)
  if (files.length === 0) {
    console.warn(`跳过 ${name}：未找到对应安装包`)
    return
  }
  const lines = [`version: ${version}`, 'files:']
  for (const f of files) {
    lines.push(`  - url: ${f.url}`, `    sha512: ${f.sha512}`, `    size: ${f.size}`)
  }
  // 顶层 path/sha512 供旧版 electron-updater 兼容读取，指向首选安装包
  lines.push(`path: ${files[0].url}`, `sha512: ${files[0].sha512}`, `releaseDate: '${releaseDate}'`, '')
  // 删除 job 产出的旧清单，统一写到 artifacts 根目录
  for (const old of all.filter(f => path.basename(f) === name)) fs.rmSync(old)
  fs.writeFileSync(path.join(dir, name), lines.join('\n'))
  console.log(`生成 ${name}: ${files.map(f => f.url).join(', ')}`)
}

const v = version.replace(/\./g, '\\.')

// ===== 迁移开关：哪些平台的自动更新指向新架构（Wails）=====
//
// `latest*.yml` 是**存量用户**的更新通道 —— 老客户端靠它决定下哪个包。
// 把它指向 Wails 产物，等于让老用户下次点「更新」时被换成新架构。
//
// 这是**单向门**：装上新架构后再也回不到 Electron（新架构没有
// electron-updater）。所以：
//
//   1. 默认**一个都不切** —— 保持现状，老用户继续拿 Electron 版
//   2. 按平台逐个切，用环境变量 MIGRATE_TO_WAILS=macos,linux 控制
//   3. 切之前必须先确认该平台的 Wails 版**能自更新**
//      （见 internal/update/install_*.go），否则出事无法推修复
//
// 为什么 macOS 先切：它的安装由我们自己的代码完成（解压 zip 替换 .app），
// 完全不依赖 electron-updater 的 NSIS 逻辑，`ditto` + `codesign` 那条路
// 已经被 Electron 版验证了很多个版本。
//
// Windows 要等 NSIS 脚本支持 `--updated` / `--force-run` 才能切。
const MIGRATE = new Set(
  (process.env.MIGRATE_TO_WAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
)

/** 平台是否已切到新架构 */
const migrating = (platform) => MIGRATE.has(platform)

if (MIGRATE.size > 0) {
  console.log(`⚠ 迁移模式：以下平台的自动更新将指向 Wails 产物 → ${[...MIGRATE].join(', ')}`)
}

writeManifest('latest.yml', [
  migrating('windows')
    ? new RegExp(`^DownVid-Wails-windows-x64-${v}\\.zip$`)
    : new RegExp(`^DownVid-Setup-${v}\\.exe$`),
])

writeManifest('latest-mac.yml', migrating('macos')
  ? [
      // 新架构：只列 zip（安装逻辑要解压后替换 .app，dmg 用不上）
      // 列出 arm64/x64/universal，使存量 Electron 客户端（按 isArm 严格匹配）与新客户端均能识别
      new RegExp(`^DownVid-Wails-mac-arm64-${v}\\.zip$`),
      new RegExp(`^DownVid-Wails-mac-x64-${v}\\.zip$`),
      new RegExp(`^DownVid-Wails-mac-universal-${v}\\.zip$`),
    ]
  : [
      new RegExp(`^DownVid-arm64-Mac-${v}\\.zip$`),
      new RegExp(`^DownVid-x64-Mac-${v}\\.zip$`),
      new RegExp(`^DownVid-arm64-Mac-${v}\\.dmg$`),
      new RegExp(`^DownVid-x64-Mac-${v}\\.dmg$`),
    ])

writeManifest('latest-linux.yml', migrating('linux')
  ? [new RegExp(`^DownVid-Wails-linux-x64-${v}\\.tar\\.gz$`)]
  : [
      new RegExp(`^DownVid-x86_64-Linux-${v}\\.AppImage$`),
      new RegExp(`^DownVid-amd64-Linux-${v}\\.deb$`),
      new RegExp(`^DownVid-x86_64-Linux-${v}\\.rpm$`),
    ])

writeManifest('latest-linux-arm64.yml', [new RegExp(`^DownVid-arm64-Linux-${v}\\.AppImage$`)])
