//go:build windows

package download

// Windows 侧：没有进程组信号，只能靠 `taskkill /T /F`。
//
// `/T` 是整棵树（这正是我们要的），`/F` 是强制。
// **顺序**：必须先 taskkill 再杀父进程，否则父进程先死、taskkill 就
// 拿不到父子关系了。

import (
	"os"
	"os/exec"
	"time"
)

// killTreeByPlatform 是跨平台分发点的 Windows 实现。
//
// 通用文件按 `KillOptions.Platform` 分发，而那个字段**可被调用方覆盖**
// （测试会用 `Platform: "linux"` 在 mac 上验证 POSIX 分支）。所以这个符号
// 在每个平台都必须存在，否则编译期就报 `undefined: killTreeByPlatform`。
//
// Windows 走不到这里时也返回 `killTreeWindows` 的结果：真到了这一步，
// 调用方明确要求按「非 windows」处理，但我们手上只有 taskkill ——
// 与其静默什么都不做（那会留下孤儿进程继续吃带宽），不如照样收树。
func killTreeByPlatform(target KillTarget, grace time.Duration) error {
	return killTreeWindows(target, KillOptions{}, grace)
}

// SetProcessGroup 在 Windows 上是**空操作**。
//
// POSIX 靠 `Setpgid` 让子进程成为新进程组组长；Windows 的 `SysProcAttr`
// 根本没有这个字段（写在同一文件里会 `GOOS=windows go build` 直接失败），
// 而且设了 `CREATE_NEW_PROCESS_GROUP` 还会弹新控制台窗口。
// 收树由 `taskkill /T` 负责，不需要这层。
func SetProcessGroup(cmd *exec.Cmd, platform string) {
	_ = cmd
	_ = platform
}

// isProcessAlive 在 Windows 上用 `os.FindProcess` 探活。
//
// 与 POSIX 的 `kill(pid, 0)` 不同：Windows 上 `FindProcess` 对已退出的 pid
// 也可能成功（它只是打开一个句柄）。所以这里**只能作为「大概还活着」的
// 提示**，真正的判断由调用方的 `Exited` 回调（`Wait` 之后的 ProcessState）
// 与 taskkill 的返回值负责。
func isProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	p, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	_ = p.Release()
	return true
}
