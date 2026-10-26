package main

import (
	"os"
	"path/filepath"
	"testing"
)

// 迁移用例都靠改 HOME 把 ~ 指到临时目录：resolveHistoryPath / downvidHome
// 都从 os.UserHomeDir() 取根，不改 HOME 就会写到真实的 ~/.downvid。
// Windows 上 os.UserHomeDir 读 USERPROFILE，所以两个都设。
func setFakeHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	return home
}

func writeFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读 %s 失败：%v", path, err)
	}
	return string(data)
}

// 目标目录**已存在**（哪怕是个空目录）时也必须逐项搬过去。
//
// 变异点：早先的实现只在目标目录不存在时才搬，于是「手动建过空目录」或
// 「上次搬家失败留下半个目录」的用户，旧目录里的 yt-dlp 会永远躺着，而探测
// 只看新目录 → 依赖像是消失了，用户白重下 80MB。
func TestMigrateTreeMovesIntoExistingTarget(t *testing.T) {
	home := setFakeHome(t)
	dataDir := filepath.Join(home, "userdata")
	oldDir := filepath.Join(dataDir, "runtime", "bin")
	newDir := filepath.Join(home, ".downvid", "runtime", "bin")

	writeFile(t, filepath.Join(oldDir, "yt-dlp"), "old-ytdlp")
	writeFile(t, filepath.Join(oldDir, "downvid-deps"), "old-sidecar")
	if err := os.MkdirAll(newDir, 0o755); err != nil { // 目标目录已存在
		t.Fatal(err)
	}

	got := resolveManagedDir(dataDir)
	if got != newDir {
		t.Fatalf("托管目录应为 %q，got %q", newDir, got)
	}
	if body := readFile(t, filepath.Join(newDir, "yt-dlp")); body != "old-ytdlp" {
		t.Errorf("yt-dlp 应已搬到新目录，内容 %q", body)
	}
	if body := readFile(t, filepath.Join(newDir, "downvid-deps")); body != "old-sidecar" {
		t.Errorf("downvid-deps 应已搬到新目录，内容 %q", body)
	}
	if _, err := os.Stat(oldDir); !os.IsNotExist(err) {
		t.Errorf("搬空的旧目录应被删掉，err = %v", err)
	}
}

// 目标已有同名文件时**不覆盖**：新目录里可能是更新过的版本，覆盖等于降级。
func TestMigrateTreeKeepsNewerTargetFile(t *testing.T) {
	home := setFakeHome(t)
	dataDir := filepath.Join(home, "userdata")
	oldDir := filepath.Join(dataDir, "runtime", "bin")
	newDir := filepath.Join(home, ".downvid", "runtime", "bin")

	writeFile(t, filepath.Join(oldDir, "yt-dlp"), "old-ytdlp")
	writeFile(t, filepath.Join(newDir, "yt-dlp"), "new-ytdlp")

	resolveManagedDir(dataDir)

	if body := readFile(t, filepath.Join(newDir, "yt-dlp")); body != "new-ytdlp" {
		t.Errorf("新目录里的版本不该被旧文件覆盖，got %q", body)
	}
	if body := readFile(t, filepath.Join(oldDir, "yt-dlp")); body != "old-ytdlp" {
		t.Errorf("被跳过的旧文件应留在原地，got %q", body)
	}
}

// 下载历史必须跟着搬：留在 userData 里 = 用户升级后历史「凭空消失」。
func TestResolveHistoryPathMigratesOldFile(t *testing.T) {
	home := setFakeHome(t)
	dataDir := filepath.Join(home, "userdata")
	oldPath := filepath.Join(dataDir, "download-history.json")
	writeFile(t, oldPath, `[{"title":"旧的记录"}]`)

	got := resolveHistoryPath(dataDir)
	want := filepath.Join(home, ".downvid", "download-history.json")
	if got != want {
		t.Fatalf("历史文件位置应为 %q，got %q", want, got)
	}
	if body := readFile(t, got); body != `[{"title":"旧的记录"}]` {
		t.Errorf("历史内容应原样搬过来，got %q", body)
	}
	if _, err := os.Stat(oldPath); !os.IsNotExist(err) {
		t.Errorf("旧文件应已被移走，err = %v", err)
	}
}

// 新位置已有历史时以它为准：不能被旧文件覆盖掉升级后新增的记录。
func TestResolveHistoryPathKeepsExistingFile(t *testing.T) {
	home := setFakeHome(t)
	dataDir := filepath.Join(home, "userdata")
	oldPath := filepath.Join(dataDir, "download-history.json")
	newPath := filepath.Join(home, ".downvid", "download-history.json")
	writeFile(t, oldPath, "old")
	writeFile(t, newPath, "new")

	if got := resolveHistoryPath(dataDir); got != newPath {
		t.Fatalf("got %q", got)
	}
	if body := readFile(t, newPath); body != "new" {
		t.Errorf("新位置的历史不该被覆盖，got %q", body)
	}
	if body := readFile(t, oldPath); body != "old" {
		t.Errorf("被跳过的旧文件应留在原地，got %q", body)
	}
}

// 全新安装（没有旧文件、没有旧目录）不该报错、也不该创建空目录。
func TestResolvePathsOnFreshInstall(t *testing.T) {
	home := setFakeHome(t)
	dataDir := filepath.Join(home, "userdata")

	if got := resolveHistoryPath(dataDir); got != filepath.Join(home, ".downvid", "download-history.json") {
		t.Errorf("got %q", got)
	}
	if got := resolveManagedDir(dataDir); got != filepath.Join(home, ".downvid", "runtime", "bin") {
		t.Errorf("got %q", got)
	}
	if _, err := os.Stat(filepath.Join(home, ".downvid")); !os.IsNotExist(err) {
		t.Errorf("全新安装不该创建 ~/.downvid，err = %v", err)
	}
}
