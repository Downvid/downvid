#!/usr/bin/env node
/**
 * 生成 backend/internal/manifest/assets.gen.go
 *
 * 从上游发布页抓取版本号与 SHA-256，写进 Go 侧车：
 *   - yt-dlp : yt-dlp-nightly-builds（nightly，站点修复更及时），官方提供 SHA2-256SUMS
 *   - ffmpeg : eugeneware/ffmpeg-static（静态构建，含 libmp3lame / aac / libx264），无校验值需自算
 *
 * 固定到某个 tag 而不是 "latest"：安装结果必须可复现、可校验，
 * 用户每次点"下载"都应拿到同一份字节串。
 *
 * 网络统一走 curl 而不是 Node 的 fetch：Node 的 fetch 不读取 HTTP(S)_PROXY
 * 环境变量，在国内网络下几乎必失败，而 curl 原生支持。
 *
 * 用法：
 *   node scripts/gen-deps-manifest.mjs                 # 使用上游最新版本并重算全部哈希
 *   node scripts/gen-deps-manifest.mjs --ytdlp <tag>   # 固定 yt-dlp tag
 *   node scripts/gen-deps-manifest.mjs --ffmpeg <tag>  # 固定 ffmpeg tag
 *   node scripts/gen-deps-manifest.mjs --check         # 轻量校验（CI 用，不重新下载大文件）
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { devNull, tmpdir } from 'node:os'
import path from 'node:path'

const YTDLP_REPO = 'yt-dlp/yt-dlp-nightly-builds'
const FFMPEG_REPO = 'eugeneware/ffmpeg-static'
// aria2 的静态构建。官方 release 只有 Windows 与 Android 包，其余靠社区构建。
//
// **五个平台用三个源**，因为没有任何单一仓库同时提供「自包含 + 架构齐全」的产物。
// 每个平台的选择都是实测过的（`file` / `otool -L` + 真跑一次下载）：
//
// | 平台 | 源 | 归档 | 为什么是它 |
// | --- | --- | --- | --- |
// | linux/x64, linux/arm64 | abcfy2/aria2-static-build | zip | musl 静态，不依赖发行版库 |
// | win32/x64 | abcfy2/aria2-static-build | zip | mingw 静态，自带依赖 |
// | darwin/arm64 | ricode-labs/aria2 | tar.gz | **只有系统库**，实测 `--version` 与真实下载都正常 |
// | darwin/x64 | static-build/aria2 | 裸 Mach-O | 只有系统库；上游仅提供 x86_64 的 darwin 包 |
//
// 反面例子（别用）：
//   - Homebrew bottle：二进制链接到 `@@HOMEBREW_PREFIX@@/opt/openssl@4/...`，
//     单独拷出来跑不了（exec format error / dyld 找不到库），是最容易误选的「看似官方」来源
//   - qydysky/aria2：只发 ubuntu/windows，没有 macOS
//   - Elypha/aria2-mod：只有 linux-amd64 与 windows
const ARIA2_SOURCES = {
  'abcfy2': 'abcfy2/aria2-static-build',
  'ricode': 'ricode-labs/aria2',
  'staticbuild': 'static-build/aria2',
}

/** 兼容旧代码路径（默认 tag 跟随 abcfy2） */
const ARIA2_REPO = ARIA2_SOURCES.abcfy2
const OUT_FILE = path.resolve('backend/internal/manifest/assets.gen.go')

/**
 * yt-dlp 各平台使用的产物名。
 *
 * ## 为什么改成 Python zipapp（`yt-dlp`）而不是 PyInstaller 独立包
 *
 * 实测（同一台机器、同一个 bilibili 视频）：
 *
 * | 形态 | `--version` | 真实解析 |
 * | --- | --- | --- |
 * | `yt-dlp_macos`（PyInstaller） | 9.5~10.5s | 11.4s |
 * | `yt-dlp`（Python zipapp） | 0.41s | **2.2s** |
 *
 * PyInstaller 的单文件包每次启动都要把 ~72MB 解压到临时目录，这 9 秒是**纯开销**：
 * 它不随网络、不随站点变化，用户能直接感觉到的就是「点解析要等十几秒」。
 * zipapp 只解压自己的源码（3MB），启动快到几乎可以忽略。
 *
 * 代价是**需要一个 python3 运行时**。策略是「有就用快的，没有就用能跑的」：
 *   - 清单里同时记两份：`yt-dlp`（zipapp）与 `<platform>_bundled`（PyInstaller）
 *   - 边车的 `fetch` 先探测 python3；可用就装 zipapp，不可用就装独立包
 *   - 探测时两者都能识别（zipapp 的版本输出与独立包一致）
 *
 * Windows 不用 zipapp：官方 `yt-dlp.exe` 是自包含的（自带解释器），
 * 而 Windows 上「有 python3」远不如 Linux/macOS 普遍，强依赖会翻车。
 */
