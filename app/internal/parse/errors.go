// Package parse 的错误分类与诊断。
//
// 本文件是 shared/parse-error.ts 的 Go 移植（222 行，6 条 vitest 用例）。
//
// ## 为什么这块重要
//
// 它决定两件用户能感知的事：
//  1. 用户看到的是**可行动的提示**（「需要登录」/「更新 yt-dlp」）还是一条
//     「Error: exit status 1」；
//  2. 「提交 Issue」按钮出不出现——出现得不对会让仓库堆满空报告。
//
// 分类靠两层：先认**我方自己打的标记**（`[[parse-error:xxx]]`，来自渲染进程
// 与主进程之间的契约），再按 yt-dlp 的英文输出做启发式匹配。标记优先是因为
// 它精确；启发式只是兜底。
package parse

import (
	"regexp"
	"strings"
)

// ErrorKind 是错误类别。
type ErrorKind string

const (
	KindUnsupportedURL     ErrorKind = "unsupported-url"
	KindInvalidURL         ErrorKind = "invalid-url"
	KindRuntimeUnavailable ErrorKind = "runtime-unavailable"
	KindFormatUnavailable  ErrorKind = "format-unavailable"
	KindPageReload         ErrorKind = "page-reload"
	KindChallengeFailed    ErrorKind = "challenge-failed"
	KindAuthentication     ErrorKind = "authentication"
	KindAccessDenied       ErrorKind = "access-denied"
	KindNetwork            ErrorKind = "network"
	KindNotFound           ErrorKind = "not-found"
	KindRateLimit          ErrorKind = "rate-limit"
	// KindPlatformBlocked 表示「站点要求请求签名 / 人机验证，本应用当前拿不到」。
	//
	// 与 authentication 分开是必须的：抖音的 403 是 `ArgusSecurityPlugin
	// Signature Not Found`（缺 a_bogus 签名），快手是 GraphQL 返回
	// `Need captcha`（滑块验证）。两者**配 Cookie 也解决不了**——实测带完整
	// 浏览器登录态仍然被拒。归到 authentication 会让用户反复去配 Cookie，
	// 而那条路是死的。
	KindPlatformBlocked ErrorKind = "platform-blocked"
	KindUnknown         ErrorKind = "unknown"
)

// ParseMessages 是每类错误给人的话。
//
// 文案与 TS 逐字一致：界面上已经按这些文案做过截图与文档，
// 改动会让人以为出了别的问题。
var ParseMessages = map[ErrorKind]string{
	KindUnsupportedURL:     "暂不支持该网站或链接类型",
	KindInvalidURL:         "请输入有效的链接",
	KindRuntimeUnavailable: "YouTube 解析需要可运行的 Node.js 22+ 或 Deno 2.3+",
	KindFormatUnavailable:  "未找到可下载的视频格式，请检查运行依赖或登录状态",
	KindPageReload:         "YouTube 客户端解析失败，请更新 yt-dlp 后重试",
	KindChallengeFailed:    "YouTube 验证脚本执行失败，请检查 JS 运行时和 yt-dlp",
	KindAuthentication:     "该视频需要登录或访问权限，请检查 Cookies 设置",
	KindAccessDenied:       "网站拒绝了访问请求，请检查权限或稍后重试",
	KindNetwork:            "网络请求失败或超时，请检查连接后重试",
	KindNotFound:           "视频不存在、不可用或已被删除",
	KindRateLimit:          "网站请求过于频繁，请稍后重试",
	KindPlatformBlocked:    "该平台要求请求签名或人机验证，当前版本无法解析。请在浏览器中打开该链接后手动下载",
	KindUnknown:            "无法解析该链接",
}

// markerPattern 匹配我方自己打的标记。
//
// 两种形态都认：
//   - `[[parse-error:xxx]]`  —— 渲染进程从主进程收到的消息里带
//   - `错误类别：xxx`        —— 诊断文本里的中文形态
var markerPattern = regexp.MustCompile(`(?:\[\[parse-error:|错误类别：)([\w-]+)`)

