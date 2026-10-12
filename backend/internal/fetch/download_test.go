package fetch

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func gzipBytes(t *testing.T, payload []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := zw.Write(payload); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// 校验值针对下载内容（gzip 时为压缩文件），通过后解压安装
func TestInstallGzipVerifiesCompressedBytes(t *testing.T) {
	payload := []byte("#!/bin/sh\necho hello\n")
	archive := gzipBytes(t, payload)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", strconv.Itoa(len(archive)))
		w.Write(archive)
	}))
	defer srv.Close()

	target := filepath.Join(t.TempDir(), "tool")
	err := Install(context.Background(), []Task{{
		Tool: "ffmpeg", URL: srv.URL, SHA256: sha256Hex(archive), Gzip: true, Target: target,
	}}, Options{Timeout: 30 * time.Second})
	if err != nil {
		t.Fatalf("安装失败：%v", err)
	}

	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, payload) {
		t.Errorf("解压结果不符，得到 %q", got)
	}
	if runtime.GOOS != "windows" {
		info, _ := os.Stat(target)
		if info.Mode().Perm()&0o100 == 0 {
			t.Error("安装后应具备执行权限")
		}
	}
}

// 校验失败必须中止安装，且不能留下任何可执行文件
func TestInstallRejectsBadChecksum(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("malicious payload"))
	}))
	defer srv.Close()

	dir := t.TempDir()
	target := filepath.Join(dir, "tool")
	err := Install(context.Background(), []Task{{
		Tool: "yt-dlp", URL: srv.URL, SHA256: strings.Repeat("0", 64), Target: target,
	}}, Options{Timeout: 30 * time.Second, Retries: 1})
	if err == nil {
		t.Fatal("校验失败时应返回错误")
	}
	if !strings.Contains(err.Error(), "校验失败") {
		t.Errorf("错误信息应说明校验失败，实际：%v", err)
	}
	if _, statErr := os.Stat(target); !os.IsNotExist(statErr) {
		t.Error("校验失败时不应留下目标文件")
	}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		t.Errorf("目录应保持干净，却发现 %s", e.Name())
	}
}

// 首次请求失败后应自动重试
func TestInstallRetriesThenSucceeds(t *testing.T) {
	payload := []byte("binary")
	attempts := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts == 1 {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		w.Write(payload)
	}))
	defer srv.Close()

	target := filepath.Join(t.TempDir(), "tool")
	err := Install(context.Background(), []Task{{
		Tool: "yt-dlp", URL: srv.URL, SHA256: sha256Hex(payload), Target: target,
	}}, Options{Timeout: 30 * time.Second, Retries: 3})
	if err != nil {
		t.Fatalf("重试后应成功：%v", err)
	}
	if attempts < 2 {
		t.Errorf("应至少请求两次，实际 %d 次", attempts)
	}
}

// 进度事件必须与压缩包大小一致，不能按解压后的字节数上报（否则百分比会超过 100%）
func TestProgressNeverExceedsTotal(t *testing.T) {
	archive := gzipBytes(t, bytes.Repeat([]byte("x"), 512*1024))
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", strconv.Itoa(len(archive)))
		w.Write(archive)
	}))
	defer srv.Close()

	var events []Event
	err := Install(context.Background(), []Task{{
		Tool: "ffmpeg", URL: srv.URL, SHA256: sha256Hex(archive), Gzip: true,
		Target: filepath.Join(t.TempDir(), "tool"),
	}}, Options{Timeout: 30 * time.Second, Emit: func(e Event) { events = append(events, e) }})
	if err != nil {
		t.Fatal(err)
	}

	var sawProgress bool
	for _, e := range events {
		if e.Event != "progress" {
			continue
		}
		sawProgress = true
		if e.Total <= 0 {
			continue
		}
		if e.Downloaded > e.Total {
			t.Errorf("已下载 %d 超出总大小 %d", e.Downloaded, e.Total)
		}
	}
	if !sawProgress {
		t.Error("应至少上报一次进度")
	}
}

// 已存在的文件在替换时必须成功（Windows 上覆盖运行中的 exe 会失败，需要先删除）
func TestInstallOverwritesExisting(t *testing.T) {
	payload := []byte("new content")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(payload)
	}))
	defer srv.Close()

	target := filepath.Join(t.TempDir(), "tool")
	if err := os.WriteFile(target, []byte("old content"), 0o755); err != nil {
		t.Fatal(err)
	}

	if err := Install(context.Background(), []Task{{
		Tool: "yt-dlp", URL: srv.URL, SHA256: sha256Hex(payload), Target: target,
	}}, Options{Timeout: 30 * time.Second}); err != nil {
		t.Fatalf("覆盖安装失败：%v", err)
	}
	got, _ := os.ReadFile(target)
	if string(got) != string(payload) {
		t.Errorf("文件未更新，内容为 %q", got)
	}
}

func TestInstallRejectsEmptyTaskList(t *testing.T) {
	if err := Install(context.Background(), nil, Options{}); err == nil {
		t.Error("空任务列表应返回错误")
	}
}

// GitHub 的下载地址带超长签名 JWT：错误信息必须只保留 主机/路径，
// 否则界面会被一串无意义的查询串撑爆
func TestSanitizeURLStripsQuery(t *testing.T) {
	raw := `Get "https://release-assets.githubusercontent.com/x/y?sp=r&sig=AbCdEf123&jwt=eyJhbGciOiJIUzI1NiJ9.long.token": net/http: TLS handshake timeout`
	got := sanitizeURL(raw)
	if strings.Contains(got, "sig=") || strings.Contains(got, "jwt=") {
		t.Errorf("查询串未被去掉：%q", got)
	}
	if !strings.Contains(got, "release-assets.githubusercontent.com/x/y") {
		t.Errorf("主机与路径应保留：%q", got)
	}
	if !strings.Contains(got, "TLS handshake timeout") {
		t.Errorf("原始错误原因应保留：%q", got)
	}
}

// 代理与超时是两种不同处置方式，提示必须区分
func TestNetworkHint(t *testing.T) {
	cases := []struct {
		msg  string
		want string
	}{
		{"proxyconnect tcp: dial tcp 127.0.0.1:1: connect: connection refused", "代理"},
		{"net/http: TLS handshake timeout", "超时"},
		{"some other failure", ""},
	}
	for _, c := range cases {
		got := networkHint(errors.New(c.msg))
		if c.want == "" {
			if got != "" {
				t.Errorf("%q 不应给出提示，实际 %q", c.msg, got)
			}
			continue
		}
		if !strings.Contains(got, c.want) {
			t.Errorf("%q 的提示应含 %q，实际 %q", c.msg, c.want, got)
		}
	}
}
