import { describe, it, expect } from 'vitest'
import { applyQualityDisambiguation } from './filename'

/**
 * 文件名模板的清晰度消歧。
 *
 * 两个真实故障驱动了这组用例：
 *   1. 同一视频下过 1080P 后再下 4K，文件名相同 → yt-dlp 跳过并报成功，
 *      用户拿到的是旧文件。
 *   2. 纯音频/直链没有 height，`%(height)s` 渲染成 `NA` →
 *      产物名成了 `标题 [NAp].mp4`。
 */

describe('applyQualityDisambiguation', () => {
  it('默认模板 + 有高度 → 在扩展名前插入 [1080p]', () => {
    expect(applyQualityDisambiguation('%(title)s.%(ext)s', 1080)).toBe(
      '%(title)s [1080p].%(ext)s',
    )
  })

  it('没有高度 → 原样返回（否则会得到 [NAp]）', () => {
    const tpl = '%(title)s.%(ext)s'
    expect(applyQualityDisambiguation(tpl, undefined)).toBe(tpl)
    expect(applyQualityDisambiguation(tpl, 0)).toBe(tpl)
    expect(applyQualityDisambiguation(tpl, NaN)).toBe(tpl)
  })

  it('模板已含清晰度字段 → 尊重用户写法，不追加', () => {
    for (const tpl of [
      '%(title)s-%(height)sp.%(ext)s',
      '%(title)s-%(resolution)s.%(ext)s',
      '%(title)s-%(format_id)s.%(ext)s',
    ]) {
      expect(applyQualityDisambiguation(tpl, 1080)).toBe(tpl)
    }
  })

  it('模板没写扩展名 → 后缀加在末尾（与后端补 .%(ext)s 的规则一致）', () => {
    expect(applyQualityDisambiguation('%(title)s', 720)).toBe('%(title)s [720p]')
  })

  it('空模板退回默认值再加后缀', () => {
    expect(applyQualityDisambiguation('', 480)).toBe('%(title)s [480p].%(ext)s')
    expect(applyQualityDisambiguation('   ', 480)).toBe('%(title)s [480p].%(ext)s')
  })

  it('高度取整（29.97fps 那类浮点不该漏进文件名）', () => {
    expect(applyQualityDisambiguation('%(title)s.%(ext)s', 1079.6)).toBe(
      '%(title)s [1080p].%(ext)s',
    )
  })

  it('不同清晰度算出不同文件名——这是本函数存在的唯一理由', () => {
    const tpl = '%(title)s.%(ext)s'
    expect(applyQualityDisambiguation(tpl, 1080)).not.toBe(
      applyQualityDisambiguation(tpl, 2160),
    )
  })
})
