import { describe, it, expect } from 'vitest'
import { canInstall, countPlugins, filterPlugins, hasUpdate } from './plugin-filter'
import type { PluginEntry } from './types'

const entry = (over: Partial<PluginEntry>): PluginEntry => ({
  id: 'x',
  name: 'X',
  repo: 'a/x',
  installed: false,
  ...over,
})

const bili = entry({
  id: 'bilibili',
  name: '哔哩哔哩',
  description: 'B站的解析器',
  repo: 'alice/dv-bilibili',
  sites: ['bilibili.com', 'b23.tv'],
  version: '1.2.0',
  installed: true,
  installedVersion: '1.2.0',
})

const kuaishou = entry({
  id: 'kuaishou',
  name: '快手',
  description: '短视频',
  repo: 'bob/dv-kuaishou',
  sites: ['kuaishou.com'],
  version: '0.9.0',
  installed: true,
  installedVersion: '0.8.0', // 落后一版
})

const fresh = entry({
  id: 'weibo',
  name: '微博',
  repo: 'carol/dv-weibo',
  version: '1.0.0',
  installed: false,
})

const all = [bili, kuaishou, fresh]

describe('hasUpdate', () => {
  it('已装且版本不同才算可更新', () => {
    expect(hasUpdate(kuaishou)).toBe(true)
    expect(hasUpdate(bili)).toBe(false)
    // 没装的不能显示「可更新」：那是「可安装」
    expect(hasUpdate(fresh)).toBe(false)
  })

  it('缺版本号时不算可更新（避免每次刷新都提示更新）', () => {
    expect(hasUpdate(entry({ installed: true, version: '', installedVersion: '' }))).toBe(false)
    expect(hasUpdate(entry({ installed: true, version: '1.0.0' }))).toBe(false)
  })
})

describe('filterPlugins', () => {
  it('按名称搜索', () => {
    expect(filterPlugins(all, '哔哩', 'all').map((p) => p.id)).toEqual(['bilibili'])
  })

  it('按支持站点搜索（用户常记得站点而非插件名）', () => {
    expect(filterPlugins(all, 'b23.tv', 'all').map((p) => p.id)).toEqual(['bilibili'])
    expect(filterPlugins(all, 'kuaishou.com', 'all').map((p) => p.id)).toEqual(['kuaishou'])
  })

  it('按描述与 id 搜索', () => {
    expect(filterPlugins(all, '短视频', 'all').map((p) => p.id)).toEqual(['kuaishou'])
    expect(filterPlugins(all, 'weibo', 'all').map((p) => p.id)).toEqual(['weibo'])
  })

  it('大小写与首尾空格不影响匹配', () => {
    expect(filterPlugins(all, '  BILIBILI  ', 'all').map((p) => p.id)).toEqual(['bilibili'])
  })

  it('筛选：已安装 / 未安装 / 可更新', () => {
    expect(filterPlugins(all, '', 'installed').map((p) => p.id)).toEqual(['bilibili', 'kuaishou'])
    expect(filterPlugins(all, '', 'available').map((p) => p.id)).toEqual(['weibo'])
    expect(filterPlugins(all, '', 'updatable').map((p) => p.id)).toEqual(['kuaishou'])
  })

  it('搜索与筛选叠加（两个条件都要成立）', () => {
    expect(filterPlugins(all, 'bilibili', 'available')).toEqual([])
    expect(filterPlugins(all, 'bilibili', 'installed').map((p) => p.id)).toEqual(['bilibili'])
  })

  it('没有匹配时返回空数组而不是全部', () => {
    expect(filterPlugins(all, '不存在的插件', 'all')).toEqual([])
  })
})

describe('canInstall', () => {
  it('未安装且有仓库才能装', () => {
    expect(canInstall(fresh)).toBe(true)
  })

  it('已安装的不能再装（应走「更新」）', () => {
    expect(canInstall(bili)).toBe(false)
  })

  it('没有仓库地址不能装（来源不明）', () => {
    expect(canInstall(entry({ id: 'x', repo: '' }))).toBe(false)
  })

  it('被拦下的（如缺风险声明）不能装', () => {
    // 这是硬门槛：不满足就不许装，界面要显示原因而不是让用户点了才失败
    expect(canInstall(entry({ id: 'x', repo: 'a/x', blockedReason: 'README 缺少风险声明标记' }))).toBe(false)
  })
})

describe('countPlugins', () => {
  it('四个计数各自对应正确', () => {
    expect(countPlugins(all)).toEqual({ all: 3, installed: 2, updatable: 1, available: 1 })
  })

  it('空列表全为 0（界面据此不渲染筛选条）', () => {
    expect(countPlugins([])).toEqual({ all: 0, installed: 0, updatable: 0, available: 0 })
  })
})
