package download

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// 执行层的测试：**真起进程**，不 mock。
//
// 为什么不用 mock：这层要验证的恰好是「子进程的输出怎么到我们手里」——
// 管道缓冲、半行、stderr 分流、进程组终止，全是真实进程才有的行为。
// mock 掉就等于什么都没测。
//
// 用 shell 脚本扮 yt-dlp：输出格式与真的一致（`[dvp]` 行、stderr 的 `[dvpp]`），
// 但不需要网络也不需要真的下载。

func writeFakeYtdlp(t *testing.T, script string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("用 shell 脚本做夹具，Windows 上跳过（真实的 Windows 路径由原生回归覆盖）")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "fake-ytdlp")
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+script), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

// 完整一次「下载」：stdout 进度 + stderr 后处理 + 最终文件路径。
func TestRunParsesRealProcessOutput(t *testing.T) {
	fake := writeFakeYtdlp(t, `
echo "[dvp]5242880|10485760|NA|2097152|2|0|0"
echo "[dvp]10485760|10485760|NA|0|NA|0|0"
echo "[dvpp]Merger|started" >&2
echo "[dvfile]/tmp/out/video.mp4"
exit 0
`)
	outDir := t.TempDir()

	var events []Event
	r := NewRunner()
	res, err := r.Run("t1", RunOptions{
		YtdlpPath: fake,
		Args:      []string{"-f", "137"},
		URL:       "https://example.com/v",
		OutputDir: outDir,
		OnEvent:   func(ev Event) { events = append(events, ev) },
	})
	if err != nil {
		t.Fatal(err)
	}

	if res.Code == nil || *res.Code != 0 {
		t.Fatalf("退出码应为 0，got %v", res.Code)
	}
	if res.FilePath != "/tmp/out/video.mp4" {
		t.Errorf("FilePath = %q", res.FilePath)
	}
	if res.Paused {
		t.Error("不该标记为暂停")
	}
	if res.StartErr != nil {
		t.Errorf("成功的下载不该有 StartErr：%v", res.StartErr)
	}

	// 事件序列：两条进度 + file（前端据此更新任务的文件路径）+ merging。
	// 注意顺序不保证：stdout 与 stderr 是两个协程并行读的，
	// merging 走 stderr，可能与 stdout 的 file 行交错。
	var kinds []string
	for _, ev := range events {
		kinds = append(kinds, ev.Kind)
	}
	if !containsAll(kinds, []string{"progress", "progress", "file", "merging"}) {
		t.Fatalf("事件应包含 2 条 progress + file + merging，got %v", kinds)
	}
	if events[0].Percent < 49.9 || events[0].Percent > 50.1 {
		t.Errorf("第一条进度应约 50%%，got %v", events[0].Percent)
	}
}

// stderr 上的后处理进度必须被解析（`--print` 隐含 `--quiet`，那走 stderr）。
//
// 只读 stdout 的话这条会失败——而真机上表现是「合并阶段进度条不动」。
func TestRunReadsStderr(t *testing.T) {
	fake := writeFakeYtdlp(t, `
echo "[dvpp]ExtractAudio|started" >&2
exit 0
`)
	var events []Event
	r := NewRunner()
	if _, err := r.Run("t2", RunOptions{
		YtdlpPath: fake, Args: []string{}, URL: "u", OutputDir: t.TempDir(),
		OnEvent: func(ev Event) { events = append(events, ev) },
	}); err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Kind != "merging" {
		t.Fatalf("应收到 stderr 上的 merging 事件，got %+v", events)
	}
}

// 半行必须被正确拼起来。
//
// 管道的分块边界**不保证**与行对齐，一次 Read 可能拿到半行。
// 不处理会把半行当成完整行，解析出错误进度（表现为进度条乱跳）。
func TestRunHandlesSplitLines(t *testing.T) {
	// 用 printf 不带换行，分两次写，中间 sleep 强制分开到达
	fake := writeFakeYtdlp(t, `
printf "[dvp]5242880|1048576"
sleep 0.1
printf "0|NA|0|NA|0|0\n"
exit 0
`)
	var events []Event
	r := NewRunner()
	if _, err := r.Run("t3", RunOptions{
		YtdlpPath: fake, Args: []string{}, URL: "u", OutputDir: t.TempDir(),
		OnEvent: func(ev Event) { events = append(events, ev) },
	}); err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Fatalf("半行应被拼成一条完整事件，got %d 条：%+v", len(events), events)
	}
	if events[0].Percent < 49.9 || events[0].Percent > 50.1 {
		t.Errorf("Percent = %v, want ~50（半行拼接失败会得到错误百分比）", events[0].Percent)
	}
}