const YTDLP_ASSETS = {
  'darwin/arm64': 'yt-dlp',
  'darwin/x64': 'yt-dlp',
  'linux/x64': 'yt-dlp',
  'linux/arm64': 'yt-dlp',
  'win32/x64': 'yt-dlp.exe',
}

/**
 * 自包含的 PyInstaller 独立包，作为「没有 python3」时的回退。
 *
 * 与 `YTDLP_ASSETS` 一一对应：zipapp 装不上时用它。
 * Windows 的两份相同（`yt-dlp.exe` 本来就是自包含的），不重复下载。
 */
const YTDLP_BUNDLED_ASSETS = {
  'darwin/arm64': 'yt-dlp_macos',
  'darwin/x64': 'yt-dlp_macos',
  'linux/x64': 'yt-dlp_linux',
  'linux/arm64': 'yt-dlp_linux_aarch64',
  'win32/x64': 'yt-dlp.exe',
}

/**
 * 哪些平台使用 zipapp（需要系统 python3）。
 * Windows 排除：那边 python3 不普遍，且官方 exe 已自带解释器。
 */
const YTDLP_ZIPAPP_PLATFORMS = new Set(['darwin/arm64', 'darwin/x64', 'linux/x64', 'linux/arm64'])

/**
 * aria2 各平台的下载描述。
 *
 * `source` / `tag` 一起决定 URL 前缀；`asset` 是文件名；`archive` 决定怎么解包：
 *   - `zip`     → fetch 的 ZipInner（取包内 aria2c[.exe]）
 *   - `tar.gz`  → fetch 的 TarInner（取包内 aria2c-*，macOS 那个包用的）
 *   - `raw`     → 下载物本身就是可执行文件，直接安装
 *
 * `tag` 为 `latest` 的源（static-build）用 releases/latest/download 形式，
 * 不做版本钉住 —— 它只发 darwin/x64 单个二进制，且没有版本化 tag。
 */
const ARIA2_ASSETS = {
  'linux/x64': { source: 'abcfy2', asset: 'aria2-x86_64-linux-musl_static.zip', archive: 'zip', inner: 'aria2c' },
  'linux/arm64': { source: 'abcfy2', asset: 'aria2-aarch64-linux-musl_static.zip', archive: 'zip', inner: 'aria2c' },
  'win32/x64': { source: 'abcfy2', asset: 'aria2-x86_64-w64-mingw32_static.zip', archive: 'zip', inner: 'aria2c.exe' },
  'darwin/arm64': { source: 'ricode', tag: 'aria2-1.37.0', asset: 'aria2-macos-arm64.tar.gz', archive: 'tar.gz', inner: 'aria2c-macos-arm64' },
  'darwin/x64': { source: 'staticbuild', tag: 'latest', asset: 'aria2c.darwin', archive: 'raw', inner: '' },
}

/** ffmpeg-static 各平台使用的产物名（实际文件为 <name>.gz） */
const FFMPEG_ASSETS = {
  'darwin/arm64': { ffmpeg: 'ffmpeg-darwin-arm64', ffprobe: 'ffprobe-darwin-arm64' },
  'darwin/x64': { ffmpeg: 'ffmpeg-darwin-x64', ffprobe: 'ffprobe-darwin-x64' },
  'linux/x64': { ffmpeg: 'ffmpeg-linux-x64', ffprobe: 'ffprobe-linux-x64' },
  'linux/arm64': { ffmpeg: 'ffmpeg-linux-arm64', ffprobe: 'ffprobe-linux-arm64' },
  'win32/x64': { ffmpeg: 'ffmpeg-win32-x64', ffprobe: 'ffprobe-win32-x64' },
}

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const argValue = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

let workDir = null
const retrySignal = new Int32Array(new SharedArrayBuffer(4))
function waitBeforeRetry(seconds) {
  Atomics.wait(retrySignal, 0, 0, seconds * 1000)
}
function tmpFile(name) {
  if (!workDir) workDir = mkdtempSync(path.join(tmpdir(), 'downvid-deps-'))
  return path.join(workDir, name)
}

