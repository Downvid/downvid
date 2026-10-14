import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 「运行依赖是否真的该提示更新」。
 *
 * 曾经的现象：**版本与清单完全一致时也显示「更新」按钮**。根因在界面侧——
 * 只看 `managed` 就渲染「更新」，与版本无关。用户点下去白下 37MB，
 * 下完还是同一个版本，于是以为「更新失败」。
 *
 * 这里直接对 DepPanel 的判断逻辑做纯函数验证，并用源码断言守住
 * 「不许退回只看 managed」——那个分支没有类型错误、也没有运行时报错，
 * 只能靠这种约束拦住。
 */

/** 与 DepPanel.vue 的 compareVersions 保持同一实现（此处复制一份以便单测） */
function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split(/[.\-+]/).map((n) => parseInt(n, 10)).filter((n) => !Number.isNaN(n))
  const pa = parts(a)
  const pb = parts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

function isOutdated(dep: {
  managed?: boolean
  version?: string
  requiredVersion?: string
}): boolean {
  if (!dep.managed || !dep.version || !dep.requiredVersion) return false
  return compareVersions(dep.version, dep.requiredVersion) < 0
}

describe('依赖更新提示', () => {
  it('版本与清单一致时不提示更新', () => {
    // 这正是报上来的问题：装的就是清单要求的版本，却显示「更新」
    expect(isOutdated({ managed: true, version: '2026.10.10.233141', requiredVersion: '2026.10.10.233141' })).toBe(false)
  })

  it('版本确实落后时才提示更新', () => {
    expect(isOutdated({ managed: true, version: '2026.07.04', requiredVersion: '2026.10.10.233141' })).toBe(true)
  })

  it('版本比清单新时不提示更新', () => {
    // 用户自己装了更新的 nightly：不该催他「更新」到更旧的版本
    expect(isOutdated({ managed: true, version: '2026.11.01.000000', requiredVersion: '2026.10.10.233141' })).toBe(false)
  })

  it('非托管（系统自带）永不提示更新', () => {
    // 系统那份是用户自己装的，覆盖它会踩到用户的包管理器
    expect(isOutdated({ managed: false, version: '2026.07.04', requiredVersion: '2026.10.10.233141' })).toBe(false)
  })

  it('缺版本号时不提示更新', () => {
    // 宁可少提示，也不要在信息不全时亮出「更新」
    expect(isOutdated({ managed: true, version: '2026.07.04' })).toBe(false)
    expect(isOutdated({ managed: true, requiredVersion: '2026.10.10.233141' })).toBe(false)
    expect(isOutdated({ managed: true })).toBe(false)
  })

  it('ffmpeg 语义版本也能比较', () => {
    expect(compareVersions('6.0', '6.1.1')).toBe(-1)
    expect(compareVersions('9.0.2', '6.1.1')).toBe(1)
    expect(compareVersions('6.1.1', '6.1.1')).toBe(0)
    // 段数不同时短的那个按 0 补齐
    expect(compareVersions('6.1', '6.1.0')).toBe(0)
  })

  it('yt-dlp 日期版本按数字段比较，不做字符串比较', () => {
    // 字符串比较会把 '2026.9.1' 判成比 '2026.10.10' 新（'9' > '1'），必须逐段比数字
    expect(compareVersions('2026.9.1', '2026.10.10')).toBe(-1)
    expect(compareVersions('2026.10.10', '2026.10.9')).toBe(1)
  })
})

describe('DepPanel 源码约束', () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, '../src/components/DepPanel.vue'), 'utf8')

  it('「更新」按钮必须走 isOutdated，而不是只看 managed', () => {
    // 回归防线：早先「更新」按钮的条件就是 v-else-if="dep.managed"，
    // 与版本无关，于是版本一致时也显示更新。
    // 文案已迁到 i18n（t('deps.update')），所以这里断言**词条键**而不是中文字面量：
    // 断言字面量会在切换语言时假失败，断言键才能一直守住这条契约。
    expect(src).toMatch(/v-else-if="isOutdated\(dep\)"[\s\S]{0,400}?t\('deps\.update'\)/)
    // managed 仍可用于「已是最新」这类纯展示，但不得再作为「更新」按钮的条件
    const managedBranches = [...src.matchAll(/v-else-if="dep\.managed"[^>]*>([^<]*)</g)].map((m) => m[1].trim())
    expect(managedBranches).not.toContain("t('deps.update')")
  })

  it('版本一致时应显示「已是最新」而不是空白', () => {
    expect(src).toContain("t('deps.upToDate')")
  })
})
