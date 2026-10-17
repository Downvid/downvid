import { describe, it, expect } from 'vitest'
import { CONNECTION_STOPS, nearestConnectionStop } from './constants'

/**
 * 加速滑块的「值 ↔ 档位」映射。
 *
 * 滑块是离散四档（4 / 8 / 12 / 16），而设置里存的是**实际连接数**。
 * 两者的转换由 `nearestConnectionStop` 负责——判错了会让滑块显示在
 * 一个「不存在的档位」上，或者拖动后设置里存了个 7 这种值。
 */

describe('CONNECTION_STOPS', () => {
  it('是四档且严格递增', () => {
    expect(CONNECTION_STOPS).toHaveLength(4)
    for (let i = 1; i < CONNECTION_STOPS.length; i++) {
      expect(CONNECTION_STOPS[i]).toBeGreaterThan(CONNECTION_STOPS[i - 1])
    }
  })

  it('与 Go 侧 acceleration 的 clamp 上限一致（16）', () => {
    // internal/settings 的 normalizeAcceleration 把上限截到 16。
    // 两处不一致时，用户拖到最高档、存进设置、后端读出来会变成一个更小的值。
    expect(CONNECTION_STOPS[CONNECTION_STOPS.length - 1]).toBe(16)
  })

  it('最低档是 4（与 Go 侧允许的最小有效并发一致）', () => {
    expect(CONNECTION_STOPS[0]).toBe(4)
  })
})

describe('nearestConnectionStop', () => {
  it('恰好是档位值时原样返回', () => {
    for (const stop of CONNECTION_STOPS) {
      expect(nearestConnectionStop(stop)).toBe(stop)
    }
  })

  it('落在两档之间时取更近的那个', () => {
    expect(nearestConnectionStop(5)).toBe(4)  // 距 4 差 1，距 8 差 3
    // 6 距 4 与 8 都是 2 —— 相等时 reduce 的严格 `<` 保留**先出现的**（4）。
    // 这个行为要钉住：若有人把 `<` 改成 `<=`，正中间的值会跳到后一档，
    // 表现是「拖到正中间时滑块突然跳到右边一格」。
    expect(nearestConnectionStop(6)).toBe(4)
    expect(nearestConnectionStop(7)).toBe(8)
    expect(nearestConnectionStop(10)).toBe(8)
    expect(nearestConnectionStop(11)).toBe(12)
    expect(nearestConnectionStop(14)).toBe(12)
    expect(nearestConnectionStop(15)).toBe(16)
  })

  it('超出范围的极值不会返回 undefined', () => {
    // 设置文件可能被手工改成 1 或 999
    expect(CONNECTION_STOPS).toContain(nearestConnectionStop(1))
    expect(CONNECTION_STOPS).toContain(nearestConnectionStop(999))
    expect(CONNECTION_STOPS).toContain(nearestConnectionStop(0))
    expect(CONNECTION_STOPS).toContain(nearestConnectionStop(-5))
  })

  it('极值落在一端而不是中间', () => {
    expect(nearestConnectionStop(1)).toBe(4)
    expect(nearestConnectionStop(999)).toBe(16)
    expect(nearestConnectionStop(0)).toBe(4)
    expect(nearestConnectionStop(-100)).toBe(4)
  })

  it('返回值一定是合法档位（拖动不会产生 7 这种值）', () => {
    for (let v = -10; v <= 30; v++) {
      expect(CONNECTION_STOPS).toContain(nearestConnectionStop(v))
    }
  })
})
