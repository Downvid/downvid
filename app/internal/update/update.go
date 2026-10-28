// Package update 实现「按链路依次尝试更新源」。
//
// 桌面端的正常更新路径已改为 `wml.go`（wmlUpdate）。本文件保留的链路只在
// `CheckUpdate` 遇到 `no_asset` 时用于显示版本与尝试轨迹，以及给诊断与
// TS ↔ Go 交叉验证使用；不要在新的生产路径里调用它。
//
// 本包是 shared/update-sources.ts（纯数据）与 shared/update-check.ts（执行）的 Go 移植。
// 两者合并成一个包，因为 Go 里把「纯数据」与「发请求」拆两个包只会增加 import 噪音。
//
// ## 这个包为什么值得单独移植
//
// 它是唯一涉及**网络降级链**的模块。判错了的表现是「更新永远失败但没有任何提示」——
// 而这是唯一一类「发新版也修不好」的故障：修好的代码要走的就是那条坏掉的通道。
//
// 关键设计（照搬 TS 的理由）：
//   - **不抛异常**。全挂时返回 release=nil + 轨迹，由调用方决定文案。
//     做成异常会让调用方到处写 try/catch，最后总有一处写成「catch 了就当作已是最新」。
//   - `httpClient` 由调用方注入：桌面端要走系统代理，容器用默认的，测试塞假实现。
package update

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// SourceID 是更新源标识。
//
// `auto` 表示「依次尝试整条链路」，不是真的一个源。
type SourceID string

const (
	SourceAuto     SourceID = "auto"
	SourceGitHub   SourceID = "github"
	SourceJSDelivr SourceID = "jsdelivr"
	SourceGHPROXY  SourceID = "ghproxy"
	SourceGitee    SourceID = "gitee"
	SourceWebsite  SourceID = "website"
)

// SourceIDs 是用户可选的源（`auto` 排第一，是默认值）。
var SourceIDs = []SourceID{
	SourceAuto, SourceGitHub, SourceJSDelivr, SourceGHPROXY, SourceGitee, SourceWebsite,
}

// AutoChain 是 `auto` 的降级顺序。
//
// `website` 排在最后是刻意的：它只能回答「最新版本是多少」，给不出安装包与校验值，
// 等于让用户手动去点下载页。把它放前面会让「自动更新」在 GitHub 短暂抽风时
// 悄悄退化成「手动下载」。
var AutoChain = []SourceID{
	SourceGitHub, SourceJSDelivr, SourceGHPROXY, SourceGitee, SourceWebsite,
}

// Failure 是单个源的失败原因分类。
//
// 分类而不是直接抛原文，是因为两种失败要**区别对待**：
//   - unreachable / rate-limited / server：换下一个源
//   - not-found：源是通的，只是这个仓库/版本不存在（Gitee 没同步、jsDelivr 还没缓存到新 tag）
//     ——同样换下一个，但要在诊断里说清楚
type Failure string

const (
	FailureUnreachable Failure = "unreachable"
	FailureRateLimited Failure = "rate-limited"
	FailureNotFound    Failure = "not-found"
	FailureServer      Failure = "server"
	FailureBadResponse Failure = "bad-response"
)

// ClassifyHTTPStatus 把 HTTP 状态码归类。
func ClassifyHTTPStatus(status int) Failure {
	switch {
	case status == 404 || status == 410 || status == 451:
		return FailureNotFound
	case status == 403 || status == 429:
		return FailureRateLimited
	case status >= 500:
		return FailureServer
	case status >= 400:
		return FailureNotFound
	default:
		return FailureBadResponse
	}
}

// ClassifyError 把网络异常归类为不可达。
//
// TS 侧原本还区分 abort/timeout，但两条分支都返回 unreachable——保留单一是因为
// 用户在两种情况下能做的事完全一样（换网络/配代理），分开只是给日志增加噪音。
func ClassifyError(err error) Failure {
	return FailureUnreachable
}

// Candidate 是一个候选地址。
type Candidate struct {
	Source SourceID
	// URL 是发起请求的完整地址
	URL string
	// Kind 说明该地址返回 JSON 元数据还是纯文本版本号
	Kind string // "json" | "text"
}

// Repo 是仓库坐标。由调用方注入，避免本包硬编码 owner/repo
// （硬编码的结果是换仓库时要改很多处，漏一处就永远收不到更新）。
type Repo struct {
	Owner string
	Repo  string
}

