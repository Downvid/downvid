import { describe, it, expect, beforeEach } from 'vitest'
import { t, setLocale, resolveLocale, detectSystemLocale, allMessages } from '../src/i18n'
import { translateMainMessage } from '../src/i18n/main-messages'

/**
 * 界面国际化核心。
 *
 * 对应的问题：词条缺失 / 占位符写错 / 语言没生效，**都不会报错**——
 * 界面要么静默显示中文，要么把 `{count}` 原样打出来。
 */
describe('t()', () => {
  beforeEach(() => setLocale('zh-CN'))

  it('取到当前语言的词条', () => {
    expect(t('queue.title')).toBe('任务队列')
    setLocale('en-US')
    expect(t('queue.title')).toBe('Task queue')
  })

  it('替换占位符', () => {
    expect(t('queue.activeCount', { count: 3 })).toBe('3 进行中')
    setLocale('en-US')
    expect(t('queue.activeCount', { count: 3 })).toBe('3 active')
  })

  it('同一个键重复出现时全部替换，不只第一个', () => {
    // 手工造一个重复占位符的词条：用 split/join 而不是 replace 的原因就在这里
    setLocale('zh-CN')
    expect(t('update.available', { new: '9', current: '9' })).toContain('v9')
    expect(t('update.available', { new: '9', current: '9' })).not.toContain('{')
  })

  it('参数为 undefined 时渲染成空串，而不是字面量 "undefined"', () => {
    // 依赖版本探测不到时版本号就是 undefined，界面上出现 "当前 undefined" 比留空更糟
    expect(t('deps.versionHint', { current: undefined, required: undefined })).not.toContain('undefined')
  })

  it('未知键回退中文，再回退键名（不能显示空白）', () => {
    setLocale('en-US')
    // 不存在的键：回退到键名本身，至少能看出是哪一处漏了
    expect(t('no.such.key')).toBe('no.such.key')
  })

  it('缺失英文时回退中文，而不是留空', () => {
    const zh = allMessages()['zh-CN']
    const en = allMessages()['en-US']
    // 断言两份词条表键集合一致（lint:i18n 也会查，这里做运行时兜底）
    expect([...Object.keys(en)].sort()).toEqual([...Object.keys(zh)].sort())
  })
})

describe('语言解析', () => {
  it('明确的 locale 直接采用', () => {
    expect(resolveLocale('zh-CN')).toBe('zh-CN')
    expect(resolveLocale('en-US')).toBe('en-US')
  })

  it('auto / 非法值都走系统探测', () => {
    // 非法值（存档被改坏、来自未来版本）不能变成「没有语言」
    expect(['zh-CN', 'en-US']).toContain(resolveLocale('auto'))
    expect(['zh-CN', 'en-US']).toContain(resolveLocale(undefined))
    expect(['zh-CN', 'en-US']).toContain(resolveLocale('klingon'))
  })

  it('系统语言探测只认中英，其余回退英文', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    const set = (langs: string[]) => {
      Object.defineProperty(globalThis, 'navigator', {
        value: { languages: langs, language: langs[0] },
        configurable: true,
      })
    }
    try {
      set(['zh-CN', 'zh'])
      expect(detectSystemLocale()).toBe('zh-CN')
      set(['en-GB'])
      expect(detectSystemLocale()).toBe('en-US')
      // 德语用户看到英文界面可以接受，看到纯中文不行
      set(['de-DE'])
      expect(detectSystemLocale()).toBe('en-US')
    } finally {
      if (original) Object.defineProperty(globalThis, 'navigator', original)
      else delete (globalThis as any).navigator
    }
  })
})

describe('主进程文案的兜底翻译', () => {
  beforeEach(() => setLocale('en-US'))

  it('翻译已知的整句文案', () => {
    expect(translateMainMessage('未找到可用的 yt-dlp')).not.toContain('未找到')
  })

  it('翻译带参数的模板（保留依赖名）', () => {
    const out = translateMainMessage('未找到可用的 ffmpeg，请在「设置 → 运行依赖」中下载后重试')
    expect(out).toContain('ffmpeg')
    expect(out).not.toContain('未找到')
  })

  it('认不出来的文案原样透传，不吞掉信息', () => {
    // 宁可显示中文，也不能显示空白或键名——那会让用户以为界面坏了
    const raw = 'ERROR: 某个我们还没归类的新错误'
    expect(translateMainMessage(raw)).toBe(raw)
  })

  it('空输入不抛错', () => {
    expect(translateMainMessage('')).toBe('')
  })
})