// 启发式规则。
//
// **顺序有意义**：后面的规则更宽泛，放前面会把具体错误吃掉。
// 例如 `403` 同时能匹配 access-denied 与 network 的某些形态。
var classifyRules = []struct {
	kind ErrorKind
	re   *regexp.Regexp
}{
	{KindUnsupportedURL, regexp.MustCompile(`(?i)Unsupported URL`)},
	// 平台要求请求签名 / 人机验证。**必须排在 access-denied 与 authentication
	// 之前**：抖音这条响应是 403 开头（会被 403 规则吃掉），快手那条带
	// "captcha" 字样。两条都是「配 Cookie 也没用」，说成「需要登录」会误导用户。
	{KindPlatformBlocked, regexp.MustCompile(`(?i)ArgusSecurityPlugin|Need captcha|verification_filter|status_code"\s*:\s*11110`)},
	{KindInvalidURL, regexp.MustCompile(`(?i)not a valid URL|请输入有效的链接`)},
	{KindFormatUnavailable, regexp.MustCompile(`(?i)Requested format is not available|No video formats found|Only images are available`)},
	{KindPageReload, regexp.MustCompile(`(?i)The page needs to be reloaded`)},
	{KindChallengeFailed, regexp.MustCompile(`(?i)challenge.*fail|signature.*fail|No supported JavaScript runtime`)},
	// 抖音 / 快手的 API 对「没有新鲜 cookie」的请求直接返回空，yt-dlp 的原话是
	// `Fresh cookies (not necessarily logged in) are needed`：不需要登录，但必须有
	// 一次真实浏览器会话产生的 cookie（ttwid / msToken 等）。归到 authentication，
	// 界面才会提示去配置 Cookie，而不是说「无法解析该链接」。
	{KindAuthentication, regexp.MustCompile(`(?i)Sign in|private video|登录|authentication|cookies? .{0,40}needed`)},
	{KindRateLimit, regexp.MustCompile(`(?i)429|Too Many Requests`)},
	{KindAccessDenied, regexp.MustCompile(`(?i)403|Forbidden`)},
	{KindNetwork, regexp.MustCompile(`(?i)timed? out|timeout|network|Unable to download.*page|ConnectionError`)},
	{KindNotFound, regexp.MustCompile(`(?i)Video unavailable|404|not found|已被删除`)},
}

// ClassifyParseError 判断错误类别。
//
// 先认标记，再走启发式：标记是我方打的，精确；启发式靠 yt-dlp 的英文输出，
// 会随上游改文案而失效——那时退化为 unknown，仍能给出可读提示。
func ClassifyParseError(raw string) ErrorKind {
	if m := markerPattern.FindStringSubmatch(raw); m != nil {
		kind := ErrorKind(m[1])
		// 只接受已知类别：手工构造的 `[[parse-error:whatever]]` 不该被当成有效分类
		if _, ok := ParseMessages[kind]; ok {
			return kind
		}
	}
	for _, rule := range classifyRules {
		if rule.re.MatchString(raw) {
			return rule.kind
		}
	}
	return KindUnknown
}

// safeVersionPattern 限定诊断里能出现的版本号形态。
//
// 只允许 `node@1.2.3` / `deno@1.2.3` 与 yt-dlp 的日期版本 `2026.10.10.233141`。
// **绝不能**把原始子进程输出拼进诊断——里面可能带 URL、token、Cookie。
var safeVersionPattern = regexp.MustCompile(`^(?:(?:node|deno)@\d+\.\d+\.\d+|\d{4}\.\d{2}\.\d{2}(?:\.\d+)?)$`)

var (
	ytdlpVersionInRaw   = regexp.MustCompile(`(?:^|\n)ytdlp：([^\n]+)`)
	runtimeVersionInRaw = regexp.MustCompile(`(?:^|\n)runtime：([^\n]+)`)
)

// Versions 是诊断时能附带的版本信息。
type Versions struct {
	Ytdlp   string
	Runtime string
}

// ParseDiagnostic 生成脱敏诊断。
//
// **诊断只输出允许公开的类别和版本，绝不拼接原始子进程输出。**
// 这条约束是 Issue 模板的基础：用户把诊断贴出来时，不该连带泄露 URL 与 Cookie。
func ParseDiagnostic(raw string, versions Versions) string {
	return ParseDiagnosticWithKind(raw, ClassifyParseError(raw), versions)
}

// classifyForURL 在通用分类之上补一层「站点上下文」。
//
// 抖音 / 快手的分享短链对**匿名请求**会被重定向到站点首页，yt-dlp 收到首页
// 地址只会说 `Unsupported URL`。那不是「不支持该网站」，所以不按
// unsupported-url 报。
//
// 但改判成**什么**要分清：
//   - 快手：yt-dlp 上游**没有** Kuaishou extractor，`Unsupported URL` 是字面事实，
//     与 Cookie 无关 → 保持 unsupported-url。
//   - 抖音：有 extractor，失败原因是缺签名/cookie → platform-blocked。
//
// 早先两者都改判成 authentication，于是界面提示「请检查 Cookies 设置」，
// 而实测带完整浏览器登录态依然被拒（见 KindPlatformBlocked 注释）。
func classifyForURL(raw, pageURL string) ErrorKind {
	kind := ClassifyParseError(raw)
	if kind != KindUnsupportedURL {
		return kind
	}
	if IsKuaishou(pageURL) {
		return KindUnsupportedURL
	}
	if IsDouyin(pageURL) {
		return KindPlatformBlocked
	}
	return kind
}

