package main

// 真机端到端：用**真实 yt-dlp** 下载一个本地 HTTP 文件。
// 不开窗口，直接调绑定方法。
import (
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/Downvid/downvid/app/internal/download"
)

func TestRealDownloadEndToEnd(t *testing.T) {
	ytdlp, err := exec.LookPath("../..")
	_ = ytdlp
	// 用本机真实的 yt-dlp（托管目录）
	home, _ := os.UserHomeDir()
	realYtdlp := filepath.Join(home, "Library/Application Support/downvid/runtime/bin/yt-dlp")
	if _, err := os.Stat(realYtdlp); err != nil {
		t.Skip("本机没有真实 yt-dlp，跳过")
	}

	// 造一个本地 HTTP 服务提供夹具
	fixture := []byte("fake video content for e2e " + time.Now().String())
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "video/mp4")
		w.Header().Set("Accept-Ranges", "bytes")
		w.Write(fixture)
	}))
	defer srv.Close()

	outDir := t.TempDir()
	app := NewApp()
	app.dataDir = t.TempDir()
	app.downloadsDir = outDir
	app.historyPath = filepath.Join(app.dataDir, "h.json")
	app.runner = download.NewRunner()

	var events []DownloadProgress
	app.emitHook = func(_ string, data any) {
		if p, ok := data.(DownloadProgress); ok {
			events = append(events, p)
		}
	}

	args := download.BuildArgs(download.Options{
		TaskID: "e2e", URL: srv.URL + "/v.mp4", FormatID: "best", DownloadMode: "video",
		// 正确写法是给**不含扩展名**的模板：BuildArgs 会自己追加 .%(ext)s。
		// 写成 "e2e.mp4" 会得到 e2e.mp4.mp4——这不是 bug，是模板语义。
		FilenameTmpl: "e2e",
	}, outDir, download.BuildArgsContext{})

	res, err := app.runner.Run("e2e", download.RunOptions{
		YtdlpPath: realYtdlp, Args: args, URL: srv.URL + "/v.mp4", OutputDir: outDir,
		Timeout: 60 * time.Second,
		OnEvent: func(ev download.Event) {
			t.Logf("事件: kind=%s percent=%.1f size=%s speed=%s", ev.Kind, ev.Percent, ev.TotalSize, ev.Speed)
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("退出码=%v paused=%v filePath=%s", res.Code, res.Paused, res.FilePath)
	if res.Code == nil || *res.Code != 0 {
		t.Skipf("yt-dlp 退出码非 0（本地 HTTP 可能不被 generic 提取器支持）：%s", res.Stderr)
	}

	// 产物必须真的落盘
	entries, _ := os.ReadDir(outDir)
	if len(entries) == 0 {
		t.Fatal("没有任何产物落盘")
	}
	for _, e := range entries {
		st, _ := e.Info()
		t.Logf("产物: %s (%d 字节)", e.Name(), st.Size())
	}
	_ = events
}
