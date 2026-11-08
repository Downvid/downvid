package appdir

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// setHome 把 ~ 指到临时目录；Windows 的 os.UserHomeDir 读 USERPROFILE。
func setHome(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	t.Setenv("USERPROFILE", dir)
	return dir
}

func TestHistoryPathMigratesOldFile(t *testing.T) {
	home := setHome(t)
	userData := filepath.Join(home, "userdata")
	if err := os.MkdirAll(userData, 0o755); err != nil {
		t.Fatal(err)
	}
	old := filepath.Join(userData, "download-history.json")
	if err := os.WriteFile(old, []byte("[]"), 0o644); err != nil {
		t.Fatal(err)
	}

	got := HistoryPath(userData)
	want := filepath.Join(home, ".downvid", "download-history.json")
	if got != want {
		t.Fatalf("HistoryPath = %q, want %q", got, want)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatalf("旧文件应已搬走，stat err = %v", err)
	}
	if b, err := os.ReadFile(got); err != nil || string(b) != "[]" {
		t.Fatalf("新文件内容不对：%q %v", b, err)
	}
}

func TestManagedBinDirMigratesOldTools(t *testing.T) {
	home := setHome(t)
	userData := filepath.Join(home, "userdata")
	oldDir := filepath.Join(userData, "runtime", "bin")
	if err := os.MkdirAll(oldDir, 0o755); err != nil {
		t.Fatal(err)
	}
	old := filepath.Join(oldDir, "yt-dlp")
	if err := os.WriteFile(old, []byte("bin"), 0o755); err != nil {
		t.Fatal(err)
	}

	got := ManagedBinDir(userData)
	want := filepath.Join(home, ".downvid", "runtime", "bin")
	if got != want {
		t.Fatalf("ManagedBinDir = %q, want %q", got, want)
	}
	if _, err := os.Stat(filepath.Join(got, "yt-dlp")); err != nil {
		t.Fatalf("依赖没有搬到托管目录：%v", err)
	}
}

func TestFindToolManualThenManaged(t *testing.T) {
	home := setHome(t)
	manual := filepath.Join(t.TempDir(), "my-yt-dlp")
	if err := os.WriteFile(manual, []byte("bin"), 0o755); err != nil {
		t.Fatal(err)
	}

	got, ok := FindTool("yt-dlp", map[string]string{"yt-dlp": manual})
	if !ok || got != manual {
		t.Fatalf("manual: %q %v", got, ok)
	}

	name := "yt-dlp"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	managed := filepath.Join(home, ".downvid", "runtime", "bin", name)
	if err := os.MkdirAll(filepath.Dir(managed), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(managed, []byte("bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	got, ok = FindTool("yt-dlp", nil)
	if !ok || got != managed {
		t.Fatalf("managed: %q %v", got, ok)
	}
}
