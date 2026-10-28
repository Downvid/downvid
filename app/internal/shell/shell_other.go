//go:build !windows

package shell

// 非 Windows 平台：一条系统命令就够了（对应 Electron 的
// `shell.openPath` / `showItemInFolder`），不需要引入第三方库。

import (
	"os/exec"
	"path/filepath"
	"runtime"
)

func openPathOS(path string) error {
	if runtime.GOOS == "darwin" {
		return exec.Command("open", path).Run()
	}
	return exec.Command("xdg-open", path).Run()
}

func showInFolderOS(path string) error {
	if runtime.GOOS == "darwin" {
		return exec.Command("open", "-R", path).Run()
	}
	// Linux 没有跨桌面环境的「选中文件」协议：Nautilus / Dolphin 各有参数，
	// Thunar 没有。与其猜，不如稳定地打开所在目录——文件就在里面。
	return exec.Command("xdg-open", filepath.Dir(path)).Run()
}

func openExternalOS(url string) error {
	if runtime.GOOS == "darwin" {
		return exec.Command("open", url).Run()
	}
	return exec.Command("xdg-open", url).Run()
}
