// Package download —— 结束整棵进程树。
//
// 本文件是 electron/download/process-tree.ts 的 Go 移植（132 行，8 条用例）。
//
// ## 为什么必须杀进程树（照搬原注释，这些坑都真实踩过）
//
// `Child.Kill()` 只给**直接子进程**发信号。而 yt-dlp 在启用 aria2 时是这样跑的：
//
//	Electron ──spawn──▶ yt-dlp ──spawn──▶ aria2c
//
// 杀 yt-dlp 之后 aria2c 变成孤儿，**继续把文件下完**。后果不是「多下一个文件」
// 这么简单：
//
//  1. 暂停后 .part 还在被写 → 界面显示的大小继续涨，看起来像没暂停；
//  2. 恢复时 aria2c 拿到的 .aria2 控制文件已经过时/被写坏 → 判定无法续传，
//     **从零重下整个文件**（实测 16MB 的样本重传了 16.8MB）；
//  3. 用户点暂停却吃满带宽，这是最直观的「加速功能坏了」。
//
// POSIX 用「进程组」解决：`SysProcAttr{Setpgid: true}` 让子进程成为新进程组组长，
// 于是 `syscall.Kill(-pid, sig)` 一次信号覆盖整棵树。
// Windows 没有进程组信号，只能 `taskkill /T /F`（`/T` 就是整棵树）。
//
// **顺序很关键**：Windows 上必须先 taskkill 再杀父进程，否则父进程先死、
// taskkill 拿不到子进程关系。
package download

import (
	"context"
	"os/exec"
	"runtime"
	"strconv"
	"syscall"
	"time"
)

// KillOptions 是终止整棵进程树的选项。
type KillOptions struct {
	// Grace 是等待落盘的宽限期：aria2c 需要时间把 .aria2 控制文件写完
	Grace time.Duration
	// Platform 覆盖平台判断（测试用）
	Platform string
	// TaskkillPath 覆盖 taskkill 路径（测试用）；空则用默认位置
	TaskkillPath string
}

// KillTarget 是被终止的进程。
//
// 不用 *exec.Cmd 而用最小接口：调用方可能持有的是「已封装过的任务对象」，
// 而且测试不需要真起进程。
type KillTarget struct {
	PID uint32
	// Exited 报告进程是否已经结束（调用方据此跳过无意义的信号）
	Exited func() bool
	// Kill 是退回逐个杀时的兜底（对应 TS 的 child.kill）
	Kill func(sig syscall.Signal) error
}

// KillProcessTree 结束整棵进程树。
//
// 返回 error 而不是 fire-and-forget：调用方（暂停）必须等 aria2c 真的把控制文件
// 写完再返回，否则恢复时会读到半截文件，前功尽弃。
func KillProcessTree(target KillTarget, opts KillOptions) error {
	if target.PID == 0 || (target.Exited != nil && target.Exited()) {
		return nil
	}

	grace := opts.Grace
	if grace <= 0 {
		grace = 3 * time.Second
	}
	platform := opts.Platform
	if platform == "" {
		platform = CurrentPlatform()
	}

	if platform == "windows" {
		return killTreeWindows(target, opts, grace)
	}
	return killTreePOSIX(target, grace)
}

// killTreeWindows 用 `taskkill /T /F` 收掉整棵树。
func killTreeWindows(target KillTarget, opts KillOptions, grace time.Duration) error {
	exe := opts.TaskkillPath
	if exe == "" {
		exe = `C:\Windows\System32\taskkill.exe`
	}

	ctx, cancel := context.WithTimeout(context.Background(), min(grace, 5*time.Second))
	defer cancel()

	// /T = 整棵树，/F = 强制。必须**先** taskkill：父进程先死会断开子进程关系。
	cmd := exec.CommandContext(ctx, exe, "/PID", strconv.FormatUint(uint64(target.PID), 10), "/T", "/F")
	hideWindow(cmd)
	if err := cmd.Run(); err != nil {
		// taskkill 失败（进程已退出、权限不足）时至少把直接子进程收掉
		if target.Kill != nil {
			_ = target.Kill(syscall.SIGKILL)
		}
	}
	return nil
}

// killTreePOSIX 对进程组发信号。
//
// 先 SIGTERM 给 aria2c 机会把 .aria2 控制文件写完整；宽限期后仍未退出才 SIGKILL。
// 直接 SIGKILL 会让控制文件停留在上一次 auto-save 的状态，恢复时丢最后几秒的进度。
func killTreePOSIX(target KillTarget, grace time.Duration) error {
	pid := int(target.PID)

	signal := func(sig syscall.Signal) {
		// 负 pid = 发给整个进程组。
		if err := syscall.Kill(-pid, sig); err == nil {
			return
		}
		// 失败通常是因为子进程不是组长（没设 Setpgid，或已被系统重新归组），
		// 此时退回杀单个进程——总比什么都不做好。
		if target.Kill != nil {
			_ = target.Kill(sig)
		}
	}

	signal(syscall.SIGTERM)

	// 轮询等待退出。上限是宽限期的一半，留出另一半给最后的 SIGKILL 生效。
	deadline := time.Now().Add(grace / 2)
	for time.Now().Before(deadline) {
		if isProcessAlive(pid) == false {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}

	// 还没退出就上 SIGKILL：绝不能留下孤儿进程继续吃带宽
	if isProcessAlive(pid) {
		signal(syscall.SIGKILL)
	}
	return nil
}

// isProcessAlive 探测进程是否存在（signal 0 只探测，不真的发信号）。
//
// EPERM 表示「进程存在但没权限」——不该发生在我们自己的子进程上，
// 但绝不能误判成已退出（那样会跳过 SIGKILL，留下孤儿）。
func isProcessAlive(pid int) bool {
	err := syscall.Kill(pid, 0)
	if err == nil {
		return true
	}
	return err == syscall.EPERM
}

// CurrentPlatform 返回 Node 风格（`win32`）还是 Go 风格（`windows`）？
//
// **统一用 Go 风格**（`windows` / `linux` / `darwin`）。这与仓库其它地方
// （依赖清单、资产表）一致；跨语言映射只发生在边界上，不在核心逻辑里。
func CurrentPlatform() string {
	return runtime.GOOS
}

// SetProcessGroup 让子进程成为新进程组的组长，从而能被整组收掉。
//
// POSIX 上必须设；Windows 上**不要**设（会弹新控制台窗口，且 taskkill 已能处理树）。
func SetProcessGroup(cmd *exec.Cmd, platform string) {
	if platform == "" {
		platform = CurrentPlatform()
	}
	if platform == "windows" {
		return
	}
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true
}

func min(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}
