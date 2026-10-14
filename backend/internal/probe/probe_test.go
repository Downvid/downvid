package probe

import "testing"

func TestParseVersion(t *testing.T) {
	cases := []struct {
		tool string
		out  string
		want string
	}{
		{"yt-dlp", "2026.10.10.233141\n", "2026.10.10.233141"},
		{"yt-dlp", "\n\n  2025.01.15  \n", "2025.01.15"},
		{"ffmpeg", "ffmpeg version 6.0 Copyright (c) 2000-2023 the FFmpeg developers", "6.0"},
		{"ffmpeg", "ffmpeg version 9.0.2 Copyright (c) 2000-2025", "9.0.2"},
		{"ffprobe", "ffprobe version n7.1-static Copyright (c)", "n7.1-static"},
		{"yt-dlp", "", ""},
		{"yt-dlp", "ERROR: missing runtime DLL", ""},
		{"yt-dlp", "2026.10.10 error", ""},
		{"ffmpeg", "ERROR: missing runtime DLL", ""},
		{"ffmpeg", "ffmpeg version unknown", ""},
		{"ffmpeg", "another tool version 6.0", ""},
	}
	for _, c := range cases {
		if got := ParseVersion(c.tool, c.out); got != c.want {
			t.Errorf("ParseVersion(%q, %q) = %q, 期望 %q", c.tool, c.out, got, c.want)
		}
	}
}

func TestMajor(t *testing.T) {
	cases := map[string]int{
		"2026.10.10.233141": 2026, // yt-dlp 日期版本 -> 年份
		"6.0":               6,
		"n7.1-static":       7,
		"":                  0,
		"unknown":           0,
	}
	for in, want := range cases {
		if got := Major(in); got != want {
			t.Errorf("Major(%q) = %d, 期望 %d", in, got, want)
		}
	}
}

func TestMinimumMajorRejectsStaleYtDlp(t *testing.T) {
	// 2022 年的 yt-dlp 大量站点已失效，应判为不可用
	if got := Major("2022.11.11"); got >= MinimumMajor["yt-dlp"] {
		t.Errorf("2022.11.11 应低于最低要求 %d，实际判定 %d", MinimumMajor["yt-dlp"], got)
	}
	if got := Major("2026.10.10"); got < MinimumMajor["yt-dlp"] {
		t.Errorf("2026.10.10 应满足最低要求 %d，实际判定 %d", MinimumMajor["yt-dlp"], got)
	}
}
