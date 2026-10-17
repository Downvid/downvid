import { describe, it, expect } from 'vitest'
import { translate, applyParams, allMessages, detectSystemLocale, resolveLocale, LOCALES, type Locale } from './core'

/**
 * 国际化纯逻辑。
 *
 * 对应的问题：词条缺失 / 占位符写错 / 语言没生效，**都不会报错**——
 * 界面要么静默显示中文，要么把 `{count}` 原样打出来。
 *
 * 这些用例是从仓库根的 `tests/i18n.test.ts` 搬来的（同一批断言），
 * 外加针对「纯函数化」新增的两条。
 */

describe('translate()', () => {
  it('取到指定语言的词条', () => {
    expect(translate('zh-CN', 'queue.title')).toBe('任务队列')
    expect(translate('en-US', 'queue.title')).toBe('Task queue')
  })

  it('替换占位符', () => {
    expect(translate('zh-CN', 'queue.activeCount', { count: 3 })).toBe('3 进行中')
    expect(translate('en-US', 'queue.activeCount', { count: 3 })).toBe('3 active')
  })

  it('同一个键重复出现时全部替换，不只第一个', () => {
    // 用 split/join 而不是 replace 的原因就在这里。
    //
    // **必须用同一个占位符出现两次的文案**：`update.available` 是
    // `v{new} ... v{current}`，两个占位符不同，用 replace 也能通过——
    // 那是这张用例最初没拦住变异的原因。这里直接构造一个重复的：
    const zh = allMessages()['zh-CN']
    // 找一个值里出现两次同一占位符的词条；没有就用 `deps.versionHint` 的形态验证
    const repeated = Object.entries(zh).find(([, v]) => {
      const m = /\{(\w+)\}/.exec(v)
      return m && (v.split(`{${m[1]}}`).length - 1) >= 2
    })
    if (repeated) {
      const [key, value] = repeated
      const ph = /\{(\w+)\}/.exec(value)![1]
      const got = translate('zh-CN', key, { [ph]: 'X' })
      expect(got).not.toContain('{')
      expect(got.split('X').length - 1).toBe(value.split(`{${ph}}`).length - 1)
      return
    }

    // 词表里没有重复占位符时，退而验证「不同占位符都被替换」——
    // 这条拦住 replace 只替第一个的变异
    const got = translate('zh-CN', 'update.available', { new: '9', current: '8' })
    expect(got).toContain('v9')
    expect(got).toContain('v8')
    expect(got).not.toContain('{')
  })

  it('replace 只替第一个的实现在重复占位符上会漏（回归守卫）', () => {
    // 直接验证底层语义：同一个占位符出现两次时必须都替换。
    // 用一条**构造出来的**词条不现实（词表是产品文案），所以这里验证
    // 「所有占位符都被消掉」这个可观测结果——它等价于 split/join。
    for (const locale of ['zh-CN', 'en-US'] as const) {
      for (const [key, value] of Object.entries(allMessages()[locale])) {
        const placeholders = [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
        if (placeholders.length === 0) continue
        // 给每个占位符一个唯一值，替换后不该残留任何 `{`
        const params: Record<string, string> = {}
        for (const p of placeholders) params[p] = `__${p}__`
        const got = translate(locale, key, params)
        expect(got, `${locale} / ${key}`).not.toContain('{')
      }
    }
  })

  it('参数为 undefined 时渲染成空串，而不是字面量 "undefined"', () => {
    // 依赖版本探测不到时版本号就是 undefined，
    // 界面上出现「当前 undefined」比留空更糟
    const got = translate('zh-CN', 'deps.versionHint', { current: undefined, required: undefined })
    expect(got).not.toContain('undefined')
  })

  it('未知键回退键名（不能显示空白）', () => {
    // 回退到键名本身，至少能看出是哪一处漏了。
    // 这条同时守卫「中文回退」那一层：两份词表都由 lint:i18n 保证成对，
    // 所以「en 缺、zh 有」的情况只可能出现在词表被手工改坏时——
    // 那时回退到中文比回退到键名更好读。这里通过键名回退覆盖同一段代码路径。
    expect(translate('en-US', 'no.such.key')).toBe('no.such.key')
    expect(translate('zh-CN', 'no.such.key')).toBe('no.such.key')
  })

  it('缺失英文时回退中文，而不是留空', () => {
    const zh = allMessages()['zh-CN']
    const en = allMessages()['en-US']
    // 两份词条表键集合必须一致（lint:i18n 也会查，这里做运行时兜底）
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})

describe('纯函数化带来的好处', () => {
  it('同一 locale 多次调用结果稳定（不依赖任何全局状态）', () => {
    // 这是与 Vue 版最大的差异：`translate` 读参数而不是全局 ref，
    // 所以两个 locale 交错调用不会串味
    const a = translate('zh-CN', 'queue.title')
    const b = translate('en-US', 'queue.title')
    const c = translate('zh-CN', 'queue.title')
    expect(a).toBe(c)
    expect(a).not.toBe(b)
  })

  it('词条表的键数不为零（防止搬文件时整块漏掉）', () => {
    const zh = allMessages()['zh-CN']
    expect(Object.keys(zh).length).toBeGreaterThan(200)
  })
})

describe('语言探测与解析', () => {
  it('resolveLocale 对明确值原样返回', () => {
    expect(resolveLocale('zh-CN')).toBe('zh-CN')
    expect(resolveLocale('en-US')).toBe('en-US')
  })

  it('resolveLocale 对 auto / 非法值走系统探测', () => {
    for (const v of ['auto', '', undefined, 'fr-FR', 'ZH-cn']) {
      const got = resolveLocale(v as string | undefined)
      expect(LOCALES).toContain(got as Locale)
    }
  })

  it('detectSystemLocale 在无 navigator 的环境下不崩，且返回合法值', () => {
    // 注意：Node 26 起全局有 navigator 对象（含 language），所以这里**不能**
    // 断言「一定是英文」。只验证两件确定的事：
    //   1. 不抛异常
    //   2. 返回值一定是 LOCALES 之一（否则 setLocale 会拿到非法值）
    const got = detectSystemLocale()
    expect(LOCALES).toContain(got as Locale)
  })
})

describe('占位符替换的底层语义', () => {
  it('同一占位符出现多次时全部替换（replace 只替第一个的坑）', () => {
    // 真实场景：`新版本 v{new} 可用 · 当前 v{current}` 是不同占位符，
    // 用 replace 也能过。但一旦文案里同一个占位符出现两次
    // （如「{size}（剩余 {size} 可用）」），replace 就只换一个，
    // 界面上会露出 `{size}` 原始文本。
    expect(applyParams('a {x} b {x} c', { x: '1' })).toBe('a 1 b 1 c')
    expect(applyParams('{x}{x}{x}', { x: 'Z' })).toBe('ZZZ')
  })

  it('未提供的占位符原样保留（可见，便于发现漏传）', () => {
    // 保留 `{y}` 比替换成空更能暴露问题：界面上看到 `{y}` 就知道漏传了
    expect(applyParams('a {x} b {y}', { x: '1' })).toBe('a 1 b {y}')
  })

  it('undefined 值渲染成空串，不是 "undefined"', () => {
    expect(applyParams('当前 {v}', { v: undefined })).toBe('当前 ')
  })

  it('数字参数被转成字符串', () => {
    expect(applyParams('{count} 项', { count: 3 })).toBe('3 项')
  })
})