func (r Repo) Slug() string { return r.Owner + "/" + r.Repo }

// Endpoints 是各源需要的基址。
//
// 抽出来是为了让测试能替换成 httptest，而不必真的联网。
type Endpoints struct {
	GitHubAPI  string
	JSDelivr   string
	GHPROXYAPI string
	GiteeAPI   string
	WebsiteURL string
}

// DefaultEndpoints 是生产环境地址。
func DefaultEndpoints() Endpoints {
	return Endpoints{
		GitHubAPI:  "https://api.github.com",
		JSDelivr:   "https://data.jsdelivr.com",
		GHPROXYAPI: "https://gh-proxy.com",
		GiteeAPI:   "https://gitee.com/api/v5",
		WebsiteURL: "https://downvid-coral.vercel.app",
	}
}

// LatestCandidates 生成 `latest` 元数据的所有候选地址（按优先级）。
func LatestCandidates(source SourceID, repo Repo, ep Endpoints) []Candidate {
	chain := []SourceID{source}
	if source == SourceAuto {
		chain = AutoChain
	}

	slug := repo.Slug()
	out := make([]Candidate, 0, len(chain))
	for _, id := range chain {
		switch id {
		case SourceGitHub:
			out = append(out, Candidate{
				Source: SourceGitHub,
				URL:    fmt.Sprintf("%s/repos/%s/releases/latest", ep.GitHubAPI, slug),
				Kind:   "json",
			})
		case SourceJSDelivr:
			// jsDelivr 的 GitHub 镜像 API：不限流、国内可达。
			// 返回的不是 GitHub Release 的形状，字段由 ParseLatestPayload 归一化。
			out = append(out, Candidate{
				Source: SourceJSDelivr,
				URL:    fmt.Sprintf("%s/v1/packages/gh/%s", ep.JSDelivr, slug),
				Kind:   "json",
			})
		case SourceGHPROXY:
			// gh-proxy 系列：把完整 URL 拼在反代域名后面。API 与 raw 都能透传。
			out = append(out, Candidate{
				Source: SourceGHPROXY,
				URL:    fmt.Sprintf("%s/%s/repos/%s/releases/latest", ep.GHPROXYAPI, ep.GitHubAPI, slug),
				Kind:   "json",
			})
		case SourceGitee:
			// Gitee 的 Release API 形状与 GitHub 不同：返回数组，没有 /latest。
			out = append(out, Candidate{
				Source: SourceGitee,
				URL:    fmt.Sprintf("%s/repos/%s/releases?per_page=1", ep.GiteeAPI, slug),
				Kind:   "json",
			})
		case SourceWebsite:
			// 官网把最新版本写在一个稳定的纯文本端点。之所以不是 `?format=json`：
			// 纯文本没有解析歧义，也方便用户自己 curl 验证。
			out = append(out, Candidate{
				Source: SourceWebsite,
				URL:    ep.WebsiteURL + "/version.txt",
				Kind:   "text",
			})
		}
	}
	return out
}

// Release 是归一化后的最新版本信息。
type Release struct {
	Version     string   `json:"version"`
	ReleaseNote string   `json:"releaseNotes"`
	ReleaseDate string   `json:"releaseDate"`
	Source      SourceID `json:"source"`
	// Assets 是这次 Release 挂的全部文件名。
	//
	// 需要它来判断「这一版有没有发布新架构（Wails）的产物」。
	// 只有 GitHub / Gitee 的 API 会给这个字段；jsDelivr / 官网只报版本号，
	// 此时 Assets 为空 —— 调用方据此区分「确定没有」与「不知道」。
	Assets []string `json:"assets,omitempty"`
	// AssetDetails 是与 Assets 一一对应的详细信息（URL / sha512 / 大小）。
	//
	// 自更新需要 URL 与校验值；只给文件名的话，调用方还得自己拼
	// `releases/download/vX/<name>`，那条规则变一次就全错。
	AssetDetails []Asset `json:"assetDetails,omitempty"`
}

// Asset 是 Release 里的一个产物。
type Asset struct {
	Name string `json:"name"`
	// URL 是浏览器的下载直链（GitHub 的 browser_download_url）
	URL string `json:"url,omitempty"`
	// Size 是字节数，用于下载时校验长度
	Size int64 `json:"size,omitempty"`
	// Digest 是 GitHub 提供的摘要，形如 `sha256:abc...`；可能为空
	Digest string `json:"digest,omitempty"`
	// SHA512 来自同名 `.sha512` 附件（若发布流程提供）
	SHA512 string `json:"sha512,omitempty"`
}

