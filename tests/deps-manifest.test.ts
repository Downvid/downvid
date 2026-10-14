import { it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

it('清单检查在网络重试时使用 Node 等待和本平台空设备', async () => {
  const source = fs.readFileSync('scripts/gen-deps-manifest.mjs', 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const require = createRequire(import.meta.url)
  const hash = 'a'.repeat(64)
  const manifest = `const YtDlpTag = "2026.10.14"\nconst FFmpegTag = "b6.1.1"\n${hash}`
  const sums = ['yt-dlp_macos', 'yt-dlp_linux', 'yt-dlp_linux_aarch64', 'yt-dlp.exe']
    .map(name => `${hash}  ${name}`).join('\n')
  let calls = 0
  let waits = 0
  let assetRetry = false
  const complete = new Promise<void>((resolve, reject) => {
    vm.runInNewContext(code, {
      exports: {},
      process: { argv: ['node', 'gen-deps-manifest.mjs', '--check'], exit: (status: number) => reject(new Error(`退出 ${status}`)) },
      SharedArrayBuffer, Int32Array,
      Atomics: { wait: () => { waits++; return 'timed-out' } },
      console: {
        log: (message: string) => { if (message === '清单与上游一致') resolve() },
        warn: () => {}, error: (message: string) => reject(new Error(message)),
      },
      require: (specifier: string) => {
        if (specifier === 'node:fs') return { ...fs, readFileSync: () => manifest }
        if (specifier !== 'node:child_process') return require(specifier)
        return {
          execFileSync: (command: string, args: string[]) => {
            expect(command).toBe('curl')
            const out = args.indexOf('-o')
            if (out >= 0) expect(args[out + 1]).toBe(os.devNull)
            calls++
            if (calls === 1) throw new Error('模拟首次连接失败')
            const url = args[args.length - 1]!
            if (url.endsWith('/releases/latest')) {
              const tag = url.includes('ffmpeg-static') ? 'b6.1.1' : '2026.10.14'
              return `https://github.com/example/releases/tag/${tag}`
            }
            if (url.endsWith('/SHA2-256SUMS')) return sums
            if (!assetRetry) { assetRetry = true; throw new Error('模拟产物连接失败') }
            return ''
          },
        }
      },
    })
  })
  await complete
  expect(waits).toBe(2)
  expect(calls).toBeGreaterThan(10)
})
