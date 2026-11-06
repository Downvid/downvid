/**
 * 赞助商名单：**在线读取**，改名单不用发版。
 *
 * 内容源文件是仓库根部的 `sponsors.json`（`[{ name, url, note?, logo? }]`），
 * 应用启动 / 打开「关于」页时按镜像链现拉（见 `remote.ts`）。
 *
 * ## 为什么整条链都要校验
 *
 * 公共代理失效时返回的是自己的首页 HTML，而 `fetch` 跟着跳转、状态码 200。
 * 不校验的话会把 HTML 当名单解析失败——还好只是没内容；但更糟的是
 * 「解析出一堆垃圾条目」。所以 `parseSponsors` 对每一条都做白名单校验：
 * 名字非空、链接必须是 http(s)、字段类型不对就整条丢弃。
 *
 * ## 返回值为什么要区分 null 与 []
 *
 * `[]` = 拿到了合法名单，只是现在没人赞助；
 * `null` = 所有镜像都失败。调用方据此决定「清空」还是「保留上一次的名单」，
 * 否则一次网络抖动就会把界面上的赞助商全抹掉。
 */
import { mirrorUrls } from './remote'

export interface Sponsor {
  name: string
  url: string
  note?: string
  logo?: string
}

/** 名单上限：真到十几家就该单独做页面了，不是塞进「关于」页 */
const MAX_SPONSORS = 12
const MAX_NAME = 60
const MAX_NOTE = 80
const MAX_URL = 500

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/** 只接受 http(s)：`javascript:` / `file:` 之类的链接不能进 `openExternal` */
function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * 解析名单原文。
 *
 * 返回 `null` 表示「这不是一份名单」（JSON 坏 / 不是数组），调用方应继续
 * 试下一个镜像；返回数组（可能是空数组）表示这一跳成功。
 */
export function parseSponsors(raw: string): Sponsor[] | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(data)) return null

  const seen = new Set<string>()
  const list: Sponsor[] = []
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const name = text(record.name, MAX_NAME)
    const url = text(record.url, MAX_URL)
    // 缺字段或链接不是网页：丢掉这一条，而不是让整份名单失败
    if (!name || !url || !isWebUrl(url) || seen.has(url)) continue
    seen.add(url)

    const sponsor: Sponsor = { name, url }
    const note = text(record.note, MAX_NOTE)
    if (note) sponsor.note = note
    const logo = text(record.logo, MAX_URL)
    if (logo && isWebUrl(logo)) sponsor.logo = logo
    list.push(sponsor)
    if (list.length >= MAX_SPONSORS) break
  }
  return list
}

/**
 * 按镜像链拉取名单。
 *
 * 全失败返回 `null`（调用方保留旧名单），成功返回数组（可能是 `[]`）。
 */
export async function fetchSponsors(
  fetcher: typeof fetch = fetch,
  timeoutMs = 4000,
): Promise<Sponsor[] | null> {
  for (const url of mirrorUrls('sponsors.json')) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) })
      if (!response.ok) continue
      const list = parseSponsors(await response.text())
      if (list) return list
    } catch {
      // 断网 / 超时 / 内容读一半：换下一跳
    }
  }
  return null
}
