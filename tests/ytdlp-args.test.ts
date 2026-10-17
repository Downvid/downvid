import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { buildYtdlpArgs, buildFormatSelector, type DownloadOptions } from '../electron/download/ytdlp'

/**
 * 自动追加的清晰度后缀。与 electron/download/ytdlp.ts 的 QUALITY_SUFFIX 一致。
 *
 * 用它拼预期值而不是写死字面量：后缀本身是「行为的一部分」，
 * 用例要钉住的是**位置与次数**（扩展名前、只出现一次），
 * 而不是把常量抄两遍。
 */
const QUALITY_SUFFIX = ' [%(height,format_id)s]'

/**
 * yt-dlp 参数组装。
 *
 * 这是纯函数（依赖路径与 JS 运行时由调用方传入），因此可以不起进程直接断言。
 * 这里覆盖的都是曾经出过问题的分支：
 *  - 音频模式误走合并逻辑，结果只下到纯音频
 *  - 无 m4a 音轨时退化成 bestaudio
 *  - 字幕模式仍传 --ffmpeg-location，且未加 --skip-download
 */

/**
 * 输出路径要用 path.join 拼预期值，不能写死 POSIX 路径。
 *
 * 生产代码用 path.join 组装输出模板，Windows 上得到的是反斜杠；
 * 写死 '/tmp/out/...' 会让用例只在类 Unix 上通过（CI 的 windows job
 * 就是这么抓到的）。
 */
const OUT_DIR = path.join('tmp', 'out')

