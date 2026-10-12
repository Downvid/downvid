//go:build !windows

package probe

import "os/exec"

// hideWindow 在 Linux 上是空操作（进程本就没有控制台窗口）
func hideWindow(_ *exec.Cmd) {}