// versionPattern 与 TS 的 `/^\d+(\.\d+)*([.-][0-9A-Za-z.-]+)?$/` 对应。
//
// 只认「数字开头、点分段、可选预发布后缀」的形式。宁可拒绝一个奇怪但合法的
// 版本号（换下一个源），也不要接受一个看起来像版本号的任意字符串——
// 后者会被当成「有新版本」推给用户。
var versionPattern = regexp.MustCompile(`^\d+(\.\d+)*([.-][0-9A-Za-z.-]+)?$`)

var prereleasePattern = regexp.MustCompile(`(?i)-(beta|alpha|rc|pre)`)

func normalizeVersion(v any) (string, bool) {
	s, ok := v.(string)
	if !ok {
		return "", false
	}
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(strings.TrimPrefix(s, "v"), "V")
	if !versionPattern.MatchString(s) {
		return "", false
	}
	return s, true
}

// ParseLatestPayload 把各源的响应归一化成 Release。
//
// 返回 ok=false 表示「这个源的响应解析不出可用的版本号」，调用方应当换下一个源。
// 各源形状差异：
//   - GitHub：`{ tag_name, body, published_at }`
//   - jsDelivr：`{ versions: [{ version }] }`（版本号不带 v，且顺序不保证）
//   - Gitee：`[{ tag_name, body, created_at }]`（数组）
//   - website：`v1.4.0` 纯文本
func ParseLatestPayload(source SourceID, payload any) (Release, bool) {
	if source == SourceWebsite {
		v, ok := normalizeVersion(payload)
		if !ok {
			return Release{}, false
		}
		return Release{Version: v, Source: source}, true
	}

	if source == SourceJSDelivr {
		obj, ok := payload.(map[string]any)
		if !ok {
			return Release{}, false
		}
		list, ok := obj["versions"].([]any)
		if !ok {
			return Release{}, false
		}
		// jsDelivr 的 versions 是「所有 tag」，顺序不保证 → 自己挑最大的稳定版。
		// 只挑稳定版：预发布不应通过这条通道推给稳定用户。
		var stable []string
		for _, entry := range list {
			e, ok := entry.(map[string]any)
			if !ok {
				continue
			}
			v, ok := normalizeVersion(e["version"])
			if !ok || prereleasePattern.MatchString(v) {
				continue
			}
			stable = append(stable, v)
		}
		if len(stable) == 0 {
			return Release{}, false
		}
		sort.SliceStable(stable, func(i, j int) bool { return CompareVersions(stable[i], stable[j]) < 0 })
		return Release{Version: stable[len(stable)-1], Source: source}, true
	}

	// GitHub 与 Gitee 都是 `tag_name` + `body`；Gitee 外面还包了一层数组
	node := payload
	if arr, ok := payload.([]any); ok {
		if len(arr) == 0 {
			return Release{}, false
		}
		node = arr[0]
	}
	obj, ok := node.(map[string]any)
	if !ok {
		return Release{}, false
	}

	rawTag := obj["tag_name"]
	if rawTag == nil {
		rawTag = obj["name"]
	}
	version, ok := normalizeVersion(rawTag)
	if !ok {
		return Release{}, false
	}

	notes, _ := obj["body"].(string)
	date := ""
	if d, ok := obj["published_at"].(string); ok {
		date = d
	} else if d, ok := obj["created_at"].(string); ok {
		date = d
	}

	// GitHub / Gitee 都叫 `assets`，每项里有 `name`
	var assets []string
	var details []Asset
	if list, ok := obj["assets"].([]any); ok {
		for _, raw := range list {
			a, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			name, _ := a["name"].(string)
			if name == "" {
				continue
			}
			assets = append(assets, name)

			detail := Asset{Name: name}
			if u, ok := a["browser_download_url"].(string); ok {
				detail.URL = u
			}
			if sz, ok := a["size"].(float64); ok {
				detail.Size = int64(sz)
			}
			if dg, ok := a["digest"].(string); ok {
				detail.Digest = dg
			}
			details = append(details, detail)
		}
	}

	return Release{
		Version: version, ReleaseNote: notes, ReleaseDate: date, Source: source,
		Assets: assets, AssetDetails: details,
	}, true
}

