package probe

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// slowBinary 写一个「启动很慢、之后才输出」的假二进制，用来模拟
// yt-dlp 官方 macOS 构建（PyInstaller，本机实测 --version 要 8～10 秒）。
//
// 慢的必须是**执行**本身：用例要证明的正是「单候选时限必须容得下 8 秒级启动」，
// 把 CandidateTimeout 改小就该失败。
func slowBinary(t *testing.T, dir, name, output string, delay time.Duration) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("Windows 上无法用 shell 脚本模拟慢启动")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, name)
	script := fmt.Sprintf("#!/bin/sh\nsleep %.1f\necho '%s'\n", delay.Seconds(), output)
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

// TestCandidateTimeoutAllowsSlowStartup 回归 issue：刚下载好的 yt-dlp 被判为「不可用」。
//
// 现象：用户点「下载」→ 进度跑完 → 界面**仍然显示「下载」**，反复点都没用。
// 原因：探测单候选只有 3 秒预算，而 yt-dlp 的 macOS 官方构建（约 37MB，
// PyInstaller 打包）`--version` 稳定要 8～10 秒，于是超时被翻译成
// 「执行超时，文件可能损坏」，托管副本被跳过、结果回落到系统里的旧版本
// （或直接报缺失）。Homebrew / uv 装的是 Python zipapp，只要 0.2 秒，
// 所以只有「必须用托管副本」的机器会踩到。
//
// 这个用例把 6 秒的启动放进探测：预算只要退回 3 秒就会失败。
func TestCandidateTimeoutAllowsSlowStartup(t *testing.T) {
	if testing.Short() {
		t.Skip("需要真实等待，short 模式跳过")
	}
	path := slowBinary(t, t.TempDir(), "yt-dlp", "2026.10.10.233141", 6*time.Second)

	info, err := Run("yt-dlp", path)
	if err != nil {
		t.Fatalf("6 秒启动的候选不应被判为不可用（预算 %s）：%v", CandidateTimeout, err)
	}
	if info.Version != "2026.10.10.233141" {
		t.Errorf("版本 = %q，期望 2026.10.10.233141", info.Version)
	}
}

// TestCandidateTimeoutIsGreaterThanSlowStartup 把「预算必须够」写成断言。
//
// 直接写死 3 秒的人大概率不是有意的，所以这里用下界约束把它挡住：
// 一旦有人把 CandidateTimeout 调回 3 秒，这条会先失败并说明原因。
func TestCandidateTimeoutIsGreaterThanSlowStartup(t *testing.T) {
	const ytDlpWorstCase = 10 * time.Second // 本机实测 8～10 秒
	if CandidateTimeout < ytDlpWorstCase {
		t.Fatalf("CandidateTimeout = %s，必须 ≥ %s：yt-dlp 官方 macOS 构建冷启动就要这么久，"+
			"预算不足会让刚下载好的副本被判为「文件损坏」", CandidateTimeout, ytDlpWorstCase)
	}
}

// TestTimeoutMessageNotAbsolute 超时提示不应断言「文件已损坏」。
//
// 用户看到「文件可能损坏」会去重新下载，而下一次依然超时——正是这个
// 误导性的措辞让现象看起来像「下载坏了」。
//
// 直接测 describeRunError：起真实进程来触发超时既慢又不跨平台
// （曾经用 /bin/echo，在 Windows 上直接报「executable file not found」）。
func TestTimeoutMessageNotAbsolute(t *testing.T) {
	msg := describeRunError(context.DeadlineExceeded, "").Error()
	if !strings.Contains(msg, "超时") {
		t.Errorf("错误信息应说明超时，实际：%s", msg)
	}
	if strings.Contains(msg, "，文件可能损坏") {
		t.Errorf("不应把超时断言成「文件损坏」：下载好的文件也会超时，实际：%s", msg)
	}
	// 上下文取消（用户关掉界面 / 父级超时）走同一条文案
	msg2 := describeRunError(context.Canceled, "").Error()
	if !strings.Contains(msg2, "超时") {
		t.Errorf("上下文取消也应给出超时文案，实际：%s", msg2)
	}
}
