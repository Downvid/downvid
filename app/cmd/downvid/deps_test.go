package main

import "testing"

func TestKnownKind(t *testing.T) {
	for _, k := range []string{"yt-dlp", "ffmpeg", "ffprobe", "aria2"} {
		if !knownKind(k) {
			t.Errorf("%q 应该是已知依赖", k)
		}
	}
	if knownKind("ffplay") {
		t.Fatal("ffplay 不该被当成已知依赖")
	}
}

func TestDepsBytes(t *testing.T) {
	if got, want := depsBytes(512), "512 B"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
	if got, want := depsBytes(2*1024*1024), "2.0 MB"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}
