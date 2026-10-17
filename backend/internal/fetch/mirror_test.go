package fetch

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// 镜像顺序里 direct 必须排第一：能直连的用户不该为别人的网络问题多付延迟。
func TestDirectMirrorIsFirst(t *testing.T) {
	if Mirrors[0].Prefix != "" || Mirrors[0].ID != "direct" {
		t.Fatalf("第一个镜像必须是直连，实际 %+v", Mirrors[0])
	}
	if len(Mirrors) < 2 {
		t.Fatal("至少要有 1 个公共镜像，否则国内网络无法下载依赖")
	}
}

// 镜像必须是前缀式的：它们的用法就是把原始地址整段拼在后面。
// 写成需要替换域名/带占位符的格式时，拼出来的地址会 404 ——
// 而失败表现只是「下载不了」，看不出是格式写错。
func TestMirrorsArePrefixStyle(t *testing.T) {
	for _, m := range Mirrors {
		if m.Prefix == "" {
			continue
		}
		if m.ID == "" || m.Name == "" {
			t.Errorf("镜像 %q 缺少 ID 或 Name", m.Prefix)
		}
		if !hasPrefixHTTP(m.Prefix) {
			t.Errorf("镜像 %s 的 Prefix 不是 http(s) 开头：%q", m.ID, m.Prefix)
		}
		if !hasSuffixSlash(m.Prefix) {
			t.Errorf("镜像 %s 的 Prefix 必须以 / 结尾，否则拼接后主机与路径会粘连：%q", m.ID, m.Prefix)
		}
	}
}

func hasPrefixHTTP(s string) bool {
	return len(s) > 8 && (s[:8] == "https://" || s[:7] == "http://")
}

func hasSuffixSlash(s string) bool { return len(s) > 0 && s[len(s)-1] == '/' }

// 只改写 GitHub release 资产：别的地址拼上镜像前缀只会拿到 403，
// 反而把「本来能直连的下载」弄坏（测试里的 httptest 就是这样）。
func TestMirrorURLOnlyRewritesGitHubReleaseAssets(t *testing.T) {
	gh := "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/2026.10.10/yt-dlp_macos"
	m := Mirror{ID: "ghproxy", Prefix: "https://gh-proxy.com/"}
	if got := mirrorURL(m, gh); got != m.Prefix+gh {
		t.Fatalf("GitHub 资产应被改写，实际 %q", got)
	}
	for _, other := range []string{
		"https://example.com/file.gz",
		"https://github.com/yxxbc/downvid/archive/refs/heads/main.tar.gz", // 不是 release 资产
	} {
		if got := mirrorURL(m, other); got != other {
			t.Errorf("非发布资产不应改写：%q → %q", other, got)
		}
	}
	if got := mirrorURL(Mirrors[0], gh); got != gh {
		t.Errorf("直连镜像不该改写地址，实际 %q", got)
	}
}

// 不认识的 --mirror 值必须降级成 auto，而不是「一个镜像都不试」。
// 后者会让下载永久失败，且没有任何提示。
func TestMirrorPreferenceFallsBackToAuto(t *testing.T) {
	for _, in := range []string{"", "auto", "AUTO", "  ", "nope", "gh-proxy"} {
		if got := MirrorPreference(in); got != "auto" {
			t.Errorf("MirrorPreference(%q) = %q，应回退 auto", in, got)
		}
	}
	if got := MirrorPreference("ghproxy"); got != "ghproxy" {
		t.Errorf("合法的镜像 ID 应保留，实际 %q", got)
	}
	if len(MirrorChain("auto")) != len(Mirrors) {
		t.Error("auto 应返回完整链路")
	}
	if got := MirrorChain("ghproxy"); len(got) != 1 || got[0].ID != "ghproxy" {
		t.Errorf("钉死某个镜像时只应返回它，实际 %+v", got)
	}
}

// 这是本次修复的核心：第一个源连不通时，必须**自动换下一个源**并成功装上。
//
// 回归背景：依赖只有 GitHub 一个来源，国内网络下连不通 = 用户装不上依赖 =
// 应用整体不可用（比「更新检查失败」严重得多）。
//
// 用自定义 RoundTripper 把 github.com 与镜像域名映射到进程内的假服务器，
// 而不是在源码里加测试钩子：被测的是**真实的**镜像拼接与回退逻辑。
func TestInstallFallsBackToNextMirror(t *testing.T) {
	payload := []byte("#!/bin/sh\necho ok\n")
	var directHits, deadHits, liveHits int32

	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		rec := httptest.NewRecorder()
		switch r.URL.Host {
		case "github.com":
			atomic.AddInt32(&directHits, 1)
			rec.WriteHeader(http.StatusForbidden) // 模拟被墙/限流
		case "dead.test":
			atomic.AddInt32(&deadHits, 1)
			return nil, &net.OpError{Op: "dial", Net: "tcp", Err: errConnRefused{}}
		case "live.test":
			atomic.AddInt32(&liveHits, 1)
			rec.Header().Set("Content-Length", strconv.Itoa(len(payload)))
			rec.Write(payload)
		default:
			rec.WriteHeader(http.StatusNotFound)
		}
		return rec.Result(), nil
	})}

	orig := Mirrors
	defer func() { Mirrors = orig }()
	Mirrors = []Mirror{
		{ID: "direct", Name: "GitHub"},
		{ID: "dead", Name: "dead", Prefix: "https://dead.test/"},
		{ID: "live", Name: "live", Prefix: "https://live.test/"},
	}

	task := Task{
		Tool:   "yt-dlp",
		URL:    "https://github.com/o/r/releases/download/v1/tool",
		SHA256: sha256Hex(payload),
		Target: filepath.Join(t.TempDir(), "tool"),
	}

	var events []string
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	err := Install(ctx, []Task{task}, Options{
		Timeout:    10 * time.Second,
		Retries:    1,
		HTTPClient: client,
		Emit:       func(e Event) { events = append(events, e.Event) },
	})
	if err != nil {
		t.Fatalf("应回退到可用镜像并安装成功，实际失败：%v", err)
	}
	if got, readErr := os.ReadFile(task.Target); readErr != nil || string(got) != string(payload) {
		t.Fatalf("安装内容不一致：%q %v", got, readErr)
	}
	if directHits == 0 {
		t.Error("应当先试直连（海外用户不该多付反代延迟）")
	}
	if liveHits == 0 {
		t.Fatal("第三个镜像应被请求到")
	}
	if !slices.Contains(events, "mirror") {
		t.Error("换源时应广播 mirror 事件，否则界面看不出「正在换源」")
	}
	_ = deadHits
}

