// Package shell 提供「用系统方式打开」的能力。
//
// 对应 Electron 的 `shell.openPath` / `shell.showItemInFolder` / `shell.openExternal`。
//
// ## 为什么不用 Go 的第三方库
//
// 三个平台各一条命令就够了，引入库只会增加依赖与审计面：
//
//	macOS   open / open -R
//	Windows explorer / start
//	Linux   xdg-open
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
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// ErrNotFound 表示路径不存在。
var ErrNotFound = errors.New("路径不存在")

// ErrEmpty 表示路径为空。
var ErrEmpty = errors.New("路径为空")

// OpenPath 用系统默认程序打开文件或目录。
//
// 打开目录时用文件管理器；打开文件时用关联的默认应用。
func OpenPath(path string) error {
	if strings.TrimSpace(path) == "" {
		return ErrEmpty
	}
	// 必须存在：不存在时 macOS 的 `open` 会弹一个系统对话框，
	// 用户会以为是应用坏了。统一在这里挡掉，给明确错误。
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("%w：%s", ErrNotFound, path)
	}

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", path)
	case "windows":
		// 用 explorer 而不是 `start`：`start` 是 cmd 内建命令，
		// 需要经过 `cmd /c`，路径含空格与特殊字符时引号处理很容易出错
		cmd = exec.Command("explorer", path)
	default:
		cmd = exec.Command("xdg-open", path)
	}
	hideWindow(cmd)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("打开失败：%w", err)
	}
	return nil
}

// ShowInFolder 在文件管理器里定位到该文件（选中它）。
//
// 与 OpenPath 的区别：用户点「在目录中显示」是想**找到**这个文件，
// 而不是打开它。三个平台的实现差别很大：
//
//	macOS   open -R <file>       （-R 是 reveal，会选中）
//	Windows explorer /select,<file>
//	Linux   xdg-open <dir>       （没有统一的「选中」语义，退回打开所在目录）
func ShowInFolder(path string) error {
	if strings.TrimSpace(path) == "" {
		return ErrEmpty
	}
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("%w：%s", ErrNotFound, path)
	}

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", "-R", path)
	case "windows":
		// `/select,` 后面**不能有空格**，且路径要用引号包住（含空格时必需）
		cmd = exec.Command("explorer", "/select,"+path)
	default:
		// Linux 没有跨桌面环境的「选中文件」协议：
		// Nautilus 有 `nautilus --select`，Dolphin 有 `--select`，Thunar 没有。
		// 与其猜，不如稳定地打开所在目录——文件就在里面，用户能找到。
		cmd = exec.Command("xdg-open", filepath.Dir(path))
	}
	hideWindow(cmd)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("打开目录失败：%w", err)
	}
	return nil
}

// OpenExternal 用系统浏览器打开 URL。
//
// **只接受 http(s)**：历史记录里存着网页 URL，但那些数据可被手工编辑，
// 而 `shell:openExternal` 若能打开任意 scheme（`file:`、自定义协议），
// 就等于给了一个「执行系统命令」的入口。
func OpenExternal(url string) error {
	if strings.TrimSpace(url) == "" {
		return ErrEmpty
	}
	lower := strings.ToLower(url)
	if !strings.HasPrefix(lower, "http://") && !strings.HasPrefix(lower, "https://") {
		return errors.New("只允许打开 http/https 链接")
	}

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		// 用 rundll32 而不是 `start`：同样避开 cmd 的引号问题
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	hideWindow(cmd)
	if err := cmd.Run(); err != nil {
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
