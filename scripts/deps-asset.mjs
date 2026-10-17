#!/usr/bin/env node
/**
 * 从生成的依赖清单（`backend/internal/manifest/assets.gen.go`）里取出
 * 某个平台要用的资产名、下载地址与 SHA-256，供 Dockerfile 使用。
 *
 * ## 为什么不让 Dockerfile 自己写死版本与哈希
 *
 * 镜像里的 yt-dlp / ffmpeg / ffprobe 必须与**桌面版用户下载到的那一份**
 * 完全一致：同一套格式选择、同一套编码器、同一套 bug。历史上 Dockerfile
 * 自己钉了一个 `YTDLP_VERSION`（拉 `yt-dlp` 那个 Python zipapp），而桌面清单
 * 用的是 `yt-dlp_linux` 静态包 —— 两条升级路径各走各的，迟早对不上，
 * 而且**对不上不会报错**：镜像照常起，只是版本静默落后。
 *
 * 所以这里把清单当作唯一来源：
 *   - 版本号与哈希来自 `assets.gen.go`（由 `pnpm deps:manifest` 生成）
 *   - Dockerfile 只负责按本脚本的输出下载 + 校验
 *   - `scripts/lint-docker.mjs` 静态校验 Dockerfile 没有自己写死任何版本/哈希
 *
 * ## 输出
 *
 * `--shell`：每行 `KIND<TAB>URL<TAB>SHA256`，供 Dockerfile 的 while-read 消费。
 * 换成 JSON 也行，但 shell 里解析 JSON 需要额外工具（镜像里刻意不装 jq）。
 *
 * 用法：
 *   node scripts/deps-asset.mjs --platform linux-x64
 *   node scripts/deps-asset.mjs --platform linux-arm64 --shell
 *   node scripts/deps-asset.mjs --platform linux-x64 --kind ytdlp
 */

import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_MANIFEST = path.resolve(import.meta.dirname, '../backend/internal/manifest/assets.gen.go')

/**
 * Docker 的 TARGETARCH 与清单里平台键的映射。
 *
 * `TARGETARCH` 取 `amd64` / `arm64`，而清单键是 `linux/x64` / `linux/arm64`
 * ——与 `scripts/build-backend.sh` 里的 `x64:amd64` 是同一张表。
 * 直接透传会得到 `linux/amd64`，在清单里查不到，然后**静默拿到空资产**。
 */
const PLATFORM_BY_TARGETARCH = {
  amd64: 'linux/x64',
  arm64: 'linux/arm64',
}
const ARCH_BY_TARGETARCH = { amd64: 'x64', arm64: 'arm64' }

export function normalizePlatform(value) {
  const raw = String(value || '').trim()
  if (!raw) throw new Error('缺少平台参数')
  if (PLATFORM_BY_TARGETARCH[raw]) return PLATFORM_BY_TARGETARCH[raw]
  const alias = { 'linux/amd64': 'linux/x64', 'linux/x64': 'linux/x64', 'linux/arm64': 'linux/arm64' }
  if (alias[raw]) return alias[raw]
  if (ARCH_BY_TARGETARCH[raw]) return `linux/${ARCH_BY_TARGETARCH[raw]}`
  // `linux-arm64`（连字符写法）来自文档与 compose，避免用户写一种就对不上
  const dashed = /^linux-(x64|amd64|arm64)$/.exec(raw)
  if (dashed) return dashed[1] === 'arm64' ? 'linux/arm64' : 'linux/x64'
  throw new Error(`不认识的平台：${raw}（可用：amd64 / arm64 / linux-x64 / linux-arm64）`)
}

/**
 * 解析 assets.gen.go。
 *
 * 刻意用正则而不是 Go 的 AST：这个文件由 `scripts/gen-deps-manifest.mjs`
 * 生成，形状固定（`"平台": {"资产名", "哈希"}`）。格式一旦变化就抛错，
 * 而不是安静地少解析出几条——后者会让镜像里少一个依赖。
 */
export function parseManifest(source) {
  const tagOf = (name) => {
    const m = new RegExp(`const\\s+${name}\\s*=\\s*"([^"]+)"`).exec(source)
    if (!m) throw new Error(`清单里找不到常量 ${name}`)
    return m[1]
  }
  const ytdlpTag = tagOf('YtDlpTag')
  const ffmpegTag = tagOf('FFmpegTag')

  // yt-dlp 的条目是多行结构体（Name/SHA256/Bundled/…），不再是单行字面量。
  // 容器里**必须用自包含的 Bundled 包**：镜像刻意不装 python3（那是 abcfy2 那边
  // 省下的 27MB），用 zipapp 会在容器里直接报 "python3: not found"。
  const ytdlp = new Map()
  const ytdlpBlock = /var ytdlpAssets = map\[string\]ytdlpAsset\{([\s\S]*?)\n\}/.exec(source)
  if (!ytdlpBlock) throw new Error('清单里找不到 ytdlpAssets')
  for (const m of ytdlpBlock[1].matchAll(
    /"([^"]+)":\s*\{\s*Name:\s*"([^"]+)",\s*SHA256:\s*"([^"]+)",\s*Bundled:\s*"([^"]*)",\s*BundledSHA256:\s*"([^"]*)"/g,
  )) {
    const [, platform, name, sha256, bundled, bundledSha] = m
    // 有回退包就用回退包（自包含），否则用主用包（Windows 两包相同）
    ytdlp.set(platform, bundled
      ? { name: bundled, sha256: bundledSha }
      : { name, sha256 })
  }

  const ffmpeg = new Map()
  // 每个平台一段："linux/x64": { rt.KindFFmpeg: {...}, rt.KindFFprobe: {...} }
  // 不能用「一直匹配到文件末尾」的锚点（`\n\}\s*$`）：清单里 ffmpegAssets
  // 后面又多了 aria2Assets，锚点会失配 —— 表现是「清单里找不到 ffmpegAssets」，
  // 而文件明明在。改为匹配到**第一处顶格 `}`**，与 Go 的块结构对齐。
  const ffmpegBlock = /var ffmpegAssets = map\[string\]map\[rt\.Kind\]asset\{([\s\S]*?)\n\}/.exec(source)
  if (!ffmpegBlock) throw new Error('清单里找不到 ffmpegAssets')
  for (const m of ffmpegBlock[1].matchAll(/"([^"]+)":\s*\{([\s\S]*?)\n\t\},/g)) {
    const platform = m[1]
    const entry = {}
    for (const k of m[2].matchAll(/rt\.Kind(FFmpeg|FFprobe):\s*\{"([^"]+)",\s*"([^"]+)"\}/g)) {
      entry[k[1] === 'FFmpeg' ? 'ffmpeg' : 'ffprobe'] = { name: k[2], sha256: k[3] }
    }
    if (entry.ffmpeg && entry.ffprobe) ffmpeg.set(platform, entry)
  }

  return { ytdlpTag, ffmpegTag, ytdlp, ffmpeg }
}

