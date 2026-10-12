#!/usr/bin/env node
/**
 * IPC 契约校验。
 *
 * 渲染进程能调用的每个能力都由三处手工维护，漏改会**静默失败**（不报错、功能不生效）：
 *   1. electron/ipc/*.ts        ipcMain.handle('通道')   —— 主进程实现
 *   2. electron/preload.ts      ipcRenderer.invoke/on    —— 暴露给渲染进程的桥
 *   3. src/env.d.ts             Window.electronAPI 类型 —— 渲染进程的类型提示
 *
 * 广播事件（主进程 → 渲染进程）有第四处：主进程的 emit 点。少一处，事件就
 * 永远收不到，且没有任何报错。
 *
 * 本脚本静态比对这几处的一致性，并顺带校验几项约定：
 *   - src/env.d.ts 不能出现顶层 import/export（否则会从全局声明脚本变成模块，
 *     interface Window 随即失效，electron-env.d.ts 时代就是这样踩的坑）
 *   - shared/app.ts 的 owner/repo 必须与 electron-builder.json5 的 publish 一致
 *     （换仓库时漏改会让存量用户收不到更新）
 *   - electron-builder.json5 的 artifactName 必须保留约定的产物名
 *
 * 用法：node scripts/lint-ipc.mjs
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const problems = []
const notes = []

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/** 收集任意文本里所有 `pattern` 捕获组第 1 组 */
function collect(text, pattern) {
  return [...text.matchAll(pattern)].map(m => m[1])
}

// ===== 1. 收集主进程注册的通道 =====
const ipcDir = path.join(ROOT, 'electron/ipc')
const mainChannels = new Set()
for (const file of fs.readdirSync(ipcDir)) {
  if (!file.endsWith('.ts')) continue
  const src = read(path.join('electron/ipc', file))
  for (const ch of collect(src, /ipcMain\.handle\(\s*'([^']+)'/g)) mainChannels.add(ch)
}

// ===== 2. 收集 preload 暴露的调用通道 =====
const preload = read('electron/preload.ts')
const preloadInvoke = new Set(collect(preload, /ipcRenderer\.invoke\(\s*'([^']+)'/g))
const preloadListen = new Set(collect(preload, /ipcRenderer\.on\(\s*'([^']+)'/g))

// ===== 3. 收集主进程实际发送的广播事件 =====
const emitted = new Set()
const electronDir = path.join(ROOT, 'electron')
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walk(full)
    } else if (entry.name.endsWith('.ts')) {
      const src = fs.readFileSync(full, 'utf8')
      for (const ch of collect(src, /(?:broadcast|sendToRenderer)\(\s*'([^']+)'/g)) emitted.add(ch)
      for (const ch of collect(src, /webContents\.send\(\s*'([^']+)'/g)) emitted.add(ch)
    }
  }
}
walk(electronDir)

// ===== 4. 校验 1 ↔ 2：主进程注册的通道必须都暴露给渲染进程 =====
for (const ch of mainChannels) {
  if (!preloadInvoke.has(ch)) {
    problems.push(`主进程注册了 '${ch}'，但 preload.ts 没有暴露（渲染进程无法调用）`)
  }
}
for (const ch of preloadInvoke) {
  if (!mainChannels.has(ch)) {
    problems.push(`preload.ts 暴露了 '${ch}'，但主进程没有 ipcMain.handle（调用会抛出"无处理程序"）`)
  }
}

// ===== 5. 校验广播事件三处一致 =====
for (const ev of emitted) {
  if (!preloadListen.has(ev)) {
    problems.push(`主进程发送广播 '${ev}'，但 preload.ts 没有 ipcRenderer.on（事件永远收不到）`)
  }
}
for (const ev of preloadListen) {
  if (!emitted.has(ev)) {
    problems.push(`preload.ts 监听 '${ev}'，但主进程从未发送（监听是死代码）`)
  }
}
// 广播事件不应被当成 invoke 通道
for (const ev of preloadListen) {
  if (mainChannels.has(ev)) {
    problems.push(`'${ev}' 同时作为广播事件与 invoke 通道存在，会造成混淆`)
  }
}

// ===== 6. env.d.ts 必须是全局声明脚本 =====
const envDts = read('src/env.d.ts')
const topLevelModuleSyntax = envDts
  .split('\n')
  .filter(line => /^(import|export)\s/.test(line.trim()))
if (topLevelModuleSyntax.length) {
  problems.push(
    `src/env.d.ts 出现顶层 import/export（${topLevelModuleSyntax.length} 处），` +
    '会把它从全局声明脚本变成模块、interface Window 随即失效；请改用内联 import(...)',
  )
}
if (!/interface Window\s*\{/.test(envDts)) {
  problems.push('src/env.d.ts 未声明 interface Window')
}

// ===== 7. env.d.ts 的顶层键需覆盖 preload 的顶层键 =====
/**
 * 取对象字面量/接口体的直接子键。
 *
 * 不能写死缩进：preload 的对象在文件顶层（2 空格），而 env.d.ts 里
 * electronAPI 嵌在 `interface Window` 内（4 空格）。
 * 也不能靠正则猜"这行是不是嵌套对象"——多行类型（如
 * `onUpdateStatus: (callback: (data: { ... }) => void) => () => void`）
 * 会让这类猜测失效。改为按行累计花括号深度，只取深度恰为 1 的行首键。
 */
function topLevelKeys(source, marker) {
  const markerIndex = source.indexOf(marker)
  if (markerIndex < 0) return []
  const braceIndex = source.indexOf('{', markerIndex)

  const keys = []
  // 起始的 `{` 已经进入第一层，因此初始深度为 1
  let depth = 1
  let lineStart = braceIndex + 1
  let cursor = braceIndex + 1

  // 逐行扫描：每行开头若 depth===1，则该行首的 `名:` 就是直接子键
  while (cursor < source.length) {
    const lineEnd = source.indexOf('\n', cursor)
    const end = lineEnd < 0 ? source.length : lineEnd
    const line = source.slice(lineStart, end)

    if (depth === 1) {
      const m = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*[?]?\s*:/)
      if (m) keys.push(m[1])
    }

    // 累计本行的花括号（字符串里的括号在类型声明中极少见，忽略之）
    for (const ch of line) {
      if (ch === '{') depth++
      else if (ch === '}') depth--
    }
    if (depth <= 0) break

    cursor = end + 1
    lineStart = cursor
  }
  return keys
}

const preloadKeys = topLevelKeys(preload, "exposeInMainWorld('electronAPI'")
const envKeys = topLevelKeys(envDts, 'electronAPI:')
for (const key of preloadKeys) {
  if (!envKeys.includes(key)) {
    problems.push(`preload.ts 暴露了 '${key}'，但 src/env.d.ts 的类型里没有（渲染进程会报类型错误）`)
  }
}
for (const key of envKeys) {
  if (!preloadKeys.includes(key)) {
    problems.push(`src/env.d.ts 声明了 '${key}'，但 preload.ts 没有暴露（类型在撒谎）`)
  }
}

// ===== 8. 仓库坐标一致性 =====
const sharedApp = read('shared/app.ts')
const owner = sharedApp.match(/owner:\s*'([^']+)'/)?.[1]
const repo = sharedApp.match(/repo:\s*'([^']+)'/)?.[1]
const builder = read('electron-builder.json5')
const publishOwner = builder.match(/"owner":\s*"([^"]+)"/)?.[1]
const publishRepo = builder.match(/"repo":\s*"([^"]+)"/)?.[1]

