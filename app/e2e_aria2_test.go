package main

// aria2 加速的**真机**验证：确认「设置里的连接数」真的变成了 aria2c 的多连接下载。
//
// 这条用例存在的理由：加速链路上有三处**静默失效**的点，全都不报错：
//
//  1. `aria2Path` 解析不到 → `BuildArgs` 悄悄退回 yt-dlp 原生下载器
//     （功能「正常」，只是慢，没人会察觉）
//  2. 设置里的 `maxConnections` 没传到 `Acceleration` → 永远按 8 连接跑
//     （滑块拖到 1 也一样）
//  3. 参数拼错（`--downloader` 的写法、`--paths` 的目录不存在）→ yt-dlp
//     直接报错退出，而那属于「下载失败」，与加速无关的排查方向
//
// 所以这里直接断言**生成的参数**里 aria2 真的启用了、连接数与设置一致，
// 再跑一次真实下载确认 aria2c 进程真的被拉起来。

import (
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Downvid/downvid/app/internal/download"
)

// aria2cPath 找本机的 aria2c（找不到就跳过，CI 上不装它）。
func aria2cPath(t *testing.T) string {
	t.Helper()
	for _, p := range []string{"/opt/homebrew/bin/aria2c", "/usr/local/bin/aria2c", "/usr/bin/aria2c"} {
		if st, err := os.Stat(p); err == nil && st.Mode().IsRegular() {
			return p
		}
	}
	if p, err := exec.LookPath("aria2c"); err == nil {
		return p
	}
	t.Skip("本机没有 aria2c，跳过加速验证")
	return ""
}

// 加速开关与连接数必须真的体现在参数上。
func TestAccelerationReachesArgs(t *testing.T) {
	aria2 := aria2cPath(t)

	on := true
	off := false

	cases := []struct {
		name        string
		accel       *download.Acceleration
		wantAria2   bool
		wantConns   string
		description string
	}{
		{
			name:        "开启 16 连接",
			accel:       &download.Acceleration{Enabled: &on, MaxConnections: 16},
			wantAria2:   true,
			wantConns:   "--max-connection-per-server=16",
			description: "滑到「激进」必须真的用 16 连接",
		},
		{
			name:        "开启 4 连接",
			accel:       &download.Acceleration{Enabled: &on, MaxConnections: 4},
			wantAria2:   true,
			wantConns:   "--max-connection-per-server=4",
			description: "滑到「轻量」必须真的降下来",
		},
		{
			name:        "关闭加速",
			accel:       &download.Acceleration{Enabled: &off, MaxConnections: 16},
			wantAria2:   false,
			wantConns:   "--concurrent-fragments 1",
			description: "关掉开关必须退回原生下载（连接数恒为 1）",
		},
		{
			name:        "未设置（nil）",
			accel:       nil,
			wantAria2:   true,
			wantConns:   "--max-connection-per-server=8",
			description: "没设置过时默认开启 8 连接，与前端默认值一致",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			args := download.BuildArgs(
				download.Options{
					TaskID: "t", URL: "https://example.com/v.mp4", FormatID: "best",
					DownloadMode: "video", Acceleration: c.accel,
				},
				t.TempDir(),
				download.BuildArgsContext{Aria2Path: aria2},
			)
			joined := strings.Join(args, " ")

			hasAria2 := strings.Contains(joined, "--downloader http:"+aria2)
			if hasAria2 != c.wantAria2 {
				t.Fatalf("%s：aria2 启用状态 = %v，期望 %v\n参数：%s", c.description, hasAria2, c.wantAria2, joined)
			}
			if !strings.Contains(joined, c.wantConns) {
				t.Fatalf("%s：参数里没有 %q\n参数：%s", c.description, c.wantConns, joined)
			}
		})
	}
}

