package download

import (
	"os/exec"
	"syscall"
	"testing"
	"time"
)

// tests/aria2-progress.test.ts 的 3 条断言逐条移植。

func TestParseAria2Progress(t *testing.T) {
	got, ok := ParseAria2Progress("[#abc123 1000/4000(25%) CN:8 DL:2000 ETA:1s]")
	if !ok {
		t.Fatal("应解析成功")
	}
	if got.Downloaded != 1000 || got.Total != 4000 || got.Speed != 2000 {
		t.Fatalf("got %+v", got)
	}
}

func TestParseAria2ProgressWithByteSuffixAndCR(t *testing.T) {
	// aria2 用回车刷新同一行，不依赖换行；数字后的 B 后缀可选
	got, ok := ParseAria2Progress("\r[#abc123 1000B/4000B(25%) CN:8 DL:2000B ETA:1s]")
	if !ok {
		t.Fatal("应解析成功")
	}
	if got.Downloaded != 1000 || got.Total != 4000 || got.Speed != 2000 {
		t.Fatalf("got %+v", got)
	}
}

func TestParseAria2ProgressRejectsGarbage(t *testing.T) {
	// 四类都必须被拒：
	//   普通日志 / 被截断的半行 / 已下载>总大小 / 超出安全整数
	cases := []string{
		"download completed",
		"[#abc123 1000/4000(25%) CN:8 DL:2000",
		"[#abc123 5000/4000(125%) CN:8 DL:2000]",
		"[#abc123 0/90071992547409999(0%) CN:1 DL:1]",
	}
	for _, line := range cases {
		if _, ok := ParseAria2Progress(line); ok {
			t.Errorf("%q 不该被当成进度", line)
		}
	}
}

// 超出安全整数要拒绝，而不是溢出成负数或静默失真。
//
// 这条不能用交叉验证代替：TS 的 Number 到 2^53 就静默失真，
// 而 Go 的 int64 能装到 2^63——两边「都能解析」但结果不同。
func TestParseAria2ProgressRejectsBeyondSafeInt(t *testing.T) {
	// 2^53 = 9007199254740992，这里是它 +1
	if _, ok := ParseAria2Progress("[#a 9007199254740993/9007199254740994(1%) CN:1 DL:1]"); ok {
		t.Fatal("超出 2^53-1 的值必须拒绝（JS 侧会静默失真，两边行为要对齐）")
	}
	// 恰好 2^53-1 是允许的
	if _, ok := ParseAria2Progress("[#a 1/9007199254740991(1%) CN:1 DL:1]"); !ok {
		t.Fatal("2^53-1 以内的值应允许")
	}
}

// ===== process-tree =====

// 已退出的进程不该被再发信号。
func TestKillSkipsExitedProcess(t *testing.T) {
	called := false
	err := KillProcessTree(KillTarget{
		PID:    12345,
		Exited: func() bool { return true },
		Kill:   func(sig syscall.Signal) error { called = true; return nil },
	}, KillOptions{Platform: "linux"})
	if err != nil {
		t.Fatal(err)
	}
	if called {
		t.Fatal("已退出的进程不该再被 kill")
	}
}

// PID 为 0 时直接返回（对应 TS 的 `if (!pid) return`）。
func TestKillSkipsZeroPID(t *testing.T) {
	if err := KillProcessTree(KillTarget{PID: 0}, KillOptions{}); err != nil {
		t.Fatal(err)
	}
}

// Windows 走 taskkill；路径不存在时退回直接 Kill，而不是静默什么都不做。
func TestKillWindowsFallsBackWhenTaskkillMissing(t *testing.T) {
	called := false
	err := KillProcessTree(KillTarget{
		PID:    9999,
		Exited: func() bool { return false },
		Kill:   func(sig syscall.Signal) error { called = true; return nil },
	}, KillOptions{
		Platform:     "windows",
		TaskkillPath: "/definitely/not/here/taskkill.exe",
		Grace:        100 * time.Millisecond,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !called {
		t.Fatal("taskkill 失败时应退回直接 Kill（否则进程永远留着一个孤儿）")
	}
}

// treeSpawnOptions 的等价物：POSIX 要设进程组，Windows 不能设。
func TestSetProcessGroupByPlatform(t *testing.T) {
	// 只在编译期验证签名可用——真正的平台分支由 hideWindow 的 build tag 覆盖，
	// 这里确认调用不会 panic。
	var cmd = newTestCmd(t)
	SetProcessGroup(cmd, "windows")
	SetProcessGroup(cmd, "linux")
}

func newTestCmd(t *testing.T) *exec.Cmd {
	t.Helper()
	return exec.Command("echo")
}
