package runtime

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/yxxbc/downvid/backend/internal/probe"
)

// 写一个可执行的假二进制，输出指定的版本号
func fakeBinary(t *testing.T, dir, name, output string) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, name)
	// Windows 上无法执行 shell 脚本，用 .bat 兜底
	if runtime.GOOS == "windows" {
		path = filepath.Join(dir, name+".bat")
		if err := os.WriteFile(path, []byte("@echo "+output+"\r\n"), 0o755); err != nil {
			t.Fatal(err)
		}
		return path
	}
	script := "#!/bin/sh\necho '" + output + "'\n"
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestBinaryNameSuffix(t *testing.T) {
	got := BinaryName(KindYtDlp)
	want := "yt-dlp"
	if runtime.GOOS == "windows" {
		want = "yt-dlp.exe"
	}
	if got != want {
		t.Errorf("BinaryName = %q, 期望 %q", got, want)
	}
}

// 托管目录必须优先于系统 PATH：用户点击下载后应立刻用上新版本
func TestManagedDirTakesPrecedenceInCandidates(t *testing.T) {
	managed := t.TempDir()
	list := candidatesFor(KindYtDlp, Options{ManagedDir: managed})

	if len(list) == 0 {
		t.Fatal("候选列表不应为空")
	}
	wantPath := filepath.Join(managed, BinaryName(KindYtDlp))
	if filepath.Clean(list[0].Path) != filepath.Clean(wantPath) {
		t.Errorf("首个候选应为托管目录 %q，实际 %q", wantPath, list[0].Path)
	}
	if list[0].Source != SourceManaged {
		t.Errorf("首个候选来源应为 managed，实际 %q", list[0].Source)
	}
}

// 手动指定必须排在所有来源之前
func TestManualPathWins(t *testing.T) {
	managed := t.TempDir()
	manual := filepath.Join(t.TempDir(), BinaryName(KindFFmpeg))
	list := candidatesFor(KindFFmpeg, Options{
		ManagedDir:  managed,
		ManualPaths: map[Kind]string{KindFFmpeg: manual},
	})

	if filepath.Clean(list[0].Path) != filepath.Clean(manual) {
		t.Errorf("首个候选应手动路径 %q，实际 %q", manual, list[0].Path)
	}
	if list[0].Source != SourceManual {
		t.Errorf("首个候选来源应为 manual，实际 %q", list[0].Source)
	}
}

// 候选路径需去重，避免同一文件被探测多次
func TestCandidatesDeduplicated(t *testing.T) {
	managed := t.TempDir()
	list := candidatesFor(KindFFmpeg, Options{ManagedDir: managed})
	seen := map[string]int{}
	for _, c := range list {
		seen[filepath.Clean(c.Path)]++
	}
	for path, count := range seen {
		if count > 1 {
			t.Errorf("路径 %q 重复出现 %d 次", path, count)
		}
	}
}

func TestFindAllCoversEveryKind(t *testing.T) {
	results := FindAll(Options{ManagedDir: t.TempDir()})
	if len(results) != len(Kinds) {
		t.Fatalf("应返回 %d 项结果，实际 %d", len(Kinds), len(results))
	}
	for _, r := range results {
		if r.Kind == "" {
			t.Error("结果缺少 kind 字段")
		}
		// 无论找到与否，界面都要有可展示的信息
		if r.Found && r.Version == "" {
			t.Errorf("%s 已找到但缺少版本号", r.Kind)
		}
		if !r.Found && r.Reason == "" {
			t.Errorf("%s 未找到时必须给出原因", r.Kind)
		}
	}
}

// 托管目录里损坏的二进制不应被采用，更不应让探测整体失败
func TestBrokenManagedBinaryIsSkipped(t *testing.T) {
	managed := t.TempDir()
	broken := filepath.Join(managed, BinaryName(KindYtDlp))
	if err := os.WriteFile(broken, []byte("not a real executable"), 0o755); err != nil {
		t.Fatal(err)
	}

	res := FindOne(KindYtDlp, Options{ManagedDir: managed})
	if res.Found && filepath.Clean(res.Path) == filepath.Clean(broken) {
		t.Error("损坏的托管二进制不应被判定为可用")
	}
	// 系统里装有 yt-dlp 时应回退到系统版本，否则给出原因
	if !res.Found && res.Reason == "" {
		t.Error("回退失败时必须说明原因")
	}
}

