//go:build windows

package download

import (
	"os/exec"
	"syscall"
)

// hideWindow 让 taskkill 不弹出控制台窗口。
//
// 单独成文件是因为 `SysProcAttr.HideWindow` 只有 Windows 存在——
// 写在主文件里会让 Linux/macOS 编译不过。
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