// CompareVersions 按「数字段逐个比较」判断 a 与 b 的先后，返回 -1 / 0 / 1。
//
// 与 electron/updater.ts 的实现**必须一致**——两边各判一次「有没有更新」，
// 判法不同会让「设置里说有更新、弹窗说已最新」。Go 侧成为唯一实现后，
// 桌面端与容器端都调它。
func CompareVersions(a, b string) int {
	parse := func(v string) []int {
		v = strings.TrimPrefix(strings.TrimPrefix(v, "v"), "V")
		parts := regexp.MustCompile(`[.-]`).Split(v, -1)
		out := make([]int, len(parts))
		for i, p := range parts {
			n, _ := strconv.Atoi(p)
			out[i] = n
		}
		return out
	}
	pa, pb := parse(a), parse(b)
	n := len(pa)
	if len(pb) > n {
		n = len(pb)
	}
	for i := 0; i < n; i++ {
		var x, y int
		if i < len(pa) {
			x = pa[i]
		}
		if i < len(pb) {
			y = pb[i]
		}
		if x != y {
			return x - y
		}
	}
	return 0
}

// SourceLabels 是源的展示名（诊断与日志用；界面文案仍走 i18n）。
var SourceLabels = map[SourceID]string{
	SourceGitHub:   "GitHub API",
	SourceJSDelivr: "jsDelivr",
	SourceGHPROXY:  "gh-proxy",
	SourceGitee:    "Gitee",
	SourceWebsite:  "官网",
}

// DescribeFailure 生成人话版的失败说明。
//
// 不把 HTTP 细节直接抛给用户：「403」对用户毫无意义，而「这个源限流了，
// 正在换下一个」能让他知道不是自己网络坏了。
func DescribeFailure(source SourceID, failure Failure) string {
	label := SourceLabels[source]
	switch failure {
	case FailureUnreachable:
		return label + " 无法连接"
	case FailureRateLimited:
		return label + " 请求被限流"
	case FailureNotFound:
		return label + " 上找不到这个版本"
	case FailureServer:
		return label + " 服务异常"
	default:
		return label + " 返回了无法解析的内容"
	}
}

// NormalizeSource 校验设置里的源 id。
//
// 存档值可能是旧版本、手工改坏或未来版本；非法值一律回退 `auto`，
// 而不是原样保留——否则「一个源都不试」会表现成「永远没有更新」。
func NormalizeSource(value any) SourceID {
	s, ok := value.(string)
	if !ok {
		return SourceAuto
	}
	for _, id := range SourceIDs {
		if string(id) == s {
			return id
		}
	}
	return SourceAuto
}

// ===== 链路执行（原 update-check.ts）=====

// HTTPResponse 是注入的客户端要返回的最小形状。
//
// 刻意不直接用 *http.Response：调用方（桌面端）可能要走 Electron 的 session，
// 容器端用标准库，测试塞假实现。抽象出最小接口让三种场景都能接。
type HTTPResponse struct {
	OK     bool
	Status int
	// Body 是完整响应体；调用方负责按 Kind 解析
	Body []byte
}

// HTTPClient 发一个 GET。
//
// `timeout` 由链路统一控制，实现方应尊重它（标准库实现用 context）。
type HTTPClient func(ctx context.Context, url string, headers map[string]string) (HTTPResponse, error)

// Attempt 是一次尝试的轨迹。
type Attempt struct {
	Source  SourceID `json:"source"`
	URL     string   `json:"url"`
	OK      bool     `json:"ok"`
	Failure Failure  `json:"failure,omitempty"`
	// Detail 是失败的人话说明（写日志/诊断面板用，不直接给最终用户）
	Detail string `json:"detail,omitempty"`
}

// LookupResult 是链路执行结果。
type LookupResult struct {
	// Release 全部成功时为解析结果；全挂时为 nil
	Release *Release `json:"release"`
	// Attempts 是每一次尝试的轨迹，顺序与链路一致
	Attempts []Attempt `json:"attempts"`
}

// LookupOptions 是链路执行参数。
type LookupOptions struct {
	Source   SourceID
	Client   HTTPClient
	Repo     Repo
	Endpoint Endpoints
	// TimeoutMs 是单源超时。默认 8 秒：比一个 TTFB 宽松，又不至于让链路整体拖太久
	TimeoutMs int
	Headers   map[string]string
	// RequireAssets 表示只有带产物清单（AssetDetails）的结果才算成功。
	//
	// 自更新下载需要 URL 与校验值，而 jsDelivr / 官网只报版本号。不加这个
	// 约束时链路会在 jsDelivr 就停下：界面显示「有新版本」，点下载却因为
	// 没有安装包而退回浏览器。GitHub 被限流、但 gh-proxy 可用时，这个
	// 区别决定更新能不能完成。
	RequireAssets bool
	// OnAttempt 在每个源失败时回调（主进程用它写日志）
	OnAttempt func(Attempt)
}