/**
 * 某个平台要下载的三件东西。
 *
 * 顺序固定为 yt-dlp → ffmpeg → ffprobe，方便 Dockerfile 里的 `set --` 消费，
 * 也方便单独跑 `--kind ffmpeg` 调试。
 */
export function assetsFor(source, platform) {
  const manifest = parseManifest(source)
  const key = normalizePlatform(platform)
  const ytdlp = manifest.ytdlp.get(key)
  const ffmpeg = manifest.ffmpeg.get(key)
  if (!ytdlp) throw new Error(`清单里没有 ${key} 的 yt-dlp 资产`)
  if (!ffmpeg) throw new Error(`清单里没有 ${key} 的 ffmpeg 资产`)

  const out = [
    {
      kind: 'yt-dlp',
      // 注意是 `yt-dlp_linux` / `yt-dlp_linux_aarch64`（PyInstaller 独立包，不需要 Python），
      // 不是 `yt-dlp`（那是要 python3 的 zipapp）
      name: ytdlp.name,
      url: `https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/${manifest.ytdlpTag}/${ytdlp.name}`,
      sha256: ytdlp.sha256,
      // ffmpeg-static 的产物是 .gz；上传时要先解压（校验仍针对 .gz 本身，
      // 与边车 `fetch` 的行为一致）
      gzip: false,
    },
    {
      kind: 'ffmpeg',
      name: ffmpeg.ffmpeg.name,
      url: `https://github.com/eugeneware/ffmpeg-static/releases/download/${manifest.ffmpegTag}/${ffmpeg.ffmpeg.name}.gz`,
      sha256: ffmpeg.ffmpeg.sha256,
      gzip: true,
    },
    {
      kind: 'ffprobe',
      name: ffmpeg.ffprobe.name,
      url: `https://github.com/eugeneware/ffmpeg-static/releases/download/${manifest.ffmpegTag}/${ffmpeg.ffprobe.name}.gz`,
      sha256: ffmpeg.ffprobe.sha256,
      gzip: true,
    },
  ]
  return out
}

// ===== CLI =====
function main(argv) {
  const arg = (name, fallback = '') => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('用法: node scripts/deps-asset.mjs --platform <amd64|arm64|linux-x64|linux-arm64> [--kind yt-dlp|ffmpeg|ffprobe] [--manifest <assets.gen.go>] [--shell|--json]')
    return 0
  }

  const platform = arg('platform') || process.env.TARGETARCH || process.arch
  const only = arg('kind')
  // --manifest 指向另一份 assets.gen.go。Dockerfile 里源码树不全（只拷了清单），
  // 用它把路径显式指过去，而不是靠「猜脚本旁边有没有仓库」。
  const manifestPath = arg('manifest') || DEFAULT_MANIFEST
  if (!fs.existsSync(manifestPath)) throw new Error(`找不到清单文件：${manifestPath}`)
  const source = fs.readFileSync(manifestPath, 'utf8')
  let assets = assetsFor(source, platform)
  if (only) {
    assets = assets.filter((a) => a.kind === only)
    if (!assets.length) throw new Error(`未知的 --kind：${only}`)
  }

  if (argv.includes('--json')) {
    console.log(JSON.stringify(assets, null, 2))
  } else {
    // 默认输出 shell 友好的 TSV：无引号、无前导空格，`set -- $line` 直接可用
    for (const a of assets) {
      console.log([a.kind, a.url, a.sha256, a.name, a.gzip ? 'gz' : 'raw'].join('\t'))
    }
  }
  return 0
}

/**
 * 是否作为脚本直接运行（而不是被 `tests/` 里 import）。
 *
 * 不用「文件名猜」：Dockerfile 会把它拷成 /tmp/deps-asset.mjs 之外的临时名字，
 * 改名后入口判断失效的表现是**脚本静默啥也不做、退出码 0**——镜像里
 * ffmpeg 就装不上了，而且构建还「成功」。这里用 realpath 精确比对。
 */
function isMain() {
  if (!process.argv[1]) return false
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url))
  } catch {
    return false
  }
}

if (isMain()) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (e) {
    console.error(`[deps-asset] ${e?.message || e}`)
    process.exitCode = 1
  }
}
