// Package download —— yt-dlp 输出行的解析与进度事件。
//
// 本文件把 electron/download/ytdlp.ts 的 `handleLine` 搬成可测的纯逻辑。
//
// ## 为什么把解析单独拆出来
//
// 原实现里 `handleLine` 直接调 `throttledProgress()`（会发 IPC / 推送 WebSocket），
// 于是「一行输出该解成什么」和「怎么发出去」缠在一起，测不了。
// 拆开后：这个文件只负责**判断一行是什么、算出什么数值**，
// 发不发、发到哪由调用方决定（桌面走 Wails 事件、容器走 WebSocket）。
//
// ## 前缀是跨进程契约，不能改
//
// `[dvp]` / `[dvpp]` / `[dvfile]` / `[dvsubs]` 是 yt-dlp `--progress-template`
// 与 `--print` 里写死的。改前缀等于改参数（见 ytdlp_args.go 的 ProgressTemplate），
// 两边必须同时改，否则进度条不动而所有测试全绿。
package download

import (
	"encoding/json"
	"math"
	"path/filepath"
	"strconv"
	"strings"
)

// Event 是解析出的一行输出对应的动作。
type Event struct {
	// Kind 是事件种类：progress / merging / file / subs / ignored
	Kind string
	// Percent 是 0~100（仅 Kind=progress/merging 时有意义）
	Percent float64
	// TotalSize / Speed / ETA 是**已格式化**的展示字符串（"12.3 MB" / "1.2 MB/s" / "01:23"）
	TotalSize string
	Speed     string
	ETA       string
	// Message 用于 merging 时的说明文案（"正在合并音视频..."）
	Message string
	// FilePath 是下载完成的文件路径（Kind=file/subs 时）
	FilePath string
}

// LineState 是跨行累积的状态。
type LineState struct {
	// Started 表示已经开始下载（收到过进度）
	Started bool
}

// 进度模板的字段顺序（与 ProgressTemplate 一一对应）。
const progressFieldCount = 7

// ParseLine 解析 yt-dlp 的一行输出。
//
// 返回 Event{Kind:"ignored"} 表示这行与进度无关（yt-dlp 的日志、aria2 的杂项）。
// 调用方应当忽略它，而不是当成错误——**yt-dlp 的正常输出里大部分行都是这种**。
//
// wantSubtitles 用于在多个字幕里挑用户要的语言（Kind=subs 时）。
func ParseLine(line string, state *LineState, wantSubtitles []string) Event {
	line = strings.TrimRight(line, "\r")

	// aria2 的进度行没有前缀，靠格式识别（`[#abc 1/2(50%) CN:8 DL:3]`）
	if p, ok := ParseAria2Progress(line); ok {
		state.Started = true
		percent := 0.0
		if p.Total > 0 {
			percent = math.Min(99, float64(p.Downloaded)/float64(p.Total)*100)
		}
		ev := Event{Kind: "progress", Percent: percent, TotalSize: FormatBytesInt(p.Total)}
		if p.Speed > 0 {
			ev.Speed = FormatBytesInt(p.Speed) + "/s"
			ev.ETA = FormatETA(float64(p.Total-p.Downloaded) / float64(p.Speed))
		}
		return ev
	}

	if strings.HasPrefix(line, ProgressPrefix) {
		return parseDownloadProgress(strings.TrimPrefix(line, ProgressPrefix), state)
	}
	if strings.HasPrefix(line, PostprocessPrefix) {
		return parsePostprocess(strings.TrimPrefix(line, PostprocessPrefix))
	}
	if strings.HasPrefix(line, FilePrefix) {
		return Event{Kind: "file", FilePath: resolvePath(strings.TrimSpace(strings.TrimPrefix(line, FilePrefix)))}
	}
	if strings.HasPrefix(line, SubsPrefix) {
		return parseSubs(strings.TrimPrefix(line, SubsPrefix), wantSubtitles)
	}

	return Event{Kind: "ignored"}
}

// parseDownloadProgress 解析 `[dvp]done|total|estimate|speed|eta|fragIdx|fragCount`。
//
// 百分比优先用字节算，字节缺失时退到分片进度（HLS/DASH 场景 total 常为 NA）。
func parseDownloadProgress(body string, state *LineState) Event {
	fields := strings.Split(body, "|")
	if len(fields) < progressFieldCount {
		// 字段不足说明模板与解析不同步——**不要猜**，直接忽略。
		// 猜错的结果是进度条乱跳，比不动更难排查。
		return Event{Kind: "ignored"}
	}

	done := num(fields[0])
	total := num(fields[1])
	if total == 0 {
		total = num(fields[2]) // estimate 兜底
	}
	fragIdx := num(fields[5])
	fragCount := num(fields[6])
	speed := num(fields[3])

	var percent float64
	switch {
	case total > 0:
		percent = done / total * 100
	case fragCount > 0:
		percent = fragIdx / fragCount * 100
	}
	if percent > 100 {
		percent = 100
	}

	state.Started = true
	ev := Event{
		Kind:      "progress",
		Percent:   percent,
		TotalSize: FormatBytesInt(int64(total)),
	}
	if speed > 0 {
		ev.Speed = FormatBytesInt(int64(speed)) + "/s"
	}
	// eta 可能是字面量 "NA"（yt-dlp 在总大小未知时这么写）
	if eta := strings.TrimSpace(fields[4]); eta != "" && eta != "NA" {
		ev.ETA = FormatETA(num(eta))
	}
	return ev
}

