package parse

import (
	"reflect"
	"testing"
)

// 本文件是 tests/formats.test.ts 的逐条移植（16 条）。
//
// 每条用例都对应一个**曾经真实出过的问题**，不是编造的边界：
//   - X/Twitter 的 mp4 没有 vcodec，被过滤后格式列表为空 → 无法下载
//   - m3u8 与直链共存时优先选了 m3u8 → 只能浏览器式串流
//   - 全部格式都没有分辨率时没有兜底 → 用户无从选择
//   - bilibili 三编码 + 浮点 fps → 界面显示两个 1080P

func strPtr(s string) *string { return &s }

func ids(fs []Format) []string {
	out := make([]string, len(fs))
	for i, f := range fs {
		out[i] = f.FormatID
	}
	return out
}

func heights(fs []Format) []int {
	out := make([]int, len(fs))
	for i, f := range fs {
		out[i] = f.Height
	}
	return out
}

// --- YouTube 流格式回退保留仅有的 HLS 清晰度 ---

func TestYoutubeFallbackKeepsOnlyHLS(t *testing.T) {
	info := FmtInfo{Formats: []RawFormat{{
		FormatID: "hls", Vcodec: "h264", Acodec: strPtr("aac"),
		Height: 720, Protocol: "m3u8_native",
	}}}
	if got := BuildVideoFormatsWithManifests(info, true, true); got[0].FormatID != "hls" {
		t.Fatalf("允许 manifest 时应保留 hls，got %v", ids(got))
	}
	if got := BuildVideoFormatsWithManifests(info, true, false); got[0].FormatID == "hls" {
		t.Fatalf("不允许 manifest 时不该保留 hls，got %v", ids(got))
	}
}

// --- 保留没有 vcodec 的格式（X/Twitter 的 mp4）---

func TestKeepsFormatWithoutVcodec(t *testing.T) {
	info := FmtInfo{Formats: []RawFormat{{
		FormatID: "http-1", URL: "https://x/v.mp4", Ext: "mp4", Width: 1280, Height: 720,
	}}}
	got := BuildVideoFormats(info, false)
	if len(got) == 0 {
		t.Fatal("vcodec 缺失不该导致列表为空（X/Twitter 的 mp4 就是这样）")
	}
	if got[0].FormatID != "http-1" {
		t.Fatalf("got %v", ids(got))
	}
}

// --- 按分辨率降序排列 ---

