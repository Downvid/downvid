import { describe, it, expect } from 'vitest'
import { fetchAnnouncement, mirrorSources, parseAnnouncement } from './announcement'

/**
 * 公告（作者的话）的远端读取与降级。
 *
 * 两个真问题驱动这组用例：
 *   1. `fetchAnnouncement()` 写好了却**从来没被调用过** —— 界面永远读本地
 *      打包的那份，作者更新了内容用户也看不到。
 *   2. 它原先只返回文档、不返回来源，调用方无法区分「远端拿到的」与
 *      「本地兜底」，于是没法如实告诉用户「这是离线副本」。
 */

function fakeFetch(handler: (url: string) => Promise<Response>): typeof fetch {
  return ((url: string) => handler(String(url))) as unknown as typeof fetch
}

const md = '---\ntitle: 测试\ndate: 2026-10-18\n---\n\n正文第一段。\n'

describe('fetchAnnouncement', () => {
  it('第一跳成功 → source=remote，并给出命中的 URL', async () => {
    const res = await fetchAnnouncement(
      'zh-CN',
      fakeFetch(async () => new Response(md, { status: 200 })),
    )
    expect(res.source).toBe('remote')
    expect(res.doc.title).toBe('测试')
    expect(res.via).toContain('raw.githubusercontent.com')
  })

  it('第一跳 404 → 降级到 jsDelivr（仍算 remote）', async () => {
    const res = await fetchAnnouncement(
      'zh-CN',
      fakeFetch(async (url) =>
        url.includes('raw.githubusercontent.com')
          ? new Response('', { status: 404 })
          : new Response(md, { status: 200 }),
      ),
    )
    expect(res.source).toBe('remote')
    expect(res.via).toContain('jsdelivr')
  })

  it('全部镜像失败 → source=local（用打包副本兜底）', async () => {
    const res = await fetchAnnouncement(
      'zh-CN',
      fakeFetch(async () => {
        throw new Error('offline')
      }),
    )
    expect(res.source).toBe('local')
    expect(res.via).toBeUndefined()
    // 本地兜底必须有内容，不能是空文档
    expect(res.doc.blocks.length).toBeGreaterThan(0)
  })

  it('返回空内容也算失败，继续下一跳', async () => {
    const res = await fetchAnnouncement(
      'zh-CN',
      fakeFetch(async (url) =>
        url.includes('raw.githubusercontent.com')
          ? new Response('   \n  ', { status: 200 })
          : new Response(md, { status: 200 }),
      ),
    )
    expect(res.source).toBe('remote')
    expect(res.via).toContain('jsdelivr')
  })

  it('英文 locale 走对应的本地文件', async () => {
    const res = await fetchAnnouncement(
      'en-US',
      fakeFetch(async () => {
        throw new Error('offline')
      }),
    )
    expect(res.source).toBe('local')
    expect(res.doc.blocks.length).toBeGreaterThan(0)
  })
})

describe('parseAnnouncement', () => {
  it('解析 frontmatter 与三种块', () => {
    const doc = parseAnnouncement(
      '---\ntitle: T\ndate: 2026-10-18\nsignature: 签名\n---\n\n## 小标题\n\n段落\n\n- 列表项\n',
    )
    expect(doc.title).toBe('T')
    expect(doc.date).toBe('2026-10-18')
    expect(doc.signature).toBe('签名')
    expect(doc.blocks.map((b) => b.type)).toEqual(['h2', 'p', 'li'])
  })

  it('没有 frontmatter 时用默认标题，正文仍能解析', () => {
    const doc = parseAnnouncement('就是一段话')
    expect(doc.title).toBe('Announcement')
    expect(doc.blocks[0]).toEqual({ type: 'p', text: '就是一段话' })
  })
})

// ===== 代理返回 HTML 的情况 =====
//
// 真实背景：公共镜像 `ghproxy.com` 在 2026-10 之后对任何路径都返回
// **301 跳转到自己的首页**。`fetch` 默认跟随跳转、`response.ok` 成立，
// 于是代码会把首页 HTML 当成公告正文 —— 用户看到「标题是 <html lang="">」，
// 而且那个结果被当成「远端成功」，连离线标记都不显示。
describe('fetchAnnouncement 对代理错误页的防御', () => {
  const html = '<!DOCTYPE html>\n<html lang="">\n<head><title>301</title></head></html>'

  it('返回 HTML 的一跳被跳过，继续下一跳', async () => {
    const res = await fetchAnnouncement(
      'zh-CN',
      fakeFetch(async (url) =>
        url.includes('raw.githubusercontent.com')
          ? new Response(html, { status: 200 })
          : new Response(md, { status: 200 }),
      ),
    )
    expect(res.source).toBe('remote')
    expect(res.doc.title).toBe('测试')
    expect(res.via).toContain('jsdelivr')
  })

  it('所有镜像都返回 HTML 时退回本地', async () => {
    const res = await fetchAnnouncement(
      'zh-CN',
      fakeFetch(async () => new Response(html, { status: 200 })),
    )
    expect(res.source).toBe('local')
    expect(res.doc.blocks.length).toBeGreaterThan(0)
  })

  it('过短的内容（错误页）同样被跳过', async () => {
    const res = await fetchAnnouncement(
      'zh-CN',
      fakeFetch(async (url) =>
        url.includes('raw.githubusercontent.com')
          ? new Response('404', { status: 200 })
          : new Response(md, { status: 200 }),
      ),
    )
    expect(res.source).toBe('remote')
    expect(res.via).toContain('jsdelivr')
  })
})

// ===== 镜像链本身 =====
//
// 这组断言的是**配置**而不是逻辑，但同样必要：镜像失效过一次
// （ghproxy.com 变成 301 跳首页），而那次失效的表现是「200 + 错误内容」，
// 逻辑层看不出来。至少要把「链路上有哪些域名」钉住，改的时候能看见 diff。
describe('mirrorSources', () => {
  it('中文与英文指向不同的文件', () => {
    const zh = mirrorSources('zh-CN')
    const en = mirrorSources('en-US')
    expect(zh[0]).toContain('author.zh.md')
    expect(en[0]).toContain('author.en.md')
  })

  it('第一跳是 GitHub raw（最快、最权威）', () => {
    expect(mirrorSources('zh-CN')[0]).toMatch(/^https:\/\/raw\.githubusercontent\.com\//)
  })

  it('包含 jsDelivr 与至少两个 gh 反代', () => {
    const urls = mirrorSources('zh-CN')
    expect(urls.some((u) => u.includes('cdn.jsdelivr.net'))).toBe(true)
    // 反代 URL 形如 `https://gh-proxy.com/https://raw.githubusercontent.com/...`
    // —— 它们**也包含** raw 地址，所以不能按「含不含 raw」过滤。
    // 正确判据：不以 `https://raw.` 开头的都不是直连
    const proxies = urls.filter((u) => !u.startsWith('https://raw.githubusercontent.com/'))
    expect(proxies.length).toBeGreaterThanOrEqual(2)
  })

  it('不含已知失效的 ghproxy.com', () => {
    // 2026-10 实测：它对任何路径返回 301 跳自己的首页，
    // 而 fetch 跟随跳转后 response.ok 成立 → 会把 HTML 当公告
    for (const u of mirrorSources('zh-CN')) {
      expect(u).not.toContain('ghproxy.com/')
    }
  })

  it('每一条都是 https（明文会让公告被中间人篡改）', () => {
    for (const u of mirrorSources('zh-CN')) {
      expect(u.startsWith('https://')).toBe(true)
    }
  })
})
