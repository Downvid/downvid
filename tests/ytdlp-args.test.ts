import { describe, it, expect } from 'vitest'
import { buildYtdlpArgs, buildFormatSelector, type DownloadOptions } from '../electron/download/ytdlp'

/**
 * yt-dlp 参数组装。
 *
 * 这是纯函数（依赖路径与 JS 运行时由调用方传入），因此可以不起进程直接断言。
 * 这里覆盖的都是曾经出过问题的分支：
 *  - 音频模式误走合并逻辑，结果只下到纯音频
 *  - 无 m4a 音轨时退化成 bestaudio
 *  - 字幕模式仍传 --ffmpeg-location，且未加 --skip-download
 */

const base: DownloadOptions = {
  url: 'https://example.com/v/1',
  formatId: '137',
  outputDir: '/tmp/out',
  taskId: 't1',
}

const ctx = { ffmpegLocation: '/opt/homebrew/bin', jsRuntime: null }

/** 取某个选项后面跟的值 */
function valueAfter(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

describe('buildFormatSelector', () => {
  it('音频模式直接使用所选格式，不做音视频合并', () => {
    expect(buildFormatSelector({ ...base, downloadMode: 'audio', formatId: '140' }))
      .toBe('140')
  })

  it('已含音轨的格式优先原样下载', () => {
    const selector = buildFormatSelector({ ...base, hasAudio: true })
    expect(selector.startsWith('137/')).toBe(true)
    expect(selector).toContain('bv*+ba/b')
  })

  it('无音轨时合并最佳音轨', () => {
    const selector = buildFormatSelector({ ...base, hasAudio: false })
    expect(selector).toContain('137+bestaudio[ext=m4a]')
    // 必须有兜底，避免找不到 m4a 时整体失败
    expect(selector).toContain('bv*+ba/b')
  })

  it('指定语言时按语言挑音轨', () => {
    const selector = buildFormatSelector({ ...base, hasAudio: false, audioTrack: { language: 'ja' } })
    expect(selector).toContain('bestaudio[language^=ja]')
  })

  it('m3u8 音轨直接用其 formatId（无法与视频合并时）', () => {
    const selector = buildFormatSelector({ ...base, audioTrack: { formatId: 'hls-audio', isM3u8: true } })
    expect(selector).toBe('hls-audio')
  })
})

describe('buildYtdlpArgs', () => {
  it('包含结构化进度模板，供解析进度与最终路径', () => {
    const args = buildYtdlpArgs(base, '/tmp/out', ctx)
    const templates = args.filter((_, i) => args[i - 1] === '--progress-template')
    expect(templates.some(t => t.includes('[dvp]'))).toBe(true)
    expect(templates.some(t => t.includes('[dvpp]'))).toBe(true)
    // --print 隐含 --quiet，必须显式带 --progress 才有进度输出
    expect(args).toContain('--progress')
  })

  it('传 ffmpeg 的目录而非文件路径（yt-dlp 会在该目录里同时找 ffmpeg 与 ffprobe）', () => {
    const args = buildYtdlpArgs(base, '/tmp/out', ctx)
    expect(valueAfter(args, '--ffmpeg-location')).toBe('/opt/homebrew/bin')
  })

  it('输出模板包含用户设置的文件名模板', () => {
    const args = buildYtdlpArgs({ ...base, filenameTemplate: '%(title)s-%(id)s' }, '/tmp/out', ctx)
    expect(valueAfter(args, '-o')).toBe('/tmp/out/%(title)s-%(id)s.%(ext)s')
  })

  it('字幕模式：跳过下载、写字幕、转 srt，且不需要 ffmpeg', () => {
    const args = buildYtdlpArgs({ ...base, downloadMode: 'subtitle', subtitles: ['zh-Hans', 'en'] }, '/tmp/out', { ...ctx, ffmpegLocation: '' })
    expect(args).toContain('--skip-download')
    expect(args).toContain('--write-subs')
    expect(args).toContain('--convert-subs')
    expect(valueAfter(args, '--sub-langs')).toBe('zh-Hans,en')
    // 字幕不需要合并，传 ffmpeg 位置没有意义
    expect(args).not.toContain('--ffmpeg-location')
  })

  it('音频模式：转 mp3 且写入 id3v1 标签（兼容旧播放器）', () => {
    const args = buildYtdlpArgs({ ...base, downloadMode: 'audio' }, '/tmp/out', ctx)
    expect(args).toContain('-x')
    expect(args).toContain('--audio-format')
    expect(valueAfter(args, '--audio-format')).toBe('mp3')
    expect(args).toContain('--postprocessor-args')
    // 音频模式不该再指定合并容器
    expect(args).not.toContain('--merge-output-format')
  })

  it('视频模式合并为 mp4', () => {
    const args = buildYtdlpArgs(base, '/tmp/out', ctx)
    expect(valueAfter(args, '--merge-output-format')).toBe('mp4')
  })

  it('非字幕模式且选了字幕时，附带写字幕参数', () => {
    const args = buildYtdlpArgs({ ...base, subtitles: ['en'] }, '/tmp/out', ctx)
    expect(args).toContain('--write-subs')
    expect(valueAfter(args, '--sub-langs')).toBe('en')
    expect(args).not.toContain('--skip-download')
  })

  it('代理只在设置后传入', () => {
    expect(buildYtdlpArgs(base, '/tmp/out', ctx)).not.toContain('--proxy')
    expect(valueAfter(buildYtdlpArgs({ ...base, proxy: 'http://127.0.0.1:7890' }, '/tmp/out', ctx), '--proxy'))
      .toBe('http://127.0.0.1:7890')
  })

  it('YouTube 带 JS 运行时参数；node 与 deno 用不同前缀', () => {
    const yt: DownloadOptions = { ...base, url: 'https://www.youtube.com/watch?v=x' }
    const withNode = buildYtdlpArgs(yt, '/tmp/out', { ...ctx, jsRuntime: { path: '/usr/bin/node', name: 'Node.js' } })
    expect(valueAfter(withNode, '--js-runtimes')).toBe('node:/usr/bin/node')

    const withDeno = buildYtdlpArgs(yt, '/tmp/out', { ...ctx, jsRuntime: { path: '/usr/bin/deno', name: 'Deno' } })
    expect(valueAfter(withDeno, '--js-runtimes')).toBe('deno:/usr/bin/deno')
  })

  it('非 YouTube 不带 JS 运行时参数', () => {
    const args = buildYtdlpArgs(base, '/tmp/out', { ...ctx, jsRuntime: { path: '/usr/bin/node', name: 'Node.js' } })
    expect(args).not.toContain('--js-runtimes')
  })

  it('单集下载：不跟播放列表', () => {
    const args = buildYtdlpArgs(base, '/tmp/out', ctx)
    expect(args).toContain('--no-playlist')
    expect(valueAfter(args, '--playlist-items')).toBe('1')
  })
})