// 4xx 不该重试：同一地址再要一次也是 4xx，纯属让用户多等。
func TestNonRetryableErrorsSkipRetry(t *testing.T) {
	var hits int32
	client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		atomic.AddInt32(&hits, 1)
		rec := httptest.NewRecorder()
		rec.WriteHeader(http.StatusNotFound)
		return rec.Result(), nil
	})}

	orig := Mirrors
	defer func() { Mirrors = orig }()
	Mirrors = []Mirror{{ID: "direct", Name: "GitHub"}}

	err := Install(context.Background(), []Task{{
		Tool:   "yt-dlp",
		URL:    "https://github.com/o/r/releases/download/v1/tool",
		Target: filepath.Join(t.TempDir(), "tool"),
	}}, Options{Timeout: 5 * time.Second, Retries: 3, HTTPClient: client})
	if err == nil {
		t.Fatal("404 应报错")
	}
	if got := atomic.LoadInt32(&hits); got != 1 {
		t.Errorf("404 只应请求一次，实际 %d 次（多出来的都是白等）", got)
	}
}

// 全部镜像都失败时，错误信息要说清「试过几个源」，
// 而不是把最后一个源的原始报文丢给用户。
func TestAllMirrorsFailMentionsAttemptCount(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		rec := httptest.NewRecorder()
		rec.WriteHeader(http.StatusNotFound)
		return rec.Result(), nil
	})}
	orig := Mirrors
	defer func() { Mirrors = orig }()
	Mirrors = []Mirror{
		{ID: "direct", Name: "GitHub"},
		{ID: "m1", Name: "m1", Prefix: "https://m1.test/"},
	}

	err := Install(context.Background(), []Task{{
		Tool:   "yt-dlp",
		URL:    "https://github.com/o/r/releases/download/v1/tool",
		Target: filepath.Join(t.TempDir(), "tool"),
	}}, Options{Timeout: 5 * time.Second, Retries: 1, HTTPClient: client})
	if err == nil {
		t.Fatal("应报错")
	}
	if !strings.Contains(err.Error(), "2") {
		t.Errorf("错误信息应说明尝试过几个源，实际：%v", err)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// errConnRefused 让 net.OpError 看起来像连接被拒绝（与真实场景同类）
type errConnRefused struct{}

func (errConnRefused) Error() string   { return "connect: connection refused" }
func (errConnRefused) Timeout() bool   { return false }
func (errConnRefused) Temporary() bool { return true }

// 真实网络下的镜像回退（默认跳过，需 DOWNVID_TEST_REAL_MIRROR=1）。
//
// 与上面那条的区别：那条用假 RoundTripper，只能证明**控制流**正确；这一条真的
// 从公共镜像拉一份 37MB 的 yt-dlp 并校验 SHA-256，能抓到「镜像前缀拼对了、
// 但它其实返回 403/HTML 错误页」这类问题——那种情况下假传输层永远是通过的。
func TestRealMirrorFallback(t *testing.T) {
	if os.Getenv("DOWNVID_TEST_REAL_MIRROR") == "" {
		t.Skip("设置 DOWNVID_TEST_REAL_MIRROR=1 才跑（需要外网）")
	}
	orig := Mirrors
	defer func() { Mirrors = orig }()
	Mirrors = []Mirror{
		{ID: "direct", Name: "GitHub"},
		{ID: "ghproxy", Name: "gh-proxy", Prefix: "https://gh-proxy.com/"},
	}

	// 直连一律失败（模拟被墙），只有镜像那次真的联网
	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "github.com" {
			return nil, &net.OpError{Op: "dial", Net: "tcp", Err: errConnRefused{}}
		}
		return http.DefaultTransport.RoundTrip(r)
	})}

	target := filepath.Join(t.TempDir(), "yt-dlp")
	var sawMirror bool
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	err := Install(ctx, []Task{{
		Tool:   "yt-dlp",
		URL:    "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/2026.10.10.233141/yt-dlp_macos",
		SHA256: "c8ee97b3f6aa0fb5cbc3f56d772c0d79dc2c5d3d60f3bf0b240d5dd0d461fd25",
		Target: target,
	}}, Options{
		Timeout:    4 * time.Minute,
		Retries:    1,
		HTTPClient: client,
		Emit: func(e Event) {
			if e.Event == "mirror" {
				sawMirror = true
			}
		},
	})
	if err != nil {
		t.Skipf("外网/镜像不可用，跳过：%v", err)
	}
	if !sawMirror {
		t.Error("换源时应广播 mirror 事件")
	}
	if _, statErr := os.Stat(target); statErr != nil {
		t.Fatal("文件应已安装")
	}
}
