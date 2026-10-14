package runtime

import (
	"fmt"
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

	resetScanBudget()
	got := scanDir(filepath.Join(root, "Downloads"), BinaryName(KindFFmpeg), 0)
	if got == "" {
		t.Fatal("未在嵌套目录中找到 ffmpeg（保底扫描失效）")
	}
	if filepath.Base(got) != BinaryName(KindFFmpeg) {
		t.Errorf("找到的文件名不对：%s", got)
	}
}

func TestScanContinuesAfterRejectedCopy(t *testing.T) {
	root := t.TempDir()
	name := BinaryName(KindFFprobe)
	var valid string
	for _, sub := range []string{"a-broken", "b-valid"} {
		dir := filepath.Join(root, sub)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		file := filepath.Join(dir, name)
		if err := os.WriteFile(file, []byte("fixture"), 0o755); err != nil {
			t.Fatal(err)
		}
		valid = file
	}
	resetScanBudget()
	got := scanDirMatching(root, name, 0, func(file string) bool { return file == valid })
	if got != valid {
		t.Fatalf("拒绝第一个副本后未继续扫描：%q，期望 %q", got, valid)
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

	resetScanBudget()
	if got := scanDir(root, BinaryName(KindYtDlp), 0); got != "" {
		t.Errorf("超过深度上限仍被找到：%s（深度限制失效，Windows 上会变慢）", got)
	}
}

// 预算用尽时必须停下，不能无限遍历
func TestScanRespectsBudget(t *testing.T) {
	root := t.TempDir()
	// 造一条比预算更深的目录链
	deep := root
	for i := 0; i < 20; i++ {
		deep = filepath.Join(deep, "d")
	}
	if err := os.MkdirAll(deep, 0o755); err != nil {
		t.Fatal(err)
	}
	// 把目标放在第 10 层（超出 3 个目录的预算，但没超出深度上限）
	targetDir := root
	for i := 0; i < 3; i++ {
		targetDir = filepath.Join(targetDir, "d")
	}
	if err := os.WriteFile(filepath.Join(targetDir, BinaryName(KindYtDlp)), []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}

	setScanBudgetForTest(2) // 预算不足以到达第 3 层
	if got := scanDir(root, BinaryName(KindYtDlp), 0); got != "" {
		t.Errorf("预算耗尽后仍找到了文件：%s", got)
	}
}

// 关键：预算按**目录数**计，而不是条目数。
//
// 回归背景：早先按条目计（20000 条），Windows 上扫 C:\Program Files 时
// 一个大目录就吃光预算，保底扫描形同虚设。CI 的 windows job 暴露了它。
func TestBudgetCountsDirsNotEntries(t *testing.T) {
	root := t.TempDir()
	// 一个目录里塞很多文件（模拟 Program Files 这类大目录）
	for i := 0; i < 5000; i++ {
		if err := os.WriteFile(filepath.Join(root, fmt.Sprintf("f%d.txt", i)), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// 目标在下一层
	sub := filepath.Join(root, "bin")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sub, BinaryName(KindFFmpeg)), []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}

	// 只够进 10 个目录，但大目录里的 5000 个文件不该消耗它
	setScanBudgetForTest(10)
	if got := scanDir(root, BinaryName(KindFFmpeg), 0); got == "" {
		t.Error("大目录里的文件数不应消耗预算（否则 Windows 上扫不到）")
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

// 每个依赖独立计算预算，避免前一个把预算耗尽导致后一个扫不到。
//
// 断言"重置后的值等于上限"而不是"剩余 > 1"：后者会依赖扫描是否真的发生
// （macOS 上候选目录命中会提前 return，Windows 上不会），于是同一份代码
// 在两个平台上表现不同——这正是第一版用例的问题。
func TestFindOneResetsScanBudget(t *testing.T) {
	scanDirsLeft = 1
	_ = FindOne(KindFFprobe, Options{ManagedDir: t.TempDir()})
	if scanDirsLeft == 1 {
		t.Errorf("FindOne 未重置扫描预算，实际剩余 %d", scanDirsLeft)
	}
}
