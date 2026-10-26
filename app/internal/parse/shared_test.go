package parse

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// tests/parsers-shared.test.ts 的 13 条断言逐条移植。

// writeTempCookies 写一个临时 cookies.txt（对应 TS 的 writeTemp）。
func writeTempCookies(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	file := filepath.Join(dir, "cookies.txt")
	if err := os.WriteFile(file, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return file
}

// ===== EstimateFileSize =====

func TestEstimateFileSizeGrowsWithHeight(t *testing.T) {
	const duration = 60_000
	heights := []int{360, 480, 720, 1080}
	var prev int64 = -1
	for _, h := range heights {
		got := EstimateFileSize(h, duration)
		if got <= prev {
			t.Fatalf("height=%d 时估算 %d，不大于上一档 %d（应随分辨率增大）", h, got, prev)
		}
		prev = got
	}
}

func TestEstimateFileSizeLinearWithDuration(t *testing.T) {
	one := EstimateFileSize(720, 60_000)
	two := EstimateFileSize(720, 120_000)
	if two != one*2 {
		t.Fatalf("时长翻倍应大小翻倍：%d vs %d", one, two)
	}
}

func TestEstimateFileSizeInteger(t *testing.T) {
	size := EstimateFileSize(720, 12_345)
	if size <= 0 {
		t.Fatalf("应给出正值，got %d", size)
	}
}

func TestEstimateFileSizeZeroDuration(t *testing.T) {
	// 时长为 0 时返回 0，不产生 NaN
	if got := EstimateFileSize(1080, 0); got != 0 {
		t.Fatalf("got %d, want 0", got)
	}
}

func TestEstimateFileSizeUnknownHeightFallsBack(t *testing.T) {
	// 低于 360 的高度会走默认 2Mbps 档，仍给出正值
	if got := EstimateFileSize(240, 10_000); got <= 0 {
		t.Fatalf("未知分辨率也应给出正值，got %d", got)
	}
}

// ===== ParseCookiesFile =====

func TestParseCookiesFileNetscapeFormat(t *testing.T) {
	path := writeTempCookies(t, strings.Join([]string{
		"# Netscape HTTP Cookie File",
		".douyin.com\tTRUE\t/\tTRUE\t0\tsessionid\tabc123",
	}, "\n"))

	cookies := ParseCookiesFile(path)
	if len(cookies) != 1 {
		t.Fatalf("应解析 1 条，got %d", len(cookies))
	}
	c := cookies[0]
	if c.Domain != ".douyin.com" || !c.IncludeSubdomains || c.Path != "/" || !c.Secure ||
		c.Name != "sessionid" || c.Value != "abc123" || c.Expiry != 0 {
		t.Fatalf("got %+v", c)
	}
}

func TestParseCookiesFileSkipsCommentsAndBlanks(t *testing.T) {
	path := writeTempCookies(t, strings.Join([]string{
		"# 注释",
		"",
		".douyin.com\tTRUE\t/\tFALSE\t0\ta\t1",
		"   ",
	}, "\n"))
	if got := ParseCookiesFile(path); len(got) != 1 {
		t.Fatalf("应只剩 1 条，got %d", len(got))
	}
}

func TestParseCookiesFileIgnoresShortLines(t *testing.T) {
	path := writeTempCookies(t, ".douyin.com\tTRUE\t/\tFALSE\t0")
	if got := ParseCookiesFile(path); len(got) != 0 {
		t.Fatalf("字段不足 7 个的行应被忽略，got %d 条", len(got))
	}
}

func TestParseCookiesFileMissingReturnsEmpty(t *testing.T) {
	// 文件不存在时返回空切片而非报错（调用方据此退化为无 Cookie 请求）
	if got := ParseCookiesFile("/definitely/not/here/cookies.txt"); len(got) != 0 {
		t.Fatalf("got %d 条", len(got))
	}
}

// ===== BuildCookieHeader =====

func testCookie(domain, name, value string) Cookie {
	return Cookie{Domain: domain, IncludeSubdomains: true, Path: "/", Secure: true, Name: name, Value: value}
}

func TestBuildCookieHeaderFiltersDomains(t *testing.T) {
	cookies := []Cookie{
		testCookie(".douyin.com", "sessionid", "abc"),
		testCookie(".iesdouyin.com", "ttwid", "def"),
		testCookie(".google.com", "NID", "should-not-appear"),
	}
	header := BuildCookieHeader(cookies, DouyinCookieDomains)

	if !strings.Contains(header, "sessionid=abc") || !strings.Contains(header, "ttwid=def") {
		t.Fatalf("应包含抖音域名下的 Cookie，got %q", header)
	}
	if strings.Contains(header, "NID") || strings.Contains(header, "should-not-appear") {
		t.Fatalf("不该包含无关域名的 Cookie，got %q", header)
	}
}

func TestBuildCookieHeaderFormat(t *testing.T) {
	cookies := []Cookie{
		testCookie(".douyin.com", "sessionid", "abc"),
		testCookie(".iesdouyin.com", "ttwid", "def"),
	}
	if got := BuildCookieHeader(cookies, DouyinCookieDomains); got != "sessionid=abc; ttwid=def" {
		t.Fatalf("got %q", got)
	}
}

func TestBuildCookieHeaderNoMatch(t *testing.T) {
	// 域名不匹配时返回空串（而非 nil）——调用方直接拼进请求头
	if got := BuildCookieHeader([]Cookie{testCookie(".google.com", "NID", "x")}, DouyinCookieDomains); got != "" {
		t.Fatalf("got %q, want 空串", got)
	}
}

func TestBuildCookieHeaderEmpty(t *testing.T) {
	if got := BuildCookieHeader(nil, DouyinCookieDomains); got != "" {
		t.Fatalf("got %q", got)
	}
}

// 浏览器扩展导出的是 JSON 数组，不是 Netscape 文本。
//
// 变异点：早先只按制表符切分，JSON 文件一条都解析不出来 → 直连解析器
// 拿到空 Cookie 头，抖音对匿名请求直接回首页/403，用户看到「配了 cookies
// 还是用不了」，而且没有任何提示说格式不对。
func TestParseCookiesFileJSONExport(t *testing.T) {
	raw := `[
		{"domain":".douyin.com","hostOnly":false,"name":"ttwid","path":"/","secure":true,"expirationDate":1824114971,"value":"1%7Cabc"},
		{"domain":"www.douyin.com","hostOnly":true,"name":"__ac_nonce","path":"/","secure":false,"value":"06adf2"}
	]`
	path := filepath.Join(t.TempDir(), "cookies.txt")
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}

	cookies := ParseCookiesFile(path)
	if len(cookies) != 2 {
		t.Fatalf("应解析出 2 条 cookie，got %d", len(cookies))
	}
	if cookies[0].Name != "ttwid" || cookies[0].Domain != ".douyin.com" {
		t.Errorf("第一条解析错误：%+v", cookies[0])
	}
	if cookies[1].Domain != "www.douyin.com" || cookies[1].IncludeSubdomains {
		t.Errorf("hostOnly 的域名不该加前导点、也不包含子域：%+v", cookies[1])
	}
	header := BuildCookieHeader(cookies, DouyinCookieDomains)
	if !strings.Contains(header, "ttwid=1%7Cabc") || !strings.Contains(header, "__ac_nonce=06adf2") {
		t.Errorf("Cookie 头应包含抖音的两条 cookie，got %q", header)
	}
}

// Netscape 文本仍要照旧可解析（不能因为加了 JSON 分支就把老格式弄坏）。
func TestParseCookiesFileStillReadsNetscape(t *testing.T) {
	raw := "# Netscape HTTP Cookie File\n.douyin.com\tTRUE\t/\tTRUE\t1793010826\tttwid\t1%7Cabc\n"
	path := filepath.Join(t.TempDir(), "cookies.txt")
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	cookies := ParseCookiesFile(path)
	if len(cookies) != 1 || cookies[0].Name != "ttwid" || cookies[0].Value != "1%7Cabc" {
		t.Fatalf("Netscape 解析坏了：%+v", cookies)
	}
}
