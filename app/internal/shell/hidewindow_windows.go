//go:build windows

package shell

import (
	"os/exec"
	"syscall"
)

// hideWindow 让系统命令不弹出控制台窗口。
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