/**
 * 用 curl 抓取内容；redirect: 'follow' 对应 -L。
 * 网络抖动时重试，这是本项目里最省心的做法（见 AGENTS.md 的发布说明）。
 */
function curlFetch(url, { binary = false, retries = 6 } = {}) {
  const out = binary ? tmpFile(`dl-${createHash('sha1').update(url).digest('hex')}`) : null
  const args = ['-fsSL', '--max-time', '180', '--retry', '2']
  if (out) args.push('-o', out)
  args.push(url)

  const text = curlText(args, { retries, quiet: binary })
  return out ? readFileSync(out) : text
}

/** 带重试的 curl：本项目的网络（含 CI）会出现 TLS 抖动，统一在这里兜住 */
function curlText(textArgs, { retries = 5, quiet = false } = {}) {
  let lastError = ''
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return execFileSync('curl', textArgs, { encoding: 'utf8' })
    } catch (e) {
      lastError = e?.stderr?.toString().trim() || e?.message || ''
      if (attempt < retries) {
        if (!quiet) console.warn(`  ! curl 第 ${attempt} 次失败，重试中`)
        waitBeforeRetry(attempt * 2)
      }
    }
  }
  throw new Error(lastError || 'curl 执行失败')
}

/** 解析 `hash  filename` 形式的校验文件 */
function parseSums(text) {
  const map = new Map()
  for (const line of String(text).split('\n')) {
    const match = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i)
    if (match) map.set(match[2].trim(), match[1].toLowerCase())
  }
  return map
}

/**
 * 取最新 tag。
 *
 * 不用 GitHub API：未认证时很快会被限流（403），
 * 改为读 releases/latest 的 302 跳转地址，稳定且无配额。
 */
function latestTag(repo) {
  let tag = ''
  try {
    // 不带 -L：需要捕获 302 的 Location 才能拿到 tag
    const location = curlText([
      '-sS', '-o', devNull, '-w', '%{redirect_url}', '--max-time', '60',
      `https://github.com/${repo}/releases/latest`,
    ], { quiet: true }).trim()
    tag = location.split('/tag/')[1] || ''
  } catch {}

  if (!tag) {
    // 少数代理会直接跟随跳转：退回 GitHub API（未认证时可能限流，故仅作兜底）
    try {
      const json = curlText([
        '-fsSL', '--max-time', '60',
        `https://api.github.com/repos/${repo}/releases/latest`,
      ], { quiet: true })
      tag = JSON.parse(json).tag_name || ''
    } catch {}
  }
  if (!tag) throw new Error(`无法确定 ${repo} 的最新 tag，请用 --ytdlp/--ffmpeg 显式指定`)
  return decodeURIComponent(tag)
}

async function resolveYtDlp(tag, { withHashes }) {
  const resolvedTag = tag || latestTag(YTDLP_REPO)
  const base = `https://github.com/${YTDLP_REPO}/releases/download/${resolvedTag}`

  const assets = {}
  if (withHashes) {
    const sums = parseSums(curlFetch(`${base}/SHA2-256SUMS`))
    const lookup = (name) => {
      const hash = sums.get(name)
      if (!hash) throw new Error(`${resolvedTag} 的 SHA2-256SUMS 中缺少 ${name}`)
      return hash
    }
    for (const [platform, name] of Object.entries(YTDLP_ASSETS)) {
      // 每个平台同时记两份：主用（zipapp）+ 回退（自包含）
      assets[platform] = {
        name,
        hash: lookup(name),
        // 回退包与主用包同名时（Windows）不重复记录，节省一次下载与一段清单
        bundled: YTDLP_BUNDLED_ASSETS[platform] === name ? '' : YTDLP_BUNDLED_ASSETS[platform],
        bundledHash: YTDLP_BUNDLED_ASSETS[platform] === name ? '' : lookup(YTDLP_BUNDLED_ASSETS[platform]),
        zipapp: YTDLP_ZIPAPP_PLATFORMS.has(platform),
      }
    }
  }
  return { tag: resolvedTag, assets }
}

async function resolveFfmpeg(tag, { withHashes }) {
  const resolvedTag = tag || latestTag(FFMPEG_REPO)
  const base = `https://github.com/${FFMPEG_REPO}/releases/download/${resolvedTag}`

  const assets = {}
  for (const [platform, kinds] of Object.entries(FFMPEG_ASSETS)) {
    assets[platform] = {}
    for (const key of ['ffmpeg', 'ffprobe']) {
      const name = kinds[key]
      // 上游不公布校验值：更新模式下下载后自算，校验模式下留空由调用方比对
      const hash = withHashes
        ? createHash('sha256').update(curlFetch(`${base}/${name}.gz`, { binary: true })).digest('hex')
        : ''
      assets[platform][key] = { name, hash }
    }
  }
  return { tag: resolvedTag, assets }
}

