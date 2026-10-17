//go:build windows

package shell

import (
	"path/filepath"
	"syscall"
	"unsafe"
)

var (
	kernel32            = syscall.NewLazyDLL("kernel32.dll")
	getDiskFreeSpaceExW = kernel32.NewProc("GetDiskFreeSpaceExW")
)

// diskSpace 用 GetDiskFreeSpaceExW 拿剩余/总空间。
//
// 用 syscall（Go 标准库）而不是 golang.org/x/sys：
// 后者会拉着 Go 版本号一起升，而本仓库的 Go 版本必须与 CI 一致（1.25）——
// 依赖为了一个系统调用把整个工具链版本抬上去，不值。
func diskSpace(path string) (free int64, total int64, err error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return 0, 0, err
	}
	ptr, err := syscall.UTF16PtrFromString(abs)
	if err != nil {
		return 0, 0, err
	}

	var freeBytes, totalBytes, totalFreeBytes uint64
	r, _, callErr := getDiskFreeSpaceExW.Call(
		uintptr(unsafe.Pointer(ptr)),
		uintptr(unsafe.Pointer(&freeBytes)),
		uintptr(unsafe.Pointer(&totalBytes)),
		uintptr(unsafe.Pointer(&totalFreeBytes)),
	)
	if r == 0 {
		return 0, 0, callErr
	}
	return int64(freeBytes), int64(totalBytes), nil
}
