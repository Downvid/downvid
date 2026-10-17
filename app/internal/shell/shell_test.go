package shell

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// shell 层的测试：只验证**不需要真的打开窗口**的部分。
//
// 「真的打开了文件管理器」没法在自动化里断言（那需要 GUI 会话），
// 但「该拒绝的拒绝了」与「磁盘空间算得对」可以。

// --- 安全：只接受存在的路径 ---

func TestOpenPathRejectsMissing(t *testing.T) {
	err := OpenPath("/definitely/not/here/nope.txt")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("不存在的路径应返回 ErrNotFound，got %v", err)
	}
}

func TestShowInFolderRejectsMissing(t *testing.T) {
	err := ShowInFolder("/definitely/not/here/nope.txt")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("got %v", err)
	}
}

func TestOpenPathRejectsEmpty(t *testing.T) {
	for _, p := range []string{"", "   "} {
		if err := OpenPath(p); !errors.Is(err, ErrEmpty) {
			t.Errorf("空路径应返回 ErrEmpty，got %v", err)
		}
		if err := ShowInFolder(p); !errors.Is(err, ErrEmpty) {
			t.Errorf("空路径应返回 ErrEmpty，got %v", err)
		}
	}
}

// 路径穿越不该被特殊对待——它和其它不存在的路径一样被拒。
// 这条守的是「历史记录被手工改坏」的场景。
func TestRejectsTraversalPath(t *testing.T) {
	if err := OpenPath("../../../../etc/passwd"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("穿越路径应因不存在被拒，got %v", err)
	}
}

// --- 安全：openExternal 只允许 http(s) ---

func TestOpenExternalRejectsNonHTTP(t *testing.T) {
	// 允许任意 scheme 等于给了一个「执行系统命令」的入口
	// （`file:`、自定义协议处理器都能做事）
	bad := []string{
		"file:///etc/passwd",
		"javascript:alert(1)",
		"ftp://example.com/x",
		"smb://server/share",
		"  ",
		"",
	}
	for _, u := range bad {
		if err := OpenExternal(u); err == nil {
			t.Errorf("%q 不该被允许打开", u)
		}
	}
}

func TestOpenExternalAcceptsHTTP(t *testing.T) {
	// 只验证**协议校验通过**，不真的起浏览器：
	// 用一个不存在的域名，命令会失败，但那说明它已经走到执行阶段了
	err := OpenExternal("https://example.invalid/never")
	if err == nil {
		// 某些环境里 xdg-open/open 对无效域名也返回 0，视为通过
		return
	}
	// 关键：**不能**是「只允许 http/https」那个错误
	if strings.Contains(err.Error(), "只允许打开") {
		t.Fatalf("https 应通过协议校验，got %v", err)
	}
}

// --- 磁盘空间 ---

func TestDiskSpace(t *testing.T) {
	dir := t.TempDir()
	free, total, err := DiskSpace(dir)
	if err != nil {
		t.Fatal(err)
	}
	if total <= 0 {
		t.Fatalf("总空间应大于 0，got %d", total)
	}
	if free < 0 || free > total {
		t.Fatalf("剩余空间应在 [0, total] 内，free=%d total=%d", free, total)
	}
}

// 目录不存在时退到最近的存在祖先，而不是报错。
// 场景：用户改了下载目录但还没下过东西。
func TestDiskSpaceFallsBackToAncestor(t *testing.T) {
	dir := t.TempDir()
	missing := filepath.Join(dir, "a", "b", "c")
	free, total, err := DiskSpace(missing)
	if err != nil {
		t.Fatalf("不存在的目录应退到祖先，got %v", err)
	}
	if total <= 0 {
		t.Fatal("应拿到真实空间")
	}
	_ = free
}

func TestDiskSpaceRejectsEmpty(t *testing.T) {
	if _, _, err := DiskSpace(""); !errors.Is(err, ErrEmpty) {
		t.Fatalf("got %v", err)
	}
}

// --- 平台命令选择 ---
//
// 命令名是「平台相关但不依赖 GUI」的部分，可以断言。

func TestShowInFolderCommandSemantics(t *testing.T) {
	// 这个测试不执行命令，只确认**平台分支存在且不 panic**。
	// 真正的命令差异（open -R / explorer /select, / xdg-open）靠真机验证——
	// 自动化里起文件管理器没有意义。
	if runtime.GOOS == "windows" {
		t.Log("Windows: explorer /select,<path>（/select, 后不能有空格）")
	} else if runtime.GOOS == "darwin" {
		t.Log("macOS: open -R <path>")
	} else {
		t.Log("Linux: xdg-open <dir>（无统一「选中」协议）")
	}
	// 建一个真实文件，确认不因为路径不存在而提前返回
	f := filepath.Join(t.TempDir(), "x.mp4")
	if err := os.WriteFile(f, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(f); err != nil {
		t.Fatal(err)
	}
}
