/**
 * 仓库内文件的在线读取：统一镜像链。
 *
 * 正式应用里的「内容型」数据（作者的话、赞助商名单）都存在仓库里，
 * 由应用运行时现拉，这样改内容不用发版。
 *
 * ## 为什么不能只用 GitHub raw
 *
 * 国内直连 raw.githubusercontent.com 经常超时或 404。只有这一条路的话，
 * 用户会**永远**看不到作者写了什么 —— 与「更新通道坏掉」是同一类问题。
 *
 * ## 为什么镜像链之外还必须校验内容
 *
 * 公共代理会像 ghproxy.com 那样「301/200 + 自己的首页」，`fetch` 跟着跳转、
 * `response.ok` 成立，代码就会把 HTML 当成数据解析。所以调用方拿到文本后
 * **必须校验格式**（公告看 `looksLikeMarkdown`，赞助商名单看 JSON 解析），
 * 不像就跳过这一跳，继续下一跳。
 *
 * 镜像可用性实测于 2026-10-18（逐个 curl 验证）。
 */
import { REPO_URL } from './constants'

const REPO_PATH = REPO_URL.replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '')

export function mirrorUrls(path: string): string[] {
  const raw = 'https://raw.githubusercontent.com/' + REPO_PATH + '/main/' + path
  return [
    raw,
    'https://cdn.jsdelivr.net/gh/' + REPO_PATH + '@main/' + path,
    'https://gh-proxy.com/' + raw,
    'https://ghfast.top/' + raw,
    'https://ghproxy.net/' + raw,
  ]
}
