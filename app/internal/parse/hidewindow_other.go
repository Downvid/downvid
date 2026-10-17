//go:build !windows

package parse

import "os/exec"

// hideWindowParse 在非 Windows 平台是空操作。
func hideWindowParse(_ *exec.Cmd) {}
