package image

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// 用 httptest 起真实 HTTP 服务，不 mock http.Client——
// 这层要验证的恰好是「请求头怎么发、响应怎么读」。

func TestFetchWithReferer(t *testing.T) {
	var gotReferer, gotUA string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotReferer = r.Header.Get("Referer")
		gotUA = r.Header.Get("User-Agent")
		w.Header().Set("Content-Type", "image/jpeg")
		w.Write([]byte{0xFF, 0xD8, 0xFF, 0xE0})
	}))
	defer srv.Close()

	got, err := NewClient().Fetch(srv.URL+"/cover.jpg", "https://www.bilibili.com/")
	if err != nil {
		t.Fatal(err)
	}

	// 防盗链的关键就是这个 Referer——不带会被 403 或返回占位图
	if gotReferer != "https://www.bilibili.com/" {
		t.Fatalf("Referer = %q", gotReferer)
	}
	if gotUA == "" {
		t.Fatal("应带 User-Agent（部分站点的防盗链会检查）")
	}
	if !strings.HasPrefix(got, "data:image/jpeg;base64,") {
		t.Fatalf("应返回 data URL，got %q", got[:min(len(got), 40)])
	}
}

func TestFetchDefaultsReferer(t *testing.T) {
	var gotReferer string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotReferer = r.Header.Get("Referer")
		w.Header().Set("Content-Type", "image/png")
		w.Write([]byte{0x89, 0x50})
	}))
	defer srv.Close()

	if _, err := NewClient().Fetch(srv.URL+"/a.png", ""); err != nil {
		t.Fatal(err)
	}
	if gotReferer != DefaultReferer {
		t.Fatalf("空 Referer 应回退默认，got %q", gotReferer)
	}
}

// 只接受 http(s)：`file:` 能让本地任意文件被 base64 后送到前端
func TestFetchRejectsNonHTTP(t *testing.T) {
	for _, u := range []string{"file:///etc/passwd", "ftp://x/y.jpg", "javascript:alert(1)"} {
		if _, err := NewClient().Fetch(u, ""); err == nil {
			t.Errorf("%q 不该被允许", u)
		}
	}
}

// 非图片的 Content-Type 要拒绝
func TestFetchRejectsNonImage(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte("<html>"))
	}))
	defer srv.Close()

	_, err := NewClient().Fetch(srv.URL+"/x", "")
	if !errors.Is(err, ErrNotImage) {
		t.Fatalf("应返回 ErrNotImage，got %v", err)
	}
}

// 超大图片要拒绝（TS 版没有这道限制——一个被指到 4GB 文件的 URL 会把内存吃满）
func TestFetchRejectsTooLarge(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("Content-Length", "999999999")
		w.Write([]byte{0xFF})
	}))
	defer srv.Close()

	_, err := NewClient().Fetch(srv.URL+"/big.jpg", "")
	if !errors.Is(err, ErrTooLarge) {
		t.Fatalf("应返回 ErrTooLarge，got %v", err)
	}
}

// 没有 Content-Length（chunked）时也要挡住
func TestFetchRejectsTooLargeChunked(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/jpeg")
		// 不设 Content-Length，写入超过上限
		w.Write(make([]byte, MaxBytes+1024))
	}))
	defer srv.Close()

	_, err := NewClient().Fetch(srv.URL+"/big2.jpg", "")
	if !errors.Is(err, ErrTooLarge) {
		t.Fatalf("chunked 超限也应被拒，got %v", err)
	}
}

func TestFetchHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(403)
	}))
	defer srv.Close()

	if _, err := NewClient().Fetch(srv.URL+"/x.jpg", ""); err == nil {
		t.Fatal("403 应报错")
	}
}

// 空 URL 返回空串而不是错误（前端可能没有封面）
func TestFetchEmptyURL(t *testing.T) {
	got, err := NewClient().Fetch("", "")
	if err != nil || got != "" {
		t.Fatalf("got %q, %v", got, err)
	}
}

func TestInferContentType(t *testing.T) {
	cases := map[string]string{
		"https://x/a.png":      "image/png",
		"https://x/a.webp?v=1": "image/webp",
		"https://x/a.gif":      "image/gif",
		"https://x/a.jpg":      "image/jpeg",
		"https://x/a":          "image/jpeg",
		// B 站最常见的形态：jpeg + 查询串
		"https://i0.hdslb.com/bfs/archive/x.jpg@672w_378h_1c.webp": "image/webp",
	}
	for in, want := range cases {
		if got := inferContentType(in); got != want {
			t.Errorf("inferContentType(%q) = %q, want %q", in, got, want)
		}
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// 说明：上面的 http(s) 校验在**当前实现下是冗余的**——
// `http.NewRequest` 自己就拒绝 `file://` / `ftp://`，所以去掉那道检查
// 这条用例仍然通过（变异测试证实过）。
//
// 保留它的理由写在 image.go 的注释里：意图声明 + 换客户端时的兜底。
// 这类「冗余但表达意图」的检查不该被「为覆盖率」的清理删掉，
// 所以这里用一条注释说明，而不是删掉用例。
