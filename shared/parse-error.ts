export type ParseErrorKind = 'unsupported-url' | 'invalid-url' | 'runtime-unavailable' | 'format-unavailable' | 'page-reload' | 'challenge-failed' | 'authentication' | 'access-denied' | 'network' | 'not-found' | 'rate-limit' | 'unknown'

export function classifyParseError(raw: string): ParseErrorKind {
  const marked = /(?:\[\[parse-error:|错误类别：)([\w-]+)/.exec(raw)?.[1]
  if (marked && Object.prototype.hasOwnProperty.call(PARSE_MESSAGES, marked)) return marked as ParseErrorKind
  if (/Unsupported URL/i.test(raw)) return 'unsupported-url'
  if (/not a valid URL|请输入有效的链接/i.test(raw)) return 'invalid-url'
  if (/Requested format is not available|No video formats found|Only images are available/i.test(raw)) return 'format-unavailable'
  if (/The page needs to be reloaded/i.test(raw)) return 'page-reload'
  if (/challenge.*fail|signature.*fail|No supported JavaScript runtime/i.test(raw)) return 'challenge-failed'
  if (/Sign in|private video|登录|authentication/i.test(raw)) return 'authentication'
  if (/429|Too Many Requests/i.test(raw)) return 'rate-limit'
  if (/403|Forbidden/i.test(raw)) return 'access-denied'
  if (/timed? out|timeout|network|Unable to download.*page|ConnectionError/i.test(raw)) return 'network'
  if (/Video unavailable|404|not found|已被删除/i.test(raw)) return 'not-found'
  return 'unknown'
}

export const PARSE_MESSAGES: Record<ParseErrorKind, string> = {
  'unsupported-url': '暂不支持该网站或链接类型',
  'invalid-url': '请输入有效的链接',
  'runtime-unavailable': 'YouTube 解析需要可运行的 Node.js 22+ 或 Deno 2.3+',
  'format-unavailable': '未找到可下载的视频格式，请检查运行依赖或登录状态',
  'page-reload': 'YouTube 客户端解析失败，请更新 yt-dlp 后重试',
  'challenge-failed': 'YouTube 验证脚本执行失败，请检查 JS 运行时和 yt-dlp',
  authentication: '该视频需要登录或访问权限，请检查 Cookies 设置',
  'access-denied': '网站拒绝了访问请求，请检查权限或稍后重试',
  network: '网络请求失败或超时，请检查连接后重试',
  'not-found': '视频不存在、不可用或已被删除',
  'rate-limit': '网站请求过于频繁，请稍后重试',
  unknown: '无法解析该链接',
}

/** 诊断只输出允许公开的类别和版本，绝不拼接原始子进程输出。 */
export function parseDiagnostic(raw: string, versions: { ytdlp?: string; runtime?: string } = {}): string {
  const kind = classifyParseError(raw)
  const lines = [`错误类别：${kind}`, PARSE_MESSAGES[kind]]
  const safeVersions = { ytdlp: versions.ytdlp || /(?:^|\n)ytdlp：([^\n]+)/.exec(raw)?.[1], runtime: versions.runtime || /(?:^|\n)runtime：([^\n]+)/.exec(raw)?.[1] }
  for (const [name, value] of Object.entries(safeVersions)) {
    if (value && /^(?:node|deno)@\d+\.\d+\.\d+$|^\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$/.test(value)) lines.push(`${name}：${value}`)
  }
  if (/challenge.*fail|signature.*fail|No supported JavaScript runtime|诊断：JS 验证脚本未成功执行/i.test(raw)) lines.push('诊断：JS 验证脚本未成功执行')
  if (/PO Token|SABR|诊断：站点限制了部分流格式/i.test(raw)) lines.push('诊断：站点限制了部分流格式')
  return lines.join('\n')
}

export function safeIssueReport(message: string, detail: string): { title: string; body: string } {
  const kind = classifyParseError(`${detail}\n${message}`)
  return { title: `[Bug] ${PARSE_MESSAGES[kind]}`, body: `## 问题描述\n\n${PARSE_MESSAGES[kind]}\n\n## 脱敏诊断\n\n${parseDiagnostic(`${detail}\n${message}`)}\n\n## 复现步骤\n\n请补充不含个人信息的复现步骤。` }
}
