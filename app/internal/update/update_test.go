package update

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
)

// tests/update-sources.test.ts 的更新源相关用例逐条移植，
// 外加链路执行的四个分支（TS 侧用假 fetch 覆盖，Go 侧用注入的 HTTPClient）。

func testRepo() Repo { return Repo{Owner: "Downvid", Repo: "downvid"} }

func testEndpoints() Endpoints {
	return Endpoints{
		GitHubAPI:  "https://api.github.com",
		JSDelivr:   "https://data.jsdelivr.com",
		GHPROXYAPI: "https://gh-proxy.com",
		GiteeAPI:   "https://gitee.com/api/v5",
		WebsiteURL: "https://example.test",
	}
}

func sourcesOf(cs []Candidate) []SourceID {
	out := make([]SourceID, len(cs))
	for i, c := range cs {
		out[i] = c.Source
	}
	return out
}

// --- auto 展开成完整链路，且顺序就是优先级 ---

func TestAutoExpandsToFullChain(t *testing.T) {
	got := sourcesOf(LatestCandidates(SourceAuto, testRepo(), testEndpoints()))
	if !reflect.DeepEqual(got, AutoChain) {
		t.Fatalf("got %v, want %v", got, AutoChain)
	}
}

// --- auto 是唯一会展开的取值；其余只给一个候选 ---

func TestOnlyAutoExpands(t *testing.T) {
	for _, id := range SourceIDs {
		if id == SourceAuto {
			continue
		}
		got := LatestCandidates(id, testRepo(), testEndpoints())
		if len(got) != 1 {
			t.Fatalf("%s 应只给 1 个候选，got %d", id, len(got))
		}
		if got[0].Source != id {
			t.Fatalf("%s 的候选源是 %s", id, got[0].Source)
		}
	}
}

// --- 每个源的 URL 都指向正确的主机与仓库（拼错=永远已是最新）---

func TestCandidateURLs(t *testing.T) {
	want := map[SourceID]string{
		SourceGitHub:   "https://api.github.com/repos/Downvid/downvid/releases/latest",
		SourceJSDelivr: "https://data.jsdelivr.com/v1/packages/gh/Downvid/downvid",
		SourceGHPROXY:  "https://gh-proxy.com/https://api.github.com/repos/Downvid/downvid/releases/latest",
		SourceGitee:    "https://gitee.com/api/v5/repos/Downvid/downvid/releases?per_page=1",
		SourceWebsite:  "https://example.test/version.txt",
	}
	for _, c := range LatestCandidates(SourceAuto, testRepo(), testEndpoints()) {
		if got := c.URL; got != want[c.Source] {
			t.Errorf("%s 的 URL = %q\n  want %q", c.Source, got, want[c.Source])
		}
	}
}

// --- 官网排在链路最后：它给不出安装包，只是最后的兜底 ---

func TestWebsiteIsLast(t *testing.T) {
	if AutoChain[len(AutoChain)-1] != SourceWebsite {
		t.Fatal("官网必须排在链路最后——它给不出安装包，排前面会让自动更新退化成手动下载")
	}
}

// --- 响应归一化 ---

func TestParseGitHub(t *testing.T) {
	payload := map[string]any{
		"tag_name":     "v1.5.0",
		"body":         "更新说明",
		"published_at": "2026-10-17",
	}
	got, ok := ParseLatestPayload(SourceGitHub, payload)
	if !ok {
		t.Fatal("应解析成功")
	}
	if got.Version != "1.5.0" || got.ReleaseNote != "更新说明" || got.ReleaseDate != "2026-10-17" {
		t.Fatalf("got %+v", got)
	}
	if got.Source != SourceGitHub {
		t.Fatalf("source = %s", got.Source)
	}
}

func TestParseGiteeArray(t *testing.T) {
	payload := []any{map[string]any{
		"tag_name":   "v1.5.0",
		"body":       "说明",
		"created_at": "2026-10-17",
	}}
	got, ok := ParseLatestPayload(SourceGitee, payload)
	if !ok || got.Version != "1.5.0" || got.ReleaseDate != "2026-10-17" {
		t.Fatalf("got %+v ok=%v", got, ok)
	}
}

func TestParseJSDelivrPicksMaxStable(t *testing.T) {
	payload := map[string]any{"versions": []any{
		map[string]any{"version": "1.3.0"},
		map[string]any{"version": "1.5.0"},
		map[string]any{"version": "1.4.0"},
		map[string]any{"version": "2.0.0-beta.1"},
	}}
	got, ok := ParseLatestPayload(SourceJSDelivr, payload)
	if !ok {
		t.Fatal("应解析成功")
	}
	// 顺序不保证 → 自己挑最大的稳定版；预发布要跳过
	if got.Version != "1.5.0" {
		t.Fatalf("应挑 1.5.0（最大的稳定版），got %s", got.Version)
	}
}

