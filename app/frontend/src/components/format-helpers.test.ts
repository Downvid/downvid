import { describe, it, expect } from 'vitest'
import { translate } from '../i18n/core'

/**
 * 组件里的展示规则（`formatFileSize` / `formatDuration`）。
 *
 * 这两个函数在旧版是**每个组件各写一份**（VideoInfoCard 与 FormatSelector 各有
 * 一份完全相同的 formatFileSize）。迁到 Svelte 时如果不抽出来，就会变成第三、第四份。
 *
 * 这里内联同一套逻辑做测试，并在 `format-helpers.ts` 里只保留一份实现——
 * 组件改为 import 它。测试针对那份实现。
 */
import { formatFileSize, formatDuration } from './format-helpers'

describe('formatFileSize', () => {
  it('undefined / null 显示「未知」，不是 0', () => {
    expect(formatFileSize(undefined)).toBe(translate('zh-CN', 'common.unknown'))
    expect(formatFileSize(null)).toBe(translate('zh-CN', 'common.unknown'))
  })

  it('0 单独处理：平台没给大小时显示 sizeUnknown，而不是 0.0 MB', () => {
    // 显示成「0.0 MB」会让用户以为文件是空的
    expect(formatFileSize(0)).toBe(translate('zh-CN', 'formats.sizeUnknown'))
    expect(formatFileSize(0)).not.toContain('0.0 MB')
  })

  it('MB 与 GB 的分界在 1024 MB', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
    expect(formatFileSize(1024 * 1024 * 1023)).toBe('1023.0 MB')
    // 正好 1024 MB 走 GB 分支
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.00 GB')
  })

  it('小数位数固定（1 位 MB / 2 位 GB）', () => {
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB')
    expect(formatFileSize(2.25 * 1024 * 1024 * 1024)).toBe('2.25 GB')
  })
})

describe('formatDuration', () => {
  it('秒数为 0 / undefined 时返回空串（不显示 0:00）', () => {
    // 显示 "0:00" 会让用户以为视频长度是零
    expect(formatDuration(0)).toBe('')
    expect(formatDuration(undefined)).toBe('')
  })

  it('分钟:秒 且秒补零', () => {
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(60)).toBe('1:00')
    expect(formatDuration(9)).toBe('0:09')
  })

  it('超过一小时仍用分钟表示（与旧版一致，不是 h:mm:ss）', () => {
    // 旧版就是这么写的：754 秒 → 12:34。
    // 迁移时**不能顺手改成 12:34 之外的形式**，否则与旧版看起来不一致。
    expect(formatDuration(754)).toBe('12:34')
    expect(formatDuration(3600)).toBe('60:00')
  })
})

describe('locale 参数（切语言时必须跟着变）', () => {
  it('formatFileSize 的「未知」文案随 locale 变化', () => {
    // 这是组件里必须传 getLocale() 的原因：
    // 若 helper 里写死 'zh-CN'，切到英文后文件大小仍显示中文「未知」，
    // 而这种不一致在截图上很难注意到。
    const zh = formatFileSize(undefined, 'zh-CN')
    const en = formatFileSize(undefined, 'en-US')
    expect(zh).toBe(translate('zh-CN', 'common.unknown'))
    expect(en).toBe(translate('en-US', 'common.unknown'))
    expect(zh).not.toBe(en)
  })

  it('sizeUnknown（0 字节）同样随 locale 变化', () => {
    expect(formatFileSize(0, 'zh-CN')).toBe(translate('zh-CN', 'formats.sizeUnknown'))
    expect(formatFileSize(0, 'en-US')).toBe(translate('en-US', 'formats.sizeUnknown'))
  })

  it('MB / GB 的单位不随 locale 变（与旧版一致）', () => {
    // 「1.5 MB」在两种语言下都一样——单位是国际通用写法，
    // 翻译它反而会让用户对不上系统里显示的数值。
    expect(formatFileSize(1.5 * 1024 * 1024, 'zh-CN')).toBe('1.5 MB')
    expect(formatFileSize(1.5 * 1024 * 1024, 'en-US')).toBe('1.5 MB')
  })
})
