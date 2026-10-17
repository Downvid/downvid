//go:build windows

package deps

import (
	"os/exec"
	"syscall"
)

// hideWindow 让边车进程不弹出控制台窗口。
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
