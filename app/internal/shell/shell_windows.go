//go:build windows

package shell

// Windows 用 Shell API，而不是 `explorer.exe` 命令行。
//
// ## 为什么不用 explorer
//
// 1. 它的退出码不可信：窗口正常打开也常返回 1（issue #95 最初的表现）。
// 2. 它的命令行解析是私有的：`/select,` 后面跟含空格 / 逗号的路径时，
//    引号怎么加都可能被它理解成另一个路径——1.7.2 只忽略了退出码，
//    结果是「不报错了，但文件夹也没打开」。
// 3. `SysProcAttr.HideWindow` 对 GUI 程序的效果不可控，还可能让应用失去焦点。
//
// `SHOpenFolderAndSelectItems` 直接把 PIDL 交给资源管理器，不经过命令行，
// 这是 Explorer「在文件夹中显示」的原生实现。
//
// 依赖 `golang.org/x/sys/windows`：它本来就是 Wails 的间接依赖，
// 不需要新增任何模块。

import (
	"fmt"
	"path/filepath"
	"runtime"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	shell32                        = windows.NewLazySystemDLL("shell32.dll")
	procSHParseDisplayName         = shell32.NewProc("SHParseDisplayName")
	procSHOpenFolderAndSelectItems = shell32.NewProc("SHOpenFolderAndSelectItems")
)

// shellExecute 用系统默认动作打开一个文件、目录或 URL。
//
// ShellExecute 不经过 cmd，不需要处理引号，也不会因退出码误判。
func shellExecute(target string) error {
	ptr, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return err
	}
	// SW_SHOWNORMAL 让目标以正常窗口显示；verb 传 nil 表示默认动作（open）。
	return windows.ShellExecute(0, nil, ptr, nil, nil, windows.SW_SHOWNORMAL)
}

// openPathOS 用 ShellExecute 打开文件或目录。
func openPathOS(path string) error {
	// 统一成 Windows 路径分隔符：设置文件 / 历史里可能存着 `/`，
	// 文件管理器对混合分隔符的处理并不一致。
	return shellExecute(filepath.Clean(path))
}

// openExternalOS 打开 http(s) 链接。
//
// **不能**经过 filepath.Clean：那会把 `https://` 改成 `https:\`。
func openExternalOS(url string) error {
	return shellExecute(url)
}

// showInFolderOS 在资源管理器中打开所在目录并选中该项。
func showInFolderOS(path string) error {
	file, err := windows.UTF16PtrFromString(filepath.Clean(path))
	if err != nil {
		return err
	}

	// Shell API 与 COM 内存必须在同一个 OS 线程上处理。
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	// 出错时也要恢复线程的 COM 状态。
	// S_FALSE 表示这个线程已经初始化过（仍要配对 CoUninitialize）；
	// RPC_E_CHANGED_MODE 表示已被别的代码初始化成另一种 apartment，
	// 直接沿用即可，不能重复初始化。
	err = windows.CoInitializeEx(0, windows.COINIT_APARTMENTTHREADED|windows.COINIT_DISABLE_OLE1DDE)
	switch err {
	case nil, syscall.Errno(windows.S_FALSE):
		defer windows.CoUninitialize()
	case syscall.Errno(windows.RPC_E_CHANGED_MODE):
		// 复用已有 apartment
	default:
		return fmt.Errorf("初始化 Shell 失败：%w", err)
	}

	var pidl unsafe.Pointer
	hr, _, _ := procSHParseDisplayName.Call(
		uintptr(unsafe.Pointer(file)),
		0,
		uintptr(unsafe.Pointer(&pidl)),
		0,
		0,
	)
	if int32(hr) < 0 {
		return fmt.Errorf("无法定位文件（HRESULT 0x%08x）", uint32(hr))
	}
	defer windows.CoTaskMemFree(pidl)

	// cidl=0、apidl=nil 表示「在父文件夹中选中这个绝对 PIDL」，
	// 对文件和目录都适用。
	hr, _, _ = procSHOpenFolderAndSelectItems.Call(uintptr(pidl), 0, 0, 0)
	if int32(hr) < 0 {
		return fmt.Errorf("无法在资源管理器中选中文件（HRESULT 0x%08x）", uint32(hr))
	}
	return nil
}
