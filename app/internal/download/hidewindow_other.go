//go:build !windows

package download

import "os/exec"

// hideWindow 在非 Windows 平台是空操作（没有控制台窗口的概念）。
func hideWindow(_ *exec.Cmd) {}