// ParseDiagnosticWithKind 用调用方已经判定的类别生成诊断文本。
//
// 单独开一个入口是因为有一处需要「按上下文改判」：抖音短链的
// Unsupported URL 要改判成 platform-blocked（见 classifyForURL）。
func ParseDiagnosticWithKind(raw string, kind ErrorKind, versions Versions) string {
	lines := []string{"错误类别：" + string(kind), ParseMessages[kind]}

	ytdlp := versions.Ytdlp
	if ytdlp == "" {
		ytdlp = firstSubmatch(ytdlpVersionInRaw, raw)
	}
	runtime := versions.Runtime
	if runtime == "" {
		runtime = firstSubmatch(runtimeVersionInRaw, raw)
	}

	// map 迭代顺序随机 → 用固定顺序输出，否则同一输入会生成逐字不同的诊断文本
	for _, pair := range []struct{ name, value string }{
		{"ytdlp", ytdlp}, {"runtime", runtime},
	} {
		if pair.value != "" && safeVersionPattern.MatchString(pair.value) {
			lines = append(lines, pair.name+"："+pair.value)
		}
	}

	if regexp.MustCompile(`(?i)challenge.*fail|signature.*fail|No supported JavaScript runtime|诊断：JS 验证脚本未成功执行`).MatchString(raw) {
		lines = append(lines, "诊断：JS 验证脚本未成功执行")
	}
	if regexp.MustCompile(`(?i)PO Token|SABR|诊断：站点限制了部分流格式`).MatchString(raw) {
		lines = append(lines, "诊断：站点限制了部分流格式")
	}

	return strings.Join(lines, "\n")
}

func firstSubmatch(re *regexp.Regexp, s string) string {
	if m := re.FindStringSubmatch(s); m != nil {
		return strings.TrimSpace(m[1])
	}
	return ""
}

// IssueReport 是预填的 Issue 内容。
type IssueReport struct {
	Title string
	Body  string
}

// SafeIssueReport 生成预填的 Issue 标题与正文。
//
// 正文里只放脱敏诊断，不放原始错误——那里面可能有用户自己的链接。
func SafeIssueReport(message, detail string) IssueReport {
	combined := detail + "\n" + message
	kind := ClassifyParseError(combined)
	return IssueReport{
		Title: "[Bug] " + ParseMessages[kind],
		Body: "## 问题描述\n\n" + ParseMessages[kind] +
			"\n\n## 脱敏诊断\n\n" + ParseDiagnostic(combined, Versions{}) +
			"\n\n## 复现步骤\n\n请补充不含个人信息的复现步骤。",
	}
}

// NoIssueKinds 是**不应该**提供「提交 Issue」入口的类别。
//
// ## 为什么要有这个名单
//
// 有些错误的处置办法**已经在应用里**（配置 Cookie、更新 yt-dlp、换个链接），
// 它们不是代码缺陷，提 Issue 提不出任何可行动的信息。但界面对所有错误
// 都渲染「提交 Issue」按钮，应用又会自动生成一个只有错误类别、没有任何用户
// 输入的正文并预填。结果是：用户一路回车 → 仓库多一条
// 「该视频需要登录或访问权限，请检查 Cookies 设置」的空 Issue。
//
// 实测这类空报告会重复出现，维护者只能挨个关掉，真正有价值的报告反而被淹没。
//
// ## 名单内容
//
// 只放「用户自己能解决 / 不是缺陷」的类别：
//   - authentication      → 配置 Cookie 即可
//   - access-denied       → 403，多半是限流或需要登录
//   - rate-limit          → 等几分钟
//   - invalid-url         → 链接本身就是错的
//   - unsupported-url     → 站点不受支持，是已知边界
//   - runtime-unavailable → 装个 Node/Deno 即可
//   - not-found           → 视频已被删除
//   - platform-blocked    → 站点要求签名/验证，当前版本已明确不支持，
//     用户唯一能做的是去浏览器里下载。提 Issue 只会重复同一句「不支持」。
//
// **不要**把 format-unavailable / page-reload / challenge-failed / network / unknown
// 放进来——这些往往对应真实的解析回归（历史上 issue #50 就是 page-reload），
// 挡住了反而让维护者失去线索。
var NoIssueKinds = []ErrorKind{
	KindAuthentication,
	KindAccessDenied,
	KindRateLimit,
	KindInvalidURL,
	KindUnsupportedURL,
	KindRuntimeUnavailable,
	KindNotFound,
	KindPlatformBlocked,
}

// ShouldOfferIssue 判断这条错误是否值得开 Issue。
//
// kind 为空时（非解析类错误）保守地返回 true：那类错误（下载失败、代理不可用……）
// 没有「用户自己就能解决」的统一特征，宁可让用户能提。
func ShouldOfferIssue(kind ErrorKind) bool {
	if kind == "" {
		return true
	}
	for _, k := range NoIssueKinds {
		if k == kind {
			return false
		}
	}
	return true
}
