//go:build windows

package jsruntime

import (
	"os/exec"
	"syscall"
)

// hideWindow 让 `node --version` 不弹出控制台窗口（TS 版的 windowsHide: true）。
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
