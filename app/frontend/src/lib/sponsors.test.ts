import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { fetchSponsors, parseSponsors } from './sponsors'

/**
 * 赞助商名单的解析与镜像降级。
 *
 * 这个模块的失败方式都是**静默**的：解析宽松了会把代理的错误页当名单，
 * 解析严格了会把一条写错的记录变成空白区块；镜像全挂时如果返回 `[]`
 * 而不是 `null`，一次网络抖动就会把界面上已有的赞助商全抹掉。
 */

function fakeFetch(handler: (url: string) => Response | Promise<Response>): typeof fetch {
  return ((url: string) => handler(String(url))) as unknown as typeof fetch
}

const ok = (body: string) => new Response(body, { status: 200 })
const html = '<!doctype html><html><body>proxy home</body></html>'

describe('parseSponsors', () => {
  it('保留 name / url，可选字段齐全时才带上', () => {
    const list = parseSponsors(
      JSON.stringify([
        { name: '  Apixo AI ', url: 'https://apixo.ai', note: ' 年度赞助 ', logo: 'https://apixo.ai/logo.png' },
        { name: '回退徽标', url: 'https://example.com' },
      ]),
    )
    expect(list).toEqual([
      { name: 'Apixo AI', url: 'https://apixo.ai', note: '年度赞助', logo: 'https://apixo.ai/logo.png' },
      { name: '回退徽标', url: 'https://example.com' },
    ])
  })

  it('链接不是 http(s) 的条目整条丢掉', () => {
    const list = parseSponsors(
      JSON.stringify([
        { name: '坏链接', url: 'javascript:alert(1)' },
        { name: '本地文件', url: 'file:///etc/passwd' },
        { name: '相对路径', url: '/sponsor' },
        { name: '正常的', url: 'https://example.com' },
      ]),
    )
    expect(list).toEqual([{ name: '正常的', url: 'https://example.com' }])
  })

  it('缺名字 / 类型不对 / 重复链接都跳过，不影响其它条目', () => {
    const list = parseSponsors(
      JSON.stringify([
        { url: 'https://a.example' },
        { name: 42, url: 'https://b.example' },
        null,
        'not-an-object',
        { name: 'A', url: 'https://a.example' },
        { name: 'A 重复', url: 'https://a.example' },
      ]),
    )
    expect(list).toEqual([{ name: 'A', url: 'https://a.example' }])
  })

  it('logo 不是 http(s) 时只丢 logo，不丢这条赞助商', () => {
    const list = parseSponsors(
      JSON.stringify([{ name: 'A', url: 'https://a.example', logo: 'javascript:alert(1)' }]),
    )
    expect(list).toEqual([{ name: 'A', url: 'https://a.example' }])
  })

  it('超长文字截断，条目数有上限', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      name: '公司'.repeat(40) + i,
      url: 'https://example.com/' + i,
      note: '备注'.repeat(60),
    }))
    const list = parseSponsors(JSON.stringify(many))
    expect(list).not.toBeNull()
    expect(list!.length).toBe(12)
    expect(list![0].name.length).toBe(60)
    expect(list![0].note!.length).toBe(80)
  })

  it('不是名单的内容返回 null（镜像要继续试下一跳）', () => {
    expect(parseSponsors(html)).toBeNull()
    expect(parseSponsors('{"sponsors":[]}')).toBeNull()
    expect(parseSponsors('')).toBeNull()
  })

  it('合法的空数组是 []，不是 null（「现在没人赞助」也是有效结果）', () => {
    expect(parseSponsors('[]')).toEqual([])
  })
})

describe('fetchSponsors', () => {
  it('第一跳成功就返回，不再请求后面的镜像', async () => {
    const urls: string[] = []
    const list = await fetchSponsors(
      fakeFetch((url) => {
        urls.push(url)
        return ok(JSON.stringify([{ name: 'A', url: 'https://a.example' }]))
      }),
      50,
    )
    expect(list).toEqual([{ name: 'A', url: 'https://a.example' }])
    expect(urls.length).toBe(1)
    expect(urls[0]).toContain('raw.githubusercontent.com')
  })

  it('镜像返回 200 + HTML 时继续下一跳，不会把代理首页当名单', async () => {
    const urls: string[] = []
    const list = await fetchSponsors(
      fakeFetch((url) => {
        urls.push(url)
        return url.includes('raw.githubusercontent.com')
          ? ok(html)
          : ok(JSON.stringify([{ name: 'B', url: 'https://b.example' }]))
      }),
      50,
    )
    expect(list).toEqual([{ name: 'B', url: 'https://b.example' }])
    expect(urls.length).toBe(2)
    expect(urls[1]).toContain('jsdelivr')
  })

  it('远端空名单直接返回 []，不再往后试', async () => {
    const urls: string[] = []
    const list = await fetchSponsors(
      fakeFetch((url) => {
        urls.push(url)
        return ok('[]')
      }),
      50,
    )
    expect(list).toEqual([])
    expect(urls.length).toBe(1)
  })

  it('全部失败返回 null（调用方要保留旧名单）', async () => {
    const list = await fetchSponsors(
      fakeFetch(() => {
        throw new Error('offline')
      }),
      50,
    )
    expect(list).toBeNull()
  })
})

describe('仓库根部的 sponsors.json', () => {
  it('能被解析（格式写错了线上就是空名单，不会报错）', () => {
    const raw = readFileSync(fileURLToPath(new URL('../../../../sponsors.json', import.meta.url)), 'utf8')
    expect(parseSponsors(raw)).not.toBeNull()
  })
})
