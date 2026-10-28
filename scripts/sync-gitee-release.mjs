#!/usr/bin/env node
/**
 * 把一次 GitHub Release 的产物同步到 Gitee，并生成 Gitee 自己的更新清单。
 *
 * ## 为什么不是「只镜像清单」
 *
 * 清单里的资产 URL 如果仍指向 GitHub，那么 GitHub 不可达时清单能读到、包却下不动。
 * 这里把每个产物上传到 Gitee Release，再生成 `manifest.gitee.json`，让资产 URL
 * 指向 Gitee 自己；这样 Gitee 源可以在国内独立完成「检查 + 下载」。
 *
 * ## 幂等
 *
 * release / 附件已存在时复用；同名但大小不同则删掉重传（重跑发布时常见）。
 *
 * 用法：
 *   GITEE_TOKEN=... node scripts/sync-gitee-release.mjs \
 *     --version 1.8.0 --tag v1.8.0 --artifacts artifacts \
 *     --notes-file /tmp/release-notes.md --out website/updates/manifest.gitee.json
 *
 *   node scripts/sync-gitee-release.mjs --dry-run ...   # 只生成清单，不联网
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { buildManifest, classifyAsset } from './lib/update-manifest.mjs'

const DEFAULT_REPO = 'Xynrin/downvid'
const DEFAULT_OUT = path.join('website', 'updates', 'manifest.gitee.json')

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

async function gitee(repo, token, endpoint, init = {}) {
  const response = await fetch(`https://gitee.com/api/v5/repos/${repo}${endpoint}`, {
    ...init,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!response.ok) {
    throw new Error(`Gitee API ${init.method || 'GET'} ${endpoint} 失败（${response.status}）：${await response.text()}`)
  }
  if (response.status === 204) return null
  const text = await response.text()
  if (!text.trim()) return null
  return JSON.parse(text)
}

async function ensureRelease(repo, token, { tag, version, notes }) {
  const getByTag = async () => {
    try {
      return await gitee(repo, token, `/releases/tags/${encodeURIComponent(tag)}`)
    } catch (err) {
      // 404 表示还没有这个 Release；其余错误继续抛出。
      if (!String(err.message).includes('（404）')) throw err
      return null
    }
  }

  const existing = await getByTag()
  if (existing) return existing

  const created = await gitee(repo, token, '/releases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: 'main',
      name: `DownVid v${version}`,
      body: notes || `DownVid ${tag}`,
      prerelease: false,
    }),
  })
  if (created?.id) return created

  // Gitee 偶尔返回 201 空 body；给索引一点时间再读一次。
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const release = await getByTag()
    if (release) return release
  }
  return null
}

async function listAttachments(repo, token, releaseId) {
  const list = await gitee(repo, token, `/releases/${releaseId}/attach_files?per_page=100`)
  return Array.isArray(list) ? list : []
}

async function uploadAttachment(repo, token, releaseId, filePath, name) {
  const form = new FormData()
  form.append('file', new Blob([fs.readFileSync(filePath)]), name)
  // 注意：不要手动设置 Content-Type，fetch 会自动带上 multipart boundary。
  await gitee(repo, token, `/releases/${releaseId}/attach_files`, {
    method: 'POST',
    body: form,
  })
}

async function deleteAttachment(repo, token, releaseId, attachId) {
  await gitee(repo, token, `/releases/${releaseId}/attach_files/${attachId}`, { method: 'DELETE' })
}

async function main() {
  const version = arg('version')
  const tag = arg('tag', version ? `v${version}` : '')
  const artifactsDir = arg('artifacts')
  const out = path.resolve(arg('out', DEFAULT_OUT))
  const repo = arg('repo', DEFAULT_REPO)
  const notesFile = arg('notes-file', '')
  const dryRun = hasFlag('dry-run')
  const token = process.env.GITEE_TOKEN || ''

  if (!version || !artifactsDir || !tag) {
    throw new Error('需要 --version、--artifacts 和 --tag（或由 version 推导）')
  }
  if (!dryRun && !token) {
    throw new Error('需要 GITEE_TOKEN（本地可先 GITEE_TOKEN="$(gitee auth token)"）')
  }

  const assets = readArtifacts(artifactsDir)
  const notes = notesFile ? fs.readFileSync(notesFile, 'utf8').trim() : ''
  const releaseBase = `https://gitee.com/${repo}/releases/download/${encodeURIComponent(tag)}`

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
  const writeManifest = () => {
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`)
  }

  if (dryRun) {
    writeManifest()
    console.log(`dry-run: ${path.relative(process.cwd(), out)}，${assets.length} 个资产（未上传）`)
    return
  }

  const release = await ensureRelease(repo, token, { tag, version, notes })
  if (!release?.id) throw new Error('Gitee 没有返回 Release ID')

  const existing = new Map((await listAttachments(repo, token, release.id)).map((a) => [a.name, a]))
  let uploaded = 0
  for (const asset of assets) {
    const filePath = path.join(artifactsDir, asset.name)
    const current = existing.get(asset.name)
    if (current && Number(current.size) === asset.size) {
      console.log(`跳过 ${asset.name}（已存在）`)
      continue
    }
    if (current) {
      console.log(`重传 ${asset.name}（大小变化 ${current.size} -> ${asset.size}）`)
      await deleteAttachment(repo, token, release.id, current.id)
    }
    await uploadAttachment(repo, token, release.id, filePath, asset.name)
    uploaded++
    console.log(`上传 ${asset.name}`)
  }

  // 只有全部上传成功才写清单：CI 用 /tmp 文件的存在作为「可以提交」的信号，
  // 半途失败时不能把指向缺失资产的清单推上去。
  writeManifest()
  console.log(`Gitee Release ${tag} 就绪：${assets.length} 个资产（本次上传 ${uploaded} 个）`)
}

main().catch((err) => {
  console.error(`同步 Gitee 失败：${err.message}`)
  process.exit(1)
})