/** 从已生成的 Go 文件里读回现有 tag */
function readCurrentTags() {
  try {
    const src = readFileSync(OUT_FILE, 'utf8')
    return {
      ytdlp: src.match(/YtDlpTag\s*=\s*"([^"]+)"/)?.[1],
      ffmpeg: src.match(/FFmpegTag\s*=\s*"([^"]+)"/)?.[1],
      aria2: src.match(/Aria2Tag\s*=\s*"([^"]+)"/)?.[1],
    }
  } catch {
    return {}
  }
}

/**
 * aria2 的 URL 前缀。每个平台的源可能不同（见 ARIA2_ASSETS 的注释）。
 *
 * `latest` 走 `/releases/latest/download/<asset>`：static-build 只发单文件、
 * 没有版本化 tag，钉版本反而会让清单在它重建后失效。
 */
function aria2Base(entry, tagOverride) {
  const repo = ARIA2_SOURCES[entry.source]
  if (!repo) throw new Error(`未知的 aria2 源：${entry.source}`)
  const tag = tagOverride || entry.tag || 'latest'
  return tag === 'latest'
    ? `https://github.com/${repo}/releases/latest/download`
    : `https://github.com/${repo}/releases/download/${tag}`
}

async function resolveAria2(_tag, { withHashes }) {
  // 各平台的 tag 不一致（abcfy2 是 1.37.0、ricode 是 aria2-1.37.0、static-build 是 latest），
  // 所以清单里逐平台记 URL，而不是共用一个 aria2Base + tag。
  const assets = {}
  for (const [platform, entry] of Object.entries(ARIA2_ASSETS)) {
    const url = `${aria2Base(entry)}/${entry.asset}`
    // 上游不公布校验值：更新模式下把归档完整下载后自算
    const hash = withHashes
      ? createHash('sha256').update(curlFetch(url, { binary: true })).digest('hex')
      : ''
    assets[platform] = { ...entry, url, hash }
  }
  return { tag: latestTag(ARIA2_SOURCES.abcfy2), assets }
}

