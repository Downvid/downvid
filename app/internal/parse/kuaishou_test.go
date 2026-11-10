package parse

import "testing"

// 快手短链必须能取出 photo id。
//
// 变异点：App 分享出来的是 `v.kuaishou.com/<code>`（**不带** `/f/`），
// 早先正则只认 `/f/(…)`，于是真实分享链接一条都解析不出来，直接报
// 「无法从 URL 提取快手视频 ID」。这条用例钉住两种写法都认。
func TestKuaishouShortLinkPatterns(t *testing.T) {
	cases := map[string]string{
		"https://v.kuaishou.com/3xabcdef":     "3xabcdef",
		"https://v.kuaishou.com/f/3xabcdef":   "3xabcdef",
		"https://www.kuaishou.com/f/3xabcdef": "3xabcdef",
		"https://v.kuaishou.com/AbC-d_1":      "AbC-d_1",
	}
	for u, want := range cases {
		m := ksShortLinkRegexp.FindStringSubmatch(u)
		if len(m) < 2 {
			t.Errorf("%q 应匹配短链，got %v", u, m)
			continue
		}
		if m[1] != want {
			t.Errorf("%q 取出的 code = %q, want %q", u, m[1], want)
		}
	}
}

// 短链跳转后的落点有两种，必须都取出 photo id；用户主页要返回空串。
//
// 变异点：只认 `/short-video/` 时，实测落点 `c.kuaishou.com/fw/photo/<id>`
// 取不到 id，GraphQL 于是一路用空 id 请求。
func TestExtractKuaishouPhotoID(t *testing.T) {
	cases := map[string]string{
		"https://www.kuaishou.com/short-video/3xabcdef":       "3xabcdef",
		"https://c.kuaishou.com/fw/photo/3xabcdef":            "3xabcdef",
		"https://c.kuaishou.com/fw/photo/3xabcdef?fid=0&cc=x": "3xabcdef",
		// 主页分享不是视频：必须返回空串，让上层报「不是视频链接」，
		// 而不是拿用户 id 去查 GraphQL 得到语焉不详的「未包含 photo 信息」
		"https://c.kuaishou.com/fw/user/3xabcdef": "",
		// 站点首页（失效短链的落点）
		"https://www.kuaishou.com/": "",
	}
	for u, want := range cases {
		if got := extractKuaishouPhotoID(u); got != want {
			t.Errorf("extractKuaishouPhotoID(%q) = %q, want %q", u, got, want)
		}
	}
}

// Cookie 必须真的进到请求头里。
//
// 变异点（这是修之前真实存在的 bug）：`ParseKuaishouAPI` 的签名里**根本没有**
// cookiesFile 参数，调用方 `bindings_download.go` 传的 CookiesFile 对快手是死参数。
// 表现是「配了 Cookie，快手照样 Need captcha」，且无从察觉。
func TestKuaishouCookieHeaderBuilt(t *testing.T) {
	cookies := []Cookie{
		{Domain: ".kuaishou.com", Name: "did", Value: "web_abc"},
		{Domain: ".kuaishou.com", Name: "kpn", Value: "KUAISHOU_VIS"},
		// 无关域名不该混进来：浏览器导出的文件里有大量第三方 Cookie
		{Domain: ".example.com", Name: "irrelevant", Value: "x"},
	}
	got := BuildCookieHeader(cookies, KuaishouCookieDomains)
	if got != "did=web_abc; kpn=KUAISHOU_VIS" {
		t.Errorf("Cookie 头 = %q", got)
	}
	// kwai.com 是同一家的国际域名，也要认
	if h := BuildCookieHeader([]Cookie{{Domain: ".kwai.com", Name: "a", Value: "b"}}, KuaishouCookieDomains); h != "a=b" {
		t.Errorf("kwai.com 的 Cookie 应被保留，got %q", h)
	}
}
