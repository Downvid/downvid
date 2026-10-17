//go:build windows

package parse

import (
	"os/exec"
	"syscall"
)

// hideWindowParse 让 yt-dlp 不弹出控制台窗口。
func hideWindowParse(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
