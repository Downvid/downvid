import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { loader } from './lib/load-source.mjs'

// 子进程和 Cookie 位于边界；回退、格式生成及诊断使用生产源码。
async function scenario(errors, version = '2026.10.10.233141', available = true) {
  const calls = []
  let cleaned = false
  const load = loader({
    'electron/utils/binary.ts': { resolveDependency: async () => 'fixture-tool', checkJsRuntime: async () => ({ available, kind: 'node', path: 'fixture-node', version: '22.0.0' }) },
    'electron/utils/browser.ts': { getInstalledBrowsers: () => [] },
    'electron/utils/cookies.ts': {
      getCookieAttempts: () => [], isCookieError: () => false, cookieFailureHint: () => '',
      runWithCookies: async (_attempts, run) => {
        try { return { ...await run(['--cookies', 'fixture-cookie']), failedBrowsers: [] } }
        finally { cleaned = true }
      },
    },
    'electron/constants.ts': { LANG_NAMES: {} },
    electron: { dialog: {}, shell: {} },
    'node:fs': { writeFileSync: () => {}, rm: () => {} },
    'node:child_process': { spawn: (_file, args) => {
      const child = new EventEmitter()
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
      queueMicrotask(() => {
        if (args.includes('--version')) { child.stdout.emit('data', Buffer.from(version)); child.emit('close', 0); return }
        assert.equal(cleaned, false, '回退不能使用已清理的 Cookie 临时文件')
        calls.push(args)
        const error = errors.shift()
        if (error) child.stderr.emit('data', Buffer.from(error))
        else child.stdout.emit('data', Buffer.from(JSON.stringify({ id: 'fixture', formats: [{ format_id: 'hls', protocol: 'm3u8_native', height: 720, vcodec: 'h264', acodec: 'aac' }] })))
        child.emit('close', error ? 1 : 0)
      })
      return child
    } },
  })
  const parser = load('electron/parsers/ytdlp.ts')
  let result, error
  try { result = await parser.parseWithYtdlp('https://www.youtube.com/watch?v=fixture') }
  catch (value) { error = value.message }
  return { calls, result, error, parser, cleaned }
}

const format = await scenario(['ERROR: Requested format is not available'])
assert.equal(format.calls.length, 2)
assert.equal(format.result.formats[0].formatId, 'hls')
assert.ok(format.result.parseNotice)
assert.ok(!format.calls[1].includes('--extractor-args'))
assert.ok(format.calls.every(args => args[args.indexOf('--cookies') + 1] === 'fixture-cookie'))
assert.ok(format.calls.every(args => !args.includes('--no-warnings')))
assert.ok(format.calls.every(args => args.includes('--ignore-config')))
assert.equal(format.cleaned, true)

for (const [version, client] of [['2026.09.01', 'web_safari'], ['2026.10.10.233141', 'default,web_embedded']]) {
  const page = await scenario(['ERROR: The page needs to be reloaded'], version)
  assert.equal(page.calls.length, 2)
  assert.ok(page.calls[1].some(arg => arg.includes(`player_client=${client}`)))
  assert.ok(page.parser.getExtractorArgs('https://www.youtube.com/watch?v=fixture').some(arg => arg.includes(client)))
  assert.ok(page.result.parseNotice.includes('Cookie'))
}

const exhausted = await scenario(['The page needs to be reloaded', 'Requested format is not available', 'The page needs to be reloaded https://example.invalid/?token=fixture-secret'])
assert.equal(exhausted.calls.length, 3)
assert.ok(exhausted.error.includes('page-reload'))
assert.ok(!exhausted.error.includes('fixture-secret'))
assert.ok(exhausted.error.includes('2026.10.10.233141'))
const network = await scenario(['Connection timed out'])
assert.equal(network.calls.length, 1)
assert.ok(network.error.includes('network'))
const missing = await scenario([], undefined, false)
assert.equal(missing.calls.length, 0)
assert.ok(missing.error.includes('runtime-unavailable'))
console.log('通过：格式/版本兼容回退、三轮上限、Cookie 生命周期、脱敏诊断与运行时缺失引导')
