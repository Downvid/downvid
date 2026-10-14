/** 使用固定的无颜色、非人类单位输出，兼容 aria2 的回车刷新。 */
export function parseAria2Progress(line: string): { downloaded: number; total: number; speed: number } | null {
  const match = /\[#\w+\s+(\d+)B?\/(\d+)B?\([\d.]+%\)\s+CN:\d+\s+DL:(\d+)B?[^\]]*\]/.exec(line)
  if (!match) return null
  const [downloaded, total, speed] = match.slice(1).map(Number)
  if (![downloaded, total, speed].every(Number.isSafeInteger) || downloaded > total) return null
  return { downloaded, total, speed }
}