func TestSortedByHeightDesc(t *testing.T) {
	info := FmtInfo{Formats: []RawFormat{
		{FormatID: "sd", Vcodec: "h264", Height: 360, Width: 640, Ext: "mp4"},
		{FormatID: "hd", Vcodec: "h264", Height: 1080, Width: 1920, Ext: "mp4"},
		{FormatID: "md", Vcodec: "h264", Height: 720, Width: 1280, Ext: "mp4"},
	}}
	got := heights(BuildVideoFormats(info, false))
	want := []int{1080, 720, 360}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

// --- 同一清晰度已有直链时不重复保留 m3u8 ---

func TestDirectPreferredOverM3U8(t *testing.T) {
	info := FmtInfo{Formats: []RawFormat{
		{FormatID: "direct-720", Vcodec: "h264", Height: 720, Width: 1280, Ext: "mp4", Protocol: "https"},
		{FormatID: "hls-720", Vcodec: "h264", Height: 720, Width: 1280, Ext: "mp4", Protocol: "m3u8_native"},
	}}
	got := ids(BuildVideoFormats(info, false))
	if !containsStr(got, "direct-720") {
		t.Fatalf("应保留直链，got %v", got)
	}
	if containsStr(got, "hls-720") {
		t.Fatalf("同清晰度已有直链时不该保留 m3u8，got %v", got)
	}
}

// --- 该清晰度只有 m3u8 时保留 m3u8 ---

func TestKeepsM3U8WhenOnlyOption(t *testing.T) {
	info := FmtInfo{Formats: []RawFormat{
		{FormatID: "direct-360", Vcodec: "h264", Height: 360, Width: 640, Ext: "mp4", Protocol: "https"},
		{FormatID: "hls-1080", Vcodec: "h264", Height: 1080, Width: 1920, Ext: "mp4", Protocol: "m3u8_native"},
	}}
	got := ids(BuildVideoFormats(info, false))
	if !containsStr(got, "hls-1080") {
		t.Fatalf("该清晰度只有 m3u8 时应保留，got %v", got)
	}
}

// --- 都没有分辨率时给出「最佳画质」兜底 ---

func TestFallbackBestQuality(t *testing.T) {
	info := FmtInfo{Formats: []RawFormat{{FormatID: "x", Vcodec: "h264", Ext: "mp4"}}}
	got := BuildVideoFormats(info, false)
	if !containsStr(ids(got), "bv*+ba/b") {
		t.Fatalf("无分辨率信息时应有兜底项，got %v", ids(got))
	}
}

// --- 无可用格式时返回空数组而不是抛错 ---

func TestEmptyInsteadOfPanic(t *testing.T) {
	if got := BuildVideoFormats(FmtInfo{Formats: []RawFormat{}}, false); len(got) != 0 {
		t.Fatalf("got %v", got)
	}
	if got := BuildVideoFormats(FmtInfo{}, false); len(got) != 0 {
		t.Fatalf("got %v", got)
	}
}

// --- 标记含音轨的格式 ---

func TestHasAudioFlag(t *testing.T) {
	info := FmtInfo{Formats: []RawFormat{
		{FormatID: "with-audio", Vcodec: "h264", Acodec: strPtr("aac"), Height: 720, Width: 1280, Ext: "mp4"},
		{FormatID: "video-only", Vcodec: "h264", Acodec: strPtr("none"), Height: 1080, Width: 1920, Ext: "mp4"},
	}}
	byID := map[string]Format{}
	for _, f := range BuildVideoFormats(info, false) {
		byID[f.FormatID] = f
	}
	if !byID["with-audio"].HasAudio {
		t.Fatal("acodec=aac 应标记为有音轨")
	}
	if byID["video-only"].HasAudio {
		t.Fatal("acodec=none 应标记为无音轨")
	}
}

// --- acodec 缺失应视为音视频一体（渐进式 mp4）---

func TestMissingAcodecMeansHasAudio(t *testing.T) {
	info := FmtInfo{Formats: []RawFormat{{FormatID: "progressive", Vcodec: "h264", Height: 720}}}
	got := BuildVideoFormats(info, false)
	if !got[0].HasAudio {
		t.Fatal("acodec 字段缺失应视为有音轨（渐进式 mp4），否则下载时会错误地再合并一次")
	}
}

// ===== 同一清晰度去重（真实 bilibili 数据）=====

// bilibiliInfo 是从**真实响应**里截出来的 12 条格式，不是简化版。
// 只有真实数据才同时包含「三编码 + 浮点 fps 抖动」这两个特征。
func bilibiliInfo() FmtInfo {
	return FmtInfo{
		Duration: 1206.833,
		Formats: []RawFormat{
			{FormatID: "30011", Height: 360, FPS: 29.969, Vcodec: "hev1.1.6.L120", Acodec: strPtr("none"), Tbr: 253.637},
			{FormatID: "100022", Height: 360, FPS: 29.969, Vcodec: "av01.0.00M.10", Acodec: strPtr("none"), Tbr: 226.967},
			{FormatID: "30016", Height: 360, FPS: 29.97, Vcodec: "avc1.64001E", Acodec: strPtr("none"), Tbr: 363.121},
			{FormatID: "30033", Height: 480, FPS: 29.969, Vcodec: "hev1.1.6.L120", Acodec: strPtr("none"), Tbr: 415.96},
			{FormatID: "100023", Height: 480, FPS: 29.969, Vcodec: "av01.0.00M.10", Acodec: strPtr("none"), Tbr: 382.091},
			{FormatID: "30032", Height: 480, FPS: 29.97, Vcodec: "avc1.64001F", Acodec: strPtr("none"), Tbr: 621.299},
			{FormatID: "30066", Height: 720, FPS: 29.969, Vcodec: "hev1.1.6.L120", Acodec: strPtr("none"), Tbr: 878.474},
			{FormatID: "100024", Height: 720, FPS: 29.969, Vcodec: "av01.0.00M.10", Acodec: strPtr("none"), Tbr: 819.378},
			{FormatID: "30064", Height: 720, FPS: 29.97, Vcodec: "avc1.640028", Acodec: strPtr("none"), Tbr: 1301.438},
			{FormatID: "30077", Height: 1080, FPS: 29.969, Vcodec: "hev1.1.6.L150", Acodec: strPtr("none"), Tbr: 2070.001},
			{FormatID: "100026", Height: 1080, FPS: 29.969, Vcodec: "av01.0.00M.10", Acodec: strPtr("none"), Tbr: 2000.529},
			{FormatID: "30080", Height: 1080, FPS: 29.97, Vcodec: "avc1.640032", Acodec: strPtr("none"), Tbr: 3252.336},
		},
	}
}

func TestBilibiliCollapsesToFourQualities(t *testing.T) {
	got := BuildVideoFormats(bilibiliInfo(), false)
	want := []string{"1080P", "720P", "480P", "360P"}
	qualities := make([]string, len(got))
	for i, f := range got {
		qualities[i] = f.Quality
	}
	if !reflect.DeepEqual(qualities, want) {
		t.Fatalf("12 条格式应收成 4 个清晰度（曾经显示成 8 个）\ngot  %v\nwant %v", qualities, want)
	}
	// 每个清晰度只能出现一次
	seen := map[int]bool{}
	for _, f := range got {
		if seen[f.Height] {
			t.Fatalf("height %d 重复出现", f.Height)
		}
		seen[f.Height] = true
	}
}

func TestBilibiliKeepsAVC(t *testing.T) {
	got := ids(BuildVideoFormats(bilibiliInfo(), false))
	want := []string{"30080", "30064", "30032", "30016"} // 全是 avc1
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("同一清晰度应保留兼容性最好的编码（AVC 优先）\ngot  %v\nwant %v", got, want)
	}
}

