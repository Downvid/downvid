//go:build windows

package deps

import (
	"os/exec"
	"strconv"
)

// setProcessGroup 在 Windows 上是空操作（进程树靠 taskkill /T 处理）。
func setProcessGroup(_ *exec.Cmd) {}

// signalTree 用 taskkill /T 杀掉整棵进程树。
//
// os.Interrupt 在 Windows 上不被支持，Taskkill /T 才能带走孙进程。
func signalTree(cmd *exec.Cmd, _ bool) {
	if cmd.Process == nil {
		return
	}
	if err := exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(cmd.Process.Pid)).Run(); err != nil {
		_ = cmd.Process.Kill()
	}
}
