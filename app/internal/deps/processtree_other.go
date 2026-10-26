//go:build !windows

package deps

import (
	"os/exec"
	"syscall"
)

// setProcessGroup 让边车成为进程组组长。
//
// 边车自己会再起子进程（解压、校验），只给直接子进程发信号时那些孙进程会变孤儿，
// 继续写 .part 文件，看起来像「取消了但文件还在长」。
func setProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// signalTree 向整个进程组发信号；force 为 true 时用 SIGKILL。
func signalTree(cmd *exec.Cmd, force bool) {
	if cmd.Process == nil {
		return
	}
	sig := syscall.SIGTERM
	if force {
		sig = syscall.SIGKILL
	}
	// 负 pid = 整个进程组；失败说明组不存在，再退回单进程
	if err := syscall.Kill(-cmd.Process.Pid, sig); err == nil {
		return
	}
	_ = cmd.Process.Signal(sig)
}