func TestParseJSDelivrOnlyPrereleaseReturnsFalse(t *testing.T) {
	payload := map[string]any{"versions": []any{
		map[string]any{"version": "2.0.0-beta.1"},
		map[string]any{"version": "2.0.0-rc.2"},
	}}
	if _, ok := ParseLatestPayload(SourceJSDelivr, payload); ok {
		t.Fatal("只有预发布时应返回 false（换下一个源），而不是推一个 beta 给稳定用户")
	}
}

func TestParseWebsiteText(t *testing.T) {
	got, ok := ParseLatestPayload(SourceWebsite, "v1.5.0\n")
	if !ok || got.Version != "1.5.0" {
		t.Fatalf("got %+v ok=%v", got, ok)
	}
}

func TestParseRejectsGarbage(t *testing.T) {
	cases := []any{
		nil,
		"not a version",
		map[string]any{"tag_name": "latest"},
		map[string]any{"versions": "nope"},
		[]any{},
		map[string]any{},
	}
	for _, payload := range cases {
		for _, src := range []SourceID{SourceGitHub, SourceJSDelivr, SourceGitee, SourceWebsite} {
			if _, ok := ParseLatestPayload(src, payload); ok {
				t.Errorf("payload %#v 在 %s 上不该解析成功（宁可换源，也不要猜）", payload, src)
			}
		}
	}
}

// --- HTTP 状态分类 ---

func TestClassifyHTTPStatus(t *testing.T) {
	cases := map[int]Failure{
		404: FailureNotFound, 410: FailureNotFound, 451: FailureNotFound,
		403: FailureRateLimited, 429: FailureRateLimited,
		500: FailureServer, 502: FailureServer, 503: FailureServer,
		400: FailureNotFound, 418: FailureNotFound,
		200: FailureBadResponse, 302: FailureBadResponse,
	}
	for status, want := range cases {
		if got := ClassifyHTTPStatus(status); got != want {
			t.Errorf("ClassifyHTTPStatus(%d) = %s, want %s", status, got, want)
		}
	}
}

// --- 设置里的更新源清洗 ---

func TestNormalizeSource(t *testing.T) {
	for _, id := range SourceIDs {
		if got := NormalizeSource(string(id)); got != id {
			t.Errorf("合法值 %s 应原样保留，got %s", id, got)
		}
	}
	// 非法值必须回退 auto：回退成「不试任何源」会让更新永久失灵
	for _, bad := range []any{nil, "", "AUTO", "github ", 42, map[string]any{}, []any{}, "jsdelivr "} {
		if got := NormalizeSource(bad); got != SourceAuto {
			t.Errorf("非法值 %#v 应回退 auto，got %s", bad, got)
		}
	}
}

// --- 版本比较 ---

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int // 符号
	}{
		{"1.5.0", "1.4.0", 1},
		{"1.4.0", "1.5.0", -1},
		{"1.4.0", "1.4.0", 0},
		{"v1.5.0", "1.4.0", 1}, // 带 v 前缀
		{"1.5", "1.5.0", 0},    // 段数不同
		{"1.5.1", "1.5", 1},
		{"2026.10.10", "2026.09.01", 1}, // yt-dlp 的日期版本
	}
	for _, c := range cases {
		got := CompareVersions(c.a, c.b)
		sign := 0
		if got > 0 {
			sign = 1
		} else if got < 0 {
			sign = -1
		}
		if sign != c.want {
			t.Errorf("CompareVersions(%q,%q) = %d（符号 %d），want 符号 %d", c.a, c.b, got, sign, c.want)
		}
	}
}

// ===== 链路执行与降级 =====

// fakeClient 按 URL 子串路由到固定响应，并记录调用顺序。
func fakeClient(routes map[string]func() (HTTPResponse, error), calls *[]string) HTTPClient {
	return func(_ context.Context, url string, _ map[string]string) (HTTPResponse, error) {
		if calls != nil {
			*calls = append(*calls, url)
		}
		for key, fn := range routes {
			if strings.Contains(url, key) {
				return fn()
			}
		}
		return HTTPResponse{}, errors.New("ECONNREFUSED")
	}
}

func okJSON(body string) func() (HTTPResponse, error) {
	return func() (HTTPResponse, error) {
		return HTTPResponse{OK: true, Status: 200, Body: []byte(body)}, nil
	}
}

func failStatus(status int) func() (HTTPResponse, error) {
	return func() (HTTPResponse, error) {
		return HTTPResponse{OK: false, Status: status, Body: []byte(`{}`)}, nil
	}
}

// --- 第一个源失败时自动换下一个（github 403 → jsdelivr 成功）---

