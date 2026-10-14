import { describe, it, expect } from 'vitest'
import { classifyParseError, parseDiagnostic, PARSE_MESSAGES, safeIssueReport } from '../shared/parse-error'
import { nextYoutubeRetry, youtubeExtractorArgs } from '../electron/parsers/youtube-retry'

describe('解析错误与隐私', () => {
  it('不把不支持的网址误报成无效链接', () => {
    expect(PARSE_MESSAGES[classifyParseError('ERROR: Unsupported URL: https://example.com/video')]).toBe('暂不支持该网站或链接类型')
    expect(classifyParseError('not a valid URL')).toBe('invalid-url')
  })
  it('诊断与 Issue 草稿只保留允许公开的字段', () => {
    const raw = 'ERROR: Requested format is not available https://example.invalid/?token=fixture-secret cookie=fixture-secret /private/fixture/local-file'
    const diagnostic = parseDiagnostic(raw, { ytdlp: '2026.10.10.233141', runtime: 'node@22.0.0' })
    expect(diagnostic).toContain('format-unavailable')
    expect(diagnostic).toContain('node@22.0.0')
    const report = JSON.stringify(safeIssueReport(raw, diagnostic + '\n' + raw))
    expect(report).not.toMatch(/fixture-secret|local-file|https:\/\//)
    expect(report).toContain('2026.10.10.233141')
    expect(parseDiagnostic(raw, { runtime: '/private/fixture/tool' })).not.toContain('/private')
  })
  it('格式错误保留挑战失败的诊断依据', () => {
    expect(parseDiagnostic('WARNING: signature solving failed\nERROR: Requested format is not available')).toContain('JS 验证脚本未成功执行')
  })
})

describe('YouTube 有限回退策略', () => {
  const initial = { manifests: false, client: '' }
  it('格式不可用仅允许一次流格式回退，不固定默认客户端', () => {
    const next = nextYoutubeRetry('Requested format is not available', initial, '')!
    expect(youtubeExtractorArgs(next)).toEqual([])
    expect(nextYoutubeRetry('Requested format is not available', next, '')).toBeNull()
  })
  it('页面重载按版本选兼容客户端，并合并格式策略', () => {
    const old = nextYoutubeRetry('The page needs to be reloaded', initial, '2026.09.01')!
    expect(old.client).toContain('web_safari')
    const current = nextYoutubeRetry('The page needs to be reloaded', initial, '2026.10.10.233141')!
    expect(current.client).toBe('default,web_embedded,-tv_downgraded')
    expect(youtubeExtractorArgs(current)[1]).toContain('skip=hls,dash;player_client=')
    expect(nextYoutubeRetry('The page needs to be reloaded', current, '')).toBeNull()
  })
  it('网络、鉴权和不支持网址不触发客户端回退', () => {
    for (const error of ['Connection timed out', 'Sign in to confirm', 'Unsupported URL', 'Unable to download API page: HTTP Error 403: Forbidden']) expect(nextYoutubeRetry(error, initial, '')).toBeNull()
    expect(classifyParseError('Unable to download API page: HTTP Error 403: Forbidden')).toBe('access-denied')
  })
})