// LookupLatestRelease 沿链路找最新版本。
//
// **不返回错误**：全挂时 release=nil + 轨迹，由调用方决定文案。
// 这里刻意不返回 error——「更新检查失败」是预期内的常见情况（离线、限流、
// 国内网络），把它做成错误会让调用方到处写 if err != nil，最后总有一处写成
// 「出错了就当作已是最新」，那正是最难发现的故障。
func LookupLatestRelease(opts LookupOptions) LookupResult {
	if opts.Source == "" {
		opts.Source = SourceAuto
	}
	if opts.Endpoint == (Endpoints{}) {
		opts.Endpoint = DefaultEndpoints()
	}
	timeout := opts.TimeoutMs
	if timeout <= 0 {
		timeout = 8000
	}

	attempts := []Attempt{}
	candidates := LatestCandidates(opts.Source, opts.Repo, opts.Endpoint)

	// RequireAssets 时，只给版本号的源不能算终点：先记下来，继续找
	// 能给产物清单的源。全都给不出时再退回它，让调用方给出「手动下载」提示。
	var versionOnly *Release

	headers := map[string]string{"Accept": "application/json, text/plain;q=0.9"}
	for k, v := range opts.Headers {
		headers[k] = v
	}

	for _, c := range candidates {
		ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Millisecond)
		resp, err := opts.Client(ctx, c.URL, headers)
		cancel()

		if err != nil {
			failure := ClassifyError(err)
			a := Attempt{Source: c.Source, URL: c.URL, OK: false, Failure: failure,
				Detail: DescribeFailure(c.Source, failure)}
			attempts = append(attempts, a)
			if opts.OnAttempt != nil {
				opts.OnAttempt(a)
			}
			continue
		}

		if !resp.OK {
			failure := ClassifyHTTPStatus(resp.Status)
			a := Attempt{Source: c.Source, URL: c.URL, OK: false, Failure: failure,
				Detail: DescribeFailure(c.Source, failure)}
			attempts = append(attempts, a)
			if opts.OnAttempt != nil {
				opts.OnAttempt(a)
			}
			continue
		}

		var payload any
		if c.Kind == "text" {
			payload = string(resp.Body)
		} else {
			if err := json.Unmarshal(resp.Body, &payload); err != nil {
				a := Attempt{Source: c.Source, URL: c.URL, OK: false, Failure: FailureBadResponse,
					Detail: DescribeFailure(c.Source, FailureBadResponse)}
				attempts = append(attempts, a)
				if opts.OnAttempt != nil {
					opts.OnAttempt(a)
				}
				continue
			}
		}

		release, ok := ParseLatestPayload(c.Source, payload)
		if !ok {
			a := Attempt{Source: c.Source, URL: c.URL, OK: false, Failure: FailureBadResponse,
				Detail: DescribeFailure(c.Source, FailureBadResponse)}
			attempts = append(attempts, a)
			if opts.OnAttempt != nil {
				opts.OnAttempt(a)
			}
			continue
		}

		// 经 gh-proxy 拿到的 JSON 里，产物 URL 仍是 github.com 直链。
		// 下载也必须走同一条反代，否则会出现「检查成功、下载失败」。
		if c.Source == SourceGHPROXY {
			for i := range release.AssetDetails {
				release.AssetDetails[i].URL = MirrorURL(opts.Endpoint.GHPROXYAPI, release.AssetDetails[i].URL)
			}
		}

		if opts.RequireAssets && len(release.AssetDetails) == 0 {
			if versionOnly == nil {
				versionOnly = &release
			}
			a := Attempt{Source: c.Source, URL: c.URL, OK: true,
				Detail: "只有版本号，没有产物清单，继续找可下载的源"}
			attempts = append(attempts, a)
			if opts.OnAttempt != nil {
				opts.OnAttempt(a)
			}
			continue
		}

		a := Attempt{Source: c.Source, URL: c.URL, OK: true}
		attempts = append(attempts, a)
		if opts.OnAttempt != nil {
			opts.OnAttempt(a)
		}
		return LookupResult{Release: &release, Attempts: attempts}
	}

	if versionOnly != nil {
		return LookupResult{Release: versionOnly, Attempts: attempts}
	}
	return LookupResult{Release: nil, Attempts: attempts}
}

