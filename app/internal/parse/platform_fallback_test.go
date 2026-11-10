package parse

import (
	"errors"
	"strings"
	"testing"
)

// 抖音解析器失败后**不许回落 yt-dlp**，必须把真实原因报上来。
//
// 变异点：早先这里是 `if err == nil { return }` —— 错误被静默丢弃，继续走
// yt-dlp。后果不是「少了一条错误」，而是**报出的错误换了原因**：
//
//	真实原因 = 抖音要求 a_bogus 签名（403 ArgusSecurityPlugin）
//	用户看到 = yt-dlp 的 `Fresh cookies (not necessarily logged in) are needed`
//	           → 界面提示「请检查 Cookies 设置」
//
// 而实测带完整 Chrome 登录态仍然是 403，那条提示指向一条死路。
// 这条用例用「无网络可用的假域名」触发解析器失败，断言拿到的是我方标记。
func TestDouyinFailureReachesUser(t *testing.T) {
	p := NewParser()
	_, err := p.Parse(ParseOptions{
		// 不发真实请求：域名不可解析，解析器必然失败
		URL:   "https://www.douyin.com/video/7300000000000000000.invalid",
		Proxy: "",
		// YtdlpPath 故意给一个不存在的路径：若代码回落到 yt-dlp，
		// 报出的会是 deps-missing 而不是 platform-blocked —— 正好被这条用例抓到。
		YtdlpPath: "/nonexistent/yt-dlp-should-not-be-called",
		Timeout:   -1, // 走默认值
	})
	if err == nil {
		t.Fatal("无效 ID 不该解析成功")
	}
	msg := err.Error()
	// **必须断言确切类别**，只断言「不是 deps-missing」拦不住变异：
	// 吞掉错误后仍会走到 yt-dlp，报出的是 fork/exec 之类的另一条错误，
	// 「不是 deps-missing」对它照样成立。
	want := "[[parse-error:" + string(KindPlatformBlocked) + "]]"
	if !strings.Contains(msg, want) {
		t.Fatalf("抖音失败应报 %s（真实原因是缺签名），got %q", want, msg)
	}
}

// 快手的失败同理：上游没有 Kuaishou extractor，回落只会得到 `Unsupported URL`。
func TestKuaishouFailureDoesNotFallBack(t *testing.T) {
	p := NewParser()
	_, err := p.Parse(ParseOptions{
		URL:       "https://www.kuaishou.com/short-video/3xinvalid.invalid",
		YtdlpPath: "/nonexistent/yt-dlp-should-not-be-called",
		Timeout:   -1,
	})
	if err == nil {
		t.Fatal("无效 ID 不该解析成功")
	}
	want := "[[parse-error:" + string(KindUnsupportedURL) + "]]"
	if msg := err.Error(); !strings.Contains(msg, want) {
		t.Fatalf("快手失败应报 %s（上游无 extractor），got %q", want, msg)
	}
}

// platformBlockedError 的文案不许泄漏 cause（原始响应里可能带 URL/token）。
func TestPlatformBlockedErrorHidesCause(t *testing.T) {
	secret := "https://cdn.example.invalid/?token=fixture-secret-sentinel"
	err := platformBlockedError(KindPlatformBlocked, "抖音", errors.New(secret))
	if strings.Contains(err.Error(), "fixture-secret-sentinel") {
		t.Fatalf("错误文案不该透出原始响应：%q", err.Error())
	}
	// 但 cause 要能穿透，方便上层判断
	if !strings.Contains(errors.Unwrap(err).Error(), "fixture-secret-sentinel") {
		t.Error("cause 应保留在错误链里")
	}
	if !strings.Contains(err.Error(), "抖音") {
		t.Error("文案应点明是哪个平台")
	}
}
