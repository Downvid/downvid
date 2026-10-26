// Package parse —— 平台解析器共用工具。
//
// 本文件是 electron/parsers/shared.ts 的 Go 移植（83 行，13 条用例）。
//
// 抽出来的原因照搬原注释：抖音与快手的解析器各自维护时出现了完全重复的实现
// （码率估算、Cookie 解析），抽出以免两边慢慢漂移。移植后同理——Go 侧只留这一份。
package parse

import (
	"encoding/json"
	"math"
	"os"
	"strconv"
	"strings"
)

// Cookie 是 Netscape 格式 cookies.txt 的一行。
type Cookie struct {
	Domain            string
	IncludeSubdomains bool
	Path              string
	Secure            bool
	Expiry            int64
	Name              string
	Value             string
}

// ParseCookiesFile 解析 Netscape 格式的 cookies.txt。
//
// 与 utils/cookies 里的实现是两回事：那个负责从浏览器导出快照供 yt-dlp 使用，
// 这里只解析用户已导出的纯文本文件，供平台 API 请求自行拼请求头。
//
// 文件不可读时返回空切片而**不报错**：调用方据此退化为无 Cookie 请求，
// 而不是整体失败。这与「用户没配 Cookie 也能看公开视频」的产品行为一致。
func ParseCookiesFile(filePath string) []Cookie {
	raw, err := os.ReadFile(filePath)
	if err != nil {
		return []Cookie{}
	}

	// 浏览器扩展（Cookie-Editor / EditThisCookie 等）导出的是 **JSON 数组**，
	// 不是 Netscape 文本。早先这里只按制表符切，整份文件一条都解析不出来，
	// 表现就是「明明配了 cookies.txt，却还是匿名请求」。
	if jsonCookies, ok := parseJSONCookies(raw); ok {
		return jsonCookies
	}

	cookies := []Cookie{}
	for _, line := range strings.Split(string(raw), "\n") {
		trimmed := strings.TrimSpace(line)
		// 注释与空行跳过（`#` 开头，包括文件头的 `# Netscape HTTP Cookie File`）
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		parts := strings.Split(trimmed, "\t")
		// Netscape 格式固定 7 列，少一列就没法信任剩余字段的位置
		if len(parts) < 7 {
			continue
		}
		expiry, _ := strconv.ParseInt(parts[4], 10, 64) // 解析失败按 0
		cookies = append(cookies, Cookie{
			Domain:            parts[0],
			IncludeSubdomains: parts[1] == "TRUE",
			Path:              parts[2],
			Secure:            parts[3] == "TRUE",
			Expiry:            expiry,
			Name:              parts[5],
			Value:             parts[6],
		})
	}
	return cookies
}

// BuildCookieHeader 从 cookies 构建 Cookie 请求头。
//
// domains 用于过滤：浏览器导出的文件里混着大量无关域名的 Cookie，
// 全带上既长又可能被平台判为异常请求。
//
// 无匹配时返回空串（不是 nil/undefined）——调用方直接拼进请求头，
// 空串等于「不发 Cookie 头」，是安全的。
func BuildCookieHeader(cookies []Cookie, domains []string) string {
	parts := make([]string, 0, len(cookies))
	for _, c := range cookies {
		for _, d := range domains {
			if strings.Contains(c.Domain, d) {
				parts = append(parts, c.Name+"="+c.Value)
				break
			}
		}
	}
	return strings.Join(parts, "; ")
}

// DouyinCookieDomains 是抖音相关的 Cookie 域名。
//
// 三个域都要留：douyin.com 是主站，iesdouyin.com 是分享页/嵌入式播放器，
// snssdk.com 是 API 网关。少了任一个都可能拿不到完整的登录态。
var DouyinCookieDomains = []string{"douyin.com", "iesdouyin.com", "snssdk.com"}

// EstimateFileSize 按分辨率与时长估算文件大小（字节）。
//
// 平台 API 往往不返回精确大小，只能估；用于界面上给用户一个量级参考，
// 因此不需要很准。时长单位是毫秒（platform API 的原始单位），换算在内部做。
func EstimateFileSize(height int, durationMs int64) int64 {
	durationSec := float64(durationMs) / 1000

	bitrate := 2000000.0 // 默认档：低于 360 的未知分辨率
	switch {
	case height >= 1080:
		bitrate = 5000000
	case height >= 720:
		bitrate = 2500000
	case height >= 480:
		bitrate = 1500000
	case height >= 360:
		bitrate = 800000
	}

	return int64(math.Floor(bitrate * durationSec / 8))
}

// IsYouTube 判断是否 YouTube 链接。
//
// 与 TS 侧同样的宽松匹配：只认这两个域名片段，不解析 URL
// （yt-dlp 自己能处理各种变体，这里只用来决定是否加 JS 运行时与重试策略）。
//
// parse 与 download 各有一份：两个包不该为了这一个函数而互相依赖——
// download 要 import parse（为了 Format），反向 import 会成环。
func IsYouTube(u string) bool {
	return strings.Contains(u, "youtube.com") || strings.Contains(u, "youtu.be")
}

// jsonCookieExport 是浏览器扩展导出的单个 cookie。
//
// 字段名来自 Chrome 扩展的通用格式；`hostOnly` 为 true 表示只对当前主机生效，
// Netscape 格式里对应「是否包含子域」那一列。
type jsonCookieExport struct {
	Domain         string  `json:"domain"`
	Name           string  `json:"name"`
	Value          string  `json:"value"`
	Path           string  `json:"path"`
	Secure         bool    `json:"secure"`
	HostOnly       *bool   `json:"hostOnly"`
	ExpirationDate float64 `json:"expirationDate"`
}

// parseJSONCookies 尝试把 JSON 导出解析成 Cookie 列表。
//
// 只有整份文件是一个 JSON 数组、且至少有一个条目带 name 时才认；
// 否则返回 ok=false，让调用方继续走 Netscape 解析。
func parseJSONCookies(raw []byte) ([]Cookie, bool) {
	trimmed := strings.TrimSpace(string(raw))
	if !strings.HasPrefix(trimmed, "[") {
		return nil, false
	}
	var items []jsonCookieExport
	if err := json.Unmarshal([]byte(trimmed), &items); err != nil {
		return nil, false
	}
	cookies := make([]Cookie, 0, len(items))
	for _, it := range items {
		if it.Name == "" || it.Domain == "" {
			continue
		}
		path := it.Path
		if path == "" {
			path = "/"
		}
		hostOnly := it.HostOnly != nil && *it.HostOnly
		domain := it.Domain
		// Netscape 用前导点表示「包含子域」；JSON 里是 hostOnly=false
		if !hostOnly && !strings.HasPrefix(domain, ".") {
			domain = "." + domain
		}
		cookies = append(cookies, Cookie{
			Domain:            domain,
			IncludeSubdomains: !hostOnly,
			Path:              path,
			Secure:            it.Secure,
			Expiry:            int64(it.ExpirationDate),
			Name:              it.Name,
			Value:             it.Value,
		})
	}
	if len(cookies) == 0 {
		return nil, false
	}
	return cookies, true
}
