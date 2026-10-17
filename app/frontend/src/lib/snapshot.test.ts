import { describe, it, expect } from 'vitest'
import { snapshotForRun, type CurrentSelection, type DownloadSnapshot } from './snapshot'

/**
 * 续传 / 重试必须用**任务自己的**格式。
 *
 * 这条规则出过一次真 bug：暂停后点「继续」读的是解析面板当前选中的格式，
 * 而用户暂停之后往往已经切到别的视频 / 别的清晰度。三种表现：
 *   1. 用户已清空结果 → `currentPick()` 返回 null → 「继续」点了没反应
 *   2. 已解析别的视频 → 续传按别人的 formatId 下载
 *   3. 同一视频换了清晰度 → 从 `.part` 续传时格式不匹配，进度条归零
 */
const task: DownloadSnapshot = {
  formatId: '137',
  hasAudio: false,
  subtitles: ['zh-Hans'],
}

// 用户后来在界面上换了选择（另一个视频 / 另一个清晰度）
const other: CurrentSelection = {
  formatId: '22',
  hasAudio: true,
  subtitles: [],
}

describe('snapshotForRun', () => {
  it('有任务时只用任务的格式，忽略界面当前选择', () => {
    const got = snapshotForRun(task, other)
    expect(got?.formatId).toBe('137')
    expect(got?.hasAudio).toBe(false)
    expect(got?.subtitles).toEqual(['zh-Hans'])
  })

  it('界面已被清空（current 为 null）时，续传仍然能拿到参数', () => {
    // 这是「点了继续没反应」那个 bug 的直接回归用例
    const got = snapshotForRun(task, null)
    expect(got).not.toBeNull()
    expect(got?.formatId).toBe('137')
  })

  it('首次发起（还没有任务）时才读界面当前选择', () => {
    const got = snapshotForRun(null, other)
    expect(got?.formatId).toBe('22')
    expect(got?.hasAudio).toBe(true)
  })

  it('两者都没有时返回 null（调用方据此不发请求）', () => {
    expect(snapshotForRun(null, null)).toBeNull()
  })

  it('返回的字幕数组是副本：之后再改界面不该影响这次下载', () => {
    const uiSubtitles = ['en']
    const got = snapshotForRun(null, { ...other, subtitles: uiSubtitles })
    uiSubtitles.push('ja')
    expect(got?.subtitles).toEqual(['en'])
  })

  it('任务快照的字幕也是副本（避免与 store 里的数组共享引用）', () => {
    const t: DownloadSnapshot = { formatId: '1', hasAudio: true, subtitles: ['en'] }
    const got = snapshotForRun(t, null)
    t.subtitles.push('ja')
    expect(got?.subtitles).toEqual(['en'])
  })

  it('音轨随任务走（多音轨视频续传不能丢）', () => {
    const t: DownloadSnapshot = {
      formatId: '140',
      hasAudio: true,
      audioTrack: { formatId: '251-3', language: 'ja', isM3u8: false },
      subtitles: [],
    }
    const got = snapshotForRun(t, other)
    expect(got?.audioTrack?.language).toBe('ja')
    // formatId 也要在：后端靠它拼选择器，只有语言是选不准 m3u8 音轨的
    expect(got?.audioTrack?.formatId).toBe('251-3')
  })

  it('续传时用的是任务上的直链，不是解析面板的', () => {
    // 直链是几分钟后就过期的 CDN 地址。续传时若回去读解析面板，
    // 用户可能已经解析了别的视频 —— 那时会拿着 A 的地址去下 B，
    // 或者用一个早就失效的地址反复失败。
    const t: DownloadSnapshot = {
      formatId: 'direct', hasAudio: true, subtitles: [],
      directUrl: 'https://cdn.example-cdn.com/a.mp4?sign=1',
    }
    expect(snapshotForRun(t, other)?.directUrl).toBe('https://cdn.example-cdn.com/a.mp4?sign=1')
  })

  it('音轨对象是副本：改界面上的选择不影响已发起的下载', () => {
    const ui = { formatId: '251-1', language: 'en' }
    const got = snapshotForRun(null, { ...other, audioTrack: ui })
    ui.language = 'ja'
    expect(got?.audioTrack?.language).toBe('en')
  })
})
