package deps

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

// 依赖管理层的测试：**真起进程**（用 shell 脚本扮边车）。
//
// 为什么不用 mock：这层要验证的恰好是「边车输出怎么到我们手里」——
// 流式 NDJSON、stdout/stderr 分流、取消、超时。mock 掉这些等于什么都没测。

func fakeSidecar(t *testing.T, script string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("用 shell 脚本做夹具，Windows 上跳过")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "fake-downvid-deps")
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+script), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

// --- detect ---

func TestDetectParsesSnapshot(t *testing.T) {
	sidecar := fakeSidecar(t, `cat <<'JSON'
{"platform":"darwin-arm64","managedDir":"/tmp/bin","path":"/usr/bin:/opt/homebrew/bin","results":[
 {"kind":"yt-dlp","found":true,"path":"/x/yt-dlp","version":"2026.10.10.233141","source":"managed","form":"zipapp"},
 {"kind":"ffmpeg","found":true,"path":"/opt/ffmpeg","version":"9.0.2","source":"system"},
 {"kind":"ffprobe","found":false,"optional":true,"reason":"未找到"},
 {"kind":"aria2","found":true,"optional":true,"path":"/opt/aria2c","version":"1.37.0","source":"system"}
]}
JSON
`)

	m := NewManager(sidecar, "/tmp/bin")
	snap, err := m.Detect(false)
	if err != nil {
		t.Fatal(err)
	}
	if snap.Platform != "darwin-arm64" || len(snap.Results) != 4 {
		t.Fatalf("got %+v", snap)
	}
	// 宿主随后要用这份 PATH 起 yt-dlp（zipapp 依赖 python3 ≥3.11），不能丢
	if snap.Path != "/usr/bin:/opt/homebrew/bin" {
		t.Fatalf("应保留边车回传的 PATH，got %q", snap.Path)
	}
	// yt-dlp 的 form 字段决定启动速度（zipapp 0.4s / native 9~12s），不能丢
	if snap.Results[0].Form != "zipapp" {
		t.Fatalf("应保留 form=zipapp，got %q", snap.Results[0].Form)
	}

	// Summarize 只算必需依赖：ffprobe 缺失不该报「缺少」
	missing, stale := Summarize(snap)
	if len(missing) != 0 {
		t.Fatalf("必需依赖都在，missing 应为空，got %v", missing)
	}
	if len(stale) != 0 {
		t.Fatalf("stale 应为空，got %v", stale)
	}
}

func TestSummarizeStaleSeparateFromMissing(t *testing.T) {
	snap := &Snapshot{Results: []Status{
		{Kind: KindYtdlp, Found: true, Stale: true},
		{Kind: KindFfmpeg, Found: false},
		{Kind: KindFfprobe, Found: false, Optional: true},
	}}
	missing, stale := Summarize(snap)
	// 「版本过旧」与「没找到」要分开：修法完全不同（一个点更新、一个点下载）
	if len(stale) != 1 || stale[0] != KindYtdlp {
		t.Fatalf("stale 应只有 yt-dlp，got %v", stale)
	}
	if len(missing) != 1 || missing[0] != KindFfmpeg {
		t.Fatalf("missing 应只有 ffmpeg，got %v", missing)
	}
}

func TestDetectCachesResult(t *testing.T) {
	// 脚本写标记，第二次应为缓存命中（只跑 1 次）
	dir := t.TempDir()
	marker := filepath.Join(dir, "runs")
	sidecar := fakeSidecar(t, "echo run >> '"+marker+"'\necho '{\"results\":[]}'\n")

	m := NewManager(sidecar, "/tmp/bin")
	if _, err := m.Detect(false); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Detect(false); err != nil {
		t.Fatal(err)
	}

	data, _ := os.ReadFile(marker)
	if n := strings.Count(string(data), "run"); n != 1 {
		t.Fatalf("第二次应命中缓存，实际跑了 %d 次", n)
	}

	// force 必须真的绕过缓存
	if _, err := m.Detect(true); err != nil {
		t.Fatal(err)
	}
	data, _ = os.ReadFile(marker)
	if n := strings.Count(string(data), "run"); n != 2 {
		t.Fatalf("force 时应再跑一次，实际 %d 次", n)
	}
}

