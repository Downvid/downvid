package main

import (
	"reflect"
	"testing"
)

func TestSplitArgsMovesFlagsBeforeURL(t *testing.T) {
	for _, tc := range []struct {
		in, want []string
	}{
		{[]string{"https://x/v", "-q", "1080"}, []string{"-q", "1080", "https://x/v"}},
		{[]string{"-a", "https://x/v", "--json"}, []string{"-a", "--json", "https://x/v"}},
		{[]string{"https://x/v", "--format=137+140"}, []string{"--format=137+140", "https://x/v"}},
		{[]string{"https://x/v", "-o", "/tmp/out"}, []string{"-o", "/tmp/out", "https://x/v"}},
		{[]string{"deps", "install", "--only", "yt-dlp"}, []string{"--only", "yt-dlp", "deps", "install"}},
		{[]string{"--", "https://x/v", "-q"}, []string{"https://x/v", "-q"}},
	} {
		if got := splitArgs(tc.in); !reflect.DeepEqual(got, tc.want) {
			t.Errorf("splitArgs(%v) = %v, want %v", tc.in, got, tc.want)
		}
	}
}
