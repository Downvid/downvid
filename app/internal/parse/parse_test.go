package parse

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// 解析器的测试：**真起进程**（用 shell 脚本扮 yt-dlp）。
//
// 为什么不用 mock：这层要验证的恰好是「子进程的输出怎么到我们手里」——
// 多行 JSON 只取第一行、stdout/stderr 分流、超时、退出码。
// mock 掉这些等于什么都没测。

func fakeYtdlp(t *testing.T, script string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("用 shell 脚本做夹具，Windows 上跳过")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "fake-ytdlp")
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+script), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

// 一份真实形状的 info JSON（bilibili 三编码 + 浮点 fps）
const sampleJSON = `{"id":"BV1xx","title":"测试视频","uploader":"UP主","duration":754,"thumbnail":"http://t.jpg","webpage_url":"https://www.bilibili.com/video/BV1xx",
"formats":[
 {"format_id":"30077","vcodec":"hev1.1.6.L150","acodec":"none","height":1080,"fps":29.969,"tbr":2070},
 {"format_id":"100026","vcodec":"av01.0.00M.10","acodec":"none","height":1080,"fps":29.969,"tbr":2000},
 {"format_id":"30080","vcodec":"avc1.640032","acodec":"none","height":1080,"fps":29.97,"tbr":3252}
]}`

