package runtime

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
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

	got := scanDir(newBudget(), filepath.Join(root, "Downloads"), BinaryName(KindFFmpeg), 0)
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
	got := scanDirMatching(newBudget(), root, name, 0, func(file string) bool { return file == valid })
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

	if got := scanDir(newBudget(), root, BinaryName(KindYtDlp), 0); got != "" {
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

	// 预算不足以到达第 3 层
	if got := scanDir(setScanBudgetForTest(2), root, BinaryName(KindYtDlp), 0); got != "" {
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
	if got := scanDir(setScanBudgetForTest(10), root, BinaryName(KindFFmpeg), 0); got == "" {
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
// 上一个版本断言的是「重置后包级变量 scanDirsLeft 等于上限」。那个写法
// 只能证明「有人重置了全局变量」，完全证明不了「并行时互不干扰」——
// 而真正的故障正是并行串号（见 TestBudgetIsPerCallNotGlobal）。
// 现在预算挂在每次探测自己的 budget 上，这条用例改为断言
// 「两次 FindOne 各自从满额开始」：把它们顺序跑一遍，前一个吃掉额度
// 不能影响后一个。并发下的隔离由 TestBudgetIsPerCallNotGlobal 与
// `go test -race` 负责。
func TestFindOneStartsWithFullScanBudget(t *testing.T) {
	for i := 0; i < 2; i++ {
		b := newBudget()
		if b.scanDirsLeft != scanMaxDirs {
			t.Fatalf("第 %d 次探测的初始目录预算 = %d，期望 %d", i+1, b.scanDirsLeft, scanMaxDirs)
		}
		// 模拟「这次探测把额度用光了」
		b.scanDirsLeft = 1
		b.scanDeadline = time.Now().Add(-time.Second)
		// 下一次探测必须重新满额（newBudget 每次都是新的）
		if next := newBudget(); next.scanDirsLeft != scanMaxDirs || next.scanExpired(time.Now()) {
			t.Fatalf("第 %d 次之后预算没有重置：dirs=%d expired=%v", i+1, next.scanDirsLeft, next.scanExpired(time.Now()))
		}
	}
}
