package runtime

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// 写一个可执行的假二进制，输出指定的版本号
func fakeBinary(t *testing.T, dir, name, output string) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, name)
	// Windows 上无法执行 shell 脚本，用 .bat 兜底
	if runtime.GOOS == "windows" {
		path = filepath.Join(dir, name+".bat")
		if err := os.WriteFile(path, []byte("@echo "+output+"\r\n"), 0o755); err != nil {
			t.Fatal(err)
		}
		return path
	}
	script := "#!/bin/sh\necho '" + output + "'\n"
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestBinaryNameSuffix(t *testing.T) {
	got := BinaryName(KindYtDlp)
	want := "yt-dlp"
	if runtime.GOOS == "windows" {
		want = "yt-dlp.exe"
	}
	if got != want {
		t.Errorf("BinaryName = %q, 期望 %q", got, want)
	}
}

// 托管目录必须优先于系统 PATH：用户点击下载后应立刻用上新版本
func TestManagedDirTakesPrecedenceInCandidates(t *testing.T) {
	managed := t.TempDir()
	list := candidatesFor(KindYtDlp, Options{ManagedDir: managed})

	if len(list) == 0 {
		t.Fatal("候选列表不应为空")
	}
	wantPath := filepath.Join(managed, BinaryName(KindYtDlp))
	if filepath.Clean(list[0].Path) != filepath.Clean(wantPath) {
		t.Errorf("首个候选应为托管目录 %q，实际 %q", wantPath, list[0].Path)
	}
	if list[0].Source != SourceManaged {
		t.Errorf("首个候选来源应为 managed，实际 %q", list[0].Source)
	}
}

// 手动指定必须排在所有来源之前
func TestManualPathWins(t *testing.T) {
	managed := t.TempDir()
	manual := filepath.Join(t.TempDir(), BinaryName(KindFFmpeg))
	list := candidatesFor(KindFFmpeg, Options{
		ManagedDir:  managed,
		ManualPaths: map[Kind]string{KindFFmpeg: manual},
	})

	if filepath.Clean(list[0].Path) != filepath.Clean(manual) {
		t.Errorf("首个候选应手动路径 %q，实际 %q", manual, list[0].Path)
	}
	if list[0].Source != SourceManual {
		t.Errorf("首个候选来源应为 manual，实际 %q", list[0].Source)
	}
}

// 候选路径需去重，避免同一文件被探测多次
func TestCandidatesDeduplicated(t *testing.T) {
	managed := t.TempDir()
	list := candidatesFor(KindFFmpeg, Options{ManagedDir: managed})
	seen := map[string]int{}
	for _, c := range list {
		seen[filepath.Clean(c.Path)]++
	}
	for path, count := range seen {
		if count > 1 {
			t.Errorf("路径 %q 重复出现 %d 次", path, count)
		}
	}
}

func TestFindAllCoversEveryKind(t *testing.T) {
	results := FindAll(Options{ManagedDir: t.TempDir()})
	if len(results) != len(Kinds) {
		t.Fatalf("应返回 %d 项结果，实际 %d", len(Kinds), len(results))
	}
	for _, r := range results {
		if r.Kind == "" {
			t.Error("结果缺少 kind 字段")
		}
		// 无论找到与否，界面都要有可展示的信息
		if r.Found && r.Version == "" {
			t.Errorf("%s 已找到但缺少版本号", r.Kind)
		}
		if !r.Found && r.Reason == "" {
			t.Errorf("%s 未找到时必须给出原因", r.Kind)
		}
	}
}

// 托管目录里损坏的二进制不应被采用，更不应让探测整体失败
func TestBrokenManagedBinaryIsSkipped(t *testing.T) {
	managed := t.TempDir()
	broken := filepath.Join(managed, BinaryName(KindYtDlp))
	if err := os.WriteFile(broken, []byte("not a real executable"), 0o755); err != nil {
		t.Fatal(err)
	}

	res := FindOne(KindYtDlp, Options{ManagedDir: managed})
	if res.Found && filepath.Clean(res.Path) == filepath.Clean(broken) {
		t.Error("损坏的托管二进制不应被判定为可用")
	}
	// 系统里装有 yt-dlp 时应回退到系统版本，否则给出原因
	if !res.Found && res.Reason == "" {
		t.Error("回退失败时必须说明原因")
	}
}

// 不可执行的托管文件应被跳过而不是中断探测
func TestNonExecutableManagedBinaryIsSkipped(t *testing.T) {
	managed := t.TempDir()
	noExec := filepath.Join(managed, BinaryName(KindFFmpeg))
	if err := os.WriteFile(noExec, []byte("#!/bin/sh\necho 6.0\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	res := FindOne(KindFFmpeg, Options{ManagedDir: managed})
	if res.Found && filepath.Clean(res.Path) == filepath.Clean(noExec) {
		t.Error("没有执行权限的文件不应被采用")
	}
}

// 探测结果必须带上来源，界面据此区分「系统自带」与「DownVid 下载」
func TestResultCarriesSource(t *testing.T) {
	managed := t.TempDir()
	_ = fakeBinary(t, managed, BinaryName(KindYtDlp), "2026.10.10")

	res := FindOne(KindYtDlp, Options{ManagedDir: managed})
	if !res.Found {
		t.Skipf("当前平台无法执行测试脚本：%s", res.Reason)
	}
	if res.Path == "" || res.Source == "" {
		t.Errorf("找到依赖时必须给出路径与来源，实际 %+v", res)
	}
	if res.Source != string(SourceManaged) {
		t.Errorf("托管的二进制来源应为 managed，实际 %q", res.Source)
	}
	if !res.Managed {
		t.Error("托管目录中的依赖应标记 managed=true")
	}
}

// 可选依赖需被标记，界面据此决定是否阻塞用户
func TestFfprobeIsOptional(t *testing.T) {
	if !Optional[KindFFprobe] {
		t.Error("ffprobe 应标记为可选依赖")
	}
	if Optional[KindYtDlp] || Optional[KindFFmpeg] {
		t.Error("yt-dlp 与 ffmpeg 是必需依赖，不应标记为可选")
	}
}

func TestSystemDirsExcludesAsar(t *testing.T) {
	for _, dir := range systemDirs() {
		if filepath.Base(dir) == "app.asar" || len(dir) > 0 && filepath.Base(filepath.Dir(dir)) == "app.asar" {
			t.Errorf("常见目录不应包含 app.asar：%q", dir)
		}
	}
}
