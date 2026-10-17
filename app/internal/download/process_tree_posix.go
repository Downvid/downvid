//go:build !windows

package download

// POSIX 侧：用**进程组**一次收掉整棵树。
//
// `killTreeByPlatform` 的名字是中性的（不带 POSIX）：通用文件按
// `Platform` 字段分发，而 `Platform` 可以被测试覆盖成 "windows"——
// 所以这个符号在**每个平台**都必须存在，否则 Windows 上编译会报
// `undefined: killTreeByPlatform`。
//
// 与 Windows 分开编译（`//go:build !windows`）不是洁癖：`syscall.Kill` 与
// `SysProcAttr.Setpgid` 在 Windows 上**根本不存在**，写在同一个文件里会让
// `GOOS=windows go build` 直接失败。CI 的 windows job 抓到的就是这个：
//
//     internal\download\process_tree.go:113:21: undefined: syscall.Kill
//     cmd.SysProcAttr.Setpgid undefined (type *syscall.SysProcAttr has no field ...)
//
// 而本机是 macOS，`go build ./...` 永远看不到它。

import (
	"os/exec"
	"syscall"
	"time"
)

// killTreePOSIX 对进程组发信号。
//
// 先 SIGTERM 给 aria2c 机会把 .aria2 控制文件写完整；宽限期后仍未退出才 SIGKILL。
// 直接 SIGKILL 会让控制文件停留在上一次 auto-save 的状态，恢复时丢最后几秒的进度。
func killTreeByPlatform(target KillTarget, grace time.Duration) error {
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