const base: DownloadOptions = {
  url: 'https://example.com/v/1',
  formatId: '137',
  outputDir: OUT_DIR,
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
    const args = buildYtdlpArgs(base, OUT_DIR, ctx)
    const templates = args.filter((_, i) => args[i - 1] === '--progress-template')
    expect(templates.some(t => t.includes('[dvp]'))).toBe(true)
    expect(templates.some(t => t.includes('[dvpp]'))).toBe(true)
    // --print 隐含 --quiet，必须显式带 --progress 才有进度输出
    expect(args).toContain('--progress')
  })

  it('传 ffmpeg 的目录而非文件路径（yt-dlp 会在该目录里同时找 ffmpeg 与 ffprobe）', () => {
    const args = buildYtdlpArgs(base, OUT_DIR, ctx)
    expect(valueAfter(args, '--ffmpeg-location')).toBe('/opt/homebrew/bin')
  })

  it('输出模板包含用户设置的文件名模板', () => {
    const args = buildYtdlpArgs({ ...base, filenameTemplate: '%(title)s-%(id)s' }, OUT_DIR, ctx)
    expect(valueAfter(args, '-o')).toBe(
      path.join(OUT_DIR, `%(title)s-%(id)s${QUALITY_SUFFIX}.%(ext)s`),
    )
  })

  it('完整模板保留扩展名占位符，不重复追加', () => {
    const args = buildYtdlpArgs({ ...base, filenameTemplate: '%(title)s.%(ext)s' }, OUT_DIR, ctx)
    expect(valueAfter(args, '-o')).toBe(path.join(OUT_DIR, `%(title)s${QUALITY_SUFFIX}.%(ext)s`))
  })

  it('未设置模板时自动追加一次扩展名', () => {
    expect(valueAfter(buildYtdlpArgs(base, OUT_DIR, ctx), '-o')).toBe(
      path.join(OUT_DIR, `%(title)s${QUALITY_SUFFIX}.%(ext)s`),
    )
  })

  it('字幕模式：跳过下载、写字幕、转 srt，且不需要 ffmpeg', () => {
    const args = buildYtdlpArgs({ ...base, downloadMode: 'subtitle', subtitles: ['zh-Hans', 'en'] }, OUT_DIR, { ...ctx, ffmpegLocation: '' })
    expect(args).toContain('--skip-download')
    expect(args).toContain('--write-subs')
    expect(args).toContain('--convert-subs')
    expect(valueAfter(args, '--sub-langs')).toBe('zh-Hans,en')
    // 字幕不需要合并，传 ffmpeg 位置没有意义
    expect(args).not.toContain('--ffmpeg-location')
  })

  it('音频模式：转 mp3 且写入 id3v1 标签（兼容旧播放器）', () => {
    const args = buildYtdlpArgs({ ...base, downloadMode: 'audio' }, OUT_DIR, ctx)
    expect(args).toContain('-x')
    expect(args).toContain('--audio-format')
    expect(valueAfter(args, '--audio-format')).toBe('mp3')
    expect(args).toContain('--postprocessor-args')
    // 音频模式不该再指定合并容器
    expect(args).not.toContain('--merge-output-format')
  })

  it('视频模式合并为 mp4', () => {
    const args = buildYtdlpArgs(base, OUT_DIR, ctx)
    expect(valueAfter(args, '--merge-output-format')).toBe('mp4')
  })

  it('非字幕模式且选了字幕时，附带写字幕参数', () => {
    const args = buildYtdlpArgs({ ...base, subtitles: ['en'] }, OUT_DIR, ctx)
    expect(args).toContain('--write-subs')
    expect(valueAfter(args, '--sub-langs')).toBe('en')
    expect(args).not.toContain('--skip-download')
  })

  it('代理只在设置后传入', () => {
    expect(buildYtdlpArgs(base, OUT_DIR, ctx)).not.toContain('--proxy')
    expect(valueAfter(buildYtdlpArgs({ ...base, proxy: 'http://127.0.0.1:7890' }, OUT_DIR, ctx), '--proxy'))
      .toBe('http://127.0.0.1:7890')
  })

  it('aria2 只接管 HTTP，保留原生 HLS/DASH 并隔离续传片段', () => {
    const args = buildYtdlpArgs({ ...base, acceleration: { enabled: true, maxConnections: 12, aria2Path: '' } }, OUT_DIR, { ...ctx, aria2Path: 'C:\\tools with spaces\\aria2c.exe' })
    expect(args).toContain('http:C:\\tools with spaces\\aria2c.exe')
    expect(args).toContain('dash,m3u8:native')
    expect(valueAfter(args, '--downloader-args')).toContain('--max-connection-per-server=12 --split=12')
    expect(valueAfter(args, '--downloader-args')).toContain('--check-certificate=true')
    expect(valueAfter(args, '--concurrent-fragments')).toBe('12')
    expect(valueAfter(args, '-o')).toBe(`%(title)s${QUALITY_SUFFIX}.%(ext)s`)
    expect(args).toContain(`temp:${path.join(OUT_DIR, '.downvid-aria2')}`)
  })

  it('关闭加速、未发现 aria2 或字幕模式不调用外部引擎', () => {
    const disabled = buildYtdlpArgs({ ...base, acceleration: { enabled: false, maxConnections: 16, aria2Path: '' } }, OUT_DIR, { ...ctx, aria2Path: '/bin/aria2c' })
    expect(disabled).not.toContain('--downloader')
    expect(valueAfter(disabled, '--concurrent-fragments')).toBe('1')
    expect(buildYtdlpArgs(base, OUT_DIR, ctx)).not.toContain('--downloader')
    expect(buildYtdlpArgs({ ...base, downloadMode: 'subtitle' }, OUT_DIR, { ...ctx, aria2Path: '/bin/aria2c' })).not.toContain('--downloader')
  })

  it('YouTube 带 JS 运行时参数；node 与 deno 用不同前缀', () => {
    const yt: DownloadOptions = { ...base, url: 'https://www.youtube.com/watch?v=x' }
    const withNode = buildYtdlpArgs(yt, OUT_DIR, { ...ctx, jsRuntime: { path: '/usr/bin/node', kind: 'node', name: 'Node.js' } })
    expect(valueAfter(withNode, '--js-runtimes')).toBe('node:/usr/bin/node')

    const withDeno = buildYtdlpArgs(yt, OUT_DIR, { ...ctx, jsRuntime: { path: '/usr/bin/deno', kind: 'deno', name: 'Deno' } })
    expect(valueAfter(withDeno, '--js-runtimes')).toBe('deno:/usr/bin/deno')
  })

  it('非 YouTube 不带 JS 运行时参数', () => {
    const args = buildYtdlpArgs(base, OUT_DIR, { ...ctx, jsRuntime: { path: '/usr/bin/node', kind: 'node', name: 'Node.js' } })
    expect(args).not.toContain('--js-runtimes')
  })

  it('单集下载：不跟播放列表', () => {
    const args = buildYtdlpArgs(base, OUT_DIR, ctx)
    expect(args).toContain('--no-playlist')
    expect(valueAfter(args, '--playlist-items')).toBe('1')
  })
})

describe('分块请求（下载速度的关键）', () => {
  it('始终带 --http-chunk-size', () => {
    const args = buildYtdlpArgs(base, OUT_DIR, ctx)
    expect(args).toContain('--http-chunk-size')
  })

  it('分块大小是正数且带单位（yt-dlp 需要 10M 这类写法）', () => {
    const size = valueAfter(buildYtdlpArgs(base, OUT_DIR, ctx), '--http-chunk-size')
    expect(size).toMatch(/^\d+[KMG]$/)
  })

  // 回归背景：YouTube 等 CDN 对长连接限速。同一 17.6MB 文件实测
  // 单连接 109s（0.16 MB/s），加分块后 3~5s（约 5 MB/s）。
  // 若有人"清理无用参数"把它删掉，下载会退回极慢，因此这里锁死。
  it('字幕模式也带分块（下载字幕文件同样受单连接限速影响）', () => {
    const args = buildYtdlpArgs({ ...base, downloadMode: 'subtitle', subtitles: ['en'] }, OUT_DIR, { ...ctx, ffmpegLocation: '' })
    expect(args).toContain('--http-chunk-size')
  })

  it('音频模式同样带分块', () => {
    const args = buildYtdlpArgs({ ...base, downloadMode: 'audio' }, OUT_DIR, ctx)
    expect(args).toContain('--http-chunk-size')
  })
})
