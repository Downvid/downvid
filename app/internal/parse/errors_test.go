package parse

import (
	"strings"
	"testing"
)

// tests/parse-error.test.ts 的 6 条断言逐条移植（含 youtube-retry 的 3 条）。

// --- 不把不支持的网址误报成无效链接 ---

func TestClassifyDoesNotConfuseUnsupportedWithInvalid(t *testing.T) {
	kind := ClassifyParseError("ERROR: Unsupported URL: https://example.com/video")
	if ParseMessages[kind] != "暂不支持该网站或链接类型" {
		t.Fatalf("got %q", ParseMessages[kind])
	}
	if got := ClassifyParseError("not a valid URL"); got != KindInvalidURL {
		t.Fatalf("got %s", got)
	}
}

// --- 诊断与 Issue 草稿只保留允许公开的字段 ---

func TestDiagnosticKeepsOnlyPublicFields(t *testing.T) {
	raw := "ERROR: Requested format is not available https://example.invalid/?token=fixture-secret " +
		"cookie=fixture-secret /private/fixture/local-file"

	diagnostic := ParseDiagnostic(raw, Versions{Ytdlp: "2026.10.10.233141", Runtime: "node@22.0.0"})
	if !strings.Contains(diagnostic, "format-unavailable") {
		t.Fatalf("诊断应含错误类别，got %q", diagnostic)
	}
	if !strings.Contains(diagnostic, "node@22.0.0") {
		t.Fatalf("诊断应含运行时版本，got %q", diagnostic)
	}

	report := SafeIssueReport(raw, diagnostic+"\n"+raw)
	combined := report.Title + "\n" + report.Body
	for _, secret := range []string{"fixture-secret", "local-file", "https://"} {
		if strings.Contains(combined, secret) {
			t.Fatalf("Issue 草稿不该包含 %q（用户贴出来会泄露自己的链接与 Cookie）\n%s", secret, combined)
		}
	}
	if !strings.Contains(combined, "2026.10.10.233141") {
		t.Fatalf("Issue 草稿应保留版本号，got %q", combined)
	}

	// 非法的运行时版本（路径）不该出现
	if strings.Contains(ParseDiagnostic(raw, Versions{Runtime: "/private/fixture/tool"}), "/private") {
		t.Fatal("诊断不该包含路径形态的运行时值")
	}
}

// --- 格式错误保留挑战失败的诊断依据 ---

func TestDiagnosticKeepsChallengeHint(t *testing.T) {
	got := ParseDiagnostic("WARNING: signature solving failed\nERROR: Requested format is not available", Versions{})
	if !strings.Contains(got, "JS 验证脚本未成功执行") {
		t.Fatalf("got %q", got)
	}
}

// ===== YouTube 有限回退策略 =====

func TestRetryFormatUnavailableOnce(t *testing.T) {
	initial := RetryState{}
	next := NextYoutubeRetry("Requested format is not available", initial, "")
	if next == nil {
		t.Fatal("首次格式错误应允许回退一次")
	}
	if args := YoutubeExtractorArgs(*next); len(args) != 0 {
		t.Fatalf("仅放开 manifest 时不该带 --extractor-args，got %v", args)
	}
	if again := NextYoutubeRetry("Requested format is not available", *next, ""); again != nil {
		t.Fatal("第二次格式错误不该再回退（无上限重试会把一次解析拖成几十秒）")
	}
}

func TestRetryPageReloadPicksClientByVersion(t *testing.T) {
	initial := RetryState{}

	old := NextYoutubeRetry("The page needs to be reloaded", initial, "2026.09.01")
	if old == nil || !strings.Contains(old.Client, "web_safari") {
		t.Fatalf("旧版本应选 web_safari，got %+v", old)
	}

	current := NextYoutubeRetry("The page needs to be reloaded", initial, "2026.10.10.233141")
	if current == nil || current.Client != "default,web_embedded,-tv_downgraded" {
		t.Fatalf("新版本应选 default,web_embedded，got %+v", current)
	}

	args := YoutubeExtractorArgs(*current)
	if len(args) != 2 || !strings.Contains(args[1], "skip=hls,dash;player_client=") {
		t.Fatalf("应合并格式策略与客户端，got %v", args)
	}

	if again := NextYoutubeRetry("The page needs to be reloaded", *current, ""); again != nil {
		t.Fatal("已设过 client 后不该再回退")
	}
}

func TestRetryNotTriggeredByOtherErrors(t *testing.T) {
	initial := RetryState{}
	for _, msg := range []string{
		"Connection timed out",
		"Sign in to confirm",
		"Unsupported URL",
		"Unable to download API page: HTTP Error 403: Forbidden",
	} {
		if got := NextYoutubeRetry(msg, initial, ""); got != nil {
			t.Errorf("%q 不该触发客户端回退，got %+v", msg, got)
		}
	}
	if got := ClassifyParseError("Unable to download API page: HTTP Error 403: Forbidden"); got != KindAccessDenied {
		t.Fatalf("got %s", got)
	}
}

// --- 版本判断的边界 ---

func TestIsCurrentVersion(t *testing.T) {
	cases := map[string]bool{
		"2026.10.10":        true,  // 恰好等于分界
		"2026.10.10.233141": true,  // 完整日期版本
		"2026.10.09":        false, // 差一天
		"2026.09.30":        false,
		"2027.01.01":        true,
		"":                  false, // 空版本 → 保守走老组合
		"2026.1.1":          false, // 格式不对（位数不够）
		"not-a-version":     false,
	}
	for version, want := range cases {
		if got := isCurrentVersion(version); got != want {
			t.Errorf("isCurrentVersion(%q) = %v, want %v", version, got, want)
		}
	}
}

