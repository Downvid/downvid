// Package probe 负责执行 yt-dlp / ffmpeg / ffprobe 并解析其版本号。
package probe

import (
	"bytes"
	"context"
	"errors"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Args 各工具的版本探测参数
var Args = map[string][]string{
	"yt-dlp":  {"--version"},
	"ffmpeg":  {"-version"},
	"ffprobe": {"-version"},
}

// MinimumMajor 判断工具是否可用的最低主版本号。
// yt-dlp 使用日期版本号（2026.10.10），因此主版本号是年份：
// 早于 2024 的版本大量站点已失效，建议重新下载。
var MinimumMajor = map[string]int{
	"yt-dlp":  2024,
	"ffmpeg":  4,
	"ffprobe": 4,
}

// Info 一次成功的版本探测结果
type Info struct {
	Path    string
	Version string
	Major   int
}

var (
	reFFmpegVersion = regexp.MustCompile(`version\s+(\S+)`)
	reDigits        = regexp.MustCompile(`\d+`)
	reKilled        = regexp.MustCompile(`(?i)killed|signal: 9`)
)

// Run 执行工具并解析版本号；失败时返回的错误信息可直接展示给用户
func Run(tool, path string) (Info, error) {
	args, ok := Args[tool]
	if !ok {
		args = []string{"--version"}
	}

	info := Info{Path: path}
	out, err := run(path, args, 15*time.Second)
	info.Version = ParseVersion(tool, out)
	info.Major = Major(info.Version)

	if info.Version == "" {
		if err != nil {
			return info, describeRunError(err, out)
		}
		return info, errors.New("无法解析版本输出：" + firstLine(out))
	}
	return info, nil
}

// ParseVersion 从命令输出里提取版本号
func ParseVersion(tool, out string) string {
	line := firstNonEmptyLine(out)
	if line == "" {
		return ""
	}
	// ffmpeg / ffprobe：`ffmpeg version 6.0 Copyright (c) ...`
	if tool == "ffmpeg" || tool == "ffprobe" {
		if m := reFFmpegVersion.FindStringSubmatch(line); len(m) == 2 {
			return m[1]
		}
	}
	// yt-dlp：直接输出版本号
	if fields := strings.Fields(line); len(fields) > 0 {
		return fields[0]
	}
	return ""
}

// Major 取版本号里的第一个数字段（yt-dlp 日期版本即为年份）
func Major(version string) int {
	m := reDigits.FindString(version)
	if m == "" {
		return 0
	}
	n, err := strconv.Atoi(m)
	if err != nil {
		return 0
	}
	return n
}

func run(path string, args []string, timeout time.Duration) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, path, args...)
	hideWindow(cmd)
	sink := &limitedBuffer{limit: 64 << 10}
	cmd.Stdout = sink
	cmd.Stderr = sink
	err := cmd.Run()
	return sink.String(), err
}

// describeRunError 把底层执行错误翻译成用户能看懂的中文提示
func describeRunError(err error, out string) error {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "context deadline exceeded"):
		return errors.New("执行超时，文件可能损坏")
	case reKilled.MatchString(msg) || reKilled.MatchString(out):
		return errors.New("无法执行（macOS 可能已损坏或未签名，请重新下载）")
	case strings.Contains(msg, "permission denied"):
		return errors.New("没有执行权限 (chmod +x)")
	case strings.Contains(msg, "no such file or directory"), strings.Contains(msg, "cannot find"):
		return errors.New("文件不存在")
	case strings.Contains(msg, "exec format error"), strings.Contains(msg, "bad CPU type"),
		strings.Contains(msg, "not a valid Win32 application"), strings.Contains(msg, "%1 is not a valid"):
		return errors.New("文件格式不正确（可能下载不完整或与当前架构不匹配），请重新下载")
	}
	if line := firstLine(out); line != "" {
		return errors.New(line)
	}
	return err
}

func firstNonEmptyLine(s string) string {
	for _, line := range strings.Split(s, "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return strings.TrimSpace(s[:i])
	}
	return strings.TrimSpace(s)
}

// limitedBuffer 只保留前 limit 字节，避免 ffmpeg 的冗长输出撑爆内存
type limitedBuffer struct {
	limit int
	buf   bytes.Buffer
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if remaining := b.limit - b.buf.Len(); remaining > 0 {
		if len(p) > remaining {
			b.buf.Write(p[:remaining])
		} else {
			b.buf.Write(p)
		}
	}
	return len(p), nil
}

func (b *limitedBuffer) String() string { return b.buf.String() }
