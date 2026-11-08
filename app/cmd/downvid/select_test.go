package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/Downvid/downvid/app/internal/parse"
)

func videoInfo() *parse.VideoInfo {
	return &parse.VideoInfo{
		Title: "测试视频",
		Formats: []parse.Format{
			{FormatID: "137", Quality: "1080p", Ext: "mp4", Height: 1080, Width: 1920, FPS: 30},
			{FormatID: "136", Quality: "720p", Ext: "mp4", Height: 720, Width: 1280, FPS: 30},
			{FormatID: "135", Quality: "480p", Ext: "mp4", Height: 480, Width: 854, FPS: 30},
		},
		AudioFormats: []parse.AudioFormat{
			{FormatID: "140", Quality: "128kbps", Ext: "m4a", ABR: 128},
			{FormatID: "139", Quality: "48kbps", Ext: "m4a", ABR: 48},
		},
	}
}

func TestPickVideoQuality(t *testing.T) {
	info := videoInfo()

	for _, tc := range []struct {
		quality string
		want    string
	}{
		{"", "137"},
		{"best", "137"},
		{"1080", "137"},
		{"1080p", "137"},
		{"720", "136"},
		{"700", "135"},
	} {
		got, err := pickVideo(info, tc.quality, "")
		if err != nil {
			t.Fatalf("quality %q: %v", tc.quality, err)
		}
		if got.FormatID != tc.want {
			t.Errorf("quality %q: got %s, want %s", tc.quality, got.FormatID, tc.want)
		}
	}
}

func TestPickVideoErrors(t *testing.T) {
	if _, err := pickVideo(videoInfo(), "240", ""); err == nil {
		t.Fatal("240p 应该报没有可用格式")
	}
	if _, err := pickVideo(videoInfo(), "abc", ""); err == nil {
		t.Fatal("非法清晰度应该报错")
	}
}

func TestPickVideoExplicitFormat(t *testing.T) {
	got, err := pickVideo(videoInfo(), "best", "136")
	if err != nil || got.FormatID != "136" {
		t.Fatalf("explicit format: %+v %v", got, err)
	}

	// 不在解析结果里的选择器原样交给 yt-dlp；带 + 的不能再去补音轨。
	got, err = pickVideo(videoInfo(), "best", "137+140")
	if err != nil || got.FormatID != "137+140" || !got.HasAudio {
		t.Fatalf("selector: %+v %v", got, err)
	}
	got, _ = pickVideo(videoInfo(), "best", "137")
	if got.HasAudio {
		t.Fatal("单个视频格式不应被标记为带音频")
	}
}

func TestPickVideoWithoutFormats(t *testing.T) {
	got, err := pickVideo(&parse.VideoInfo{}, "best", "")
	if err != nil || got.FormatID != "bv*+ba/b" {
		t.Fatalf("fallback: %+v %v", got, err)
	}
}

func TestPickAudio(t *testing.T) {
	got := pickAudio(videoInfo())
	if got.FormatID != "140" {
		t.Fatalf("audio: %+v", got)
	}
	if got := pickAudio(&parse.VideoInfo{}); got.FormatID != "bestaudio" {
		t.Fatalf("audio fallback: %+v", got)
	}
}

func TestPrintFormats(t *testing.T) {
	var b bytes.Buffer
	printFormats(&b, videoInfo())
	for _, want := range []string{"137", "1080p", "140", "128kbps"} {
		if !strings.Contains(b.String(), want) {
			t.Errorf("输出里没有 %q：\n%s", want, b.String())
		}
	}
}