// --- 编码优先级不能靠「码率恰好最高」蒙对 ---

func TestCodecPriorityNotByBitrate(t *testing.T) {
	// bilibili 上 AVC 恰好码率最高，所以「按码率取第一」也会选对 —— 那是运气。
	// 这里把 AV1 的码率调到最高：只有真正按编码兼容性排序才会选 AVC。
	info := FmtInfo{Formats: []RawFormat{
		{FormatID: "av1", Vcodec: "av01.0.00M.10", Height: 1080, FPS: 30, Acodec: strPtr("none"), Tbr: 9999},
		{FormatID: "hevc", Vcodec: "hev1.1.6.L150", Height: 1080, FPS: 30, Acodec: strPtr("none"), Tbr: 5000},
		{FormatID: "avc", Vcodec: "avc1.640032", Height: 1080, FPS: 30, Acodec: strPtr("none"), Tbr: 1000},
	}}
	got := ids(BuildVideoFormats(info, false))
	if !reflect.DeepEqual(got, []string{"avc"}) {
		t.Fatalf("应选 AVC（兼容性最好），got %v", got)
	}
}

// --- 去重必须依赖归一化后的 fps ---

func TestDedupeRequiresNormalizedFPS(t *testing.T) {
	// 只有两种编码、且没有 quality 标签可用时，用原始 fps 拼 key
	// 会把 29.969 与 29.97 当成两个档位，于是显示两条 1080P。
	info := FmtInfo{Formats: []RawFormat{
		{FormatID: "x1", Vcodec: "hev1.1.6.L150", Height: 1080, FPS: 29.969, Acodec: strPtr("none")},
		{FormatID: "x2", Vcodec: "avc1.640032", Height: 1080, FPS: 29.97, Acodec: strPtr("none")},
	}}
	got := BuildVideoFormats(info, false)
	if len(got) != 1 {
		t.Fatalf("应只剩 1 条，got %d 条：%v", len(got), ids(got))
	}
	if got[0].FormatID != "x2" {
		t.Fatalf("应保留 AVC（x2），got %s", got[0].FormatID)
	}
}

