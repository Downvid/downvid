/**
 * 平台解析器共用的工具。
 *
 * 抖音与快手的解析器各自维护时出现了完全重复的实现（码率估算、Cookie 解析），
 * 抽到这里以免两边慢慢漂移；域名过滤这类平台差异通过参数传入。
 */

import fs from 'node:fs'

/** Netscape 格式 cookies.txt 的一行 */
export interface CookieItem {
  domain: string
  includeSubdomains: boolean
  path: string
  secure: boolean
  expiry: number
  name: string
  value: string
}

/**
 * 解析 Netscape 格式的 cookies.txt。
 *
 * 与 utils/cookies.ts 里的实现是两回事：那个负责从浏览器导出快照供 yt-dlp 使用，
 * 这里只解析用户已导出的纯文本文件，供平台 API 请求自行拼请求头。
 * 文件不可读时返回空数组——调用方会退化为无 Cookie 请求，而不是整体失败。
 */
export function parseCookiesFile(filePath: string): CookieItem[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const cookies: CookieItem[] = []
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const parts = trimmed.split('\t')
      if (parts.length < 7) continue
      cookies.push({
        domain: parts[0],
        includeSubdomains: parts[1] === 'TRUE',
        path: parts[2],
        secure: parts[3] === 'TRUE',
        expiry: parseInt(parts[4]) || 0,
        name: parts[5],
        value: parts[6],
      })
    }
    return cookies
  } catch {
    return []
  }
}

/**
 * 从 cookies 构建 Cookie 请求头。
 *
 * domains 用于过滤：浏览器导出的文件里混着大量无关域名的 Cookie，
 * 全带上既长又可能被平台判为异常请求。
 */
export function buildCookieHeader(cookies: CookieItem[], domains: string[]): string {
  return cookies
    .filter(c => domains.some(d => c.domain.includes(d)))
    .map(c => `${c.name}=${c.value}`)
    .join('; ')
}

/** 抖音相关的 Cookie 域名 */
export const DOUYIN_COOKIE_DOMAINS = ['douyin.com', 'iesdouyin.com', 'snssdk.com']

/**
 * 按分辨率与时长估算文件大小。
 *
 * 平台 API 往往不返回精确大小，只能估；用于界面上给用户一个量级参考，
 * 因此不需要很准。
 */
export function estimateFileSize(height: number, durationMs: number): number {
  const durationSec = durationMs / 1000
  let bitrate = 2000000
  if (height >= 1080) bitrate = 5000000
  else if (height >= 720) bitrate = 2500000
  else if (height >= 480) bitrate = 1500000
  else if (height >= 360) bitrate = 800000
  return Math.floor((bitrate * durationSec) / 8)
}
