/**
 * 把 CHANGELOG 里的**内联 Markdown** 转成可安全渲染的片段。
 *
 * ## 为什么不用 markdown 库
 *
 * CHANGELOG 里实际只用到三种语法（对 1.0.0 ~ 1.4.0 全量统计）：
 *
 * | 语法 | 出现次数 |
 * | --- | --- |
 * | `**粗体**` | 149 |
 * | `` `行内代码` `` | 245 |
 * | `[文字](链接)` | 15 |
 *
 * 标题与列表项已经在 Go 侧解析成结构了（`changelog.Entry.sections`），
 * 所以这里只需要处理**行内**。为一个只有三种语法的场景引一个
 * 30KB 的 markdown 解析器（还要额外引 sanitizer，见下）不划算——
 * 与「不引 ESLint / Prettier」同一套理由。
 *
 * ## 为什么返回 token 而不是 HTML 字符串
 *
 * 直接 `{@html}` 拼 HTML 是最省事的做法，但 CHANGELOG 是**可被编辑的文本**，
 * 里面出现 `<script>` 或 `<img onerror=...>` 时就是一个注入点。
 * 返回结构化的 token 后由 Svelte 渲染，所有文本都会自动转义——
 * 不需要额外的 sanitizer，也就不会有「sanitizer 配置写漏一条」这类问题。
 *
 * 链接的 href 单独做协议白名单：`javascript:` 必须被拦掉。
 */

/** 一个行内片段 */
export type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'code'; text: string }
  /** href 为空表示链接协议不合法，调用方应降级成纯文本 */
  | { kind: 'link'; text: string; href: string }

/**
 * 链接只允许 http(s) 与仓库内的相对路径。
 *
 * 拦掉 `javascript:` / `data:` / `file:`：CHANGELOG 里的链接会被内嵌进应用，
 * 一个被改坏的 CHANGELOG 不该变成「点击执行代码」的入口。
 */
function isSafeHref(href: string): boolean {
  const trimmed = href.trim()
  if (!trimmed) return false
  // 相对路径（仓库内文档）：不含冒号，或显式 ./ ../
  if (!trimmed.includes(':')) return true
  return /^https?:\/\//i.test(trimmed)
}

/**
 * 解析一段内联 Markdown。
 *
 * 一次扫描、不回溯：`**` / `` ` `` / `[` 三种标记互不嵌套处理
 * （CHANGELOG 里没有嵌套，强行支持只会引入难查的边界 bug）。
 */
export function parseInline(input: string): InlineToken[] {
  const tokens: InlineToken[] = []
  let text = ''

  const flushText = () => {
    if (text) {
      tokens.push({ kind: 'text', text })
      text = ''
    }
  }

  let i = 0
  while (i < input.length) {
    const rest = input.slice(i)

    // **粗体**
    if (rest.startsWith('**')) {
      const end = rest.indexOf('**', 2)
      if (end > 2) {
        flushText()
        tokens.push({ kind: 'strong', text: rest.slice(2, end) })
        i += end + 2
        continue
      }
    }

    // `行内代码`
    if (rest.startsWith('`')) {
      const end = rest.indexOf('`', 1)
      if (end > 1) {
        flushText()
        tokens.push({ kind: 'code', text: rest.slice(1, end) })
        i += end + 1
        continue
      }
    }

    // [文字](链接)
    if (rest.startsWith('[')) {
      const closeBracket = rest.indexOf('](')
      if (closeBracket > 0) {
        const closeParen = rest.indexOf(')', closeBracket + 2)
        if (closeParen > closeBracket + 2) {
          const label = rest.slice(1, closeBracket)
          const href = rest.slice(closeBracket + 2, closeParen)
          flushText()
          tokens.push(
            isSafeHref(href)
              ? { kind: 'link', text: label, href: href.trim() }
              : // 协议不合法：把整段原样当文本（不显示成可点链接）
                { kind: 'text', text: rest.slice(0, closeParen + 1) },
          )
          i += closeParen + 1
          continue
        }
      }
    }

    text += input[i]
    i += 1
  }

  flushText()
  return tokens
}

/**
 * 把一条 CHANGELOG 条目规整成**单行**。
 *
 * CHANGELOG 里的长条目是硬换行的（每行 80 列左右），直接渲染会在句中
 * 断开——真实见到的问题：一条里第一行结尾是「关于页原来只有 GitHub 与…」，
 * 第二行以「想找官网或谈合作…」开头，中间多出一个空格与断行。
 *
 * 中文之间不该有空格，英文之间保留一个。这个函数就是干这个的。
 */