func TestDetectWithoutSidecar(t *testing.T) {
	m := NewManager("", "/tmp/bin")
	if _, err := m.Detect(false); err != ErrNoSidecar {
		t.Fatalf("缺边车应返回 ErrNoSidecar，got %v", err)
	}
	if err := m.Install(FetchOptions{}, nil); err != ErrNoSidecar {
		t.Fatalf("缺边车时下载也应报错，got %v", err)
	}
}

// --- install：流式进度 ---

// 最重要的用例：进度必须**边下边推**，不能等进程结束。
func TestInstallStreamsProgress(t *testing.T) {
	sidecar := fakeSidecar(t, `echo '{"event":"progress","tool":"yt-dlp","downloaded":1000,"total":4000}'
sleep 0.15
echo '{"event":"progress","tool":"yt-dlp","downloaded":4000,"total":4000}'
sleep 0.15
echo '{"event":"done","tool":"yt-dlp"}'
`)

	var mu sync.Mutex
	var events []Progress
	var times []time.Duration
	start := time.Now()

	m := NewManager(sidecar, "/tmp/bin")
	err := m.Install(FetchOptions{}, func(p Progress) {
		mu.Lock()
		events = append(events, p)
		times = append(times, time.Since(start))
		mu.Unlock()
	})
	if err != nil {
		t.Fatal(err)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(events) != 3 {
		t.Fatalf("应收到 3 条事件，got %d", len(events))
	}
	if events[0].Downloaded != 1000 || events[0].Total != 4000 {
		t.Fatalf("got %+v", events[0])
	}

	// 「流式」的判据是**事件之间的间隔**，不是首条的绝对时间。
	//
	// 首条含进程启动开销（起 shell + 边车初始化，实测 ~280ms），
	// 用绝对时间判定会在 CI 上随机失败。而间隔能真实反映「逐行到达」：
	// 脚本每两条之间 sleep 150ms，若实现是「等进程结束再一次性解析」，
	// 三条会在同一时刻到达（间隔 ≈ 0）。
	for i := 1; i < len(times); i++ {
		gap := times[i] - times[i-1]
		if gap < 80*time.Millisecond {
			t.Fatalf("事件 %d 与上一条间隔 %v，说明不是流式推送（应约 150ms）", i, gap)
		}
	}
	// 最后一条不该和第一条同时到
	if total := times[len(times)-1] - times[0]; total < 200*time.Millisecond {
		t.Fatalf("首条到末条只隔 %v，说明是攒完再推", total)
	}
}

// 非 JSON 行（边车的日志误写到 stdout）要跳过，不能中断下载
func TestInstallSkipsNonJSONLines(t *testing.T) {
	sidecar := fakeSidecar(t, `echo 'not json'
echo '[deps] 一些日志'
echo '{"event":"done","tool":"ffmpeg"}'
`)

	var events []Progress
	m := NewManager(sidecar, "/tmp/bin")
	if err := m.Install(FetchOptions{}, func(p Progress) { events = append(events, p) }); err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Event != "done" {
		t.Fatalf("应只收到 done 事件，got %+v", events)
	}
}

// 下载完成后必须清缓存：界面要立刻看到新状态
func TestInstallInvalidatesCache(t *testing.T) {
	dir := t.TempDir()
	marker := filepath.Join(dir, "detects")
	sidecar := fakeSidecar(t, `case "$1" in
  detect) echo run >> '`+marker+`'; echo '{"results":[]}' ;;
  fetch)  echo '{"event":"done"}' ;;
esac
`)

	m := NewManager(sidecar, "/tmp/bin")
	if _, err := m.Detect(false); err != nil {
		t.Fatal(err)
	}
	// 缓存命中：detect 只跑 1 次
	if _, err := m.Detect(false); err != nil {
		t.Fatal(err)
	}
	if err := m.Install(FetchOptions{}, nil); err != nil {
		t.Fatal(err)
	}
	// 下载后缓存应被清：detect 会再跑一次
	if _, err := m.Detect(false); err != nil {
		t.Fatal(err)
	}

	data, _ := os.ReadFile(marker)
	if n := strings.Count(string(data), "run"); n != 2 {
		t.Fatalf("下载后应清缓存（detect 跑 2 次），实际 %d 次", n)
	}
}

// 边车用 cli.Fail 报错时（stdout 有 error 事件 + 非零退出码），错误要带出说明
func TestInstallSurfaceSidecarError(t *testing.T) {
	sidecar := fakeSidecar(t, `echo '{"event":"error","message":"网络不可达"}'
echo '[deps] 错误：网络不可达' >&2
exit 1
`)

	var events []Progress
	m := NewManager(sidecar, "/tmp/bin")
	err := m.Install(FetchOptions{}, func(p Progress) { events = append(events, p) })
	if err == nil {
		t.Fatal("非零退出码应返回错误")
	}
	// 错误事件本身已经通过 onProgress 给出了
	if len(events) != 1 || events[0].Event != "error" {
		t.Fatalf("应收到 error 事件，got %+v", events)
	}
	// 错误消息要带上边车的说明，而不是一句「exit status 1」
	if !strings.Contains(err.Error(), "网络不可达") {
		t.Fatalf("错误应带边车说明，got %q", err.Error())
	}
}

// Cancel 要真的终止进程
func TestInstallCancel(t *testing.T) {
	sidecar := fakeSidecar(t, `echo '{"event":"progress","tool":"yt-dlp","downloaded":1,"total":100}'
sleep 30
`)

	m := NewManager(sidecar, "/tmp/bin")
	done := make(chan error, 1)
	go func() {
		done <- m.Install(FetchOptions{}, func(Progress) {})
	}()

	// 等它真的开始
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && !m.IsDownloading() {
		time.Sleep(20 * time.Millisecond)
	}
	if !m.IsDownloading() {
		t.Fatal("应处于下载中")
	}

	if !m.Cancel() {
		t.Fatal("Cancel 应返回 true")
	}

	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "取消") {
			t.Fatalf("应返回取消错误，got %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("取消后进程未在 10 秒内退出")
	}
}

// 重复 Install 要拒绝（否则两个进程同时写同一个 .part）
func TestInstallRejectsConcurrent(t *testing.T) {
	sidecar := fakeSidecar(t, `sleep 30
`)

	m := NewManager(sidecar, "/tmp/bin")
	go func() { _ = m.Install(FetchOptions{}, nil) }()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && !m.IsDownloading() {
		time.Sleep(20 * time.Millisecond)
	}

	err := m.Install(FetchOptions{}, nil)
	if err == nil || !strings.Contains(err.Error(), "已有依赖下载正在进行") {
		t.Fatalf("并发下载应被拒绝，got %v", err)
	}

	m.Cancel()
	time.Sleep(300 * time.Millisecond)
}

// --- FormatBytes ---

func TestFormatBytes(t *testing.T) {
	cases := map[int64]string{
		0:                  "",
		-1:                 "",
		1024:               "1 KB",
		1536:               "2 KB", // 四舍五入
		1024 * 1024:        "1.0 MB",
		37 * 1024 * 1024:   "37.0 MB",
		1024 * 1024 * 1024: "1.00 GB",
	}
	for in, want := range cases {
		if got := FormatBytes(in); got != want {
			t.Errorf("FormatBytes(%d) = %q, want %q", in, got, want)
		}
	}
}
