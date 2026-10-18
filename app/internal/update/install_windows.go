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
// ## 与 electron-updater 的参数兼容
//
// 老用户由 electron-updater 触发更新时，它会传：
//
//	installer.exe --updated /S --force-run
//
// Wails 的 NSIS 脚本只认 `/S`（静默安装），额外参数被忽略。
// 结果是**装得上但不会自动重启** —— 这是可接受的降级，
// 但如果我们要让老用户平滑迁移，最好在 NSIS 脚本里补上这两个参数。

import (
	"errors"
	"os"
	"os/exec"
)

// InstallWindows 静默运行 NSIS 安装器。
//
// 返回后调用方应立即退出：安装器会等待本进程结束再覆盖文件。
func InstallWindows(installerPath string, logPath string) error {
	if installerPath == "" {
		return errors.New("缺少安装包路径")
	}
	if _, err := os.Stat(installerPath); err != nil {
		return errors.New("安装包不存在：" + err.Error())
	}

	// `/S` 静默安装。不加 `--force-run`：Wails 的脚本不认，
	// 而装完由安装器自己启动新版（它的脚本里有 open/exec）。
	cmd := exec.Command(installerPath, "/S")
	cmd.Dir = os.TempDir()
	if err := cmd.Start(); err != nil {
		return errors.New("启动安装器失败：" + err.Error())
	}
	return nil
}

// InstallMac / InstallLinux 在 Windows 上不会被调用，但必须存在。
func InstallMac(zipPath, appBundle, logPath string) error {
	return errors.New("macOS 安装包不能在 Windows 上安装")
}

func InstallLinux(newAppImage string) error {
	return errors.New("AppImage 不能在 Windows 上安装")
}
