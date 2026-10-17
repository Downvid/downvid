import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 「YouTube 回退策略拿到的版本号」这条接线。
 *
 * ## 背景：一个静默退化过的真实回归
 *
 * YouTube 报「The page needs to be reloaded」时，`nextYoutubeRetry` 会**按 yt-dlp
 * 版本**选兼容客户端：
 *
 *   - `>= 2026.10.10` → `default,web_embedded,-tv_downgraded`
 *   - 更早            → `web_safari,web_embedded,-tv_downgraded`
 *
 * 为了省掉「为拿版本号多 spawn 一次 yt-dlp」（PyInstaller 包一次 8~10 秒），
 * `electron/parsers/ytdlp.ts` 里一度写成 `const version = ''`。后果是**新版分支
 * 永远不可达**：策略静默退化成只走旧客户端，没有报错、没有日志，用户只觉得
 * 「有些 YouTube 视频解析不了」。
 *
 * ## 为什么是「接线」测试而不是「逻辑」测试
 *
 * 版本分支的逻辑本身已有单元测试（`tests/parse-error.test.ts` 用显式版本号调
 * `nextYoutubeRetry`）。漏掉的是**那句调用传进去的是什么**——纯逻辑测试看不见它。
 * 这里用两种方式锁住：
 *
 *   1. 静态断言：`dumpInfo` 里不能出现 `version = ''` 这种写死，且必须把版本
 *      交给 `nextYoutubeRetry`；
 *   2. 数据来源断言：版本必须来自**探测缓存**（`cachedVersionOf`），
 *      而不是再 spawn 一次 `--version`（后者会让解析时间翻倍）。
 *
 * 变异验证：把 `versionOf()` 换回 `''` → 第 1 组失败；
 * 把 `cachedVersionOf` 的实现改成恒返回 `''` → 第 2 组失败。
 */

const ROOT = path.resolve(import.meta.dirname, '..')
const PARSER = fs.readFileSync(path.join(ROOT, 'electron/parsers/ytdlp.ts'), 'utf8')
const RUNTIME = fs.readFileSync(path.join(ROOT, 'electron/utils/runtime.ts'), 'utf8')

/** 去掉注释，避免被「解释为什么这么写」的文字命中（注释里就写着 `version = ''`） */
function codeOf(source: string): string {
  return source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')
}

/** 截取某个顶层函数的函数体（到下一个顶层声明之前的 `\n}\n`） */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(name)
  if (start < 0) return ''
  const end = source.indexOf('\n}\n', start)
  return end < 0 ? '' : source.slice(start, end + 3)
}

describe('YouTube 回退策略的版本号来源', () => {
  it('dumpInfo 不再把版本号写死为空串', () => {
    const body = codeOf(functionBody(PARSER, 'async function dumpInfo'))
    expect(body).not.toBe('')
    // 曾经就是这一行让新版客户端分支永远不可达
    expect(body).not.toMatch(/const\s+version\s*=\s*''/)
    expect(body).not.toMatch(/nextYoutubeRetry\([^)]*,\s*state\s*,\s*''\s*\)/)
  })

  it('回退决策拿到的是缓存的真实版本', () => {
    const body = codeOf(functionBody(PARSER, 'async function dumpInfo'))
    // 版本必须来自探测缓存这一条路径
    expect(body).toContain('cachedVersionOf')
    // 且必须真的传进策略
    expect(body).toMatch(/nextYoutubeRetry\([^)]*versionOf\(\)/)
  })

  it('版本号故意在重试决策时才读取（首次解析时探测缓存可能还是冷的）', () => {
    const body = codeOf(functionBody(PARSER, 'async function dumpInfo'))
    // 惰性读取：定义成函数而不是在 spawn 之前先算一次
    expect(body).toMatch(/const\s+versionOf\s*=\s*\(\s*\)\s*=>/)
    // 「在 runYtdlp 之前直接取值」会让首次解析拿到空串 —— 那正是这个坑的形状
    expect(body).not.toMatch(/const\s+version\s*=\s*isYoutube\s*\?\s*cachedVersionOf/)
  })

  it('成功路径上仍然不为版本号单独 spawn 一次 --version', () => {
    // 这条与 tests/update-sources.test.ts 的同名约束互补：那条盯 dumpInfo 里
    // 没有 --version，这条盯版本号的**来源**是缓存而不是新起一次进程。
    const body = codeOf(functionBody(PARSER, 'async function dumpInfo'))
    expect(body).not.toMatch(/runYtdlp\(\['--ignore-config',\s*'--version'\]\)/)
  })
})

describe('cachedVersionOf 的实现', () => {
  it('从探测结果里取 version，而不是恒返回空串', () => {
    const body = codeOf(functionBody(RUNTIME, 'export function cachedVersionOf'))
    expect(body).not.toBe('')
    expect(body).toContain('cachedStatus')
    expect(body).toContain('.version')
    // 恒返回空串会让上面那条接线「看似通过、实际永远走旧客户端」
    expect(body).not.toMatch(/return\s+''\s*\n\}/)
  })

  it('探测结果里确实带 version 字段（Go 边车 detect 时已跑过 --version）', () => {
    // 数据来源若消失，cachedVersionOf 会永远返回空串 —— 而这个变化在 TS 侧看不出来
    const find = fs.readFileSync(path.join(ROOT, 'backend/internal/runtime/find.go'), 'utf8')
    expect(find).toMatch(/Version\s+string\s+`json:"version/)
    // 且必须真的被赋值（只声明不填同样会静默为空）
    expect(find).toMatch(/res\.Version\s*=\s*info\.Version/)
  })

  it('探测缓存的 version 与 path 来自同一条结果（避免取到别的依赖的版本）', () => {
    const body = codeOf(functionBody(RUNTIME, 'export function cachedVersionOf'))
    expect(body).toMatch(/find\([\s\S]*?r\.kind\s*===\s*kind/)
  })
})
