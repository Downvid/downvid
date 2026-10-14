import { describe, it, expect } from 'vitest'
import { extractUserNotes } from '../src/composables/useUpdater'

/**
 * Release 正文裁剪。
 *
 * 发布页的正文顶部是"点徽章即下载"引导区（下载徽章 + 平台对照表 + 注意事项），
 * 那是给"来下载的人"看的。应用内的更新弹窗里用户已经装好了应用，只想看改了什么，
 * 徽章与对照表是噪音，且徽章会渲染成一堆图片链接。
 *
 * 这里用真实的生成结构做输入，而不是编造的简化版。
 */
const GENERATED_NOTES = `<!-- 此正文由 scripts/gen-release-notes.mjs 生成，请勿手动编辑 -->
<div align="center">

### ⬇️ 点击徽章直接下载

[![Windows](https://img.shields.io/static/v1?label=Windows)](https://github.com/yxxbc/downvid/releases/download/v1.3.0/DownVid-Setup-1.3.0.exe)
[![macOS](https://img.shields.io/static/v1?label=macOS)](https://github.com/yxxbc/downvid/releases/download/v1.3.0/DownVid-arm64-Mac-1.3.0.dmg)

</div>

---

## 📦 下载对照表

| 平台 | 架构 | 安装包 |
|------|------|--------|
| Windows | x64 | [安装版 \`.exe\`](https://github.com/yxxbc/downvid/releases/download/v1.3.0/DownVid-Setup-1.3.0.exe) |

### ⚠️ 各平台注意事项

- **Windows**：便携版不支持自动更新

---

## 📝 更新内容

> **升级提示**：本版起安装包不再内置 yt-dlp 与 ffmpeg。

### 新增

- **运行依赖管理**：显示每个依赖的版本与来源

### 修复

- **macOS 上 Logo 不显示**

---

<sub>完整历史见 [CHANGELOG.md](https://github.com/yxxbc/downvid/blob/main/CHANGELOG.md)</sub>`

describe('extractUserNotes', () => {
  it('裁掉下载引导区，只留更新内容', () => {
    const notes = extractUserNotes(GENERATED_NOTES)
    expect(notes).toContain('升级提示')
    expect(notes).toContain('运行依赖管理')
    expect(notes).toContain('macOS 上 Logo 不显示')
  })

  it('不含徽章、对照表与平台注意事项', () => {
    const notes = extractUserNotes(GENERATED_NOTES)
    expect(notes).not.toContain('点击徽章直接下载')
    expect(notes).not.toContain('img.shields.io')
    expect(notes).not.toContain('下载对照表')
    expect(notes).not.toContain('各平台注意事项')
    expect(notes).not.toContain('DownVid-Setup-1.3.0.exe')
  })

  it('不含页脚导航小字', () => {
    const notes = extractUserNotes(GENERATED_NOTES)
    expect(notes).not.toContain('完整历史见')
    expect(notes).not.toContain('<sub>')
  })

  it('裁剪结果不含任何十六进制颜色与图片链接（弹窗里渲染不了）', () => {
    const notes = extractUserNotes(GENERATED_NOTES)
    expect(notes).not.toMatch(/!\[/)          // Markdown 图片
    expect(notes).not.toMatch(/<div|<img/)    // 原始 HTML 容器
  })

  it('手工写的 Release（没有分节标题）也要渲染成 HTML', () => {
    const manual = '## v1.3.0\n\n- 修复了一个问题\n- 新增了一个功能'
    const html = extractUserNotes(manual)
    // 关键：不再是原样的 Markdown（那样在 v-html 里会显示成一坨纯文本）
    expect(html).toContain('<h2')
    expect(html).toContain('<li>修复了一个问题</li>')
    expect(html).not.toContain('## v1.3.0')
  })

  it('空输入返回空串，不抛错', () => {
    expect(extractUserNotes('')).toBe('')
  })

  it('只有分节标题没有正文时返回空串（而不是残留的标题）', () => {
    expect(extractUserNotes('## 📝 更新内容\n\n')).toBe('')
  })

  it('兼容没有 emoji 的写法', () => {
    const notes = extractUserNotes('## 更新内容\n\n- 修好了')
    expect(notes).toContain('<li>修好了</li>')
  })

  it('Markdown 被渲染成 HTML（回归点：此前 v-html 直接显示原文）', () => {
    const html = extractUserNotes(GENERATED_NOTES)
    // 标题、列表、粗体、行内代码都要变成标签
    expect(html).toContain('<h3')
    expect(html).toContain('<li>')
    expect(html).toContain('<strong>')
    // 不能残留 Markdown 语法
    expect(html).not.toContain('### ')
    expect(html).not.toContain('**升级提示**')
  })

  it('行内代码被渲染（CHANGELOG 里常用来写文件名/命令）', () => {
    const html = extractUserNotes('## 更新内容\n\n- 修复 \`electron/updater.ts\` 的问题')
    expect(html).toContain('<code>electron/updater.ts</code>')
  })

  it('引用块（> 开头）被渲染', () => {
    const html = extractUserNotes(GENERATED_NOTES)
    expect(html).toContain('<blockquote>')
  })
})

/**
 * 回归：CHANGELOG 的条目按 ~80 字符手工折行，渲染时**不能**把折行当成硬换行。
 *
 * 曾经用 `marked` 的 `breaks: true`，它会在每个换行处插入 `<br>`，
 * 于是一段完整的话被切成好几行（实测：更新弹窗里每行都断得很碎）。
 */
describe('软换行不应变成硬换行', () => {
  it('条目内的折行被合并，不产生 <br>', () => {
    const notes = [
      '## 更新内容',
      '',
      '- **某修复**：第一段说明文字，',
      '  第二行是同一句话的延续，',
      '  第三行也是。',
    ].join('\n')
    const html = extractUserNotes(notes)
    expect(html).not.toContain('<br>')
    // 三行应合成一个 li
    expect(html.match(/<li>/g)?.length).toBe(1)
  })

  it('列表项的 markdown 结构仍然正确（多条目各占一行）', () => {
    const notes = ['## 更新内容', '', '- 第一条', '- 第二条', '- 第三条'].join('\n')
    const html = extractUserNotes(notes)
    expect(html.match(/<li>/g)?.length).toBe(3)
  })
})
