//go:build !windows

package jsruntime

import "os/exec"

// hideWindow 在非 Windows 平台是空操作。
func hideWindow(_ *exec.Cmd) {}
