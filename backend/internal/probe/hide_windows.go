//go:build windows

package probe

import (
	"os/exec"
	"syscall"
)

// hideWindow 隐藏子进程控制台窗口，避免探测时闪黑框
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
