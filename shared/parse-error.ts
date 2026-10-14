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

/**
 * 哪些错误**不应该**提供「提交 Issue」入口。
 *
 * ## 为什么要有这个名单
 *
 * 有些错误的处置办法**已经在应用里**（配置 Cookie、更新 yt-dlp、换个链接），
 * 它们不是代码缺陷，提 Issue 提不出任何可行动的信息。但界面对所有 `type === 'error'`
 * 都渲染「提交 Issue」按钮，而应用又会**自动生成**一个只有错误类别、没有任何用户
 * 输入的正文并预填到新建页面。结果是：用户一路回车 → 仓库多一条
 * 「该视频需要登录或访问权限，请检查 Cookies 设置」的空 Issue。
 *
 * 实测这类空报告会**重复出现**（同一个文案连开两条），维护者只能挨个关掉，
 * 真正有价值的报告（带 URL、带原始报错）反而被淹没。
 *
 * ## 名单内容
 *
 * 只放「用户自己能解决 / 不是缺陷」的类别：
 *   - authentication     → 配置 Cookie 即可
 *   - access-denied      → 403，多半是限流或需要登录
 *   - rate-limit         → 等几分钟
 *   - invalid-url        → 链接本身就是错的（含把站点当"不支持"的误判，见 #52）
 *   - unsupported-url    → 站点不受支持，是已知边界
 *   - runtime-unavailable→ 装个 Node/Deno 即可
 *   - not-found          → 视频已被删除
 *
 * **不要**把 format-unavailable / page-reload / challenge-failed / network / unknown
 * 放进来——这些往往对应真实的解析回归（历史上 #50 就是 page-reload），
 * 挡住了反而让维护者失去线索。
 */
export const NO_ISSUE_KINDS: readonly ParseErrorKind[] = [
  'authentication',
  'access-denied',
  'rate-limit',
  'invalid-url',
  'unsupported-url',
  'runtime-unavailable',
  'not-found',
]

/**
 * 这条错误是否值得开 Issue。
 *
 * `kind` 为 undefined 时（非解析类错误）保守地返回 true：那类错误（下载失败、
 * 代理不可用……）没有"用户自己就能解决"的统一特征，宁可让用户能提。
 */
export function shouldOfferIssue(kind?: ParseErrorKind): boolean {
  if (!kind) return true
  return !NO_ISSUE_KINDS.includes(kind)
}

/**
 * 报告正文里**必须由用户填写**的部分是否为空。
 *
 * 应用预填的正文只有「问题描述（= 错误类别文案）+ 脱敏诊断 + 复现步骤占位」，
 * 用户什么都没加时，正文与这个模板完全一致。CI 的 issue 门禁用同一个函数判断
 * 「这条报告是不是空报告」——**界面与 CI 共用一份实现**，避免两边标准漂移。
 */
export const ISSUE_PLACEHOLDER_STEPS = '请补充不含个人信息的复现步骤。'

/**
 * 判断一条 Issue 正文是否只是模板、没有任何用户补充。
 *
 * 判据：剥掉**应用自动生成**的固定片段后，剩下的"用户内容"过短。
 *
 * 关键点：`错误详情` 的代码块**不能**剥掉——那里面是真实的原始报错
 * （`Unsupported URL: https://…`、`Sign in to confirm…`），是这条 Issue
 * 唯一的线索。剥掉它会把 #50 / #52 / #57 这类**有价值的报告**误判成空报告。
 * 而 #58 / #59 那类「一路回车」的报告没有任何代码块，剥完就什么都不剩。
 */