func TestFallsBackToNextSource(t *testing.T) {
	var calls []string
	res := LookupLatestRelease(LookupOptions{
		Client: fakeClient(map[string]func() (HTTPResponse, error){
			"api.github.com":    failStatus(403),
			"data.jsdelivr.com": okJSON(`{"versions":[{"version":"1.6.0"}]}`),
		}, &calls),
		Repo:     testRepo(),
		Endpoint: testEndpoints(),
	})

	if res.Release == nil {
		t.Fatal("jsdelivr 应成功")
	}
	if res.Release.Version != "1.6.0" || res.Release.Source != SourceJSDelivr {
		t.Fatalf("got %+v", res.Release)
	}
	if len(calls) != 2 {
		t.Fatalf("应只请求 2 次（github 失败 + jsdelivr 成功），got %d", len(calls))
	}
	if res.Attempts[0].Source != SourceGitHub || res.Attempts[0].OK || res.Attempts[0].Failure != FailureRateLimited {
		t.Fatalf("第一次尝试应记录 github 被限流，got %+v", res.Attempts[0])
	}
}

// --- 网络整体不可达时不抛异常，而是如实返回全挂轨迹 ---

func TestAllSourcesDownReturnsTrace(t *testing.T) {
	res := LookupLatestRelease(LookupOptions{
		Client:   fakeClient(map[string]func() (HTTPResponse, error){}, nil),
		Repo:     testRepo(),
		Endpoint: testEndpoints(),
	})
	if res.Release != nil {
		t.Fatal("全挂时 release 必须为 nil")
	}
	if len(res.Attempts) != len(AutoChain) {
		t.Fatalf("应记录全部 %d 次尝试，got %d", len(AutoChain), len(res.Attempts))
	}
	for _, a := range res.Attempts {
		if a.OK {
			t.Fatalf("%s 不该成功", a.Source)
		}
	}
}

// --- 固定某个源时只发一个请求（不回退）---

func TestFixedSourceDoesNotFallBack(t *testing.T) {
	var calls []string
	res := LookupLatestRelease(LookupOptions{
		Source:   SourceGitee,
		Client:   fakeClient(map[string]func() (HTTPResponse, error){"gitee.com": failStatus(404)}, &calls),
		Repo:     testRepo(),
		Endpoint: testEndpoints(),
	})
	if res.Release != nil {
		t.Fatal("gitee 404 时不该有结果")
	}
	if len(calls) != 1 {
		t.Fatalf("固定源只该请求 1 次，got %d", len(calls))
	}
}

// --- 失败的说明是人话，不含 HTTP 码 ---

func TestSummarizeHasNoHTTPCodes(t *testing.T) {
	res := LookupLatestRelease(LookupOptions{
		Client:   fakeClient(map[string]func() (HTTPResponse, error){}, nil),
		Repo:     testRepo(),
		Endpoint: testEndpoints(),
	})
	text := SummarizeFailures(res.Attempts)
	if text == "" {
		t.Fatal("失败说明不该为空")
	}
	for _, code := range []string{"403", "404", "500"} {
		if strings.Contains(text, code) {
			t.Fatalf("失败说明不该出现 HTTP 码 %s：%q（用户只能换网络/配代理，看到码只会以为自己搞错了）", code, text)
		}
	}
}

// --- 坏响应会换下一个源，而不是当作成功 ---

func TestBadResponseFallsThrough(t *testing.T) {
	res := LookupLatestRelease(LookupOptions{
		Client: fakeClient(map[string]func() (HTTPResponse, error){
			"api.github.com":    okJSON(`{"unexpected":"shape"}`),
			"data.jsdelivr.com": okJSON(`{"versions":[{"version":"1.7.0"}]}`),
		}, nil),
		Repo:     testRepo(),
		Endpoint: testEndpoints(),
	})
	if res.Release == nil || res.Release.Version != "1.7.0" {
		t.Fatalf("坏响应应换下一个源，got %+v", res.Release)
	}
	if res.Attempts[0].Failure != FailureBadResponse {
		t.Fatalf("第一次尝试应记为 bad-response，got %+v", res.Attempts[0])
	}
}

// --- 官网纯文本源走 text 分支 ---

func TestWebsiteTextBranch(t *testing.T) {
	res := LookupLatestRelease(LookupOptions{
		Source: SourceWebsite,
		Client: fakeClient(map[string]func() (HTTPResponse, error){
			"version.txt": okJSON("v1.8.0\n"),
		}, nil),
		Repo:     testRepo(),
		Endpoint: testEndpoints(),
	})
	if res.Release == nil || res.Release.Version != "1.8.0" {
		t.Fatalf("got %+v", res.Release)
	}
}

// --- OnAttempt 回调对成功与失败都触发 ---

func TestOnAttemptCallback(t *testing.T) {
	var seen []SourceID
	LookupLatestRelease(LookupOptions{
		Client: fakeClient(map[string]func() (HTTPResponse, error){
			"api.github.com":    failStatus(403),
			"data.jsdelivr.com": okJSON(`{"versions":[{"version":"1.6.0"}]}`),
		}, nil),
		Repo:      testRepo(),
		Endpoint:  testEndpoints(),
		OnAttempt: func(a Attempt) { seen = append(seen, a.Source) },
	})
	if !reflect.DeepEqual(seen, []SourceID{SourceGitHub, SourceJSDelivr}) {
		t.Fatalf("回调应覆盖失败与成功两次，got %v", seen)
	}
}
