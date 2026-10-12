import { describe, it, expect } from 'vitest'
import { readMissingKinds, stripDepMarkers } from '../src/stores/deps'

/**
 * 依赖缺失时的识别与错误信息清理。
 *
 * 这几个函数决定「缺依赖时能否正确弹出下载引导」以及「错误框里显示的
 * 文字是否可信」，是用户在缺依赖场景下唯一能看到的反馈，因此值得单独覆盖。
 */
describe('readMissingKinds', () => {
  it('从主进程的标记里解析出依赖种类', () => {
    expect(readMissingKinds('[[deps-missing:yt-dlp]]未找到可用的 yt-dlp')).toEqual(['yt-dlp'])
    expect(readMissingKinds('[[deps-missing:ffmpeg]]未找到可用的 ffmpeg')).toEqual(['ffmpeg'])
  })

  it('解析 Electron invoke 包裹后的信息（真实错误消息的前缀会被带上）', () => {
    const raw = "Error invoking remote method 'ytdlp:parse': Error: [[deps-missing:yt-dlp]]未找到可用的 yt-dlp"
    expect(readMissingKinds(raw)).toEqual(['yt-dlp'])
  })

  it('多个标记去重', () => {
    const raw = '[[deps-missing:ffmpeg]][[deps-missing:ffmpeg]]'
    expect(readMissingKinds(raw)).toEqual(['ffmpeg'])
  })

  it('没有标记时退回关键字匹配（兼容旧格式错误）', () => {
    expect(readMissingKinds('未找到可用的 yt-dlp，请重试')).toEqual(['yt-dlp'])
    expect(readMissingKinds('未找到可用的 ffprobe')).toEqual(['ffprobe'])
  })

  it('无关错误不误判为缺依赖', () => {
    expect(readMissingKinds('网络连接超时')).toEqual([])
    expect(readMissingKinds('该视频需要登录才能访问')).toEqual([])
    expect(readMissingKinds('')).toEqual([])
  })

  it('不会把 yt-dlp 之外的词误当成匹配（需完整短语）', () => {
    // 旧实现用 includes('yt-dlp') 会在这里误报
    expect(readMissingKinds('yt-dlp 下载失败')).toEqual([])
    expect(readMissingKinds('ffmpeg 合并失败')).toEqual([])
  })
})

describe('stripDepMarkers', () => {
  it('去掉标记，只留给人看的文字', () => {
    expect(stripDepMarkers('[[deps-missing:yt-dlp]]未找到可用的 yt-dlp'))
      .toBe('未找到可用的 yt-dlp')
  })

  it('去掉 Electron 的 IPC 前缀', () => {
    expect(stripDepMarkers("Error invoking remote method 'ytdlp:parse': Error: 解析失败"))
      .toBe('解析失败')
  })

  it('标记与前缀同时存在', () => {
    const raw = "Error invoking remote method 'ytdlp:download': Error: [[deps-missing:ffmpeg]]未找到可用的 ffmpeg，请下载"
    expect(stripDepMarkers(raw)).toBe('未找到可用的 ffmpeg，请下载')
  })

  it('普通错误原样保留', () => {
    expect(stripDepMarkers('网络连接中断')).toBe('网络连接中断')
  })

  it('去掉首尾空白', () => {
    expect(stripDepMarkers('  下载失败  ')).toBe('下载失败')
  })
})
