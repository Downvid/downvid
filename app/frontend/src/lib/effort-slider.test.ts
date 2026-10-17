import { describe, it, expect } from 'vitest'
import { CONNECTION_STOPS, nearestConnectionStop } from './mock'

/**
 * 加速滑块的**值域契约**。
 *
 * 滑块本身用 `bits-ui` 的 `Slider.Root`（交互、键盘、无障碍由库保证，
 * 不重复测）。这里钉住的是**适配层**：索引 ↔ 连接数的映射。
 *
 * 这层错了不会报错——只是「滑到第三档，实际并发是 8」，用户完全看不出，
 * 只会觉得「加速没效果」。
 */

/** 与组件里一致：索引 = 最接近的档位下标 */
function indexOf(value: number): number {
  return Math.max(0, CONNECTION_STOPS.indexOf(nearestConnectionStop(value)))
}

/** 与组件里一致：bits-ui 的滑块值就是索引 */
function valueOf(index: number): number {
  return CONNECTION_STOPS[Math.max(0, Math.min(CONNECTION_STOPS.length - 1, index))]
}

describe('档位定义', () => {
  it('四档，递增，且都是正整数', () => {
    expect(CONNECTION_STOPS).toEqual([4, 8, 12, 16])
    for (const stop of CONNECTION_STOPS) {
      expect(Number.isInteger(stop)).toBe(true)
      expect(stop).toBeGreaterThan(0)
    }
  })

  it('档位数量决定了滑块的范围（bits-ui 的 max = 长度 - 1）', () => {
    // 若有人加了一档却没改 max，滑块会「滑不到最后一档」
    expect(CONNECTION_STOPS.length - 1).toBe(3)
  })
})

describe('索引 ↔ 连接数', () => {
  it('每个合法档位都能来回映射', () => {
    for (let i = 0; i < CONNECTION_STOPS.length; i++) {
      expect(indexOf(valueOf(i))).toBe(i)
    }
  })

  it('任意值吸附到最近的档位', () => {
    // 用户在设置里手填了非档位值（旧版本可能是任意 1..16）
    expect(valueOf(indexOf(1))).toBe(4)
    expect(valueOf(indexOf(11))).toBe(12)
    expect(valueOf(indexOf(99))).toBe(16)
  })

  it('平局时取前一个档位（6 距 4 和 8 都是 2）', () => {
    // `nearestConnectionStop` 用 `<` 比较，平局不替换——所以 6 → 4，7 → 8。
    // 这条行为是真实的（不是 bug），但**没有注释说明**，钉住避免有人改成 `<=`
    // 后「默认 6 连接的人」突然从 4 变成 8。
    expect(valueOf(indexOf(6))).toBe(4)
    expect(valueOf(indexOf(7))).toBe(8)
    // 各相邻档位的中点都是平局
    expect(valueOf(indexOf(4 + 2))).toBe(4) // 6 是 4/8 的中点
    expect(valueOf(indexOf(8 + 2))).toBe(8) // 10 是 8/12 的中点
    expect(valueOf(indexOf(12 + 2))).toBe(12) // 14 是 12/16 的中点
    // 中点两侧各自归到最近的一档
    expect(valueOf(indexOf(9))).toBe(8)
    expect(valueOf(indexOf(11))).toBe(12)
    expect(valueOf(indexOf(13))).toBe(12)
    expect(valueOf(indexOf(15))).toBe(16)
  })

  it('越界索引被钳制，不返回 undefined', () => {
    // bits-ui 理论上不会给出越界值，但「不会发生」不该靠假设——
    // 返回 undefined 会让 aria-valuetext 变成 "undefined · undefined"
    expect(valueOf(-1)).toBe(4)
    expect(valueOf(999)).toBe(16)
    expect(indexOf(-5)).toBe(0)
    expect(indexOf(1e9)).toBe(3)
  })
})

describe('默认值', () => {
  it('默认 8 落在第二档（不是第一档也不是最后）', () => {
    // 默认值选错会让用户一开始就吃到「最高并发」或「完全没加速」
    expect(indexOf(8)).toBe(1)
    expect(valueOf(1)).toBe(8)
  })
})