// 没有 aria2 时必须安静退回原生下载器，而不是拼出 `--downloader http:` 空路径。
func TestNoAria2FallsBackQuietly(t *testing.T) {
	args := download.BuildArgs(
		download.Options{
			TaskID: "t", URL: "https://example.com/v.mp4", FormatID: "best",
			DownloadMode: "video",
			Acceleration: &download.Acceleration{Enabled: boolPtr(true), MaxConnections: 16},
		},
		t.TempDir(),
		download.BuildArgsContext{Aria2Path: ""},
	)
	joined := strings.Join(args, " ")
	if strings.Contains(joined, "--downloader http:") {
		t.Fatalf("没有 aria2c 时不该拼 aria2 参数：%s", joined)
	}
}

func boolPtr(v bool) *bool { return &v }

// 真机：用 aria2c 下一份本地 HTTP 文件，确认进程真的被拉起并且产物完整。
//
// 断言的是「aria2 接管了 HTTP 下载」这件事本身——参数对了但 aria2c
// 起不来（缺库、路径错、权限）时，yt-dlp 会报错，这条就会红。
func TestRealDownloadWithAria2(t *testing.T) {
	aria2 := aria2cPath(t)
	ytdlp := realYtdlpPath()
	if ytdlp == "" {
		t.Skip("本机没有真实 yt-dlp，跳过")
	}

	// 4MB 夹具：大于 --min-split-size=1M，aria2 才会真的分片
	payload := make([]byte, 4<<20)
	for i := range payload {
		payload[i] = byte(i % 251)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.ServeContent(w, r, "sample.mp4", time.Now(), strings.NewReader(string(payload)))
	}))
	defer srv.Close()

	outDir := t.TempDir()
	on := true
	args := download.BuildArgs(
		download.Options{
			TaskID: "aria2-e2e", URL: srv.URL + "/sample.mp4", FormatID: "best",
			DownloadMode: "video", FilenameTmpl: "aria2-e2e",
			Acceleration: &download.Acceleration{Enabled: &on, MaxConnections: 8},
		},
		outDir,
		download.BuildArgsContext{Aria2Path: aria2},
	)
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "--downloader http:"+aria2) {
		t.Fatalf("参数里没有启用 aria2：%s", joined)
	}
	// aria2 的临时片段必须落在输出目录下的隔离目录里，不能与最终产物混在一起
	if !strings.Contains(joined, filepath.Join(outDir, ".downvid-aria2")) {
		t.Fatalf("缺少 aria2 片段隔离目录参数：%s", joined)
	}

	runner := download.NewRunner()
	res, err := runner.Run("aria2-e2e", download.RunOptions{
		YtdlpPath: ytdlp, Args: args, URL: srv.URL + "/sample.mp4", OutputDir: outDir,
		Timeout: 120 * time.Second,
		OnEvent: func(ev download.Event) {
			t.Logf("事件: kind=%s percent=%.1f speed=%s", ev.Kind, ev.Percent, ev.Speed)
		},
	})
	if err != nil {
		t.Fatalf("aria2 下载失败：%v", err)
	}
	if res.Code != nil && *res.Code != 0 {
		t.Fatalf("yt-dlp 退出码 %d：%s", *res.Code, res.Stderr)
	}

	// 产物必须完整（大小接近源文件；mp4 容器会有少量封装开销）
	found := false
	entries, _ := os.ReadDir(outDir)
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		st, _ := e.Info()
		if st.Size() >= int64(len(payload)) {
			found = true
			t.Logf("产物：%s（%d 字节，源 %d）", e.Name(), st.Size(), len(payload))
		}
	}
	if !found {
		t.Fatalf("没有找到完整产物，目录内容：%v", entries)
	}
}

// realYtdlpPath 返回本机真实的 yt-dlp（优先托管目录）。
func realYtdlpPath() string {
	home, _ := os.UserHomeDir()
	candidates := []string{
		filepath.Join(home, "Library/Application Support/downvid/runtime/bin/yt-dlp"),
		filepath.Join(home, ".config/downvid/runtime/bin/yt-dlp"),
		"/opt/homebrew/bin/yt-dlp",
		"/usr/local/bin/yt-dlp",
	}
	for _, p := range candidates {
		if st, err := os.Stat(p); err == nil && st.Mode().IsRegular() {
			return p
		}
	}
	if p, err := exec.LookPath("yt-dlp"); err == nil {
		return p
	}
	return ""
}