function render(ytdlp, ffmpeg, aria2, existing) {
  // yt-dlp 的资产条目多了「回退包」与「是否 zipapp」两个字段，
  // 用手写模板而不是匿名字面量：5 个字段用位置传参太容易错位。
  const ytdlpLines = Object.entries(ytdlp.assets)
    .map(([platform, a]) =>
      `\t${JSON.stringify(platform)}: {\n` +
      `\t\tName: "${a.name}", SHA256: "${a.hash}",\n` +
      `\t\tBundled: "${a.bundled || ''}", BundledSHA256: "${a.bundledHash || ''}",\n` +
      `\t\tZipApp: ${a.zipapp ? 'true' : 'false'},\n` +
      `\t},`)
    .join('\n')

  const aria2Lines = Object.entries(aria2.assets)
    .map(([platform, a]) =>
      `\t${JSON.stringify(platform)}: {\n` +
      `\t\tURL: "${a.url}", SHA256: "${a.hash || existing?.aria2?.[platform] || 'PENDING'}",\n` +
      `\t\tArchive: "${a.archive}", Inner: "${a.inner}",\n` +
      `\t},`)
    .join('\n')

  const ffmpegLines = Object.entries(ffmpeg.assets)
    .map(([platform, kinds]) => {
      const ff = kinds.ffmpeg
      const fp = kinds.ffprobe
      return `\t${JSON.stringify(platform)}: {\n` +
        `\t\trt.KindFFmpeg:  {"${ff.name}", "${h(ff, existing, platform, 'ffmpeg')}"},\n` +
        `\t\trt.KindFFprobe: {"${fp.name}", "${h(fp, existing, platform, 'ffprobe')}"},\n` +
        `\t},`
    })
    .join('\n')

  return `// Code generated by scripts/gen-deps-manifest.mjs; DO NOT EDIT.
//
// 由脚本从上游发布页抓取版本号与 SHA-256 后生成，请勿手改；
// 升级依赖请运行：node scripts/gen-deps-manifest.mjs（或 pnpm deps:manifest）。

package manifest

import rt "github.com/yxxbc/downvid/backend/internal/runtime"

// YtDlpTag yt-dlp nightly 构建的固定 tag（日期版本号）
const YtDlpTag = "${ytdlp.tag}"

// FFmpegTag ffmpeg-static 的固定 tag
const FFmpegTag = "${ffmpeg.tag}"

const (
\tytdlpBase  = "https://github.com/${YTDLP_REPO}/releases/download/" + YtDlpTag
\tffmpegBase = "https://github.com/${FFMPEG_REPO}/releases/download/" + FFmpegTag
)

// ytdlpAssets yt-dlp 在各平台的产物与 SHA-256。
//
// 每个平台两份二进制：
//   - Name / SHA256        主用。Linux / macOS 是 Python zipapp（启动 0.4s），
//                          Windows 是自包含的 yt-dlp.exe
//   - Bundled / BundledSHA256  回退。系统没有可用 python3 时装的 PyInstaller 包
//                          （启动要 9~10s，但不需要解释器）
// 为空的 Bundled 表示该平台两包相同（Windows），无需回退。
var ytdlpAssets = map[string]ytdlpAsset{
${ytdlpLines}
}

// ffmpegAssets ffmpeg / ffprobe 在各平台的产物与 SHA-256。
//
// 选用 ffmpeg-static（静态构建）而非 BtbN：体积更小、gzip 单文件便于校验，
// 且带 libmp3lame / aac / libx264，覆盖音频转换与音视频合并两种用途。
var ffmpegAssets = map[string]map[rt.Kind]asset{
${ffmpegLines}
}

// aria2Assets 各平台的静态构建。
//
// **五个平台来自三个不同的社区源**：没有任何单一仓库同时提供「自包含 + 架构齐全」。
// 每个 URL 都是实测可用的（用 file / otool -L 确认不依赖 Homebrew 私有库，
// 并真跑过一次下载）。逐平台记 URL 而不是共用一个 base：
// 三个源的 tag 形式各不相同（1.37.0 / aria2-1.37.0 / latest）。
//
// 不要换成 Homebrew bottle：那个二进制链接到 HOMEBREW_PREFIX/opt/... 下的库，
// 单独拷出来跑不了。
var aria2Assets = map[string]aria2Asset{
${aria2Lines}
}
`
}

/** 校验模式下保留文件里已有的哈希 */
function h(asset, existing, platform, key) {
  return asset.hash || existing?.ffmpeg?.[platform]?.[key] || 'PENDING'
}

/** 读回现有文件中 aria2 的哈希，供校验模式复用 */
function readExistingAria2Hashes() {
  try {
    const src = readFileSync(OUT_FILE, 'utf8')
    const block = /var aria2Assets = map\[string\]asset\{([\s\S]*?)\n\}/.exec(src)?.[1] || ''
    const out = {}
    for (const m of block.matchAll(/"([^"]+)":\s*\{"([^"]+)",\s*"([0-9a-f]{64})"\}/g)) out[m[1]] = { name: m[2], hash: m[3] }
    return out
  } catch {
    return {}
  }
}

/** 读回现有文件中 ffmpeg 的哈希，供校验模式复用 */
function readExistingFfmpegHashes() {
  try {
    const src = readFileSync(OUT_FILE, 'utf8')
    const out = {}
    const re = /\t"([^"]+)": \{\n\t\trt\.KindFFmpeg:  \{"([^"]+)", "([0-9a-f]{64})"\},\n\t\trt\.KindFFprobe: \{"([^"]+)", "([0-9a-f]{64})"\},\n\t\},/g
    let m
    while ((m = re.exec(src)) !== null) {
      out[m[1]] = { ffmpeg: { name: m[2], hash: m[3] }, ffprobe: { name: m[4], hash: m[5] } }
    }
    return out
  } catch {
    return {}
  }
}

/**
 * 判断产物是否可下载。
 *
 * 用带 Range 的 GET 而不是 HEAD：GitHub Release 的 HEAD 会跳到
 * release-assets.githubusercontent.com，部分网络下该主机直连会失败；
 * 而范围下载既能确认文件存在，又能只拉 1 字节。
 */
