import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { accelerationConnections, normalizeAcceleration } from '../shared/acceleration'
import { aria2Candidates, isSupportedAria2Version } from '../electron/download/aria2'
import { createDirectSegments, canResumeDirect } from '../electron/download/direct-state'

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

describe('aria2 探测候选', () => {
  it('手动路径优先且不替换为其他安装', () => {
    expect(aria2Candidates('E:\\tools\\aria2c.exe', 'win32', {})).toEqual(['E:\\tools\\aria2c.exe'])
  })
  it('非 Windows 主机也能验证搬迁后的 Windows PATH/Scoop/WinGet', () => {
    const candidates = aria2Candidates('', 'win32', { PATH: 'E:\\bin;F:\\bin', SCOOP: 'F:\\scoop', LOCALAPPDATA: 'E:\\local', ProgramFiles: 'E:\\programs' }, 'E:\\home')
    expect(candidates).toContain(path.win32.join('F:\\bin', 'aria2c.exe'))
    expect(candidates).toContain(path.win32.join('F:\\scoop', 'apps', 'aria2', 'current', 'aria2c.exe'))
    expect(candidates).toContain(path.win32.join('E:\\local', 'Microsoft', 'WinGet', 'Links', 'aria2c.exe'))
  })
  it('macOS/Linux 搜索常见安装位置，不生成 exe 后缀', () => {
    expect(aria2Candidates('', 'darwin', { PATH: '/custom/bin:/usr/bin' }, '/home/me')).toContain('/opt/homebrew/bin/aria2c')
    expect(aria2Candidates('', 'linux', {}, '/home/me')).toContain('/usr/bin/aria2c')
  })
  it('不接受过旧或非版本字符串', () => {
    expect(isSupportedAria2Version('1.37.0')).toBe(true)
    expect(isSupportedAria2Version('1.36.0')).toBe(true)
    expect(isSupportedAria2Version('1.23.0')).toBe(false)
    expect(isSupportedAria2Version('unknown')).toBe(false)
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