if (!owner || !repo) {
  problems.push('shared/app.ts 未能解析出 owner/repo')
} else {
  if (publishOwner !== owner) {
    problems.push(`共享常量 owner='${owner}' 与 electron-builder.json5 的 "${publishOwner}" 不一致`)
  }
  if (publishRepo !== repo) {
    problems.push(`共享常量 repo='${repo}' 与 electron-builder.json5 的 "${publishRepo}" 不一致`)
  }
}

// 工作流里的仓库地址（README badge、publish 等）也应指向同一仓库
// 这些是刻意引用的上游/衍生项目，不参与一致性检查
const ALLOWED_OTHER_REPOS = new Set([
  'cshuangyy/videdown',   // 本项目的前身（见 README 致谢）
  'yt-dlp/yt-dlp',
  'electron/electron',
  'BtbN/FFmpeg-Builds',
  'eugeneware/ffmpeg-static',
])
for (const file of ['README.md', 'electron-builder.json5']) {
  const src = read(file)
  const refs = collect(src, /https:\/\/github\.com\/([^/\s"')]+\/[^/\s"')#]+)/g)
  for (const raw of refs) {
    const ref = raw.replace(/\.git$/, '')
    if (ref === `${owner}/${repo}` || ALLOWED_OTHER_REPOS.has(ref)) continue
    if (['/releases', '/issues'].some(sfx => ref.endsWith(sfx))) continue
    notes.push(`${file} 引用了其他仓库：${ref}（若非刻意，请核对）`)
  }
}

// ===== 9. 产物命名契约 =====
// 这些名字被旧版本客户端的更新清单引用，改名会让存量用户无法自动更新
const artifactRules = [
  ['"artifactName": "${productName}-${arch}-Mac-${version}.${ext}"', 'macOS 产物'],
  ['"artifactName": "${productName}-Setup-${version}.${ext}"', 'Windows 安装包'],
  ['"artifactName": "${productName}-Portable-${version}.${ext}"', 'Windows 便携版'],
]
for (const [rule, label] of artifactRules) {
  if (!builder.includes(rule)) {
    problems.push(`${label}的 artifactName 不符合约定（${rule}），改名会让存量用户无法自动更新`)
  }
}

// ===== 输出 =====
if (notes.length) {
  console.log('提示：')
  for (const note of notes) console.log(`  - ${note}`)
}

if (problems.length) {
  console.error('\nIPC 契约校验未通过：')
  for (const problem of problems) console.error(`  ✗ ${problem}`)
  console.error(`\n共 ${problems.length} 处不一致。相关约定见 docs/standards.md 的「改动落点清单」。`)
  process.exit(1)
}

console.log(
  `IPC 契约校验通过：${mainChannels.size} 个调用通道、${emitted.size} 个广播事件、` +
  `${preloadKeys.length} 个 API 分组`,
)