function assetAvailable(url) {
  const attempts = 6
  let lastError = ''
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      execFileSync('curl', ['-fsSL', '-r', '0-0', '--max-time', '60', '-o', devNull, url],
        { stdio: ['ignore', 'ignore', 'pipe'] })
      return true
    } catch (e) {
      lastError = e?.stderr?.toString().trim() || e?.message || ''
      if (/404|Not Found/i.test(lastError)) return false
      if (attempt < attempts) waitBeforeRetry(attempt * 2)
    }
  }
  console.warn(`  ! 无法确认产物是否存在（网络原因），跳过：${url}`)
  return null
}

async function main() {
  const existingTags = readCurrentTags()
  console.log('检查上游版本...')

  if (checkOnly) {
    const ytdlpTag = latestTag(YTDLP_REPO)
    const ffmpegTag = latestTag(FFMPEG_REPO)
    const aria2Tag = latestTag(ARIA2_REPO)
    console.log(`  上游 yt-dlp : ${ytdlpTag}（本地 ${existingTags.ytdlp || '未知'}）`)
    console.log(`  上游 ffmpeg : ${ffmpegTag}（本地 ${existingTags.ffmpeg || '未知'}）`)
    // aria2 的五平台来自三个源、tag 形式各不相同，清单里逐平台记 URL 而不是单一 tag，
    // 所以这里只报告上游最新值，不参与「是否落后」的判定。
    console.log(`  上游 aria2  : ${aria2Tag}（逐平台独立源，不判定落后）`)

    const problems = []
    if (ytdlpTag !== existingTags.ytdlp) {
      problems.push(`yt-dlp 版本落后：本地 ${existingTags.ytdlp} → 上游 ${ytdlpTag}`)
    }
    // aria2 落后不算问题：它只是个可选加速器，1.36 之后就稳定了，
    // 追最新版没有收益，反而每次都要重下 14MB。只在清单缺失时提示。

    // yt-dlp 有官方校验值：顺带确认清单里的哈希与上游一致（文件很小，开销可忽略）
    if (ytdlpTag === existingTags.ytdlp) {
      const resolved = await resolveYtDlp(ytdlpTag, { withHashes: true })
      const src = readFileSync(OUT_FILE, 'utf8')
      for (const [platform, a] of Object.entries(resolved.assets)) {
        if (!src.includes(a.hash)) problems.push(`${platform} 的 yt-dlp 哈希与上游不一致`)
      }
    }

    // ffmpeg 不重新下载大文件：只确认产物名仍与上游一致
    for (const kinds of Object.values(FFMPEG_ASSETS)) {
      for (const name of Object.values(kinds)) {
        const available = assetAvailable(`https://github.com/${FFMPEG_REPO}/releases/download/${existingTags.ffmpeg}/${name}.gz`)
        if (available === false) {
          problems.push(`上游缺少产物 ${name}.gz（tag ${existingTags.ffmpeg}）`)
        }
      }
    }

    if (problems.length) {
      console.error('\n清单校验未通过：')
      for (const problem of problems) console.error(`  - ${problem}`)
      console.error('\n运行 `pnpm deps:manifest` 更新清单。')
      process.exit(1)
    }
    console.log('清单与上游一致')
    return
  }

  const ytdlp = await resolveYtDlp(argValue('--ytdlp'), { withHashes: true })
  const ffmpeg = await resolveFfmpeg(argValue('--ffmpeg') || existingTags.ffmpeg, { withHashes: true })
  const aria2 = await resolveAria2(argValue('--aria2') || existingTags.aria2, { withHashes: true })
  console.log(`  yt-dlp : ${ytdlp.tag}`)
  console.log(`  ffmpeg : ${ffmpeg.tag}`)
  console.log(`  aria2  : ${aria2.tag}`)

  writeFileSync(OUT_FILE, render(ytdlp, ffmpeg, aria2, {
    ffmpeg: readExistingFfmpegHashes(),
    aria2: readExistingAria2Hashes(),
  }), 'utf8')

  // 生成物必须是 gofmt 干净的：CI 跑 `gofmt -l .`，未格式化的**生成文件**
  // 会让整个 backend job 变红，而错误信息只指向一个「不该手改」的文件。
  // 与其让人手动跑 gofmt（然后下次生成又忘），不如在这里保证。
  try {
    execFileSync('gofmt', ['-w', OUT_FILE], { stdio: 'ignore' })
  } catch {
    console.warn('  ! 未找到 gofmt，跳过格式化（CI 的 gofmt -l 会报出来）')
  }
  console.log(`已写入 ${path.relative(process.cwd(), OUT_FILE)}`)
}

main()
  .catch((e) => {
    console.error(`生成失败：${e.message}`)
    process.exitCode = 1
  })
  .finally(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true })
  })
