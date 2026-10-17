package runtime

import (
	"os"
	"path/filepath"
	"testing"
)

// 不显式设置时限时也必须能工作。
//
// 回归背景：`scanExpired` 曾把 time.Time 的零值判成「已过期」
// （`now.After(zero)` 恒为 true），于是扫描静默什么都不做，
// Windows 上（更慢、更容易触到）直接失败。
func TestScanWorksWithoutExplicitDeadline(t *testing.T) {
	b := &budget{scanDirsLeft: scanMaxDirs} // scanDeadline 是零值
	root := t.TempDir()
	sub := filepath.Join(root, "bin")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sub, BinaryName(KindFFmpeg)), []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := scanDir(b, root, BinaryName(KindFFmpeg), 0); got == "" {
		t.Error("未设置时限时应能正常扫描（CI 上就是这样失败的）")
	}
}
