import { describe, it, expect, beforeEach } from 'vitest'
import { readSettings, updateSettings, updateDepPaths, readDepPaths, DEFAULT_SETTINGS } from '../src/stores/settings'

/**
 * 设置的合并读写。
 *
 * 回归背景（真实 bug）：设置面板的「保存」与依赖面板的「手动指定路径」
 * 各写各的整个对象，于是**在设置里点一次保存，手填的依赖路径就没了**。
 * 原因是 SettingsView 的 Settings 接口里没有 depPaths，整体覆盖时把它抹掉。
 *
 * 这类 bug 会反复出现（每加一个字段都要改所有写入点），所以改成合并写入，
 * 并用用例锁住"互不干扰"这条性质。
 */
const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as any
})

describe('readSettings', () => {
  it('没有存过时返回默认值', () => {
    expect(readSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('旧数据缺字段时用默认值补齐（老用户升级不炸）', () => {
    store.set('settings', JSON.stringify({ downloadDir: '/x', cookieMode: 'manual' }))
    const s = readSettings()
    expect(s.downloadDir).toBe('/x')
    expect(s.cookieMode).toBe('manual')
    expect(s.filenameTemplate).toBe(DEFAULT_SETTINGS.filenameTemplate)
    expect(s.depPaths).toEqual({})
  })

  it('depPaths 不是对象时兜底为空对象', () => {
    store.set('settings', JSON.stringify({ depPaths: 'garbage' }))
    expect(readSettings().depPaths).toEqual({})
  })

  it('损坏的 JSON 不抛错', () => {
    store.set('settings', '{ 坏掉的 json')
    expect(readSettings()).toEqual(DEFAULT_SETTINGS)
  })
})

describe('updateSettings 的合并语义', () => {
  it('只覆盖传入的字段', () => {
    updateSettings({ downloadDir: '/a', proxy: 'http://x' })
    updateSettings({ downloadDir: '/b' })
    const s = readSettings()
    expect(s.downloadDir).toBe('/b')
    expect(s.proxy).toBe('http://x') // 未被第二次写入清掉
  })

  it('设置面板保存不会抹掉依赖面板存的手动路径（回归点）', () => {
    // 1) DepPanel 存手动路径
    updateDepPaths({ 'yt-dlp': '/opt/homebrew/bin/yt-dlp' })
    // 2) SettingsView 点保存（它不知道 depPaths 这个字段）
    updateSettings({
      downloadDir: '/tmp',
      filenameTemplate: '%(title)s.%(ext)s',
      preferredQuality: 'best',
      cookieMode: 'auto',
      cookiesFile: '',
      proxy: '',
    })
    // 3) 手动路径必须还在
    expect(readDepPaths()).toEqual({ 'yt-dlp': '/opt/homebrew/bin/yt-dlp' })
  })

  it('反向也不干扰：改依赖路径不影响其它设置', () => {
    updateSettings({ downloadDir: '/keep', proxy: 'http://p' })
    updateDepPaths({ ffmpeg: '/usr/local/bin/ffmpeg' })
    const s = readSettings()
    expect(s.downloadDir).toBe('/keep')
    expect(s.proxy).toBe('http://p')
    expect(s.depPaths).toEqual({ ffmpeg: '/usr/local/bin/ffmpeg' })
  })

  it('返回写入后的完整设置，便于调用方直接用', () => {
    const next = updateSettings({ preferredQuality: '1080p' })
    expect(next.preferredQuality).toBe('1080p')
    expect(next.filenameTemplate).toBe(DEFAULT_SETTINGS.filenameTemplate)
  })
})