// --- 去重键不能退回 quality 字符串 ---

func TestDedupeKeyNotQualityLabel(t *testing.T) {
	// quality_label / format_note 是站点自报文案，同一 height 完全可能被标成
	// 「1080P」与「1080P60」，按标签拼 key 就会留下两条。按 height 才稳定。
	info := FmtInfo{Formats: []RawFormat{
		{FormatID: "lab1", Vcodec: "avc1", Height: 1080, FPS: 30, Acodec: strPtr("none"), FormatNote: "1080P"},
		{FormatID: "lab2", Vcodec: "hev1", Height: 1080, FPS: 30, Acodec: strPtr("none"), FormatNote: "1080P60"},
	}}
	if got := BuildVideoFormats(info, false); len(got) != 1 {
		t.Fatalf("应按 height 去重只剩 1 条，got %d 条：%v", len(got), ids(got))
	}
}

// --- 30fps 与 60fps 仍是两个不同选项 ---

func TestFpsTiersPreserved(t *testing.T) {
	info := FmtInfo{Formats: []RawFormat{
		{FormatID: "a", Vcodec: "avc1", Height: 1080, FPS: 30, Acodec: strPtr("none")},
		{FormatID: "b", Vcodec: "avc1", Height: 1080, FPS: 60, Acodec: strPtr("none")},
	}}
	got := ids(BuildVideoFormats(info, false))
	if !reflect.DeepEqual(got, []string{"b", "a"}) {
		t.Fatalf("30 与 60fps 应是两个选项，got %v", got)
	}
}

// ===== NormalizeFPS =====

func TestNormalizeFPSJitter(t *testing.T) {
	cases := map[float64]int{29.969: 30, 29.97: 30, 59.94: 60, 23.976: 24}
	for in, want := range cases {
		if got := NormalizeFPS(in); got != want {
			t.Errorf("NormalizeFPS(%v) = %d, want %d", in, got, want)
		}
	}
}

// 非档位 fps 必须**四舍五入**而不是截断。
//
// 这条不能用交叉验证代替：TS 侧也走 Math.round，两边一致地截断就「一致地错」，
// 交叉验证只看一致性、看不出正确性。这种「两边同错」只能靠独立断言的单测拦。
func TestNormalizeFPSRoundsNotTruncates(t *testing.T) {
	// 只用**不在任何档位容差内**的值：容差是 1，所以 29.4 会被归到 30，
	// 那样测不出 round 与 trunc 的区别。33.7 距 30 与 24 都超过 1，必须走 round 分支。
	cases := map[float64]int{
		33.7: 34, // round=34，截断=33 ← 能区分
		7.6:  8,  // round=8，截断=7 ← 能区分
		45.5: 46, // 距 48 差 2.5、距 30 差 15.5，走 round；半值向上
		93.2: 93, // 距 120 与 60 都很远；round=93，截断=93（不区分，确认不误伤）
	}
	for in, want := range cases {
		if got := NormalizeFPS(in); got != want {
			t.Errorf("NormalizeFPS(%v) = %d, want %d（应为四舍五入，不是截断）", in, got, want)
		}
	}
}

func TestNormalizeFPSUnknown(t *testing.T) {
	if got := NormalizeFPS(0); got != 0 {
		t.Errorf("0 表示没有信息，应保持 0，got %d", got)
	}
	if got := NormalizeFPS(15); got != 15 {
		t.Errorf("未知帧率保持原值，got %d", got)
	}
}

func containsStr(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}
