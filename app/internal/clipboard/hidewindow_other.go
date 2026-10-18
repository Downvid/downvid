//go:build !windows

package clipboard

import "os/exec"

// hideWindow 在 POSIX 上无事可做（本来就没有控制台窗口）。
func hideWindow(_ *exec.Cmd) {}
