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
func TestTimeoutMessageNotAbsolute(t *testing.T) {
	// 用一个必然超时的上下文触发 describeRunError 的超时分支
	ctx, cancel := context.WithTimeout(context.Background(), time.Nanosecond)
	defer cancel()
	_, err := RunContext(ctx, "yt-dlp", "/bin/echo")
	if err == nil {
		t.Fatal("应当返回错误")
	}
	msg := err.Error()
	if !strings.Contains(msg, "超时") {
		t.Errorf("错误信息应说明超时，实际：%s", msg)
	}
	if strings.Contains(msg, "，文件可能损坏") {
		t.Errorf("不应把超时断言成「文件损坏」：下载好的文件也会超时，实际：%s", msg)
	}
}

// TestRunDoesNotWaitForOrphanedChild 回归「子进程被杀、孙进程还在」的挂起。
//
// 我们的候选不是简单进程：可能是 shell 脚本、也可能是 PyInstaller 启动器，
// 它们都会再拉起子进程。exec.CommandContext 超时后只杀**直接子进程**，
// 孙进程仍持有 stdout 管道 → `cmd.Run()` 一直等 I/O，**探测远超预算**。
//
// 实测：一个 `sleep 300` 的假二进制把 5 秒预算的探测拖成 300 秒；
// 用户侧表现是界面卡住几十秒到几分钟，最后报「依赖检测达到时限」。
// 修复手段是 cmd.WaitDelay（见 probe.run 的注释）。
//
// 这里用「自己立刻退出、但留一个持有管道的后台孙进程」精确复现该形状，
// 并把等待控制在秒级，免得用例本身要跑几分钟。
func TestRunDoesNotWaitForOrphanedChild(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 上无法用 shell 脚本模拟")
	}
	if testing.Short() {
		t.Skip("需要真实等待，short 模式跳过")
	}
	dir := t.TempDir()
	script := "#!/bin/sh\n" +
		// 后台孙进程继承 stdout 与 stderr，然后父脚本立刻退出
		"sleep 30 &\n" +
		"exit 0\n"
	path := filepath.Join(dir, "yt-dlp")
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}

	start := time.Now()
	_, _ = RunWithTimeout(context.Background(), "yt-dlp", path, 3*time.Second)
	elapsed := time.Since(start)

	// 没有 WaitDelay 时这里会等到孙进程自然结束（30 秒）
	if elapsed > 10*time.Second {
		t.Fatalf("耗时 %s：WaitDelay 没有生效，孤儿孙进程把探测挂住了", elapsed)
	}
	t.Logf("耗时 %s（孙进程仍在后台，但未阻塞探测）", elapsed)
}
