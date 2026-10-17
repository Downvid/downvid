package fetch

import (
	neturl "net/url"
	"strings"
)

// Mirror 一个下载加速前缀。
//
// 镜像都是**前缀式**的：把原始的 GitHub 下载地址整段拼在反代域名后面
// （`https://gh-proxy.com/https://github.com/...`），因此对任何一条 release 资产
// 都通用，不需要逐个资产维护映射表。
type Mirror struct {
	// ID 用于 `--mirror` 参数与日志
	ID string
	// Name 展示给用户的名字
	Name string
	// Prefix 为空表示直连 GitHub
	Prefix string
}

// Mirrors 是依赖下载的**有序**候选链，顺序即优先级。
//
// ## 为什么需要镜像
//
// yt-dlp / ffmpeg 的资产全部托管在 `github.com/.../releases/download/...`。
// 国内网络下这个域名经常连不上，而表现是：用户点「下载」→ 进度条不动 →
// 最后报一句网络错误。桌面版因此**装不上运行依赖，整个应用不可用**——
// 这比「更新检查失败」严重得多：更新失败只是版本落后，依赖失败是功能直接为零。
//
// ## 为什么是这个顺序
//
//  1. `direct` 永远排第一：海外用户、有代理的用户、或 GitHub 恰好可用的用户
//     不该为别人的网络问题多付一次反代延迟；
//  2. 三个公共反代按**实测可用性**排序（2026-10 本机实测三者对 release 资产
//     都返回 200；`github.moeyy.xyz` 已失效、jsDelivr 不支持 release 资产，
//     两者都没放进来）；
//  3. 只有前缀式反代能覆盖 release 资产，因此这里**不放** jsDelivr / Gitee。
//
// ## 新增镜像的要求
//
// 必须实测对 **release 资产**（不是仓库文件）返回 200 且字节一致，然后再加：
// 一个连不通的镜像会让每次失败多花一个超时，用户看到的是「下载变慢了」。
// `TestMirrorsArePrefixStyle` 会拦住写错的格式。
var Mirrors = []Mirror{
	{ID: "direct", Name: "GitHub", Prefix: ""},
	{ID: "ghproxy", Name: "gh-proxy.com", Prefix: "https://gh-proxy.com/"},
	{ID: "ghproxy-net", Name: "ghproxy.net", Prefix: "https://ghproxy.net/"},
	{ID: "ghfast", Name: "ghfast.top", Prefix: "https://ghfast.top/"},
}

// MirrorPreference 把 `--mirror` 的取值归一化。
//
// 空串 / "auto" / 无法识别的值一律走完整链路——**回退到「一个镜像都不试」会让
// 下载永久失败**，所以「不认识的输入」必须降级成 auto 而不是报错退出。
// 其余取值表示「钉死某一个镜像」，用于排查是哪个镜像在捣乱。
func MirrorPreference(value string) string {
	v := strings.ToLower(strings.TrimSpace(value))
	if v == "" || v == "auto" {
		return "auto"
	}
	for _, m := range Mirrors {
		if m.ID == v {
			return v
		}
	}
	return "auto"
}

// MirrorChain 按优先级给出候选镜像列表。
//
// preference 为 "auto" 时返回完整链路；否则只返回指定的那一个
// （此时不回退，便于定位「到底是不是这个镜像的问题」）。
func MirrorChain(preference string) []Mirror {
	pref := MirrorPreference(preference)
	if pref == "auto" {
		out := make([]Mirror, len(Mirrors))
		copy(out, Mirrors)
		return out
	}
	for _, m := range Mirrors {
		if m.ID == pref {
			return []Mirror{m}
		}
	}
	return []Mirror{Mirrors[0]}
}

// mirrorURL 把原始地址改写成走某个镜像的地址；直连则原样返回。
//
// 只改写**真正托管在上游 GitHub** 的地址（release 资产）。两个原因：
//   - 镜像只代理 GitHub；把别的地址（自建对象存储、测试里的 httptest）拼上去
//     只会得到 403，反而把「本来能直连的下载」弄坏；
//   - 测试用 httptest 起的假上游必须**不经镜像**，否则用例会打真实网络
//     （踩过：一个校验值失败的用例因此拿到 403 而不是「校验失败」）。
func mirrorURL(m Mirror, url string) string {
	if m.Prefix == "" || !isUpstreamGitHub(url) {
		return url
	}
	return m.Prefix + url
}

// isUpstreamGitHub 判断地址是否托管在 github.com 的 release 资产上。
func isUpstreamGitHub(raw string) bool {
	u, err := neturl.Parse(raw)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	if host != "github.com" && host != "objects.githubusercontent.com" &&
		host != "release-assets.githubusercontent.com" {
		return false
	}
	// 只代理 release 资产：仓库文件（raw）另有渠道，且不是我们下载的东西
	return strings.Contains(u.Path, "/releases/download/")
}
