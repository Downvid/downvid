//go:build windows

package update

// Windows 的安装实现。
//
// ## 为什么必须是 NSIS 安装器，不能是裸 exe
//
// 正在运行的程序无法替换自己的 exe（文件被占用）。NSIS 安装器的做法是：
// 先把自己复制到临时目录，再从那里启动、等原进程退出、覆盖文件。
// 裸 exe 没有这个能力 —— 直接替换会失败并留下一个损坏的安装。
//
// ## 为什么要自己写一个批处理
//
// Wails 的 NSIS 模板（`pkg/buildassets/build/windows/installer/project.nsi`）
// 只负责复制文件，**不会等原进程退出，也不会在装完后重新启动应用**。
// 直接 `cmd.Start()` 安装器会有两个问题：
//
//  1. 安装器可能在本进程退出前就开始覆盖 exe，文件被占用导致安装失败；
//  2. 装完后应用消失，用户以为更新坏了。
//
// 所以这里交给一个独立的批处理：等几秒（本进程已退出）→ `/S` 静默安装并
// 等待它结束 → 重新启动新版本。批处理活过本进程，因此只用 Start，不能 Wait。

import (
	"errors"
	"os"
	"os/exec"
	"syscall"
)

// InstallWindows 静默运行 NSIS 安装器，装完重新打开应用。
//
// 返回后调用方应立即退出：批处理会先等本进程结束，再开始安装。
func InstallWindows(installerPath string, logPath string) error {
	if installerPath == "" {
		return errors.New("缺少安装包路径")
	}
	if _, err := os.Stat(installerPath); err != nil {
		return errors.New("安装包不存在：" + err.Error())
	}
	exe, err := os.Executable()
	if err != nil {
		return errors.New("拿不到可执行文件路径：" + err.Error())
	}

	script, err := os.CreateTemp(os.TempDir(), "downvid-update-*.bat")
	if err != nil {
		return errors.New("创建安装脚本失败：" + err.Error())
	}
	scriptPath := script.Name()
	if _, err := script.WriteString(windowsUpdateScript(installerPath, exe)); err != nil {
		_ = script.Close()
		_ = os.Remove(scriptPath)
		return errors.New("写入安装脚本失败：" + err.Error())
	}
	if err := script.Close(); err != nil {
		_ = os.Remove(scriptPath)
		return errors.New("写入安装脚本失败：" + err.Error())
	}

	// 隐藏控制台窗口；脚本要活过本进程，所以只 Start、不 Wait。
	cmd := exec.Command("cmd", "/c", scriptPath)
	cmd.Dir = os.TempDir()
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := cmd.Start(); err != nil {
		_ = os.Remove(scriptPath)
		return errors.New("启动安装脚本失败：" + err.Error())
	}
	return cmd.Process.Release()
}

// InstallMac / InstallLinux 在 Windows 上不会被调用，但必须存在。
func InstallMac(zipPath, appBundle, logPath string) error {
	return errors.New("macOS 安装包不能在 Windows 上安装")
}

func InstallLinux(newAppImage string) error {
	return errors.New("AppImage 不能在 Windows 上安装")
}
