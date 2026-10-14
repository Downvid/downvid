import { describe, it, expect } from 'vitest'
import { toPlainData } from '../src/stores/download'

/**
 * IPC 载荷必须是"可被 structured clone"的普通数据。
 *
 * 回归背景（两个真实 bug）：
 *  1. `deps.download()` 传了 `store.promptKinds`（Pinia 的 ref 数组）→
 *     `An object could not be cloned`（issue #39）
 *  2. 下载参数里的 `subtitles` 在 resume 时来自 `downloadTasks`（Vue Proxy），
 *     同样无法克隆 —— 只要修好"继续下载"就会立刻复现
 *
 * 所以这里直接断言"能被 structuredClone 成功克隆"，而不是逐个检查字段：
 * 后者要人记得加，前者是自动的。
 */
function reactive<T extends object>(target: T): T {
  // 模拟 Vue 的 reactive：Proxy 包裹，structuredClone 会拒绝
  return new Proxy(target, {
    get: (o, k) => Reflect.get(o, k),
    set: (o, k, v) => Reflect.set(o, k, v),
    ownKeys: o => Reflect.ownKeys(o),
    getOwnPropertyDescriptor: (o, k) => Reflect.getOwnPropertyDescriptor(o, k),
  })
}

describe('toPlainData', () => {
  it('把 Proxy 数组转成可克隆的普通数组', () => {
    const proxied = reactive(['en', 'zh-Hans'])
    expect(() => structuredClone(proxied)).toThrow(/could not be cloned/)

    const plain = toPlainData(proxied)
    expect(() => structuredClone(plain)).not.toThrow()
    expect(plain).toEqual(['en', 'zh-Hans'])
  })

  it('嵌套的 Proxy 也会被拍平', () => {
    const payload = reactive({
      url: 'https://example.com/v',
      subtitles: reactive(['en']),
      audioTrack: reactive({ formatId: '140', language: 'ja' }),
    })
    expect(() => structuredClone(payload)).toThrow()

    const plain = toPlainData(payload)
    expect(() => structuredClone(plain)).not.toThrow()
    expect(plain.audioTrack).toEqual({ formatId: '140', language: 'ja' })
    expect(plain.subtitles).toEqual(['en'])
  })

  it('undefined 字段被丢弃（IPC 里 undefined 与缺失等价）', () => {
    const plain = toPlainData({ a: 1, b: undefined })
    expect(plain).toEqual({ a: 1 })
  })

  it('保留字符串/数字/布尔/null', () => {
    const input = { s: 'x', n: 42, b: true, z: null }
    expect(toPlainData(input)).toEqual(input)
  })

  it('不可序列化的值不抛错（降级为原值，避免下载整体失败）', () => {
    const circular: any = { name: 'x' }
    circular.self = circular
    expect(() => toPlainData(circular)).not.toThrow()
  })
})