// --- ShouldOfferIssue 名单必须与注释里的约定一致 ---

func TestShouldOfferIssue(t *testing.T) {
	// 用户自己能解决的：不该给 Issue 入口
	for _, k := range []ErrorKind{
		KindAuthentication, KindAccessDenied, KindRateLimit,
		KindInvalidURL, KindUnsupportedURL, KindRuntimeUnavailable, KindNotFound,
		KindPlatformBlocked,
	} {
		if ShouldOfferIssue(k) {
			t.Errorf("%s 是用户自己能解决的，不该提示提 Issue", k)
		}
	}
	// 往往对应真实回归的：必须给入口
	for _, k := range []ErrorKind{
		KindFormatUnavailable, KindPageReload, KindChallengeFailed, KindNetwork, KindUnknown,
	} {
		if !ShouldOfferIssue(k) {
			t.Errorf("%s 可能是真实回归，必须保留 Issue 入口（历史上 #50 就是 page-reload）", k)
		}
	}
	// 非解析类错误保守给入口
	if !ShouldOfferIssue("") {
		t.Error("未分类错误应给 Issue 入口")
	}
}

// 抖音/快手短链的 Unsupported URL 不能笼统报成「需要登录」。
//
// 实测（本机，带完整 Chrome 登录态）：
//   - 抖音：`/aweme/v1/web/aweme/detail/` 一律 403 `ArgusSecurityPlugin
//     Signature Not Found`，缺的是 a_bogus 请求签名，**配 Cookie 解决不了**；
//   - 快手：yt-dlp 上游没有 Kuaishou extractor，`Unsupported URL` 是字面事实。
//
// 早先两条都改判成 authentication，界面于是提示「请检查 Cookies 设置」，
// 而那是条死路。现在按真实原因分开报。
func TestClassifyForURLDouyinShortLink(t *testing.T) {
	raw := "ERROR: Unsupported URL: https://www.douyin.com/"
	if got := classifyForURL(raw, "https://v.douyin.com/x4G02LFmUiU"); got != KindPlatformBlocked {
		t.Errorf("抖音短链应改判为 %s，got %s", KindPlatformBlocked, got)
	}
	// 快手没有 extractor，「不支持」就是事实，不该说成「要登录」
	if got := classifyForURL(raw, "https://v.kuaishou.com/abc"); got != KindUnsupportedURL {
		t.Errorf("快手短链应保持 %s，got %s", KindUnsupportedURL, got)
	}
	// 其它站点保持原判
	if got := classifyForURL(raw, "https://example.com/v/1"); got != KindUnsupportedURL {
		t.Errorf("非抖音/快手应保持 %s，got %s", KindUnsupportedURL, got)
	}
}

// 抖音的签名拦截与快手的滑块必须归类为 platform-blocked，而不是 access-denied
// 或 authentication —— 后两者会让用户去配 Cookie 或等几分钟，都无效。
func TestClassifyPlatformBlocked(t *testing.T) {
	cases := []string{
		// 抖音：窗口外的真实响应体
		"Blocked by ArgusSecurityPlugin Uifid Not Found",
		"Blocked by ArgusSecurityPlugin Signature Not Found",
		// 快手：GraphQL 的滑块
		`{"errors":[{"message":"Need captcha","locations":[{"line":1,"column":46}]}]}`,
		// 抖音旧版接口：encrypt_data_miss
		`{"extra":{"logid":"x"},"status_code":11110,"status_msg":"encrypt_data_miss"}`,
	}
	for _, raw := range cases {
		if got := ClassifyParseError(raw); got != KindPlatformBlocked {
			t.Errorf("%q 应归类为 %s，got %s", raw, KindPlatformBlocked, got)
		}
	}
	// 这是自查回归点：platform-blocked 的文案必须点明「浏览器里手动下载」，
	// 不能只说「无法解析」让人继续重试。
	if !strings.Contains(ParseMessages[KindPlatformBlocked], "浏览器") {
		t.Error("platform-blocked 的提示必须给出可行动的出路")
	}
	// 不该把「用户自己能解决」的类别也吞进 platform-blocked
	if got := ClassifyParseError("ERROR: Sign in to confirm your age"); got != KindAuthentication {
		t.Errorf("got %s", got)
	}
}

// 抖音/快手要求「新鲜 cookie」时必须归类为需要登录，而不是 unknown。
//
// 实测 yt-dlp 对无 cookie 的抖音请求只回：
//
//	ERROR: [Douyin] 7677476892161050292: Fresh cookies (not necessarily logged in) are needed
//
// 这条既不含 "Sign in" 也不含 "登录"，早先落到 unknown，界面显示「无法解析该链接」，
// 用户完全不知道要去做 Cookie 配置。
func TestClassifyFreshCookiesNeeded(t *testing.T) {
	raw := "ERROR: [Douyin] 7677476892161050292: Fresh cookies (not necessarily logged in) are needed"
	if got := ClassifyParseError(raw); got != KindAuthentication {
		t.Errorf("应归类为 %s，got %s", KindAuthentication, got)
	}
}
