//go:build linux

package update

// Linux 的安装实现。
//
// ## 只支持 AppImage
//
// AppImage 是自挂载的单文件可执行程序，替换文件本身即可完成更新。
// deb / rpm 不行 —— 它们由包管理器记录，手动覆盖会破坏系统包数据库
// （`apt list --installed` 里的版本与实际文件不符，下次 apt 升级会覆盖回来）。
//
// tar.gz 同理：解压到哪里由用户决定，我们无从得知。

import (
	"errors"
	"os"
	"path/filepath"
)

// InstallLinux 用新的 AppImage 替换当前文件。
//
// 与 macOS 不同，这里**不做「等自己退出再替换」**：
// Linux 允许替换正在执行的文件（inode 引用还在），下次启动就是新版。
func InstallLinux(newAppImage string) error {
	if newAppImage == "" {
		return errors.New("缺少安装包路径")
	}

	current, err := os.Executable()
	if err != nil {
		return errors.New("拿不到当前可执行文件路径")
	}
	// 解析符号链接：AppImage 常被软链到 ~/.local/bin
	if resolved, err := filepath.EvalSymlinks(current); err == nil {
		current = resolved
	}

	data, err := os.ReadFile(newAppImage)
	if err != nil {
		return errors.New("读取新版本失败：" + err.Error())
	}

	// 先写同目录的临时文件再 rename：rename 是原子的，
	// 中途失败不会留下半个可执行文件
	tmp := current + ".new"
	if err := os.WriteFile(tmp, data, 0o755); err != nil {
		return errors.New("写入新版本失败（可能没有目录写权限）：" + err.Error())
	}
	if err := os.Rename(tmp, current); err != nil {
		_ = os.Remove(tmp)
		return errors.New("替换可执行文件失败：" + err.Error())
	}
	return nil
}

// InstallMac / InstallWindows 在 Linux 上不会被调用，但必须存在。
func InstallMac(zipPath, appBundle, logPath string) error {
	return errors.New("macOS 安装包不能在 Linux 上安装")
}

func InstallWindows(installerPath, logPath string) error {
	return errors.New("Windows 安装器不能在 Linux 上运行")
}
