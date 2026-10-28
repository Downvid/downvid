#!/usr/bin/env node
/**
 * 把一次 GitHub Release 的产物同步到 CNB，并维护一个稳定的 CNB 更新清单。
 *
 * ## URL 设计
 *
 * CNB 的 raw API 需要登录，客户端不能直接读仓库文件；所以清单作为一个
 * **Release 资产**放在固定的 `update` Release 里：
 *
 *   https://cnb.cool/<repo>/-/releases/download/update/manifest.cnb.json
 *
 * 每个版本的安装包放在各自的 Release：
 *
 *   https://cnb.cool/<repo>/-/releases/download/v1.8.0/<asset>
 *
 * `update` Release 每次覆盖同名清单资产；版本 Release 首次创建为 draft，
 * 全部资产上传并校验后才公开。
 *
 * 用法：
 *   CNB_TOKEN=... node scripts/sync-cnb-release.mjs \
 *     --version 1.8.0 --tag v1.8.0 --artifacts artifacts \
 *     --notes-file /tmp/release-notes.md --out /tmp/manifest.cnb.json
 *
 *   node scripts/sync-cnb-release.mjs --dry-run ...
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { buildManifest, classifyAsset } from './lib/update-manifest.mjs'

const DEFAULT_REPO = 'yxxbc/downvid'
const DEFAULT_MANIFEST_TAG = 'update'
const API = 'https://api.cnb.cool'

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`)
  if (i < 0) return fallback
  const value = process.argv[i + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`--${name} 缺少值`)
  }
  return value
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`)
}

function readToken() {
  // CI 与本地 skill 都通过环境变量注入；本地 skill 的 tokens.env 是唯一存放处。
  return (process.env.CNB_TOKEN || '').trim()
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function readArtifacts(dir) {
  if (!fs.existsSync(dir)) throw new Error(`产物目录不存在：${dir}`)
  const assets = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !classifyAsset(entry.name)) continue
    const full = path.join(dir, entry.name)
    assets.push({ name: entry.name, sha256: sha256File(full), size: fs.statSync(full).size })
  }
  if (assets.length === 0) throw new Error(`没有找到任何 DownVid-Wails-* 产物：${dir}`)
  return assets
}

function jsonHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.cnb.api+json',
    'Content-Type': 'application/json',
  }
}

async function apiAbsolute(token, url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.cnb.api+json',
      ...(init.headers ?? {}),
    },
  })
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`${init.method || 'GET'} ${url} 失败（${response.status}）：${await response.text()}`)
  }
  if (response.status === 204) return null
  const text = await response.text()
  if (!text.trim()) return null
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('json')) return text
  return JSON.parse(text)
}

function api(token, repo, endpoint, init = {}) {
  return apiAbsolute(token, `${API}/${repo}${endpoint}`, init)
}

async function ensureRelease(token, repo, { tag, name, body, draft, makeLatest }) {
  const existing = await api(token, repo, `/-/releases/tags/${encodeURIComponent(tag)}`)
  if (existing) return existing

  const created = await api(token, repo, '/-/releases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: 'main',
      name,
      body,
      draft,
      prerelease: false,
      make_latest: makeLatest ? 'true' : 'false',
    }),
  })
  if (created) return created

  // 并发创建时可能刚被另一边建出来，重读一次。
  const after = await api(token, repo, `/-/releases/tags/${encodeURIComponent(tag)}`)
  if (after) return after
  throw new Error(`无法创建或读取 CNB Release ${tag}`)
}

async function uploadAsset(token, repo, releaseId, filePath, assetName) {
  const size = fs.statSync(filePath).size
  const upload = await api(token, repo, `/-/releases/${releaseId}/asset-upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ asset_name: assetName, size, overwrite: true, ttl: 0 }),
  })
  if (!upload?.upload_url || !upload?.verify_url) {
    throw new Error(`CNB 没有返回 ${assetName} 的上传地址`)
  }

  const put = await fetch(upload.upload_url, {
    method: 'PUT',
    body: fs.readFileSync(filePath),
    headers: {
      'Content-Length': String(size),
      'Content-Type': 'application/octet-stream',
    },
  })
  if (!put.ok) {
    throw new Error(`上传 ${assetName} 失败（${put.status}）：${await put.text()}`)
  }

  const verifyURL = new URL(upload.verify_url, `${API}/`).toString()
  const sep = verifyURL.includes('?') ? '&' : '?'
  await apiAbsolute(token, `${verifyURL}${sep}ttl=0`, { method: 'POST' })
}

async function main() {
  const version = arg('version')
  const tag = arg('tag', version ? `v${version}` : '')
  const artifactsDir = arg('artifacts')
  const notesFile = arg('notes-file', '')
  const out = path.resolve(arg('out', 'manifest.cnb.json'))
  const repo = arg('repo', DEFAULT_REPO)
  const manifestTag = arg('manifest-tag', DEFAULT_MANIFEST_TAG)
  const dryRun = hasFlag('dry-run')
  const token = readToken()

  if (!version || !artifactsDir || !tag) {
    throw new Error('需要 --version、--artifacts 和 --tag（或由 version 推导）')
  }
  if (!dryRun && !token) {
    throw new Error('需要 CNB_TOKEN（本地用 ~/.claude/skills/reop-all-sync/tokens.env）')
  }

  const assets = readArtifacts(artifactsDir)
  const notes = notesFile ? fs.readFileSync(notesFile, 'utf8').trim() : ''
  const releaseBase = `https://cnb.cool/${repo}/-/releases/download/${encodeURIComponent(tag)}`
  const manifest = buildManifest({
    appId: 'com.downvid.downvid',
    channel: 'stable',
    version,
    tag,
    repo,
    assets,
    notes,
    releaseBase,
  })

  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`)

  if (dryRun) {
    console.log(`dry-run: ${path.relative(process.cwd(), out)}，${assets.length} 个资产（未上传）`)
    return
  }

  // 1. 版本 Release：先 draft，资产全部上传后再公开。
  const release = await ensureRelease(token, repo, {
    tag,
    name: `DownVid ${tag}`,
    body: notes,
    draft: true,
    makeLatest: false,
  })
  if (!release?.id) throw new Error('CNB 没有返回 Release ID')

  for (const asset of assets) {
    await uploadAsset(token, repo, release.id, path.join(artifactsDir, asset.name), asset.name)
    console.log(`上传 ${asset.name}`)
  }

  await api(token, repo, `/-/releases/${release.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `DownVid ${tag}`,
      body: notes,
      draft: false,
      prerelease: false,
      make_latest: 'true',
    }),
  })
  console.log(`CNB Release ${tag} 已公开`)

  // 2. 稳定的 update Release：覆盖写入 manifest.cnb.json。
  const updateRelease = await ensureRelease(token, repo, {
    tag: manifestTag,
    name: 'CNB update manifest',
    body: 'DownVid 更新清单（自动维护，请勿手动修改）',
    draft: false,
    makeLatest: false,
  })
  if (!updateRelease?.id) throw new Error('CNB 没有返回 update Release ID')
  await uploadAsset(token, repo, updateRelease.id, out, 'manifest.cnb.json')
  console.log(
    `清单已更新：https://cnb.cool/${repo}/-/releases/download/${manifestTag}/manifest.cnb.json`,
  )
}

main().catch((err) => {
  console.error(`同步 CNB 失败：${err.message}`)
  process.exit(1)
})