// 下载未开始就失败 → StartErr 被设置，调用方据此回退重试。
func TestRunSetsStartErrWhenFailedBeforeStart(t *testing.T) {
	fake := writeFakeYtdlp(t, `
echo "ERROR: Requested format is not available" >&2
exit 1
`)
	r := NewRunner()
	res, err := r.Run("t4", RunOptions{
		YtdlpPath: fake, Args: []string{}, URL: "u", OutputDir: t.TempDir(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.StartErr == nil {
		t.Fatal("未开始就失败时应设置 StartErr（调用方据此回退为按 URL 重试）")
	}
	if !strings.Contains(res.Stderr, "Requested format") {
		t.Errorf("Stderr 应保留原始错误，got %q", res.Stderr)
	}
}

// 已经开始下载后失败 → 不算 StartErr（重试也没用，直链已过期）。
func TestRunNoStartErrAfterProgress(t *testing.T) {
	fake := writeFakeYtdlp(t, `
echo "[dvp]1000|2000|NA|0|NA|0|0"
echo "ERROR: connection reset" >&2
exit 1
`)
	r := NewRunner()
	res, err := r.Run("t5", RunOptions{
		YtdlpPath: fake, Args: []string{}, URL: "u", OutputDir: t.TempDir(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.StartErr != nil {
		t.Errorf("已开始下载后的失败不该触发回退重试，got StartErr=%v", res.StartErr)
	}
}

// Pause 必须真的终止进程，而不是只置个标志位。
func TestRunnerPauseKillsProcess(t *testing.T) {
	// 长跑脚本：输出一行进度后 sleep 60 秒
	fake := writeFakeYtdlp(t, `
echo "[dvp]1000|2000|NA|0|NA|0|0"
sleep 60
`)
	r := NewRunner()
	done := make(chan RunResult, 1)
	go func() {
		// 不设 Timeout：靠 Pause 结束，这样才能验证 Pause 本身有效
		res, _ := r.Run("t6", RunOptions{
			YtdlpPath: fake, Args: []string{}, URL: "u", OutputDir: t.TempDir(),
		})
		done <- res
	}()

	// 等它真的开始
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && !r.IsRunning("t6") {
		time.Sleep(20 * time.Millisecond)
	}
	if !r.IsRunning("t6") {
		t.Fatal("任务应处于运行中")
	}

	if !r.Pause("t6") {
		t.Fatal("Pause 应返回 true")
	}

	select {
	case res := <-done:
		if !res.Paused {
			t.Error("结果应标记为暂停")
		}
	case <-time.After(10 * time.Second):
		t.Fatal("Pause 后进程未在 10 秒内退出（进程树没被收掉）")
	}
}

// 同一 taskID 不能并发 Run。
func TestRunnerRejectsConcurrentSameTask(t *testing.T) {
	fake := writeFakeYtdlp(t, `
echo "[dvp]1000|2000|NA|0|NA|0|0"
sleep 30
`)
	r := NewRunner()
	go func() {
		_, _ = r.Run("t7", RunOptions{YtdlpPath: fake, Args: []string{}, URL: "u", OutputDir: t.TempDir()})
	}()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && !r.IsRunning("t7") {
		time.Sleep(20 * time.Millisecond)
	}

	_, err := r.Run("t7", RunOptions{YtdlpPath: fake, Args: []string{}, URL: "u", OutputDir: t.TempDir()})
	if err != ErrAlreadyRunning {
		t.Fatalf("应返回 ErrAlreadyRunning，got %v", err)
	}

	r.Pause("t7")
	time.Sleep(200 * time.Millisecond)
}

// 缺 yt-dlp 路径要立刻报错，而不是起一个必然失败的空进程。
func TestRunRequiresYtdlpPath(t *testing.T) {
	r := NewRunner()
	if _, err := r.Run("t8", RunOptions{URL: "u"}); err == nil {
		t.Fatal("缺少 yt-dlp 路径应报错")
	}
}

// URL 必须拼在最后（参数 → cookie → URL）。
//
// 顺序错了 yt-dlp 会把 URL 当成又一个选项值，不报错但行为变了。
func TestRunAppendsURLAfterCookieArgs(t *testing.T) {
	// 脚本把收到的参数原样回显，我们检查顺序
	fake := writeFakeYtdlp(t, `
echo "[dvfile]ARGS:$*"
exit 0
`)
	var got string
	r := NewRunner()
	res, err := r.Run("t9", RunOptions{
		YtdlpPath:  fake,
		Args:       []string{"-f", "137"},
		CookieArgs: []string{"--cookies", "c.txt"},
		URL:        "https://example.com/v",
		OutputDir:  t.TempDir(),
		OnEvent:    func(ev Event) { got = ev.FilePath },
	})
	if err != nil {
		t.Fatal(err)
	}
	_ = res

	// 期望顺序：-f 137 --cookies c.txt <URL>
	//
	// 不能精确匹配 URL：shell 会把 `//` 折叠成 `/`，而我们的解析又会对它做
	// filepath.Abs（那是 ParseLine 的既有行为，与 TS 的 path.resolve 一致）。
	// 这里只验证**相对顺序**，那才是这条用例要守的东西。
	iArgs := strings.Index(got, "-f 137")
	iCookie := strings.Index(got, "--cookies c.txt")
	iURL := strings.Index(got, "example.com")
	if iArgs < 0 || iCookie < 0 || iURL < 0 {
		t.Fatalf("参数不全，实际收到：%q", got)
	}
	if !(iArgs < iCookie && iCookie < iURL) {
		t.Fatalf("顺序应为「参数(%d) → cookie(%d) → URL(%d)」，实际：%q", iArgs, iCookie, iURL, got)
	}
}

// containsAll 判断 list 是否包含 want 的全部元素（不要求顺序）。
func containsAll(list, want []string) bool {
	counts := map[string]int{}
	for _, v := range list {
		counts[v]++
	}
	for _, w := range want {
		if counts[w] == 0 {
			return false
		}
		counts[w]--
	}
	return true
}
