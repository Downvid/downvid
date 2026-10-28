#!/usr/bin/env node
/**
 * 生成 wmlUpdate 的 static manifest（默认 website/updates/manifest.gitee.json）。
 *
 * Gitee 的清单提交到仓库；CNB 的清单作为固定 update Release 的资产上传。
 * 两边的资产 URL 都指向各自的 Release（用 --release-base 指定）。
 *
 * 发布流程调用它，提交回 main；官网部署后三个 URL 都指向同一份数据。
 *
 * ## 两种来源
 *
 *   --artifacts <dir>  发布 job 里已经下载好的产物（推荐，哈希由本地文件算）
 *   否则               GitHub Release API（本地补生成/核对时用；需要 digest）
 *
 * 用法：
 *   node scripts/gen-update-manifest.mjs --version 1.7.3 --tag v1.7.3 \
 *     --artifacts artifacts --notes-file /tmp/release-notes.md
 *
 *   node scripts/gen-update-manifest.mjs --tag v1.7.3 --out /tmp/manifest.json
 *
 * 生成国内镜像清单时用 --release-base 指向该镜像自己的产物地址，例如：
 *   node scripts/gen-update-manifest.mjs --version 1.8.0 --tag v1.8.0 \
 *     --artifacts /tmp/assets --out website/updates/manifest.gitee.json \
 *     --release-base "https://gitee.com/Xynrin/downvid/releases/download/v1.8.0"
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { buildManifest, classifyAsset, normalizeVersion } from './lib/update-manifest.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const APP_ID = 'com.downvid.downvid'
const DEFAULT_REPO = 'Downvid/downvid'
const DEFAULT_OUT = path.join(ROOT, 'website', 'updates', 'manifest.gitee.json')

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`)
  if (i < 0) return fallback
  const value = process.argv[i + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`--${name} 缺少值`)
  }
  return value
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function fromArtifacts(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true })
  const assets = []
  for (const entry of files) {
    if (!entry.isFile()) continue
    if (!classifyAsset(entry.name)) continue
    const full = path.join(dir, entry.name)
    assets.push({
      name: entry.name,
      sha256: sha256File(full),
      size: fs.statSync(full).size,
    })
  }
  return assets
}

async function fromGitHub({ repo, tag, token }) {
  const url = `${process.env.GITHUB_API || 'https://api.github.com'}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'DownVid-release-manifest',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const resp = await fetch(url, { headers })
  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`GitHub Release API ${resp.status}：${body.slice(0, 300)}`)
  }
  const release = await resp.json()
  const assets = (release.assets ?? []).map((asset) => ({
    name: asset.name,
    sha256: asset.digest ?? '',
    size: asset.size ?? 0,
  }))
  return { release, assets }
}

async function main() {
  const repo = arg('repo', DEFAULT_REPO)
  const out = path.resolve(arg('out', DEFAULT_OUT))
  const notesFile = arg('notes-file', '')
  const artifactsDir = arg('artifacts', '')
  const releaseBase = arg('release-base', '')
  let version = arg('version', '')
  let tag = arg('tag', '')
  let notes = notesFile ? fs.readFileSync(notesFile, 'utf8') : ''
  let publishedAt = arg('published-at', '')

  let assets
  if (artifactsDir) {
    if (!fs.existsSync(artifactsDir)) {
      throw new Error(`产物目录不存在：${artifactsDir}`)
    }
    if (!version) throw new Error('使用 --artifacts 时必须提供 --version')
    tag = tag || `v${normalizeVersion(version)}`
    assets = fromArtifacts(artifactsDir)
  } else {
    if (!tag) throw new Error('需要 --tag 或 --version 定位 Release')
    const { release, assets: remoteAssets } = await fromGitHub({
      repo,
      tag,
      token: process.env.GITHUB_TOKEN || '',
    })
    assets = remoteAssets
    version = version || release.tag_name
    notes = notes || release.body || ''
    publishedAt = publishedAt || release.published_at || ''
  }

  const manifest = buildManifest({
    appId: APP_ID,
    channel: 'stable',
    version,
    tag,
    repo,
    assets,
    notes: notes.trim(),
    publishedAt: publishedAt || new Date().toISOString(),
    releaseBase: releaseBase || undefined,
  })

  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(
    `wrote ${path.relative(ROOT, out)}: v${manifest.version}, ${manifest.assets.length} assets`,
  )
}

main().catch((err) => {
  console.error(`生成更新清单失败：${err.message}`)
  process.exit(1)
})
