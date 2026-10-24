#!/usr/bin/env node
/**
 * Gitee Release 镜像同步助手。
 *
 * 规则：
 * 仅同步更新时客户端下载所需的核心二进制包（如 DownVid-Wails-*.zip / DownVid-Setup-*.exe / .AppImage / .dmg 等），
 * 绝不上传调试符号、构建中间件或安装衍生文件（.blockmap、latest.yml 等），遵守 Gitee 空间配额与镜像纯度。
 */

import fs from 'node:fs'
import path from 'node:path'

const UPDATE_EXTENSIONS = ['.zip', '.exe', '.dmg', '.appimage', '.tar.gz', '.pkg']
const IGNORED_NAMES = ['.blockmap', 'latest.yml', 'latest-mac.yml', 'latest-linux.yml', '.part', '.tmp']

export function isUpdateAsset(filename) {
  const lower = filename.toLowerCase()
  if (IGNORED_NAMES.some(ign => lower.includes(ign))) return false
  return UPDATE_EXTENSIONS.some(ext => lower.endsWith(ext))
}

export function filterUpdateFiles(files) {
  return files.filter(isUpdateAsset)
}

export async function planGiteeMirror(options = {}) {
  const { dir = 'app/build/bin', tag = 'v1.5.0' } = options
  const results = {
    tag,
    included: [],
    excluded: [],
  }

  if (fs.existsSync(dir)) {
    const entries = fs.readdirSync(dir)
    for (const file of entries) {
      if (isUpdateAsset(file)) {
        results.included.push(path.join(dir, file))
      } else {
        results.excluded.push(file)
      }
    }
  }

  return results
}

if (process.argv[1] && process.argv[1].endsWith('gitee-release-mirror.mjs')) {
  const args = process.argv.slice(2)
  const tagIndex = args.indexOf('--tag')
  const tag = tagIndex !== -1 ? args[tagIndex + 1] : 'v1.5.0'

  console.log(`[Gitee Release 镜像助手] 目标版本: ${tag}`)
  console.log('执行策略: 仅保留自更新与安装运行必需包，剔除 blockmap 与非核心产物。')

  planGiteeMirror({ tag }).then(plan => {
    console.log(`✓ 筛选纳入更新镜像产物 (${plan.included.length} 个):`)
    plan.included.forEach(f => console.log(`   + ${path.basename(f)}`))
    if (plan.excluded.length > 0) {
      console.log(`○ 自动过滤非更新产物 (${plan.excluded.length} 个):`)
      plan.excluded.forEach(f => console.log(`   - ${f}`))
    }
  })
}
