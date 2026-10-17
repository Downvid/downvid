/**
 * WebUI 服务端访问边界与安全性校验。
 *
 * 核心防御目标：阻止跨站恶意脚本（CSWSH - Cross-Site WebSocket Hijacking）。
 * 当用户在宿主机浏览器中访问了未受信任的第三方网页时，第三方网页中的 JS
 * 不能向用户本地后台发起非法 WebSocket 连接并借用其身份调用下载/文件接口。
 */

export function isAllowedOrigin(originHeader: string | undefined, hostHeader: string | undefined): boolean {
  // 无 Origin 请求头（非浏览器环境，如 curl、移动客户端或受信任服务端转发）允许
  if (!originHeader) return true

  try {
    const origin = new URL(originHeader)

    // 1. 同源校验：Origin host（带端口）与客户端传入的 Host 报头严格相等
    if (hostHeader && origin.host.toLowerCase() === hostHeader.toLowerCase()) {
      return true
    }

    // 2. 本地安全回环地址访问放行（IPv4、IPv6 与 localhost）
    const hostname = origin.hostname.toLowerCase()
    if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)) {
      return true
    }

    // 3. 其余任何来自外部不可信域名的跨源 WebSocket 连接均严格拒绝
    return false
  } catch {
    return false
  }
}
