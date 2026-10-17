import { describe, it, expect } from 'vitest'
import { parseInline, reflowMarkdown } from './markdown'

/**
 * CHANGELOG 的内联 Markdown 渲染。
 *
 * 这组用例来自一个真实的界面问题：更新日志整段以字面量
 * `**关于页新增官网入口**` 显示，粗体星号、反引号、链接语法全部裸露。
 * 而 CHANGELOG 是**产品文案的一部分**——用户点开「关于 → 更新日志」
 * 就是为了读它。
 */

describe('parseInline', () => {
  it('粗体：星号不进正文', () => {
    const tokens = parseInline('**重点**：后面的话')
    expect(tokens[0]).toEqual({ kind: 'strong', text: '重点' })
    expect(tokens[1]).toEqual({ kind: 'text', text: '：后面的话' })
  })

  it('行内代码：反引号不进正文', () => {
    const tokens = parseInline('见 `shared/app.ts` 的常量')
    expect(tokens[1]).toEqual({ kind: 'code', text: 'shared/app.ts' })
  })

  it('链接：文字与 href 都取出来', () => {
    const tokens = parseInline('见[代码来源审计](docs/provenance/audit.md)。')
    expect(tokens[1]).toEqual({
      kind: 'link',
      text: '代码来源审计',
      href: 'docs/provenance/audit.md',
    })
  })

  it('http(s) 链接保留', () => {
    const tokens = parseInline('[官网](https://downvid-coral.vercel.app)')
    expect(tokens[0]).toEqual({
      kind: 'link',
      text: '官网',
      href: 'https://downvid-coral.vercel.app',
    })
  })

  it('javascript: 链接降级成纯文本（不能成为注入点）', () => {
    const tokens = parseInline('[点我](javascript:alert(1))')
    expect(tokens.every((t) => t.kind !== 'link')).toBe(true)
    // 整段原样当文本，不能只留 label —— 那会让用户以为链接被"吃掉了"
    expect(tokens.map((t) => t.text).join('')).toBe('[点我](javascript:alert(1))')
  })

  it('data: / file: 同样被拦', () => {
    for (const bad of ['data:text/html,x', 'file:///etc/passwd']) {
      const tokens = parseInline(`[x](${bad})`)
      expect(tokens.every((t) => t.kind !== 'link')).toBe(true)
    }
  })

  it('未闭合的标记原样保留（不让半个 ** 吞掉后文）', () => {
    expect(parseInline('这里有 **没闭合')).toEqual([{ kind: 'text', text: '这里有 **没闭合' }])
    expect(parseInline('这里有 `没闭合')).toEqual([{ kind: 'text', text: '这里有 `没闭合' }])
  })

  it('混合：一段里同时有三种语法', () => {
    const tokens = parseInline('**粗** 与 `代码` 与 [链接](https://x.test)')
    expect(tokens.map((t) => t.kind)).toEqual(['strong', 'text', 'code', 'text', 'link'])
  })

  it('纯文本原样返回', () => {
    expect(parseInline('没有任何标记')).toEqual([{ kind: 'text', text: '没有任何标记' }])
  })

  it('空串返回空数组', () => {
    expect(parseInline('')).toEqual([])
  })
})

describe('reflowMarkdown', () => {
  it('中文硬换行不留空格', () => {
    // CHANGELOG 里每条都按 80 列硬换行，直接渲染会在句中多出空格
    const got = reflowMarkdown('关于页原来只有 GitHub 与「问题反馈」两个入口，\n想找官网或谈合作只能去翻 README。')
    expect(got).toBe('关于页原来只有 GitHub 与「问题反馈」两个入口，想找官网或谈合作只能去翻 README。')
  })

  it('英文之间保留一个空格', () => {
    const got = reflowMarkdown('this is\none sentence')
    expect(got).toBe('this is one sentence')
  })

  it('去掉行首缩进（CHANGELOG 续行是两个空格缩进）', () => {
    expect(reflowMarkdown('  第一行\n  第二行')).toBe('第一行第二行')
  })

  it('空行被丢弃（不产生多余空格）', () => {
    // 英文之间该有一个空格，但**不能因为空行变成两个**
    expect(reflowMarkdown('a\n\n\nb')).toBe('a b')
  })

  it('单行原样返回', () => {
    expect(reflowMarkdown('只有一行')).toBe('只有一行')
  })
})
