package download

import (
	"math"
	"path/filepath"
	"reflect"
	"testing"
)

// yt-dlp 输出行解析的测试。
//
// 期望值全部来自 **TS 侧的真实输出**（`formatBytes` / `formatEta` 跑同一批输入），
// 不是我自己想的——这样「是否逐字一致」就有据可查。

// ===== formatBytes / formatEta 逐字对齐 =====

func TestFormatBytesMatchesTS(t *testing.T) {
	// 左侧数字与右侧期望值都来自 TS 实现的实跑输出
	cases := []struct {
		in   int64
		want string
	}{
		{0, ""},
		{-1, ""},
		{1, "0 KB"},
		{999, "1 KB"}, // (999/1024).toFixed(0) = "1"
		{1023, "1 KB"},
		{1024, "1 KB"},
		{1536, "2 KB"},       // 1.5 四舍五入到 2（toFixed(0)）
		{1048575, "1024 KB"}, // 差 1 字节到 MB 时仍是 KB
		{1048576, "1.0 MB"},
		{1572864, "1.5 MB"},
		{1073741824, "1.00 GB"},
		{1610612736, "1.50 GB"},
		{5368709120, "5.00 GB"},
	}
	for _, c := range cases {
		if got := FormatBytesInt(c.in); got != c.want {
			t.Errorf("FormatBytesInt(%d) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestFormatETAMatchesTS(t *testing.T) {
	cases := []struct {
		in   float64
		want string
	}{
		{0, "00:00"},
		{-1, ""},
		{1, "00:01"},
		{59.4, "00:59"},
		{59.6, "01:00"}, // 四舍五入到 60 秒
		{60, "01:00"},
		{61, "01:01"},
		{3599, "59:59"},
		{3600, "1:00:00"},
		{3661, "1:01:01"},
		{math.NaN(), ""},
		{math.Inf(1), ""},
	}
	for _, c := range cases {
		if got := FormatETA(c.in); got != c.want {
			t.Errorf("FormatETA(%v) = %q, want %q", c.in, got, c.want)
		}
	}
}

// ===== 行解析 =====

func TestParseLineProgress(t *testing.T) {
	st := &LineState{}
	// 下载 5MB / 总 10MB，速度 2MB/s，剩余 2.5 秒
	ev := ParseLine("[dvp]5242880|10485760|NA|2097152|2|0|0", st, nil)

	if ev.Kind != "progress" {
		t.Fatalf("Kind = %q", ev.Kind)
	}
	if math.Abs(ev.Percent-50) > 0.01 {
		t.Errorf("Percent = %v, want 50", ev.Percent)
	}
	if ev.TotalSize != "10.0 MB" {
		t.Errorf("TotalSize = %q", ev.TotalSize)
	}
	if ev.Speed != "2.0 MB/s" {
		t.Errorf("Speed = %q", ev.Speed)
	}
	if ev.ETA != "00:02" {
		t.Errorf("ETA = %q", ev.ETA)
	}
	if !st.Started {
		t.Error("应标记已开始")
	}
}

// total 为 NA 时退到 estimate。
func TestParseLineProgressUsesEstimate(t *testing.T) {
	st := &LineState{}
	ev := ParseLine("[dvp]5242880|NA|10485760|0|NA|0|0", st, nil)
	if math.Abs(ev.Percent-50) > 0.01 {
		t.Errorf("Percent = %v, want 50（应退到 total_bytes_estimate）", ev.Percent)
	}
}

// 字节全为 NA 时退到分片进度（HLS/DASH 常见）。
func TestParseLineProgressFallsBackToFragments(t *testing.T) {
	st := &LineState{}
	ev := ParseLine("[dvp]NA|NA|NA|NA|NA|5|10", st, nil)
	if math.Abs(ev.Percent-50) > 0.01 {
		t.Errorf("Percent = %v, want 50（应退到分片进度）", ev.Percent)
	}
}

// 进度不能超过 100（yt-dlp 偶尔报出超额字节）。
func TestParseLineProgressClampsAt100(t *testing.T) {
	st := &LineState{}
	ev := ParseLine("[dvp]11000000|10000000|NA|0|NA|0|0", st, nil)
	if ev.Percent > 100 {
		t.Errorf("Percent = %v，不该超过 100", ev.Percent)
	}
}

// 字段不足时忽略，而不是猜。
//
// 猜错的表现是进度条乱跳，比不动更难排查——所以宁可不动。
func TestParseLineProgressIgnoresShortField(t *testing.T) {
	st := &LineState{}
	ev := ParseLine("[dvp]1|2|3", st, nil)
	if ev.Kind != "ignored" {
		t.Fatalf("字段不足时应忽略，got %q", ev.Kind)
	}
	if st.Started {
		t.Error("忽略的行不该标记已开始")
	}
}

func TestParseLinePostprocess(t *testing.T) {
	st := &LineState{}
	ev := ParseLine("[dvpp]Merger|started", st, nil)
	if ev.Kind != "merging" || ev.Message != "正在合并音视频..." {
		t.Fatalf("got %+v", ev)
	}

	ev = ParseLine("[dvpp]ExtractAudio|started", st, nil)
	if ev.Kind != "merging" || ev.Message != "正在转换音频..." {
		t.Fatalf("got %+v", ev)
	}

	// 非 started 状态忽略（后处理会刷很多行，每次都发会让界面闪）
	if ev := ParseLine("[dvpp]Merger|processing", st, nil); ev.Kind != "ignored" {
		t.Fatalf("非 started 应忽略，got %+v", ev)
	}
}

func TestParseLineFile(t *testing.T) {
	st := &LineState{}
	// 用相对路径 + filepath.Abs 现算期望值：写死 `/tmp/out/...` 在 Windows 上
	// 会被生产代码的 filepath.Abs 归一成 `D:\...`，与字面量永不相等
	want, _ := filepath.Abs(filepath.Join("out", "video.mp4"))
	ev := ParseLine("[dvfile]out/video.mp4", st, nil)
	if ev.Kind != "file" {
		t.Fatalf("Kind = %q", ev.Kind)
	}
	if ev.FilePath != want {
		t.Errorf("FilePath = %q，期望 %q", ev.FilePath, want)
	}
}

func TestParseLineSubs(t *testing.T) {
	st := &LineState{}
	body := `{"zh-Hans":{"filepath":"out/v.zh-Hans.srt"},"en":{"filepath":"out/v.en.srt"}}`
	wantEn, _ := filepath.Abs(filepath.Join("out", "v.en.srt"))

	// 优先取用户要的语言
	ev := ParseLine("[dvsubs]"+body, st, []string{"en"})
	if ev.FilePath != wantEn {
		t.Errorf("应优先 en，got %q", ev.FilePath)
	}

	// 没有匹配时取任意一个（至少让「下载字幕」有结果）
	ev = ParseLine("[dvsubs]"+body, st, []string{"ja"})
	if ev.FilePath == "" {
		t.Error("没有匹配语言时应退回任意一个字幕")
	}

	// 坏 JSON 忽略，不 panic
	if ev := ParseLine("[dvsubs]not-json", st, nil); ev.Kind != "ignored" {
		t.Fatalf("坏 JSON 应忽略，got %+v", ev)
	}
}

// 无关行（yt-dlp 的日志）应忽略——它们占正常输出的大多数。
func TestParseLineIgnoresNoise(t *testing.T) {
	st := &LineState{}
	for _, line := range []string{
		`[youtube] Extracting URL: https://...`,
		`[info] Downloading 1 format(s): 137+140`,
		``,
		`随便什么`,
	} {
		if ev := ParseLine(line, st, nil); ev.Kind != "ignored" {
			t.Errorf("%q 应忽略，got %+v", line, ev)
		}
	}
}

// aria2 的进度行没有前缀，靠格式识别。
func TestParseLineAria2(t *testing.T) {
	st := &LineState{}
	ev := ParseLine("[#abc123 1000/4000(25%) CN:8 DL:2000 ETA:1s]", st, nil)
	if ev.Kind != "progress" {
		t.Fatalf("Kind = %q", ev.Kind)
	}
	if math.Abs(ev.Percent-25) > 0.01 {
		t.Errorf("Percent = %v, want 25", ev.Percent)
	}
}

// 回车刷新的行也要能处理（aria2 用 \r 而不是 \n）。
func TestParseLineHandlesCR(t *testing.T) {
	st := &LineState{}
	ev := ParseLine("[dvp]5000000|10000000|NA|0|NA|0|0\r", st, nil)
	if ev.Kind != "progress" {
		t.Fatalf("带 \\r 的行不该被忽略，got %q", ev.Kind)
	}
	if math.Abs(ev.Percent-50) > 0.01 {
		t.Errorf("Percent = %v", ev.Percent)
	}
}

// 前缀必须与实际参数模板一致（改前缀不会报错，只会让进度条不动）。
func TestPrefixesMatchTemplate(t *testing.T) {
	for _, pair := range []struct{ prefix, template string }{
		{ProgressPrefix, ProgressTemplate},
		{PostprocessPrefix, PostprocessTemplate},
	} {
		if !containsSub(pair.template, pair.prefix) {
			t.Errorf("模板里没有前缀 %q：%q（改前缀必须同时改参数模板）", pair.prefix, pair.template)
		}
	}
}

func containsSub(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && indexSub(s, sub) >= 0)
}

func indexSub(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

var _ = reflect.DeepEqual
