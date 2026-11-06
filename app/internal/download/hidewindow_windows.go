//go:build windows

package download

import (
	"os/exec"
	"syscall"
)

// hideWindow 让子进程不弹出控制台窗口（yt-dlp 下载与 taskkill 都用它）。
//
// 单独成文件是因为 `SysProcAttr.HideWindow` 只有 Windows 存在——
// 写在主文件里会让 Linux/macOS 编译不过。
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
