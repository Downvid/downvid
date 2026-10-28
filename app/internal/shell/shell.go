// Package shell 提供「用系统方式打开」的能力。
//
// 对应 Electron 的 `shell.openPath` / `shell.showItemInFolder` / `shell.openExternal`。
//
// ## 各平台的实现
//
//	macOS   open / open -R
//	Windows Shell API（ShellExecute / SHOpenFolderAndSelectItems）
//	Linux   xdg-open
//
// 不引入第三方库：Windows 用的 `golang.org/x/sys/windows` 本来就是 Wails
// 的依赖；`explorer.exe` 的退出码与命令行解析都不可靠（issue #95）。
//
// ## 安全：只打开已存在的路径
//
// `showInFolder` 与 `openPath` 的入参来自**历史记录**，而历史记录文件是
// 用户可编辑的 JSON。一个被改坏的路径（`../../etc`）不该让应用去执行什么。
// 所以统一先 `Stat`，不存在就直接返回错误，不交给系统命令。
package shell

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ErrNotFound 表示路径不存在。
var ErrNotFound = errors.New("路径不存在")

// ErrEmpty 表示路径为空。
var ErrEmpty = errors.New("路径为空")

// OpenPath 用系统默认程序打开文件或目录。
//
// 打开目录时用文件管理器；打开文件时用关联的默认应用。
// 平台实现见 shell_windows.go / shell_other.go。
func OpenPath(path string) error {
	if strings.TrimSpace(path) == "" {
		return ErrEmpty
	}
	// 必须存在：不存在时 macOS 的 `open` 会弹一个系统对话框，
	// 用户会以为是应用坏了。统一在这里挡掉，给明确错误。
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("%w：%s", ErrNotFound, path)
	}
	if err := openPathOS(path); err != nil {
		return fmt.Errorf("打开失败：%w", err)
	}
	return nil
}

// ShowInFolder 在文件管理器里定位到该文件（选中它）。
//
// 与 OpenPath 的区别：用户点「在目录中显示」是想**找到**这个文件，
// 而不是打开它。平台实现见 shell_windows.go / shell_other.go。
func ShowInFolder(path string) error {
	if strings.TrimSpace(path) == "" {
		return ErrEmpty
	}
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("%w：%s", ErrNotFound, path)
	}
	if err := showInFolderOS(path); err != nil {
		return fmt.Errorf("打开目录失败：%w", err)
	}
	return nil
}

// validateExternalURL 是 OpenExternal 的协议校验（纯函数，可单测）。
func validateExternalURL(raw string) error {
	if strings.TrimSpace(raw) == "" {
		return ErrEmpty
	}
	// 大小写不敏感：`HTTPS://` 也该通过
	lower := strings.ToLower(raw)
	if !strings.HasPrefix(lower, "http://") && !strings.HasPrefix(lower, "https://") {
		return errors.New("只允许打开 http/https 链接")
	}
	return nil
}

// OpenExternal 用系统浏览器打开 URL。
//
// **只接受 http(s)**：历史记录里存着网页 URL，但那些数据可被手工编辑，
// 而 `shell:openExternal` 若能打开任意 scheme（`file:`、自定义协议），
// 就等于给了一个「执行系统命令」的入口。
//
// 协议校验拆在 validateExternalURL 里，以便直接测试——`OpenExternal`
// 会真的起系统命令，在无头 CI 上不可靠（`xdg-open` 可能不存在，
// 也不该真的把浏览器拉起来）。
func OpenExternal(url string) error {
	if err := validateExternalURL(url); err != nil {
		return err
	}
	if err := openExternalOS(url); err != nil {
		return fmt.Errorf("打开链接失败：%w", err)
	}
	return nil
}

// DiskSpace 返回指定目录所在磁盘的剩余空间（字节）。
//
// 界面用它提示「空间不足」——下载 4K 视频前给个提示，比下到一半失败好。
func DiskSpace(dir string) (free int64, total int64, err error) {
	if strings.TrimSpace(dir) == "" {
		return 0, 0, ErrEmpty
	}
	// 目录可能还没创建（用户改了下载目录但还没下过东西）：
	// 退到最近的存在祖先，而不是报错
	probe := dir
	for {
		if _, statErr := os.Stat(probe); statErr == nil {
			break
		}
		parent := filepath.Dir(probe)
		if parent == probe {
			return 0, 0, fmt.Errorf("%w：%s", ErrNotFound, dir)
		}
		probe = parent
	}
	return diskSpace(probe)
}
