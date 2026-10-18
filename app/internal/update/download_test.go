package update

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// 下载与校验。全部打真实 HTTP 服务——校验相关的错误用 mock 测不出来。
func TestDownloadValidatesAndSaves(t *testing.T) {
	payload := []byte(strings.Repeat("update-payload-", 1000))
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Length", itoa(len(payload)))
		_, _ = w.Write(payload)
	}))
	defer srv.Close()

	dir := t.TempDir()
	asset := &InstallAsset{
		Name:   "DownVid-Wails-mac-universal-1.0.0.zip",
		URL:    srv.URL + "/pkg.zip",
		SHA512: sha512Base64(payload),
		Size:   int64(len(payload)),
		Kind:   KindZip,
	}

	var last DownloadProgress
	got, err := Downloader{Client: srv.Client(), Dir: dir}.Download(context.Background(), asset, func(p DownloadProgress) {
		last = p
	})
	if err != nil {
		t.Fatalf("下载失败：%v", err)
	}
	if last.Percent != 100 {
		t.Errorf("最终进度 = %.0f%%，期望 100", last.Percent)
	}

	saved, err := os.ReadFile(got)
	if err != nil {
		t.Fatal(err)
	}
	if string(saved) != string(payload) {
		t.Fatal("落盘内容与源不一致")
	}
	// 不该留下 .part
	if _, err := os.Stat(got + ".part"); err == nil {
		t.Error("成功后不该残留 .part 文件")
	}
}

// 校验失败时**不能留下任何文件**：留着会在下次重试时被误用。
func TestDownloadRemovesFileOnChecksumMismatch(t *testing.T) {
	payload := []byte("real content")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(payload)
	}))
	defer srv.Close()

	dir := t.TempDir()
	asset := &InstallAsset{
		Name:   "DownVid-Wails-mac-universal-1.0.0.zip",
		URL:    srv.URL + "/pkg.zip",
		SHA512: sha512Base64([]byte("something else")), // 故意错
		Kind:   KindZip,
	}
	_, err := Downloader{Client: srv.Client(), Dir: dir}.Download(context.Background(), asset, nil)
	if err == nil {
		t.Fatal("校验值不符时必须报错")
	}

	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Errorf("校验失败后目录应为空，实际残留 %d 个文件", len(entries))
	}
}

// 大小不符同样要拒绝（清单写 1KB 实际给 2KB，多半是代理插了东西）。
func TestDownloadRejectsSizeMismatch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("0123456789"))
	}))
	defer srv.Close()

	asset := &InstallAsset{
		Name: "x.zip", URL: srv.URL, Size: 5, Kind: KindZip,
	}
	_, err := Downloader{Client: srv.Client(), Dir: t.TempDir()}.Download(context.Background(), asset, nil)
	if err == nil {
		t.Fatal("大小不符时必须报错")
	}
}

// HTTP 404 要给出可读错误，而不是把空包写盘。
func TestDownloadHandlesHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	_, err := Downloader{Client: srv.Client(), Dir: t.TempDir()}.Download(context.Background(),
		&InstallAsset{Name: "x.zip", URL: srv.URL, Kind: KindZip}, nil)
	if err == nil {
		t.Fatal("404 应报错")
	}
	if !strings.Contains(err.Error(), "404") {
		t.Errorf("错误信息应带状态码：%v", err)
	}
}

// 取消（用户关窗口 / 主动取消）必须停下并清理，不能留下半个包。
func TestDownloadCancelsCleanly(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		// 慢速输出，给取消留时间
		for i := 0; i < 100; i++ {
			if _, err := w.Write([]byte(strings.Repeat("x", 1024))); err != nil {
				return
			}
			w.(http.Flusher).Flush()
			time.Sleep(10 * time.Millisecond)
		}
	}))
	defer srv.Close()

	dir := t.TempDir()
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()
	_, err := Downloader{Client: srv.Client(), Dir: dir}.Download(ctx,
		&InstallAsset{Name: "slow.zip", URL: srv.URL, Kind: KindZip}, nil)
	if err == nil {
		t.Skip("下载在取消前完成了")
	}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".part") {
			t.Errorf("取消后残留了 %s", e.Name())
		}
	}
}

// ===== PendingUpdate 的落盘与恢复 =====

func TestPendingRoundTrip(t *testing.T) {
	dir := t.TempDir()
	pkg := filepath.Join(dir, "pkg.zip")
	if err := os.WriteFile(pkg, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(dir, "pending.json")

	want := PendingUpdate{
		Version: "1.6.0", Path: pkg, Kind: KindZip,
		DownloadedAt: time.Now().UTC().Format(time.RFC3339),
	}
	if err := SavePending(statePath, want); err != nil {
		t.Fatal(err)
	}

	got := LoadPending(statePath)
	if got == nil {
		t.Fatal("应能读回待安装记录")
	}
	if got.Version != "1.6.0" || got.Path != pkg {
		t.Errorf("读回的内容不对：%+v", got)
	}
}

// 包已经不在了 → 返回 nil，并**顺手删掉记录**。
//
// 不删的话，每次启动都会尝试装一个不存在的文件，日志里反复出现同一句错误。
func TestLoadPendingClearsWhenPackageGone(t *testing.T) {
	dir := t.TempDir()
	statePath := filepath.Join(dir, "pending.json")
	if err := SavePending(statePath, PendingUpdate{
		Version: "1.6.0", Path: filepath.Join(dir, "missing.zip"), Kind: KindZip,
	}); err != nil {
		t.Fatal(err)
	}

	if got := LoadPending(statePath); got != nil {
		t.Fatalf("包不存在时应返回 nil，实际 %+v", got)
	}
	if _, err := os.Stat(statePath); err == nil {
		t.Error("过期的记录应被自动删除")
	}
}

func TestLoadPendingIgnoresCorruptFile(t *testing.T) {
	dir := t.TempDir()
	statePath := filepath.Join(dir, "pending.json")
	if err := os.WriteFile(statePath, []byte("{ not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := LoadPending(statePath); got != nil {
		t.Fatalf("损坏的记录应返回 nil，实际 %+v", got)
	}
}

func TestClearPending(t *testing.T) {
	dir := t.TempDir()
	statePath := filepath.Join(dir, "pending.json")
	_ = SavePending(statePath, PendingUpdate{Version: "1", Path: "/x", Kind: KindZip})
	ClearPending(statePath)
	if _, err := os.Stat(statePath); err == nil {
		t.Error("ClearPending 应删除记录")
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}
