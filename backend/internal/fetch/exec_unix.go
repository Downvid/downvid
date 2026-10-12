//go:build !windows

package fetch

import "os/exec"

// hideWindow 在类 Unix 系统上是空操作
func hideWindow(_ *exec.Cmd) {}
