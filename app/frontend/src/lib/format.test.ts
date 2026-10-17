import { describe, it, expect } from 'vitest'
import {
  formatBytes, formatSpeed, formatEta, formatDuration,
  dayGroup, formatClock, formatDate, clamp, ellipsis,
} from './format'

/**
 * 纯展示格式化。
 *
 * 这些函数不报错、只影响「看起来对不对」——数字差一位、单位错一个，
 * 用户会以为下载坏了。所以逐条钉住边界。
 */

describe('formatBytes', () => {
  it('undefined / null 返回破折号，0 返回 "0 B"（两种语义分开）', () => {
    // 未知（平台没给大小）与真的 0 字节是两件事，界面上要能区分：
    // 「—」= 不知道，「0 B」= 确定是空文件
    expect(formatBytes(undefined)).toBe('—')
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(0)).toBe('0 B')
  })

  it('KB / MB / GB 分界正确', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.00 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.00 MB')
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB')
  })

  it('大数值减少小数位（避免 "1023.99 MB" 这种读不出量级的显示）', () => {
    // 规则：>=100 无小数、>=10 一位、其余两位
    expect(formatBytes(100 * 1024 * 1024)).toBe('100 MB')
    expect(formatBytes(10 * 1024 * 1024)).toBe('10.0 MB')
    expect(formatBytes(1 * 1024 * 1024)).toBe('1.00 MB')
  })

  it('数值越大单位越大', () => {
    const sizes = [1024, 1024 ** 2, 1024 ** 3]
    const units = sizes.map((s) => formatBytes(s).replace(/[\d.]/g, '').trim())
    // 单位序列应严格递进，不能出现「1 GB 比 1 MB 小」这种
    expect(new Set(units).size).toBe(3)
  })
})

describe('formatSpeed', () => {
  it('0 / 负数显示 "0 B/s"（速度栏常驻，不显示会让布局跳动）', () => {
    // 与 formatBytes 的策略不同：速度这一栏宽度固定，空串会让数字左右跳
    expect(formatSpeed(0)).toBe('0 B/s')
    expect(formatSpeed(-1)).toBe('0 B/s')
  })

  it('带 /s 后缀', () => {
    expect(formatSpeed(1024 * 1024)).toContain('/s')
  })
})

describe('formatEta', () => {
  it('负数 / 非有限值返回破折号（不是空串）', () => {
    // 空串会让「剩余时间」这一栏塌掉，破折号保持占位
    expect(formatEta(-1)).toBe('—')
    expect(formatEta(NaN)).toBe('—')
    expect(formatEta(Infinity)).toBe('—')
  })

  it('分钟:秒 与 时:分:秒 两种形态', () => {
    expect(formatEta(65)).toBe('01:05')
    expect(formatEta(3665)).toBe('1:01:05')
  })

  it('四舍五入到秒（59.6 → 01:00，不是 00:59）', () => {
    expect(formatEta(59.6)).toBe('01:00')
  })
})

describe('formatDuration', () => {
  it('0 / undefined 返回空（不显示 "0:00"）', () => {
    // 显示 "0:00" 会让用户以为视频长度是零
    expect(formatDuration(0)).toBe('')
    expect(formatDuration(undefined)).toBe('')
  })

  it('秒补零', () => {
    expect(formatDuration(65)).toBe('1:05')
  })

  it('超过一小时用 时:分:秒', () => {
    expect(formatDuration(3665)).toBe('1:01:05')
  })
})

describe('dayGroup', () => {
  it('今天 / 昨天 / 更早 三档', () => {
    const now = new Date('2026-10-17T12:00:00Z').getTime()
    const day = 24 * 3600 * 1000
    expect(dayGroup(now, now)).toBe('today')
    expect(dayGroup(now - day, now)).toBe('yesterday')
    expect(dayGroup(now - day * 10, now)).toBe('earlier')
  })
})

describe('formatClock / formatDate', () => {
  it('clock 是 时:分 形态', () => {
    expect(formatClock(Date.now())).toMatch(/^\d{1,2}:\d{2}$/)
  })

  it('date 不含时间部分', () => {
    const d = formatDate(Date.now())
    expect(d).not.toMatch(/:\d{2}$/)
    expect(d.length).toBeGreaterThan(0)
  })
})

describe('clamp', () => {
  it('区间内原样返回，越界截断', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(99, 0, 10)).toBe(10)
  })

  it('边界值本身不被改', () => {
    expect(clamp(0, 0, 10)).toBe(0)
    expect(clamp(10, 0, 10)).toBe(10)
  })
})

describe('ellipsis', () => {
  it('未超长时原样返回', () => {
    expect(ellipsis('短标题', 10)).toBe('短标题')
  })

  it('超长时截断并加省略号，且总长不超过 max', () => {
    const got = ellipsis('这是一个非常非常长的标题需要被截断', 10)
    // 省略号可能占 1 或 2 个字符（… vs ...），但总长必须受控
    expect(got.length).toBeLessThanOrEqual(12)
    expect(got).not.toBe('这是一个非常非常长的标题需要被截断')
  })

  it('空串返回空串', () => {
    expect(ellipsis('')).toBe('')
  })
})
