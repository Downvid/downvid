import { describe, it, expect } from 'vitest'
import { findExistingDownload } from './dedupe'
import type { HistoryItem } from './types'
import type { Mode } from './constants'

/**
 * 「同一链接不同清晰度可以继续下载」的判定。
 *
 * 这条规则出过两次错，两次的表现都是**功能静默失效**：
 *
 *   1. 只比 URL：下过 1080P 之后，同一条视频的 4K 也点不动，
 *      底部按钮直接变成「打开历史」，没有任何别的入口。
 *   2. 把结果算成「解析时的一次性状态」：换清晰度后界面仍显示「已下载」。
 *      （第 2 条由 store 的 `alreadyDownloaded` 改成派生值修正，
 *       这里钉住的是判据本身。）
 */

function item(patch: Partial<HistoryItem>): HistoryItem {
  return {
    id: 'x',
    title: '猫咪视频',
    thumbnail: '',
    url: 'https://www.bilibili.com/video/BV1xx',
    filePath: '/downloads/猫咪视频 [1080]p.mp4',
    quality: '1080P',
    ext: 'mp4',
    mode: 'video' as Mode,
    sizeBytes: 1000,
    createdAt: 0,
    fileExists: true,
    ...patch,
  }
}

const video = { url: 'https://www.bilibili.com/video/BV1xx', title: '猫咪视频' }
const URL = 'https://www.bilibili.com/video/BV1xx'

describe('findExistingDownload', () => {
  it('同链接同清晰度同模式 → 判定为已下载', () => {
    const got = findExistingDownload([item({})], video, URL, { quality: '1080P', mode: 'video' })
    expect(got?.quality).toBe('1080P')
  })

  it('同链接**不同清晰度** → 放行（这是最主要的使用场景）', () => {
    // 先下过 1080P，现在想下 4K：必须是 null，否则第二次下载无处可去
    const got = findExistingDownload([item({})], video, URL, { quality: '4K', mode: 'video' })
    expect(got).toBeNull()
  })

  it('同链接同清晰度**不同模式** → 放行（先要视频，后要音频）', () => {
    const got = findExistingDownload([item({})], video, URL, { quality: '1080P', mode: 'audio' })
    expect(got).toBeNull()
  })

  it('文件已被删除的历史不参与判定（用户要的就是重新拿到文件）', () => {
    const got = findExistingDownload(
      [item({ fileExists: false })],
      video,
      URL,
      { quality: '1080P', mode: 'video' },
    )
    expect(got).toBeNull()
  })

  it('清晰度比较忽略大小写与空白', () => {
    const got = findExistingDownload([item({ quality: ' 1080p ' })], video, URL, {
      quality: '1080P',
      mode: 'video',
    })
    expect(got).not.toBeNull()
  })

  it('不同视频（URL 不同）即便清晰度相同也放行', () => {
    const got = findExistingDownload(
      [item({ url: 'https://www.bilibili.com/video/BV2yy', title: '另一个视频' })],
      video,
      URL,
      { quality: '1080P', mode: 'video' },
    )
    expect(got).toBeNull()
  })

  it('URL 缺失时才用标题兜底，且仍要求清晰度一致', () => {
    const noUrlVideo = { url: '', title: '猫咪视频' }
    // 标题相同、清晰度相同 → 拦
    expect(
      findExistingDownload([item({})], noUrlVideo, '', { quality: '1080P', mode: 'video' }),
    ).not.toBeNull()
    // 标题相同、清晰度不同 → 放行
    expect(
      findExistingDownload([item({})], noUrlVideo, '', { quality: '720P', mode: 'video' }),
    ).toBeNull()
  })

  it('拿不到当前选择时退化为「同 URL 就算重复」', () => {
    // 宁可多拦一次，也不要同一个文件被下两遍
    expect(findExistingDownload([item({})], video, URL, null)).not.toBeNull()
  })

  it('历史里有多个清晰度时，只拦对应的那一个', () => {
    const history = [
      item({ id: 'a', quality: '1080P', filePath: '/downloads/a.mp4' }),
      item({ id: 'b', quality: '720P', filePath: '/downloads/b.mp4' }),
      item({ id: 'c', quality: '4K', filePath: '/downloads/c.mp4' }),
    ]
    expect(findExistingDownload(history, video, URL, { quality: '720P', mode: 'video' })?.id).toBe('b')
    expect(findExistingDownload(history, video, URL, { quality: '480P', mode: 'video' })).toBeNull()
  })
})
