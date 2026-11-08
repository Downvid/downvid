package main

import (
	"strings"
	"testing"

	"github.com/Downvid/downvid/app/internal/parse"
)

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