export function reflowMarkdown(input: string): string {
  return input
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .reduce((acc, line) => {
      if (!acc) return line
      // 中↔中 直接相接；其它情况补一个空格
      const lastChar = acc.slice(-1)
      const firstChar = line.slice(0, 1)
      const cjk = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/
      const glue = cjk.test(lastChar) && cjk.test(firstChar) ? '' : ' '
      return acc + glue + line
    }, '')
}

/**
 * 取出一条 CHANGELOG 条目的「摘要」——也就是它开头那句加粗的标题。
 *
 * ## 为什么需要它
 *
 * CHANGELOG 的每一条都是「**一句话标题**：然后是 8~10 行展开说明」。
 * 在「关于」页里全部铺开时，**3 条就占满一整屏**（真机截图确认过），
 * 用户得滑很久才看到下面的内容。
 *
 * 而用户扫列表时真正需要的是那**一句标题**——展开说明只在想深究时才有用。
 *
 * 返回 `{ summary, detail }`：
 *   - `summary` 是标题部分（原样，未解析；调用方自己 parseInline）
 *   - `detail` 是剩下的展开说明；为空表示这条本来就只有一句话
 */
export function splitSummary(item: string): { summary: string; detail: string } {
  const line = reflowMarkdown(item)

  // 首选：以 `**加粗**` 开头的条目，标题就是那段加粗内容
  const bold = line.match(/^\*\*([^*]+)\*\*/)
  if (bold) {
    const summary = bold[1]
    // 去掉紧随其后的中英文冒号（`**标题**：展开` 与 `**标题**: 展开`）
    const rest = line.slice(bold[0].length).replace(/^\s*[:：]\s*/, '')
    return { summary, detail: rest }
  }

  // 没有加粗标题：退回到第一句（中文句号 / 英文句点 / 分号）
  const sentence = line.match(/^[^。；;.]*[。；;.]?/)
  const summary = (sentence?.[0] ?? line).trim()
  const detail = line.slice(summary.length).trim()
  return { summary, detail }
}

/**
 * 从 GitHub / Gitee 的 Release Notes（由 scripts/gen-release-notes.mjs 生成）
 * 中截取真正的「更新内容」条目列表，剔除徽章、表格、HTML、Docker 命令及脚本文本。
 */
export function extractChangelogFromReleaseNotes(text: string): string[] {
  let content = text.trim()
  if (!content) return []

  // 1. 如果包含「更新内容」或「Changelog」标头，优先截取该段落
  const headerMatch = content.match(
    /##\s*(?:📝\s*)?(?:更新内容|更新说明|变更日志|Changelog|Release Notes|\[[\d.]+\])[^\n]*/i,
  )
  if (headerMatch && headerMatch.index !== undefined) {
    const afterHeader = content.slice(headerMatch.index + headerMatch[0].length)
    const endMatch = afterHeader.match(/\n(##\s+[^\n]+|---|\n\s*<sub>)/)
    content = endMatch && endMatch.index !== undefined ? afterHeader.slice(0, endMatch.index) : afterHeader
  }

  // 2. 逐行提取列表条目（跳过 HTML、表格、代码块、脚本注释、徽章）
  const lines = content.split('\n')
  const items: string[] = []
  let inCodeBlock = false

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock) continue

    // 过滤掉脚本生成的模板元素、HTML、表格、注释、徽章、分割线
    if (
      trimmed.startsWith('<!--') ||
      trimmed.startsWith('<div') ||
      trimmed.startsWith('</div') ||
      trimmed.startsWith('<sub') ||
      trimmed.startsWith('</sub') ||
      trimmed.startsWith('![') ||
      trimmed.startsWith('[![') ||
      trimmed.startsWith('|') ||
      trimmed.startsWith('---') ||
      trimmed.startsWith('***') ||
      trimmed.startsWith('docker ') ||
      trimmed.startsWith('curl ') ||
      trimmed.includes('scripts/gen-release-notes') ||
      trimmed.includes('下载对照表') ||
      trimmed.includes('点击徽章直接下载')
    ) {
      continue
    }

    // 提取列表项
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      items.push(trimmed.slice(2).trim())
    } else if (/^\d+\.\s+/.test(trimmed)) {
      items.push(trimmed.replace(/^\d+\.\s+/, '').trim())
    } else if (!trimmed.startsWith('#')) {
      items.push(trimmed)
    }
  }

  return items
}
