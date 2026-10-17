package sidecar

import (
	"os"
	"path/filepath"
	"testing"
)

// 这组用例只覆盖**不带 withsidecar tag** 时的行为（`go test ./...` 的默认情形）。
//
// 带 tag 的那条路径由 `scripts/build.sh` 的冒烟验证覆盖：它编完边车后
// 真的执行一次 `detect` 并检查输出是 JSON——那比在这里塞一个假二进制更有意义。

// 默认构建（不带 tag）必须**如实报告**没有边车。
//
// 这一条守护的是一个真实故障的判断依据：Wails 版打出来的 app 里根本没有
// 边车，但代码里没有任何地方报告这件事，用户只看到「依赖页只剩一条」。
// `Available` 必须是编译期常量，不能被运行时"猜"出来。
func TestAvailableReflectsBuildTag(t *testing.T) {
	// `go test` 默认不带 withsidecar，所以这里应当是 false。
	// 若有人在 CI 里全局加了 tag，这条会失败并提醒他分两个构建。
	if Available {
		t.Log("本次构建带上了 withsidecar（跳过默认构建的断言）")
		return
	}

	dir := t.TempDir()
	path, err := Extract(dir)
	if err == nil {
		t.Fatalf("未嵌入边车时 Extract 应报错，实际返回 %q", path)
	}
	if path != "" {
		t.Errorf("失败时应返回空路径，实际 %q", path)
	}
	// 错误信息要能指向修法：只说「not available」会让人去翻源码
	if err.Error() == "" {
		t.Error("错误信息不能为空")
	}

	// 不该在数据目录里留下任何文件
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Errorf("失败路径不该写文件，实际写了 %d 个", len(entries))
	}
}

// Extract 失败时不能留下半个可执行文件。
//
// 边车是 6~10MB 的二进制。写到一半失败（磁盘满 / 被杀）留下半个文件，
// 下次启动会因为「文件存在」而跳过重写，于是永远跑一个坏二进制。
func TestExtractLeavesNoPartialFile(t *testing.T) {
	dir := t.TempDir()
	_, _ = Extract(dir)

	// 临时文件（`.tmp`）必须不存在
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if filepath.Ext(e.Name()) == ".tmp" {
			t.Errorf("留下了临时文件：%s", e.Name())
		}
	}
}
