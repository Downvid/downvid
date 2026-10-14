package runtime

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// 直接调用 scanDir（不经过 findOne）时也必须能工作
func TestScanWorksWithoutExplicitDeadline(t *testing.T) {
	scanDeadline = time.Time{}
	resetScanBudget()
	root := t.TempDir()
	sub := filepath.Join(root, "bin")
	os.MkdirAll(sub, 0o755)
	os.WriteFile(filepath.Join(sub, BinaryName(KindFFmpeg)), []byte("x"), 0o755)
	if got := scanDir(root, BinaryName(KindFFmpeg), 0); got == "" {
		t.Error("未设置时限时应能正常扫描（CI 上就是这样失败的）")
	}
}