// parsePostprocess 解析 `[dvpp]processor|status`。
//
// 只在**开始**时发一次事件：后处理的状态会刷很多行，每次都发会让界面闪。
func parsePostprocess(body string) Event {
	fields := strings.SplitN(body, "|", 2)
	if len(fields) < 2 {
		return Event{Kind: "ignored"}
	}
	processor, status := fields[0], strings.TrimSpace(fields[1])
	if status != "started" {
		return Event{Kind: "ignored"}
	}

	switch {
	case strings.Contains(strings.ToLower(processor), "merger"):
		return Event{Kind: "merging", Percent: 99, Message: "正在合并音视频..."}
	case strings.Contains(strings.ToLower(processor), "extractaudio"):
		return Event{Kind: "merging", Percent: 99, Message: "正在转换音频..."}
	}
	return Event{Kind: "ignored"}
}

// parseSubs 解析 `[dvsubs]{lang: {filepath: ...}}`。
//
// 优先取用户要的语言；没有匹配时取任意一个（至少让「下载字幕」有个结果）。
func parseSubs(body string, want []string) Event {
	var subs map[string]struct {
		FilePath string `json:"filepath"`
	}
	if err := json.Unmarshal([]byte(body), &subs); err != nil {
		return Event{Kind: "ignored"}
	}

	for _, lang := range want {
		if s, ok := subs[lang]; ok && s.FilePath != "" {
			return Event{Kind: "file", FilePath: resolvePath(s.FilePath)}
		}
	}
	for _, s := range subs {
		if s.FilePath != "" {
			return Event{Kind: "file", FilePath: resolvePath(s.FilePath)}
		}
	}
	return Event{Kind: "ignored"}
}

// num 把 yt-dlp 输出的数字字段转成 float64，无法解析时返回 0。
//
// yt-dlp 在「未知」时写 `NA`，不能当错误——那是最常见的情况（总大小未知）。
func num(s string) float64 {
	s = strings.TrimSpace(s)
	if s == "" || s == "NA" {
		return 0
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil || math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return v
}

func resolvePath(p string) string {
	if abs, err := filepath.Abs(p); err == nil {
		return abs
	}
	return p
}

// ===== 格式化（与 TS 的 formatBytes / formatEta 逐字一致）=====

// FormatBytes 把字节数转成人看的字符串（float64 版本，供 aria2 路径用）。
func FormatBytes(bytes float64) string { return FormatBytesInt(int64(bytes)) }

// FormatBytesInt 是实际实现。
//
// 与 TS 逐字一致：0 或负数返回空串（而不是 "0 KB"）——
// 界面据此判断「要不要显示大小这一栏」。
func FormatBytesInt(bytes int64) string {
	if bytes <= 0 {
		return ""
	}
	switch {
	case bytes >= 1<<30:
		return fmt2(float64(bytes)/(1<<30)) + " GB"
	case bytes >= 1<<20:
		return fmt1(float64(bytes)/(1<<20)) + " MB"
	default:
		// 必须**四舍五入**而不是截断：TS 用 `toFixed(0)`，999 字节 → "1 KB"。
		// 截断会得到 "0 KB"，界面显示「0 KB」比不显示更糟。
		return strconv.FormatInt(int64(math.Round(float64(bytes)/1024)), 10) + " KB"
	}
}

// FormatETA 把秒数转成 mm:ss 或 h:mm:ss。
//
// 与 TS 一致：非有限值或负数返回空串（界面据此不显示 ETA）。
func FormatETA(seconds float64) string {
	if math.IsNaN(seconds) || math.IsInf(seconds, 0) || seconds < 0 {
		return ""
	}
	s := int64(math.Round(seconds))
	h := s / 3600
	m := (s % 3600) / 60
	sec := s % 60
	if h > 0 {
		return strconv.FormatInt(h, 10) + ":" + pad2(m) + ":" + pad2(sec)
	}
	return pad2(m) + ":" + pad2(sec)
}

func pad2(n int64) string {
	if n < 10 {
		return "0" + strconv.FormatInt(n, 10)
	}
	return strconv.FormatInt(n, 10)
}

func fmt1(v float64) string { return strconv.FormatFloat(math.Round(v*10)/10, 'f', 1, 64) }
func fmt2(v float64) string { return strconv.FormatFloat(math.Round(v*100)/100, 'f', 2, 64) }
