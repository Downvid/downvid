package download

import (
	"context"
	"strings"
	"testing"
)

// newYtdlpCmd 是 Run 起进程的唯一入口：参数顺序与工作目录必须原样带过去，
// 否则行为会静默改变（URL 被当成某个选项的值、相对路径落到错误目录）。
func TestNewYtdlpCmdCarriesArgsAndDir(t *testing.T) {
	opts := RunOptions{YtdlpPath: "yt-dlp", OutputDir: "/tmp/downvid-out"}
	cmd := newYtdlpCmd(context.Background(), opts, []string{"--print", "%(title)s", "https://example.com/v"})

	if cmd.Dir != "/tmp/downvid-out" {
		t.Fatalf("工作目录 = %q，应为 /tmp/downvid-out", cmd.Dir)
	}
	want := "--print %(title)s https://example.com/v"
	if got := strings.Join(cmd.Args[1:], " "); got != want {
		t.Fatalf("参数 = %q，应为 %q", got, want)
	}
}
