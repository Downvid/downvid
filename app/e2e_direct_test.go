package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// 直链下载端到端：真起一个支持 Range 的服务，走 StartDownload 的直链分支，
// 等 completed 事件，再核对磁盘上的产物。
func TestStartDownloadDirectEndToEnd(t *testing.T) {
	data := make([]byte, 2<<20)
	for i := range data {
		data[i] = byte(i % 251)
	}
	var mu sync.Mutex
	var ranges []string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		ranges = append(ranges, r.Header.Get("Range"))
		mu.Unlock()
		w.Header().Set("Etag", `"v1"`)
		var rs, re int64
		if n, err := fmt.Sscanf(r.Header.Get("Range"), "bytes=%d-%d", &rs, &re); err == nil && n == 2 {
			if re >= int64(len(data)) {
				re = int64(len(data)) - 1
			}
			w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", rs, re, len(data)))
			w.Header().Set("Content-Length", strconv.FormatInt(re-rs+1, 10))
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write(data[rs : re+1])
			return
		}
		w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)
	}))
	defer srv.Close()

	app := NewApp()
	app.dataDir = t.TempDir()
	app.downloadsDir = t.TempDir()

	done := make(chan DownloadProgress, 64)
	app.emitHook = func(_ string, payload any) {
		if p, ok := payload.(DownloadProgress); ok {
			select {
			case done <- p:
			default:
			}
		}
	}

	res := app.StartDownload(DownloadRequest{
		TaskID:    "e2e-direct",
		URL:       "https://www.douyin.com/video/1",
		DirectURL: srv.URL + "/v.mp4",
		Title:     "端到端",
		OutputDir: app.downloadsDir,
	})
	if !res.OK {
		t.Fatalf("启动失败：%s", res.Error)
	}

	var last DownloadProgress
	timeout := time.After(30 * time.Second)
	for {
		select {
		case p := <-done:
			last = p
			if p.Status == "completed" || p.Status == "error" {
				goto finished
			}
		case <-timeout:
			t.Fatalf("30 秒内没等到完成事件，最后一个：%+v", last)
		}
	}

finished:
	if last.Status != "completed" {
		t.Fatalf("下载失败：status=%s error=%s", last.Status, last.Error)
	}

	// 产物必须存在且大小正确
	if last.FilePath == "" {
		t.Fatal("完成事件没有给出文件路径")
	}
	info, err := os.Stat(last.FilePath)
	if err != nil {
		t.Fatalf("产物不存在：%v", err)
	}
	if info.Size() != int64(len(data)) {
		t.Fatalf("产物大小 %d，期望 %d", info.Size(), len(data))
	}
	if filepath.Dir(last.FilePath) != app.downloadsDir {
		t.Errorf("产物写到了下载目录之外：%s", last.FilePath)
	}
	// 收尾要干净
	if _, err := os.Stat(last.FilePath + ".part"); err == nil {
		t.Error("完成后残留了 .part")
	}

	mu.Lock()
	defer mu.Unlock()
	if len(ranges) == 0 {
		t.Fatal("一次请求都没发出去")
	}
	// 至少有一次分段请求（而不是整段单流）
	segmented := false
	for _, r := range ranges {
		if strings.HasPrefix(r, "bytes=") && r != "bytes=0-0" {
			segmented = true
		}
	}
	if !segmented {
		t.Errorf("没有走分段下载：%v", ranges)
	}
	t.Logf("共 %d 次请求，前几个：%v", len(ranges), ranges[:min(4, len(ranges))])
}
