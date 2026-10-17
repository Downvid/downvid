import { describe, it, expect } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { accelerationConnections, normalizeAcceleration } from '../shared/acceleration'
import { isSupportedAria2Version, parseAria2Version } from '../electron/download/aria2'
import { createDirectSegments, canResumeDirect } from '../electron/download/direct-state'

const readFileSync = fs.readFileSync

describe('下载加速配置', () => {
  it('老用户默认开启八路，关闭后只使用一路', () => {
    expect(normalizeAcceleration()).toEqual({ enabled: true, maxConnections: 8, aria2Path: '' })
    expect(accelerationConnections({ enabled: false, maxConnections: 16 })).toBe(1)
  })
  it('限制非法并发数，路径只接受字符串', () => {
    expect(normalizeAcceleration({ maxConnections: 200 }).maxConnections).toBe(16)
    expect(normalizeAcceleration({ maxConnections: -10 }).maxConnections).toBe(1)
    expect(normalizeAcceleration({ maxConnections: 'broken', aria2Path: {} }).maxConnections).toBe(8)
    expect(normalizeAcceleration({ aria2Path: '  /tool/aria2c  ' }).aria2Path).toBe('/tool/aria2c')
  })
})

/**
 * aria2 的探测候选表已经并入 Go 边车（`backend/internal/runtime`），
 * 与 yt-dlp / ffmpeg 共用同一份路径表——这样 Windows 的 Scoop/WinGet/Chocolatey、
 * macOS 的 Homebrew、Linux 的 snap/nix 只维护一处。
 *
 * 这里保留的是「路径表确实覆盖了常见安装位置」的**契约检查**：
 * 原先渲染进程自己维护过一份候选，与边车那份不一致时表现为
 * 「依赖页说装了、加速页说没装」——两边都不报错，用户无所适从。
 */
describe('aria2 探测覆盖常见安装位置', () => {
  const goSource = readFileSync(path.resolve(import.meta.dirname, '../backend/internal/runtime/find.go'), 'utf8')

  it('Go 侧为 Windows 覆盖 Scoop / WinGet / Chocolatey', () => {
    expect(goSource).toContain('"scoop"')
    expect(goSource).toContain('WinGet')
    expect(goSource).toContain('ChocolateyInstall')
  })

  it('Go 侧覆盖 aria2 在 Scoop 与 WinGet 的实际落点', () => {
    // Scoop: apps\aria2\current\aria2c.exe；WinGet portable: Packages\aria2.aria2_*\aria2c.exe
    expect(goSource).toContain('filepath.Join(scoop, "apps", "aria2", "current")')
    expect(goSource).toContain('"aria2.aria2_*"')
  })

  it('Go 侧为 macOS / Linux 覆盖 Homebrew 与 snap', () => {
    expect(goSource).toContain('/opt/homebrew/bin')
    expect(goSource).toContain('/usr/local/bin')
    expect(goSource).toContain('/snap/bin')
    expect(goSource).toContain('/nix/var/nix/profiles/default/bin')
  })

  it('aria2 的二进制名是 aria2c 而不是 Kind 名', () => {
    // 写错的表现是「装了却永远显示未找到」
    expect(goSource).toContain('name = "aria2c"')
  })

  it('渲染进程不再自己维护候选表（避免两份不一致）', () => {
    const aria2Source = readFileSync(path.resolve(import.meta.dirname, '../electron/download/aria2.ts'), 'utf8')
    expect(aria2Source).not.toContain('export function aria2Candidates')
  })
})

describe('队列分块与旧检查点兼容', () => {
  it('分块数量多于工作连接，内存占用不随文件无限增长', () => {
    expect(createDirectSegments(32 * 1024 * 1024, 8).length).toBeGreaterThan(8)
    expect(createDirectSegments(10 * 1024 ** 4, 16).length).toBeLessThanOrEqual(128)
  })
  it('切换并发设置不会丢失旧版本四段布局', () => {
    const resource = { url: 'https://cdn.example/video', total: 1000, etag: 'v1', lastModified: '' }
    const saved = { ...resource, segments: Array.from({ length: 4 }, (_, i) => ({ start: i * 250, end: (i + 1) * 250, offset: i * 250 + 10 })) }
    expect(canResumeDirect(saved, resource, 1000)).toBe(true)
    saved.segments[1].start--
    expect(canResumeDirect(saved, resource, 1000)).toBe(false)
  })
})

// 老用户的数据里没有 acceleration 字段，必须能兜底且不炸（设置形状变更的兼容要求）
describe('加速设置的兼容与钳制', () => {
  it('未设置时给默认值', () => {
    expect(normalizeAcceleration(undefined)).toEqual({ enabled: true, maxConnections: 8, aria2Path: '' })
  })

  it('非法并发被钳制在 1~16', () => {
    expect(normalizeAcceleration({ maxConnections: 999 }).maxConnections).toBe(16)
    expect(normalizeAcceleration({ maxConnections: 0 }).maxConnections).toBe(1)
    expect(normalizeAcceleration({ maxConnections: -5 }).maxConnections).toBe(1)
    expect(normalizeAcceleration({ maxConnections: 'abc' as any }).maxConnections).toBe(8)
    expect(normalizeAcceleration({ maxConnections: 3.7 }).maxConnections).toBe(3)
  })

  it('关闭加速时实际连接数为 1', () => {
    expect(accelerationConnections({ enabled: false, maxConnections: 16 })).toBe(1)
  })

  it('非对象输入不炸', () => {
    expect(() => normalizeAcceleration('garbage' as any)).not.toThrow()
    expect(() => normalizeAcceleration(null as any)).not.toThrow()
  })
})
