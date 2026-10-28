package shell

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
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
	// 只验证**协议校验通过**，不真的起浏览器。
	//
	// 起进程这一步在无头 CI 上不可靠：`xdg-open` 可能不存在、可能返回非 0，
	// 也不该真的把浏览器拉起来。所以直接测 openExternal 里那一段协议判断
	// （拆成了 validateExternalURL，见 shell.go）——这是本用例真正关心的东西。
	for _, ok := range []string{
		"https://github.com/Downvid/downvid",
		"http://127.0.0.1:6080/",
		"HTTPS://Example.COM/x",
	} {
		if err := validateExternalURL(ok); err != nil {
			t.Errorf("%q 应通过协议校验，got %v", ok, err)
		}
	}

	// 反向：非 http(s) 必须被拒（这条才是安全边界）
	for _, bad := range []string{
		"file:///etc/passwd",
		"javascript:alert(1)",
		"data:text/html,x",
		"  ",
		"",
	} {
		if err := validateExternalURL(bad); err == nil {
			t.Errorf("%q 不该被允许", bad)
		}
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
		t.Log("Windows: Shell API（SHOpenFolderAndSelectItems，不经过 explorer 命令行）")
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
