package runtime

import (
	"os"
	"path/filepath"
	"testing"
)

// 保底扫描：已知目录都没命中时，能在常见的"用户自己放东西"的位置找到。
//
// 用临时目录构造真实层级来验证，而不是断言候选列表字符串。
func TestScanFindsBinaryInNestedDir(t *testing.T) {
	root := t.TempDir()
	// 仿造 `~/Downloads/ffmpeg-8.1/bin/ffmpeg`
	bin := filepath.Join(root, "Downloads", "ffmpeg-8.1", "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(bin, BinaryName(KindFFmpeg))
	if err := os.WriteFile(target, []byte("#!/bin/sh\necho 'ffmpeg version 8.1'\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	scanBudget = 20000
	got := scanDir(filepath.Join(root, "Downloads"), BinaryName(KindFFmpeg), 0)
	if got == "" {
		t.Fatal("未在嵌套目录中找到 ffmpeg（保底扫描失效）")
	}
	if filepath.Base(got) != BinaryName(KindFFmpeg) {
		t.Errorf("找到的文件名不对：%s", got)
	}
}

// 深度限制必须生效：过深的目录不该被遍历
func TestScanRespectsMaxDepth(t *testing.T) {
	root := t.TempDir()
	deep := root
	for i := 0; i < scanMaxDepth+3; i++ {
		deep = filepath.Join(deep, "d")
	}
	if err := os.MkdirAll(deep, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(deep, BinaryName(KindYtDlp)), []byte("#!/bin/sh\necho 2026.01.01\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	scanBudget = 20000
	if got := scanDir(root, BinaryName(KindYtDlp), 0); got != "" {
		t.Errorf("超过深度上限仍被找到：%s（深度限制失效，Windows 上会变慢）", got)
	}
}

// 预算用尽时必须停下，不能无限遍历
func TestScanRespectsBudget(t *testing.T) {
	root := t.TempDir()
	// 造很多目录
	for i := 0; i < 50; i++ {
		if err := os.MkdirAll(filepath.Join(root, "d", "sub", "x"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	scanBudget = 5 // 极小预算
	got := scanDir(root, BinaryName(KindYtDlp), 0)
	if got != "" {
		t.Error("预算耗尽后不应继续遍历")
	}
	if scanBudget > 0 {
		t.Logf("预算剩余 %d", scanBudget)
	}
}

// 无关目录要被跳过（否则会白扫 node_modules 这类超大目录）
func TestShouldSkipDir(t *testing.T) {
	skip := []string{"node_modules", ".git", "Cache", "Windows", "System32", "AppData", "tmp"}
	for _, d := range skip {
		if !shouldSkipDir(d) {
			t.Errorf("%q 应被跳过", d)
		}
	}
	keep := []string{"Downloads", "ffmpeg-8.1", "bin", "yt-dlp"}
	for _, d := range keep {
		if shouldSkipDir(d) {
			t.Errorf("%q 不应被跳过", d)
		}
	}
}

// 每个依赖独立计算预算，避免前一个把预算耗尽导致后一个扫不到
func TestFindOneResetsScanBudget(t *testing.T) {
	scanBudget = 1
	_ = FindOne(KindFFprobe, Options{ManagedDir: t.TempDir()})
	if scanBudget <= 1 {
		t.Errorf("FindOne 未重置扫描预算，实际剩余 %d", scanBudget)
	}
}
