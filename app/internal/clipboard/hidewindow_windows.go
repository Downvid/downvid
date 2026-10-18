//go:build windows

package clipboard

import (
	"os/exec"
	"syscall"
)

// hideWindow 避免执行 powershell 时闪一个控制台窗口。
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