export function isTemplateOnlyReport(body: string): boolean {
  let text = body || ''
  // 应用生成的固定章节标题
  text = text.replace(/^#+\s*(问题描述|脱敏诊断|复现步骤|错误详情|环境信息)\s*$/gm, '')
  // 应用生成的复现步骤占位
  text = text.replace(ISSUE_PLACEHOLDER_STEPS, '')
  // 应用生成的错误类别与版本行
  text = text.replace(/错误类别：[\w-]+/g, '')
  text = text.replace(/^(ytdlp|runtime|操作系统|用户代理)：.*$/gm, '')
  // 应用回显的固定文案（PARSE_MESSAGES 的每一句都是应用自己写的）。
  // 注意：**裸的类别名**（authentication / rate-limit …）也要算模板内容，
  // 否则 `错误类别：authentication` 剥掉前缀后剩下的 `authentication`
  // 会被当成"用户输入"而放行。
  for (const message of Object.values(PARSE_MESSAGES)) {
    text = text.split(message).join('')
  }
  for (const key of Object.keys(PARSE_MESSAGES)) {
    text = text.split(key).join('')
  }
  // 代码块里的原始报错**保留**——那是用户报告的实质内容
  const stripped = text.replace(/[\s`*\-:|]/g, '')
  return stripped.length < 24
}

// ===== 「信息不足」检测（手工提交的 Issue）=====
//
// 上面那个函数只覆盖**应用自动生成**的正文。但用户也可以从 Issues → New issue
// 选模板**手工**提交，然后把每个必填项填成 `dsadsa` / `dadas` / `123` ——
// 模板校验只要求「非空」，于是这样一条 Issue 照样能开出来，正文里没有任何
// 有用信息（实测 #60）。这类必须单独识别，否则它会一直躺在 open 里。

/**
 * 各模板章节标题 + 模板自带的固定选项文本。
 *
 * 剥掉它们之后剩下的，才是「用户真正写的内容」。标题用中英双语，
 * 因为仓库有两套模板（`bug_report.yml` / `bug_report_en.yml`）。
 */
const TEMPLATE_SECTIONS = [
  // 章节标题（中 / 英）
  /^#+\s*(运行平台|DownVid 版本号?|问题类型|问题描述|复现步骤|视频链接.*|期望行为|截图.*|错误日志|提交前确认)\s*$/gm,
  /^#+\s*(Platform|DownVid Version|Issue Category|Issue Description|Steps to Reproduce|Video URL.*|Expected Behavior|Screenshots.*|Error Logs|Before Submitting)\s*$/gm,
]

/** 模板里的固定选项与勾选项，不算用户输入 */
const TEMPLATE_BOILERPLATE = [
  /_No response_/g,
  /^(macOS|Windows|Linux)\b.*$/gm, // 平台下拉的选项文本
  // 提交前确认的**所有**勾选项。此前只匹配「我已 / 我使用 / I have」，
  // 于是 `- [x] I am using the latest version` 漏网，被当成用户内容
  /^\s*-\s*\[[ xX]\]\s*.*$/gm,
]

/**
 * 是否是「模板照抄、没有实质内容」的 Issue。
 *
 * 判据：剥掉模板的标题/固定选项/下拉值后，**用户写的散文**过短，
 * 且正文里没有任何看起来像真实信息的痕迹（链接、版本号、路径、报错、非空代码块）。
 *
 * ## 为什么要按「散文行」而不是总长度
 *
 * 占位垃圾的特征是**短的单 token**：`dadas`、`sdasdas`、`dsadasd`，
 * 以及下拉框的选项值 `Other`。它们拼起来也能凑出几十个字符，
 * 按总长度判断会放行（实测 #60 就是这样漏掉的）。
 * 真实描述则通常是有空格或含中文的句子。
 *
 * 所以：只统计「像散文」的行——含空白、或含中日韩文字、或本身很长。
 *
 * ## 为什么要求「无真实信息痕迹」
 *
 * 一句话的简短报告（「选 1080P 之后一直卡在 0%」）是**有效**的，
 * 不能因为短就关掉。真正该关的是纯填充。有链接 / 版本号 / 报错 / 非空代码块
 * 就说明用户至少提供了线索，一律放行。
 */
export function isInsufficientInfoReport(body: string): boolean {
  let text = body || ''

  for (const re of TEMPLATE_SECTIONS) text = text.replace(re, '')
  for (const re of TEMPLATE_BOILERPLATE) text = text.replace(re, '')

  // 非空的代码块（带内容）= 用户贴了真实报错，直接放行。
  // 空的 ```shell``` 是模板自带，不算。
  if (/```[a-z]*\s*\n\s*\S[\s\S]*?```/.test(text)) return false
  // 去掉代码围栏本身，只留内容（空块就什么都不剩）
  text = text.replace(/```[a-z]*/g, '')

  // 真实信息痕迹
  if (/https?:\/\/\S+/.test(text)) return false
  if (/\b\d+\.\d+(\.\d+)?\b/.test(text)) return false // 版本号
  if (/[/\\][\w.-]+[/\\]/.test(text)) return false // 文件路径
  if (/(ERROR|WARNING|Traceback|HTTP \d{3})/i.test(text)) return false

  // 只统计「像散文」的行
  const prose = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => /\s/.test(l) || /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(l) || l.length >= 12)
    .join('')
  const meaningful = prose.replace(/[\s`*\-:|_#[\]]/g, '')
  return meaningful.length < 10
}

