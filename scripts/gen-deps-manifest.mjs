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
import { tmpdir } from 'node:os'
import path from 'node:path'

const YTDLP_REPO = 'yt-dlp/yt-dlp-nightly-builds'
const FFMPEG_REPO = 'eugeneware/ffmpeg-static'
const OUT_FILE = path.resolve('backend/internal/manifest/assets.gen.go')

/** yt-dlp 各平台使用的产物名 */
const YTDLP_ASSETS = {
  'darwin/arm64': 'yt-dlp_macos',
  'darwin/x64': 'yt-dlp_macos',
  'linux/x64': 'yt-dlp_linux',
  'linux/arm64': 'yt-dlp_linux_aarch64',
  'win32/x64': 'yt-dlp.exe',
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
        execFileSync('sleep', [String(attempt * 2)])
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
      '-sS', '-o', '/dev/null', '-w', '%{redirect_url}', '--max-time', '60',
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
    for (const [platform, name] of Object.entries(YTDLP_ASSETS)) {
      const hash = sums.get(name)
      if (!hash) throw new Error(`${resolvedTag} 的 SHA2-256SUMS 中缺少 ${name}`)
      assets[platform] = { name, hash }
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
    }
  } catch {
    return {}
  }
}

function render(ytdlp, ffmpeg, existing) {
  const ytdlpLines = Object.entries(ytdlp.assets)
    .map(([platform, a]) => `\t${JSON.stringify(platform)}:${' '.repeat(Math.max(1, 15 - platform.length))}{"${a.name}", "${a.hash}"},`)
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

// ytdlpAssets yt-dlp 在各平台的产物与 SHA-256
var ytdlpAssets = map[string]asset{
${ytdlpLines}
}

// ffmpegAssets ffmpeg / ffprobe 在各平台的产物与 SHA-256。
//
// 选用 ffmpeg-static（静态构建）而非 BtbN：体积更小、gzip 单文件便于校验，
// 且带 libmp3lame / aac / libx264，覆盖音频转换与音视频合并两种用途。
var ffmpegAssets = map[string]map[rt.Kind]asset{
${ffmpegLines}
}
`
}

/** 校验模式下保留文件里已有的哈希 */
function h(asset, existing, platform, key) {
  return asset.hash || existing?.ffmpeg?.[platform]?.[key] || 'PENDING'
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
      execFileSync('curl', ['-fsSL', '-r', '0-0', '--max-time', '60', '-o', '/dev/null', url],
        { stdio: ['ignore', 'ignore', 'pipe'] })
      return true
    } catch (e) {
      lastError = e?.stderr?.toString().trim() || e?.message || ''
      if (/404|Not Found/i.test(lastError)) return false
      if (attempt < attempts) execFileSync('sleep', [String(attempt * 2)])
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
    console.log(`  上游 yt-dlp : ${ytdlpTag}（本地 ${existingTags.ytdlp || '未知'}）`)
    console.log(`  上游 ffmpeg : ${ffmpegTag}（本地 ${existingTags.ffmpeg || '未知'}）`)

    const problems = []
    if (ytdlpTag !== existingTags.ytdlp) {
      problems.push(`yt-dlp 版本落后：本地 ${existingTags.ytdlp} → 上游 ${ytdlpTag}`)
    }

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
  console.log(`  yt-dlp : ${ytdlp.tag}`)
  console.log(`  ffmpeg : ${ffmpeg.tag}`)

  writeFileSync(OUT_FILE, render(ytdlp, ffmpeg, { ffmpeg: readExistingFfmpegHashes() }), 'utf8')
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
