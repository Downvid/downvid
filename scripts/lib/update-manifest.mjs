/**
 * static update manifest 的纯逻辑。
 *
 * 这份 manifest 是 wmlUpdate 的 `source.type: static` 读取的格式，也是
 * jsDelivr / Gitee / 官网三个镜像的同一份内容。它必须带上每个产物的
 * SHA-256：wmlUpdate 在没有 `security.allow_unverified_assets` 时拒绝下载
 * 没有哈希的包，这正是我们要的行为。
 *
 * 单独放在 lib 里是为了让 `tests/update-manifest.test.ts` 能直接导入纯函数，
 * 不必启动 CLI 或联网。
 */

const ASSET_RE =
  /^DownVid-Wails-(mac|windows|linux)-([a-z0-9]+)-(.+?)(-installer)?\.(zip|dmg|exe|tar\.gz|deb|AppImage)$/i

const SHA256_RE = /^[0-9a-f]{64}$/i

/**
 * 从产物名解析平台、架构与格式。
 *
 * 只认 Wails 产物（`DownVid-Wails-*`）。Electron 的 DownVid-Setup-* /
 * DownVid-Portable-* 不属于新更新通道，返回 null 由调用方跳过。
 */
export function classifyAsset(name) {
  const m = ASSET_RE.exec(name)
  if (!m) return null

  const platform = m[1].toLowerCase()
  const os = platform === 'mac' ? 'darwin' : platform
  const archRaw = m[2].toLowerCase()
  const arch = archRaw === 'x64' ? 'amd64' : archRaw

  const ext = m[5].toLowerCase()
  let format = ext
  if (ext === 'tar.gz') format = 'tar.gz'
  // wmlUpdate 的 format 枚举里没有 deb / AppImage；deb 不参与自动安装，
  // AppImage 按 raw 处理（当前发布流程不产 AppImage）。
  else if (ext === 'deb') format = ''
  else if (ext === 'appimage') format = 'raw'

  return { os, arch, format }
}

/** 去掉版本号前的 v；只接受数字点分版本，避免拼出 `v1.7.3` 这种非 SemVer。 */
export function normalizeVersion(version) {
  const out = String(version ?? '').trim().replace(/^v/i, '')
  if (!/^[0-9]+(?:\.[0-9]+)+(?:[-+][0-9A-Za-z.-]+)?$/.test(out)) {
    throw new Error(`版本号不是合法的 SemVer：${JSON.stringify(version)}`)
  }
  return out
}

/** 构造 manifest；assets 形如 [{ name, sha256, size }]。 */
export function buildManifest({
  appId,
  channel = 'stable',
  version,
  tag,
  repo,
  assets,
  notes = '',
  publishedAt = new Date().toISOString(),
  releaseBase,
}) {
  if (!appId) throw new Error('appId 不能为空')
  if (!repo) throw new Error('repo 不能为空')
  const normalizedVersion = normalizeVersion(version)
  const releaseTag = tag || `v${normalizedVersion}`
  const base =
    releaseBase || `https://github.com/${repo}/releases/download/${encodeURIComponent(releaseTag)}`

  if (typeof notes !== 'string') throw new Error('notes 必须是字符串')
  if (Buffer.byteLength(notes, 'utf8') > 1 << 20) {
    throw new Error('notes 超过 1 MiB，wmlUpdate 会拒绝这份 manifest')
  }

  const out = []
  const seen = new Set()
  for (const asset of assets ?? []) {
    const meta = classifyAsset(asset?.name)
    if (!meta) continue
    if (seen.has(asset.name)) throw new Error(`产物名重复：${asset.name}`)
    seen.add(asset.name)

    const sha256 = String(asset.sha256 ?? '')
      .trim()
      .toLowerCase()
      .replace(/^sha256:/, '')
    if (!SHA256_RE.test(sha256)) {
      throw new Error(`产物 ${asset.name} 缺少合法的 SHA-256（发布流程必须提供）`)
    }
    const size = Number(asset.size)
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error(`产物 ${asset.name} 的 size 非法：${asset.size}`)
    }

    const entry = {
      name: asset.name,
      os: meta.os,
      arch: meta.arch,
      url: `${base}/${encodeURIComponent(asset.name)}`,
      sha256,
      size,
    }
    if (meta.format) entry.format = meta.format
    out.push(entry)
  }

  if (out.length === 0) throw new Error('没有找到任何 DownVid-Wails-* 产物')
  out.sort((a, b) => a.name.localeCompare(b.name))

  return {
    schema_version: 1,
    app_id: appId,
    channel,
    version: normalizedVersion,
    published_at: publishedAt,
    notes,
    assets: out,
  }
}