// 不可执行的托管文件应被跳过而不是中断探测
func TestNonExecutableManagedBinaryIsSkipped(t *testing.T) {
	managed := t.TempDir()
	noExec := filepath.Join(managed, BinaryName(KindFFmpeg))
	if err := os.WriteFile(noExec, []byte("#!/bin/sh\necho 6.0\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	res := FindOne(KindFFmpeg, Options{ManagedDir: managed})
	if res.Found && filepath.Clean(res.Path) == filepath.Clean(noExec) {
		t.Error("没有执行权限的文件不应被采用")
	}
}

// 探测结果必须带上来源，界面据此区分「系统自带」与「DownVid 下载」
func TestResultCarriesSource(t *testing.T) {
	managed := t.TempDir()
	_ = fakeBinary(t, managed, BinaryName(KindYtDlp), "2026.10.10")

	res := FindOne(KindYtDlp, Options{ManagedDir: managed})
	if !res.Found {
		t.Skipf("当前平台无法执行测试脚本：%s", res.Reason)
	}
	if res.Path == "" || res.Source == "" {
		t.Errorf("找到依赖时必须给出路径与来源，实际 %+v", res)
	}
	if res.Source != string(SourceManaged) {
		t.Errorf("托管的二进制来源应为 managed，实际 %q", res.Source)
	}
	if !res.Managed {
		t.Error("托管目录中的依赖应标记 managed=true")
	}
}

// 可选依赖需被标记，界面据此决定是否阻塞用户
func TestFfprobeIsOptional(t *testing.T) {
	if !Optional[KindFFprobe] {
		t.Error("ffprobe 应标记为可选依赖")
	}
	if Optional[KindYtDlp] || Optional[KindFFmpeg] {
		t.Error("yt-dlp 与 ffmpeg 是必需依赖，不应标记为可选")
	}
}

func TestSystemDirsExcludesAsar(t *testing.T) {
	for _, dir := range systemDirs() {
		if filepath.Base(dir) == "app.asar" || len(dir) > 0 && filepath.Base(filepath.Dir(dir)) == "app.asar" {
			t.Errorf("常见目录不应包含 app.asar：%q", dir)
		}
	}
}

// TestSlowManagedBinaryIsStillAdopted 回归 issue：下载完成后仍显示「下载」。
//
// 用户点「下载」→ 进度跑完 → 界面**还是显示「下载」**，反复点无效。
// 根因不在下载，而在下载后的回读：yt-dlp 官方 macOS 构建（PyInstaller，
// 约 37MB）`--version` 要 8～10 秒，而探测单候选曾只有 3 秒预算，
// 于是刚装好的托管副本被判为「执行超时，文件可能损坏」而被跳过。
//
// 这里让托管副本「启动慢但正确」，断言它仍被采用——把预算改回 3 秒即失败。
func TestSlowManagedBinaryIsStillAdopted(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 上无法用 shell 脚本模拟慢启动")
	}
	if testing.Short() {
		t.Skip("需要真实等待，short 模式跳过")
	}
	managed := t.TempDir()
	slow := filepath.Join(managed, BinaryName(KindYtDlp))
	script := "#!/bin/sh\nsleep 6\necho '2026.10.10.233141'\n"
	if err := os.WriteFile(slow, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}

	res := FindOne(KindYtDlp, Options{ManagedDir: managed})
	if !res.Found {
		t.Fatalf("启动慢但正常的托管副本应被采用，实际未找到：%s", res.Reason)
	}
	if filepath.Clean(res.Path) != filepath.Clean(slow) {
		t.Errorf("应采用托管副本 %q，实际 %q", slow, res.Path)
	}
	if res.Source != string(SourceManaged) || !res.Managed {
		t.Errorf("来源应为 managed 且 Managed=true，实际 source=%q managed=%v", res.Source, res.Managed)
	}
	if res.Version != "2026.10.10.233141" {
		t.Errorf("版本 = %q，期望 2026.10.10.233141", res.Version)
	}
}

// TestScanTimeLimitOutlastsOneCandidate 扫描时限必须容得下一个慢候选。
//
// 否则保底扫描会在命中第一个文件（可能正是刚下载好的托管副本）时被时限掐断，
// 「明明装了却说找不到」的旧问题会换个地方复现。
func TestScanTimeLimitOutlastsOneCandidate(t *testing.T) {
	if scanTimeLimit <= probe.CandidateTimeout {
		t.Fatalf("scanTimeLimit = %s 必须 > probe.CandidateTimeout = %s，"+
			"否则扫描连一个慢候选都跑不完", scanTimeLimit, probe.CandidateTimeout)
	}
}

// TestHangingCandidatesDoNotStarveManagedCopy 回归 Windows 回归用例暴露的设计缺陷。
//
// 曾用「超时后重试一次」对付慢启动，结果每个**卡死**的候选要 30 秒
// （15 秒 × 2），两个卡死候选就把一个依赖的 30 秒预算吃光，排在后面的
// 正常副本永远轮不到。正确解法是给「一个依赖内执行候选的总时间」设闸，
// 而不是给单个候选重试。
//
// 这里让两个候选彻底卡死（远超预算），断言后面的正常副本仍被采用。
func TestHangingCandidatesDoNotStarveManagedCopy(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 上无法用 shell 脚本模拟慢启动")
	}
	if testing.Short() {
		t.Skip("需要真实等待，short 模式跳过")
	}
	managed := t.TempDir()
	// 托管副本卡死（模拟损坏/被杀死的进程），PATH 里的副本正常
	hang := filepath.Join(managed, BinaryName(KindYtDlp))
	if err := os.WriteFile(hang, []byte("#!/bin/sh\nsleep 300\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	good := fakeBinary(t, filepath.Join(t.TempDir(), "path-a"), BinaryName(KindYtDlp), "2026.10.10.233141")
	t.Setenv("PATH", filepath.Dir(good))

	start := time.Now()
	res := FindOne(KindYtDlp, Options{ManagedDir: managed})
	elapsed := time.Since(start)

	if !res.Found {
		t.Fatalf("卡死候选之后的正常副本应被采用，实际：%s", res.Reason)
	}
	if res.Version != "2026.10.10.233141" {
		t.Errorf("版本 = %q，期望 2026.10.10.233141", res.Version)
	}
	// 单个依赖的探测不应被卡死候选拖成「不可接受的等待」
	if elapsed > 40*time.Second {
		t.Errorf("探测耗时 %s，超出预期（候选执行预算 %s 未生效）", elapsed, probeTimeLimit)
	}
}

// TestProbeBudgetResets 候选执行预算必须每次探测前重置。
//
// 它是包级可变状态，不重置的话「上一次探测把预算用光」会让下一次
// 静默什么都不做——与 scan 预算踩过的坑完全相同。
func TestProbeBudgetResets(t *testing.T) {
	probeDeadline = time.Now().Add(-time.Second) // 假装上一次已用尽
	if !probeBudgetExhausted() {
		t.Fatal("已过期的预算应判定为用尽")
	}
	resetProbeBudget()
	if probeBudgetExhausted() {
		t.Fatal("重置后不应判定为用尽")
	}
	probeDeadline = time.Time{} // 零值视为无期限
	if probeBudgetExhausted() {
		t.Fatal("零值应视为无期限，否则探测会静默不做任何事")
	}
}

// TestProbeTimeoutDetection 只有超时才重试，其它错误不该白等一个候选预算
func TestProbeTimeoutDetection(t *testing.T) {
	cases := map[string]bool{
		"执行超时（可执行文件响应过慢，可能已损坏，也可能是首次运行较慢）": true,
		"执行超时": false, // 下面单独断言：只要含标记就算超时
		"无法执行（macOS 可能已损坏或未签名，请重新下载）":     false,
		"文件格式不正确（可能下载不完整或与当前架构不匹配），请重新下载": false,
		"没有执行权限 (chmod +x)": false,
	}
	for msg, want := range cases {
		got := isProbeTimeout(errors.New(msg))
		if msg == "执行超时" {
			if !got {
				t.Errorf("%q 应判为超时", msg)
			}
			continue
		}
		if got != want {
			t.Errorf("isProbeTimeout(%q) = %v，期望 %v", msg, got, want)
		}
	}
	if isProbeTimeout(nil) {
		t.Error("nil 不应判为超时")
	}
}
