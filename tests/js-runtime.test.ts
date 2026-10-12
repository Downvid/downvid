import { describe, it, expect } from 'vitest'

/**
 * JS 运行时的候选判定。
 *
 * 背景（真实事故）：`checkJsRuntime()` 曾返回 `process.execPath`——也就是 Electron
 * 二进制本身——并靠 `path.includes('node')` 猜测类型。Electron 的路径里没有 "node"，
 * 于是被当成 deno 传给 `yt-dlp --js-runtimes deno:/Applications/DownVid.app/Contents/MacOS/DownVid`。
 * yt-dlp 照常执行它，**拉起了一整个 DownVid**：用户点解析后会多开一个应用。
 * 实测进程数 1 → 3。
 *
 * 所以这里把"哪些路径可以当 node/deno 运行时"这条判定固定下来。
 * 与 electron/utils/binary.ts 的 looksLikeNode 保持一致。
 */
function looksLikeNode(candidate: string): boolean {
  const lower = candidate.toLowerCase()
  // 归一化分隔符：Windows 用反斜杠
  const normalized = lower.replace(/\\/g, '/')
  if (normalized.includes('.app/contents/macos/')) return false
  if (normalized.includes('electron')) return false
  return true
}

describe('JS 运行时候选判定', () => {
  it('排除 macOS 打包应用内的 Electron 二进制（正是事故现场）', () => {
    expect(looksLikeNode('/Applications/DownVid.app/Contents/MacOS/DownVid')).toBe(false)
    expect(looksLikeNode('/Users/mac/Projects/downvid/release/1.3.0/mac-arm64/DownVid.app/Contents/MacOS/DownVid')).toBe(false)
  })

  it('排除其它 Electron 应用（路径可能不含 .app，如开发态）', () => {
    expect(looksLikeNode('/Applications/Visual Studio Code.app/Contents/MacOS/Electron')).toBe(false)
    expect(looksLikeNode('/Users/x/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')).toBe(false)
    expect(looksLikeNode('/usr/local/bin/electron')).toBe(false)
  })

  it('接受真正的 node / deno', () => {
    expect(looksLikeNode('/usr/bin/node')).toBe(true)
    expect(looksLikeNode('/usr/local/bin/node')).toBe(true)
    expect(looksLikeNode('/opt/homebrew/bin/node')).toBe(true)
    expect(looksLikeNode('/opt/homebrew/bin/deno')).toBe(true)
    expect(looksLikeNode('C:\\Program Files\\nodejs\\node.exe')).toBe(true)
  })

  it('大小写不敏感（Windows 路径常见）', () => {
    expect(looksLikeNode('C:\\PROGRAM FILES\\NODEJS\\node.exe')).toBe(true)
    expect(looksLikeNode('C:\\X\\DownVid.APP\\Contents\\MacOS\\DownVid')).toBe(false)
  })
})
