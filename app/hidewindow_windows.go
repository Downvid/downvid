//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

// hideWindow 让子进程（如边车探测程序）不弹出控制台黑框。
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