func TestParseBilibiliRealShape(t *testing.T) {
	// 用 printf 而不是 echo：sampleJSON 里有换行，echo 会输出多行，
	// 而真实的 `yt-dlp --dump-json` 输出的 JSON 是**单行**。
	// 夹具要贴近真实，否则测的是「多行 JSON 能不能拼」而不是真场景。
	fake := fakeYtdlp(t, "printf '%s\\n' '"+oneLine(sampleJSON)+"'\nexit 0\n")

	p := NewParser()
	info, err := p.Parse(ParseOptions{
		YtdlpPath: fake,
		URL:       "https://www.bilibili.com/video/BV1xx",
		CacheDir:  t.TempDir(),
		Timeout:   10 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}

	if info.Title != "测试视频" || info.Uploader != "UP主" {
		t.Fatalf("got %+v", info)
	}
	// 三编码应去重成 1 条，且选 AVC（这是曾经显示「两个 1080P」的那个 bug）
	if len(info.Formats) != 1 {
		t.Fatalf("应去重成 1 条，got %d", len(info.Formats))
	}
	if info.Formats[0].FormatID != "30080" {
		t.Fatalf("应保留 AVC（30080），got %s", info.Formats[0].FormatID)
	}
	if info.IsYoutube {
		t.Fatal("bilibili 不该标成 youtube")
	}
	// 原始 JSON 要落盘（下载时 --load-info-json 用）
	if info.CacheFile == "" {
		t.Fatal("应写出 cacheFile")
	}
	if _, err := os.Stat(info.CacheFile); err != nil {
		t.Fatalf("cacheFile 应真实存在：%v", err)
	}
}

// 播放列表会逐行输出多个 JSON，只取第一个（用户点的那条）
func TestParseTakesFirstJSONLine(t *testing.T) {
	first := `{"id":"A","title":"第一个"}`
	second := `{"id":"B","title":"第二个"}`
	fake := fakeYtdlp(t, "printf '%s\\n' '"+first+"'\nprintf '%s\\n' '"+second+"'\nexit 0\n")

	info, err := NewParser().Parse(ParseOptions{
		YtdlpPath: fake, URL: "https://x/v", CacheDir: t.TempDir(), Timeout: 10 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	if info.ID != "A" || info.Title != "第一个" {
		t.Fatalf("应取第一行，got %+v", info)
	}
}

// 失败时错误消息必须带标记（前端据此显示可行动提示）
func TestParseErrorHasMarker(t *testing.T) {
	fake := fakeYtdlp(t, "echo 'ERROR: Unsupported URL: https://x' >&2\nexit 1\n")

	_, err := NewParser().Parse(ParseOptions{
		YtdlpPath: fake, URL: "https://x/v", CacheDir: t.TempDir(), Timeout: 10 * time.Second,
	})
	if err == nil {
		t.Fatal("应返回错误")
	}
	if !strings.Contains(err.Error(), "[[parse-error:") {
		t.Fatalf("错误消息应带 [[parse-error:xxx]] 标记，got %q", err.Error())
	}
	if !strings.Contains(err.Error(), "unsupported-url") {
		t.Fatalf("应分类为 unsupported-url，got %q", err.Error())
	}
}

// 缺 yt-dlp 时给出可行动提示
func TestParseWithoutYtdlp(t *testing.T) {
	_, err := NewParser().Parse(ParseOptions{URL: "https://x/v"})
	if err == nil {
		t.Fatal("缺 yt-dlp 应报错")
	}
	if !strings.Contains(err.Error(), "[[deps-missing:yt-dlp]]") {
		t.Fatalf("应带 deps-missing 标记，got %q", err.Error())
	}
}

// 输出不是合法 JSON 时要报错，而不是返回空结果
func TestParseInvalidJSON(t *testing.T) {
	fake := fakeYtdlp(t, "echo 'not json at all'\nexit 0\n")
	_, err := NewParser().Parse(ParseOptions{
		YtdlpPath: fake, URL: "https://x/v", CacheDir: t.TempDir(), Timeout: 10 * time.Second,
	})
	if err == nil {
		t.Fatal("非法 JSON 应报错（返回空结果会让界面显示空白而无提示）")
	}
}

// 缓存：同一 URL 第二次不该再起进程
func TestParseCachesResult(t *testing.T) {
	// 脚本写一个标记文件，第二次调用时如果又跑了会追加内容
	dir := t.TempDir()
	marker := filepath.Join(dir, "runs.txt")
	fake := fakeYtdlp(t, "echo run >> '"+marker+"'\nprintf '%s\n' '"+oneLine(sampleJSON)+"'\nexit 0\n")

	p := NewParser()
	opts := ParseOptions{
		YtdlpPath: fake, URL: "https://www.bilibili.com/video/BV1xx",
		CacheDir: t.TempDir(), Timeout: 10 * time.Second,
	}

	if _, err := p.Parse(opts); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Parse(opts); err != nil {
		t.Fatal(err)
	}

	data, _ := os.ReadFile(marker)
	if n := strings.Count(string(data), "run"); n != 1 {
		t.Fatalf("第二次应命中缓存（只跑 1 次进程），实际跑了 %d 次", n)
	}
}

// 缓存有**条数上限**：只按 TTL 清理会让内存一直涨
func TestParseCacheHasEntryLimit(t *testing.T) {
	p := NewParser()
	// 直接灌 70 条（超过 cacheMax=60），验证会被淘汰
	for i := 0; i < 70; i++ {
		p.toCache(strings.Repeat("x", i+1), &VideoInfo{ID: string(rune('a' + i%26))})
	}
	p.mu.Lock()
	n := len(p.cache)
	p.mu.Unlock()

	if n > cacheMax {
		t.Fatalf("缓存应被限制在 %d 条内，实际 %d 条", cacheMax, n)
	}
}

// 多音轨：多个语言的 m3u8 音轨时按语言各取一条
func TestBuildAudioTracksFromM3U8(t *testing.T) {
	formats := []rawFormat{
		{FormatID: "ja-1", Vcodec: "none", Acodec: "aac", Protocol: "m3u8_native", Language: "ja", Height: 720},
		{FormatID: "ja-2", Vcodec: "none", Acodec: "aac", Protocol: "m3u8_native", Language: "ja", Height: 1080},
		{FormatID: "en-1", Vcodec: "none", Acodec: "aac", Protocol: "m3u8_native", Language: "en", Height: 720},
	}
	got := buildAudioTracks(formats)
	if len(got) != 2 {
		t.Fatalf("应得到 2 条音轨（ja/en），got %d", len(got))
	}
	// 每种语言取最高分辨率
	for _, tr := range got {
		if tr.Language == "ja" && tr.FormatID != "ja-2" {
			t.Fatalf("ja 应取 1080 那条，got %s", tr.FormatID)
		}
		if !tr.IsM3U8 {
			t.Fatal("m3u8 音轨应标记 IsM3U8")
		}
	}
}

// 纯音频格式按码率降序，最多 6 条，且同一码率只留一条
func TestBuildAudioFormats(t *testing.T) {
	formats := []rawFormat{
		{FormatID: "a1", Vcodec: "none", Acodec: "aac", ABR: 128},
		{FormatID: "a2", Vcodec: "none", Acodec: "aac", ABR: 128}, // 同码率，应去重
		{FormatID: "a3", Vcodec: "none", Acodec: "opus", ABR: 160},
		{FormatID: "v1", Vcodec: "h264", Acodec: "aac", ABR: 128}, // 有视频，跳过
	}
	got := buildAudioFormats(formats)
	if len(got) != 2 {
		t.Fatalf("应得到 2 条（128 去重 + 160），got %d", len(got))
	}
	if got[0].ABR != 160 {
		t.Fatalf("应按码率降序，首条应为 160，got %v", got[0].ABR)
	}
}

// 字幕：map 迭代顺序随机，输出必须稳定排序
func TestBuildSubtitlesSorted(t *testing.T) {
	subs := map[string]any{
		"zh-Hans": []any{map[string]any{"name": "中文（简体）", "url": "http://s/zh"}},
		"en":      []any{map[string]any{"name": "English", "url": "http://s/en"}},
	}
	got := buildSubtitles(subs)
	if len(got) != 2 {
		t.Fatalf("got %d", len(got))
	}
	if got[0].Language != "en" || got[1].Language != "zh-Hans" {
		t.Fatalf("应按语言排序，got %v, %v", got[0].Language, got[1].Language)
	}
	if got[0].Name != "English" || got[0].URL != "http://s/en" {
		t.Fatalf("got %+v", got[0])
	}
}

// CleanupTempFiles 要把落盘的 JSON 删掉（否则 /tmp 会一直堆）
func TestCleanupTempFiles(t *testing.T) {
	// 用 printf 而不是 echo：sampleJSON 里有换行，echo 会输出多行，
	// 而真实的 `yt-dlp --dump-json` 输出的 JSON 是**单行**。
	// 夹具要贴近真实，否则测的是「多行 JSON 能不能拼」而不是真场景。
	fake := fakeYtdlp(t, "printf '%s\\n' '"+oneLine(sampleJSON)+"'\nexit 0\n")
	dir := t.TempDir()

	p := NewParser()
	info, err := p.Parse(ParseOptions{
		YtdlpPath: fake, URL: "https://www.bilibili.com/video/BV1xx",
		CacheDir: dir, Timeout: 10 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(info.CacheFile); err != nil {
		t.Fatalf("清理前文件应存在：%v", err)
	}

	p.CleanupTempFiles()
	if _, err := os.Stat(info.CacheFile); !os.IsNotExist(err) {
		t.Fatal("清理后文件应被删除")
	}
}

// oneLine 把多行 JSON 压成单行（真实 yt-dlp 的 --dump-json 输出就是单行）。
func oneLine(s string) string {
	var b strings.Builder
	for _, line := range strings.Split(s, "\n") {
		b.WriteString(strings.TrimSpace(line))
	}
	return b.String()
}
