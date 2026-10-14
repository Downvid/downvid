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

// CandidateTimeout 是执行**托管副本**（DownVid 自己下载的那份）的时限。
//
// 为什么是 15 秒而不是曾经的 3 秒：yt-dlp 的 macOS 官方构建是 PyInstaller
// 打包的（约 37MB），本机实测 `--version` 稳定要 8～10 秒，而**刚下载完的
// 首次执行**还会更慢（实测三次首次执行：9.7s / 8.9s / 12.4s——ad-hoc 签名
// 校验与页面缓存都还没热）。3 秒预算下探测必然超时，报「执行超时，文件可能
// 损坏」，于是**刚下载好的托管副本会被判为不可用**：用户点「下载」看着进度
// 条跑完，界面却仍然显示「下载」，反复点也没用。
const CandidateTimeout = 15 * time.Second

// SystemCandidateTimeout 是执行**系统里那份**（PATH / 常见安装目录）的时限。
//
// 刻意比托管副本短得多，两个原因：
//   - 系统副本通常是 Python zipapp（Homebrew / uv / pipx），`--version` 只要
//     0.2 秒；慢到 5 秒还答不上来的，基本就是坏文件或卡死的进程
//   - **每个卡死的候选都要吃掉一整个时限**。候选表里可能有十几个路径
//     （PATH + 各平台常见安装目录），若每个都给 15 秒，最坏情况能把一次检测
//     拖到几分钟。Windows 回归用例（两个卡死候选之后才轮到正常副本）
//     正是这样暴露出来的
const SystemCandidateTimeout = 5 * time.Second

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
	reYtDlpVersion  = regexp.MustCompile(`^\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$`)
	reDigits        = regexp.MustCompile(`\d+`)
	reKilled        = regexp.MustCompile(`(?i)killed|signal: 9`)
)

// Run 执行工具并解析版本号；失败时返回的错误信息可直接展示给用户
func Run(tool, path string) (Info, error) {
	return RunContext(context.Background(), tool, path)
}

// RunContext 同时受调用方总预算与单个候选时限约束。
func RunContext(ctx context.Context, tool, path string) (Info, error) {
	return RunWithTimeout(ctx, tool, path, CandidateTimeout)
}

// RunWithTimeout 与 RunContext 相同，但由调用方指定单个候选的执行时限。
//
// 需要它是因为**不同来源的候选该给不同的预算**：托管副本是我们自己下载的
// 官方 PyInstaller 构建（8～12 秒），系统副本通常是 0.2 秒的 zipapp。
// 一律按长预算给，会让卡死的系统副本把检测拖垮（见 SystemCandidateTimeout）。
func RunWithTimeout(ctx context.Context, tool, path string, timeout time.Duration) (Info, error) {
	args, ok := Args[tool]
	if !ok {
		args = []string{"--version"}
	}

	info := Info{Path: path}
	out, err := run(ctx, path, args, timeout)
	if err != nil {
		return info, describeRunError(err, out)
	}
	info.Version = ParseVersion(tool, out)
	info.Major = Major(info.Version)

	if info.Version == "" {
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
		if m := reFFmpegVersion.FindStringSubmatch(line); strings.HasPrefix(line, tool+" version ") && len(m) == 2 && Major(m[1]) > 0 {
			return m[1]
		}
		return ""
	}
	// yt-dlp：直接输出版本号
	if tool == "yt-dlp" && reYtDlpVersion.MatchString(line) {
		return line
	}
	return ""
}

// CompareVersions 按「数字段逐个比较」判断 a 与 b 的先后，返回 -1 / 0 / 1。
//
// 适用于 yt-dlp 的日期版本号（2026.10.10.233141）与 ffmpeg 的语义版本（6.0）。
// 不做完整的 semver 解析：这里的用途只是「是否落后于清单里 pin 的版本」。
func CompareVersions(a, b string) int {
	pa := versionParts(a)
	pb := versionParts(b)
	for i := 0; i < len(pa) || i < len(pb); i++ {
		var x, y int
		if i < len(pa) {
			x = pa[i]
		}
		if i < len(pb) {
			y = pb[i]
		}
		if x != y {
			if x < y {
				return -1
			}
			return 1
		}
	}
	return 0
}

// IsOlder 报告 version 是否早于 min
func IsOlder(version, min string) bool {
	if version == "" || min == "" {
		return false // 版本未知时不判定为过旧，避免误报
	}
	return CompareVersions(version, min) < 0
}

// versionParts 抽出全部数字段；非数字前缀（如 ffmpeg 的 "n7.1"）会被跳过
func versionParts(v string) []int {
	var parts []int
	for _, seg := range reDigits.FindAllString(v, -1) {
		n, err := strconv.Atoi(seg)
		if err != nil {
			continue
		}
		parts = append(parts, n)
	}
	return parts
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

func run(parent context.Context, path string, args []string, timeout time.Duration) (string, error) {
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, path, args...)
	hideWindow(cmd)
	sink := &limitedBuffer{limit: 64 << 10}
	cmd.Stdout = sink
	cmd.Stderr = sink

	// **必须设 WaitDelay**：超时后 exec.CommandContext 只杀**直接子进程**。
	// 我们的候选是 shell 脚本或 PyInstaller 启动器，它们会再拉起子进程，
	// 而那个孙进程继承了 stdout 管道。子进程被杀了，孙进程还在，
	// 管道不关闭 → `cmd.Run()` 一直等 I/O → **探测远超预算**。
	//
	// 实测：一个 `sleep 300` 的假二进制把 5 秒预算的探测拖成了 300 秒
	// （单元测试里真实复现）。用户侧的表现是界面卡住几十秒到几分钟，
	// 最后报「依赖检测达到时限」——而真正的原因是这个孙进程。
	//
	// WaitDelay 让 Wait 在进程退出后再等这么久就强制关闭管道并返回。
	cmd.WaitDelay = 2 * time.Second

	err := cmd.Run()
	if ctx.Err() != nil {
		err = ctx.Err()
	}
	return sink.String(), err
}

// describeRunError 把底层执行错误翻译成用户能看懂的中文提示
func describeRunError(err error, out string) error {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "context deadline exceeded"):
		// 超时≠损坏：yt-dlp 的官方 macOS 构建冷启动就要 8～10 秒，
		// 说得太绝对会把用户的耐心和排查方向一起带偏
		return errors.New("执行超时（可执行文件响应过慢，可能已损坏，也可能是首次运行较慢）")
	case strings.Contains(msg, "context canceled"):
		// 父级上下文被取消（例如整体检测到了时限）。不加这一条会直接把
		// 英文的 "context canceled" 甩到界面上——错误信息一律用中文。
		return errors.New("执行超时（检测被中断）")
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
