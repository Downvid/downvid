package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/Downvid/downvid/app/internal/parse"
)

func TestListDouyinMediaWithoutYtdlp(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("USERPROFILE", t.TempDir())
	t.Setenv("APPDATA", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("PATH", t.TempDir())
	var stdout, stderr bytes.Buffer
	code := run([]string{"--list-formats", "--json", "-o", t.TempDir(), "https://v26-web.douyinvod.com/video/tos/cn/object"}, &stdout, &stderr)
	if code != 0 || !strings.Contains(stdout.String(), `"formatId":"direct"`) {
		t.Fatalf("无 yt-dlp 时应能列出抖音直链的格式：退出码 %d，stdout=%s，stderr=%s", code, &stdout, &stderr)
	}
}

func TestDirectFilename(t *testing.T) {
	info := &parse.VideoInfo{ID: "123", Title: "a/b", Uploader: "u"}
	if got, want := directFilename("%(title)s-%(uploader)s", info, "tid", "mp4"), "a-b-u.mp4"; got != want {
		t.Fatalf("template: got %q, want %q", got, want)
	}
	if got, want := directFilename("", info, "tid", "mp4"), "a-b.mp4"; got != want {
		t.Fatalf("default: got %q, want %q", got, want)
	}
	if got := directFilename("%(title)s", &parse.VideoInfo{}, "tid", "mp4"); got != "tid.mp4" {
		t.Fatalf("empty title: %q", got)
	}
	if got := directFilename("%(title)s", info, "tid", "mp4"); strings.ContainsAny(got, `/\`) {
		t.Fatalf("文件名里还有路径分隔符：%q", got)
	}
}
