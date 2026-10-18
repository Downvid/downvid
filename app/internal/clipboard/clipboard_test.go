package clipboard

import (
	"context"
	"runtime"
	"strings"
	"testing"
	"time"
)

// 这组用例只在「能真的读到剪贴板」的机器上有意义。
// 无头 CI（Linux runner）上通常没有剪贴板，所以按平台跳过而不是失败。

func TestReadReturnsSomethingOrClearError(t *testing.T) {
	out, err := Read()
	if err != nil {
		// 失败必须是**可行动的**错误，而不是空字符串
		if err.Error() == "" {
			t.Fatal("失败时错误信息不能为空")
		}
		t.Skipf("这台机器读不到剪贴板（正常）：%v", err)
	}
	if strings.TrimSpace(out) == "" {
		t.Fatal("成功返回时不该是空串（空内容应返回 ErrEmpty）")
	}
	t.Logf("读到 %d 个字符", len(out))
}

// 没装命令时必须给出「找不到命令 X」这类能指路的错误。
//
// 这条在 Linux 上最有价值：容器/精简桌面里 wl-paste、xclip、xsel
// **一个都没有**，而报错若只说「读不到剪贴板」，用户无从下手。
func TestMissingCommandErrorIsActionable(t *testing.T) {
	if runtime.GOOS == "darwin" || runtime.GOOS == "windows" {
		t.Skip("这两个平台的命令是系统自带的")
	}
	// 用一个不存在的命令名验证错误翻译
	_, err := execText(context.Background(), "downvid-no-such-command-xyz")
	if err == nil {
		t.Fatal("执行不存在的命令应该报错")
	}
	if !strings.Contains(err.Error(), "找不到命令") {
		t.Errorf("错误信息应指明「找不到命令」，实际：%v", err)
	}
}

// 读剪贴板必须有超时——某些环境下的 wl-paste 会一直阻塞。
func TestReadHasTimeout(t *testing.T) {
	start := time.Now()
	_, _ = Read()
	elapsed := time.Since(start)
	// 上限 = readTimeout + 一点进程启动开销
	if elapsed > readTimeout+2*time.Second {
		t.Fatalf("Read 用了 %s，超时机制没生效（上限 %s）", elapsed, readTimeout)
	}
}