// MirrorURL 把 GitHub Release 直链改写成反代地址。
//
// 只改真正托管在 github.com 的 URL：Gitee、自建对象存储、测试服务器，
// 以及**已经反代过**的地址都必须原样使用（二次拼接会得到不可访问的 URL）。
func MirrorURL(proxyBase, rawURL string) string {
	if rawURL == "" || proxyBase == "" || !isGitHubURL(rawURL) {
		return rawURL
	}
	return strings.TrimSuffix(proxyBase, "/") + "/" + rawURL
}

// githubMirrors 是 GitHub Release 直链的公共反代（顺序即优先级）。
//
// 与 backend/internal/fetch 的镜像思路一致，但不共享代码：那是另一个模块，
// 且这里只处理 Release 直链。
var githubMirrors = []string{
	"https://gh-proxy.com",
	"https://ghproxy.net",
	"https://ghfast.top",
}

// DownloadURLs 返回一个产物的下载候选：优先用「已经验证可用的反代」，
// 再退回 GitHub 直链与其它反代。
//
// 经 gh-proxy 检查到的 Release，其产物 URL 已被改写成反代地址；这里识别出
// 内层的 GitHub 直链，才能在该反代挂掉时继续换下一个，而不是只试一次。
func DownloadURLs(rawURL string) []string {
	if rawURL == "" {
		return nil
	}
	if isGitHubURL(rawURL) {
		return githubDownloadURLs(rawURL, "")
	}
	for _, base := range githubMirrors {
		prefix := strings.TrimSuffix(base, "/") + "/"
		if strings.HasPrefix(rawURL, prefix) {
			if inner := strings.TrimPrefix(rawURL, prefix); isGitHubURL(inner) {
				return githubDownloadURLs(inner, rawURL)
			}
		}
	}
	// 非 GitHub 托管（Gitee / 自建存储）：原样使用
	return []string{rawURL}
}

func githubDownloadURLs(githubURL, first string) []string {
	out := make([]string, 0, len(githubMirrors)+1)
	if first != "" {
		out = append(out, first)
	}
	out = append(out, githubURL)
	for _, base := range githubMirrors {
		u := strings.TrimSuffix(base, "/") + "/" + githubURL
		if u != first {
			out = append(out, u)
		}
	}
	return out
}

// isGitHubURL 判断 URL 是否真正托管在 github.com。
//
// 不能用 `strings.Contains(rawURL, "github.com")`：反代地址形如
// `https://gh-proxy.com/https://github.com/...`，子串判断会再次拼接。
func isGitHubURL(rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	return strings.EqualFold(u.Host, "github.com")
}

// SummarizeFailures 把整条链路的失败轨迹压成一句用户能看懂的话。
//
// 只列**试过的源**，不列 HTTP 码：用户能采取的行动只有「换个网络 / 配代理 /
// 手动去下载页」，堆细节只会让他以为是自己搞错了什么。
func SummarizeFailures(attempts []Attempt) string {
	if len(attempts) == 0 {
		return "没有可用的更新源"
	}
	names := make([]string, len(attempts))
	for i, a := range attempts {
		f := a.Failure
		if f == "" {
			f = FailureUnreachable
		}
		names[i] = DescribeFailure(a.Source, f)
	}
	return strings.Join(names, "；")
}

// DefaultHTTPClient 用标准库发请求（容器端与测试用）。
//
// 桌面端需要走系统代理，会注入自己的实现——这也是本包只要接口的原因。
func DefaultHTTPClient(ctx context.Context, url string, headers map[string]string) (HTTPResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return HTTPResponse{}, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return HTTPResponse{}, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20)) // 8 MiB 上限：元数据不该有这么大
	if err != nil {
		return HTTPResponse{}, err
	}

	return HTTPResponse{OK: resp.StatusCode >= 200 && resp.StatusCode < 300, Status: resp.StatusCode, Body: body}, nil
}

// ErrNoRelease 是「链路全挂」的哨兵错误。
//
// LookupLatestRelease 本身不返回 error；这个值留给上层在需要「必须拿到版本号」
// 的场景里包一层用，避免各处自己造一个同义错误。
var ErrNoRelease = errors.New("no update source returned a usable version")
