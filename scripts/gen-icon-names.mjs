#!/usr/bin/env node
/**
 * 更新 scripts/data/material-symbols-names.txt（有效 Material Symbols 名称清单）。
 *
 * 来源是 Google 官方元数据 https://fonts.google.com/metadata/icons —— 实测它与
 * 内嵌字体真正能渲染的名字集合完全一致（4256 个），而字体包自带的 TS 联合类型
 * 并不一致（会漏掉 error_outline、system_update 等能正常渲染的名字）。
 *
 * 该清单供 scripts/lint-icons.mjs 校验源码里的图标名。
 *
 * 用法：node scripts/gen-icon-names.mjs（或 pnpm icons:update）
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const URL = 'https://fonts.google.com/metadata/icons?incomplete=true&key=material_symbols'
const OUT = path.resolve(import.meta.dirname, 'data/material-symbols-names.txt')

function fetchWithRetry(url, attempts = 4) {
  let lastError
  for (let i = 1; i <= attempts; i++) {
    try {
      return execFileSync('curl', ['-fsSL', '--max-time', '60', url], {
        encoding: 'utf8',
        // 元数据响应约 1.5MB，默认 maxBuffer(1MB) 会直接 ENOBUFS
        maxBuffer: 32 * 1024 * 1024,
      })
    } catch (e) {
      lastError = e
      if (i < attempts) execFileSync('sleep', [String(i * 2)])
    }
  }
  throw new Error(`获取元数据失败：${lastError?.message || lastError}`)
}

const raw = fetchWithRetry(URL)
// 响应前面带一个 XSSI 防护前缀 )]}'
const json = JSON.parse(raw.replace(/^\)\]\}'\n?/, ''))
const names = json.icons.map(i => i.name).sort()

if (names.length < 3000) {
  throw new Error(`只解析到 ${names.length} 个名字，疑似响应格式变化，已中止`)
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, names.join('\n') + '\n')
console.log(`已写入 ${path.relative(process.cwd(), OUT)}（${names.length} 个名字）`)
