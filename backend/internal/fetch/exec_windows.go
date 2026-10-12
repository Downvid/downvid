//go:build windows

package fetch

import (
	"os/exec"
	"syscall"
)

// hideWindow 隐藏子进程控制台窗口
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
