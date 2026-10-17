package download

import (
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// 本文件是 tests/ytdlp-args.test.ts 的逐条移植。
//
// 移植目的：重构期间「行为是否还是原来那个」必须可验证。逐条对照的好处是
// 任何一条失败都能直接对上 TS 侧的同名用例，不必重新推导语义。
//
// 输出路径一律用 filepath.Join 拼预期值，不写死 POSIX 路径——生产代码也是这么拼的，
// Windows 上得到反斜杠。写死会让用例只在类 Unix 通过（CI 的 windows job 抓到过）。

var outDir = filepath.Join("tmp", "out")

func baseOptions() Options {
	return Options{
		TaskID:       "t1",
		URL:          "https://example.com/v/1",
		FormatID:     "137",
		DownloadMode: "video",
	}
}

func baseCtx() BuildArgsContext {
	return BuildArgsContext{FfmpegLocation: "/opt/homebrew/bin"}
}

// valueAfter 取某个选项后面跟的值。
func valueAfter(args []string, flag string) (string, bool) {
	for i, a := range args {
		if a == flag && i+1 < len(args) {
			return args[i+1], true
		}
	}
	return "", false
}

func contains(args []string, want string) bool {
	for _, a := range args {
		if a == want {
			return true
		}
	}
	return false
}

// ===== BuildFormatSelector =====

func TestFormatSelectorAudioModeUsesSelectedFormat(t *testing.T) {
	// 音频模式直接使用所选格式，不做音视频合并
	o := baseOptions()
	o.DownloadMode = "audio"
	o.FormatID = "140"
	if got := BuildFormatSelector(o); got != "140" {
		t.Fatalf("got %q, want %q", got, "140")
	}
}

func TestFormatSelectorPrefersFormatWithAudio(t *testing.T) {
	// 已含音轨的格式优先原样下载
	o := baseOptions()
	o.HasAudio = true
	got := BuildFormatSelector(o)
	if !strings.HasPrefix(got, "137/") {
		t.Fatalf("应以 137/ 开头，got %q", got)
	}
	if !strings.Contains(got, "bv*+ba/b") {
		t.Fatalf("应包含兜底 bv*+ba/b，got %q", got)
	}
}

func TestFormatSelectorMergesBestAudio(t *testing.T) {
	// 无音轨时合并最佳音轨，且必须有兜底
	o := baseOptions()
	o.HasAudio = false
	got := BuildFormatSelector(o)
	if !strings.Contains(got, "137+bestaudio[ext=m4a]") {
		t.Fatalf("应包含 137+bestaudio[ext=m4a]，got %q", got)
	}
	if !strings.Contains(got, "bv*+ba/b") {
		t.Fatalf("必须有兜底，避免找不到 m4a 时整体失败，got %q", got)
	}
}

func TestFormatSelectorUsesLanguage(t *testing.T) {
	// 指定语言时按语言挑音轨
	o := baseOptions()
	o.HasAudio = false
	o.AudioTrack = &AudioTrack{Language: "ja"}
	if got := BuildFormatSelector(o); !strings.Contains(got, "bestaudio[language^=ja]") {
		t.Fatalf("应包含 bestaudio[language^=ja]，got %q", got)
	}
}

func TestFormatSelectorM3U8TrackUsesItsFormatID(t *testing.T) {
	// m3u8 音轨直接用其 formatId（无法与视频合并时）
	o := baseOptions()
	o.AudioTrack = &AudioTrack{FormatID: "hls-audio", IsM3U8: true}
	if got := BuildFormatSelector(o); got != "hls-audio" {
		t.Fatalf("got %q, want hls-audio", got)
	}
}

// ===== BuildArgs =====

func TestArgsContainProgressTemplates(t *testing.T) {
	// 包含结构化进度模板，供解析进度与最终路径
	args := BuildArgs(baseOptions(), outDir, baseCtx())
	var templates []string
	for i, a := range args {
		if i > 0 && args[i-1] == "--progress-template" {
			templates = append(templates, a)
		}
	}
	hasDvp, hasDvpp := false, false
	for _, tpl := range templates {
		if strings.Contains(tpl, "[dvp]") {
			hasDvp = true
		}
		if strings.Contains(tpl, "[dvpp]") {
			hasDvpp = true
		}
	}
	if !hasDvp || !hasDvpp {
		t.Fatalf("进度模板缺失：dvp=%v dvpp=%v", hasDvp, hasDvpp)
	}
	// --print 隐含 --quiet，必须显式带 --progress 才有进度输出
	if !contains(args, "--progress") {
		t.Fatal("必须包含 --progress（--print 隐含 --quiet，否则没有进度输出）")
	}
}

func TestArgsFfmpegLocationIsDirectory(t *testing.T) {
	// 传 ffmpeg 的目录而非文件路径（yt-dlp 会在该目录里同时找 ffmpeg 与 ffprobe）
	args := BuildArgs(baseOptions(), outDir, baseCtx())
	got, _ := valueAfter(args, "--ffmpeg-location")
	if got != "/opt/homebrew/bin" {
		t.Fatalf("got %q", got)
	}
}

func TestArgsOutputTemplateUsesFilenameTemplate(t *testing.T) {
	o := baseOptions()
	o.FilenameTmpl = "%(title)s-%(id)s"
	args := BuildArgs(o, outDir, baseCtx())
	got, _ := valueAfter(args, "-o")
	want := filepath.Join(outDir, "%(title)s-%(id)s.%(ext)s")
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestArgsCompleteTemplateNotDoubled(t *testing.T) {
	// 完整模板保留扩展名占位符，不重复追加
	o := baseOptions()
	o.FilenameTmpl = "%(title)s.%(ext)s"
	args := BuildArgs(o, outDir, baseCtx())
	got, _ := valueAfter(args, "-o")
	want := filepath.Join(outDir, "%(title)s.%(ext)s")
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestArgsAutoAppendsExtension(t *testing.T) {
	// 未设置模板时自动追加一次扩展名
	args := BuildArgs(baseOptions(), outDir, baseCtx())
	got, _ := valueAfter(args, "-o")
	want := filepath.Join(outDir, "%(title)s.%(ext)s")
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestArgsSubtitleMode(t *testing.T) {
	// 字幕模式：跳过下载、写字幕、转 srt，且不需要 ffmpeg
	o := baseOptions()
	o.DownloadMode = "subtitle"
	o.Subtitles = []string{"zh-Hans", "en"}
	ctx := baseCtx()
	ctx.FfmpegLocation = ""
	args := BuildArgs(o, outDir, ctx)

	for _, flag := range []string{"--skip-download", "--write-subs", "--convert-subs"} {
		if !contains(args, flag) {
			t.Fatalf("字幕模式缺少 %s", flag)
		}
	}
	if got, _ := valueAfter(args, "--sub-langs"); got != "zh-Hans,en" {
		t.Fatalf("--sub-langs got %q", got)
	}
	// 字幕不需要合并，传 ffmpeg 位置没有意义
	if contains(args, "--ffmpeg-location") {
		t.Fatal("字幕模式不该带 --ffmpeg-location")
	}
}

func TestArgsAudioMode(t *testing.T) {
	// 音频模式：转 mp3 且写入 id3v1 标签（兼容旧播放器）
	o := baseOptions()
	o.DownloadMode = "audio"
	args := BuildArgs(o, outDir, baseCtx())

	if !contains(args, "-x") || !contains(args, "--audio-format") {
		t.Fatal("音频模式缺少 -x / --audio-format")
	}
	if got, _ := valueAfter(args, "--audio-format"); got != "mp3" {
		t.Fatalf("--audio-format got %q", got)
	}
	if !contains(args, "--postprocessor-args") {
		t.Fatal("音频模式必须写 id3v1 标签")
	}
	// 音频模式不该再指定合并容器
	if contains(args, "--merge-output-format") {
		t.Fatal("音频模式不该带 --merge-output-format")
	}
}

func TestArgsVideoModeMergesToMP4(t *testing.T) {
	args := BuildArgs(baseOptions(), outDir, baseCtx())
	if got, _ := valueAfter(args, "--merge-output-format"); got != "mp4" {
		t.Fatalf("got %q, want mp4", got)
	}
}

func TestArgsVideoWithSubtitles(t *testing.T) {
	// 非字幕模式且选了字幕时，附带写字幕参数
	o := baseOptions()
	o.Subtitles = []string{"en"}
	args := BuildArgs(o, outDir, baseCtx())
	if !contains(args, "--write-subs") {
		t.Fatal("选了字幕就该写字幕")
	}
	if got, _ := valueAfter(args, "--sub-langs"); got != "en" {
		t.Fatalf("--sub-langs got %q", got)
	}
	if contains(args, "--skip-download") {
		t.Fatal("视频模式不该 --skip-download")
	}
}

func TestArgsProxyOnlyWhenSet(t *testing.T) {
	if contains(BuildArgs(baseOptions(), outDir, baseCtx()), "--proxy") {
		t.Fatal("未设置代理时不该带 --proxy")
	}
	o := baseOptions()
	o.Proxy = "http://127.0.0.1:7890"
	if got, _ := valueAfter(BuildArgs(o, outDir, baseCtx()), "--proxy"); got != "http://127.0.0.1:7890" {
		t.Fatalf("got %q", got)
	}
}

func TestArgsAria2OnlyForHTTP(t *testing.T) {
	// aria2 只接管 HTTP，保留原生 HLS/DASH 并隔离续传片段
	o := baseOptions()
	o.Acceleration = &Acceleration{Enabled: boolPtr(true), MaxConnections: 12}
	ctx := baseCtx()
	ctx.Aria2Path = `C:\tools with spaces\aria2c.exe`
	args := BuildArgs(o, outDir, ctx)

	if !contains(args, `http:C:\tools with spaces\aria2c.exe`) {
		t.Fatal("缺少 --downloader http:<aria2>")
	}
	if !contains(args, "dash,m3u8:native") {
		t.Fatal("HLS/DASH 必须保持原生")
	}
	da, _ := valueAfter(args, "--downloader-args")
	if !strings.Contains(da, "--max-connection-per-server=12 --split=12") {
		t.Fatalf("--downloader-args 缺连接数：%q", da)
	}
	if !strings.Contains(da, "--check-certificate=true") {
		t.Fatal("--downloader-args 缺 --check-certificate=true")
	}
	if got, _ := valueAfter(args, "--concurrent-fragments"); got != "12" {
		t.Fatalf("--concurrent-fragments got %q", got)
	}
	// aria2 模式下输出模板不带目录（目录由 --paths 分开指定）
	if got, _ := valueAfter(args, "-o"); got != "%(title)s.%(ext)s" {
		t.Fatalf("-o got %q，aria2 模式下应为纯模板", got)
	}
	if !contains(args, "temp:"+filepath.Join(outDir, ".downvid-aria2")) {
		t.Fatal("必须隔离 aria2 稀疏片段目录")
	}
}

func TestArgsNoExternalEngineWhenDisabled(t *testing.T) {
	// 关闭加速、未发现 aria2 或字幕模式不调用外部引擎
	disabled := baseOptions()
	disabled.Acceleration = &Acceleration{Enabled: boolPtr(false), MaxConnections: 16}
	ctx := baseCtx()
	ctx.Aria2Path = "/bin/aria2c"
	dArgs := BuildArgs(disabled, outDir, ctx)
	if contains(dArgs, "--downloader") {
		t.Fatal("关闭加速时不该调用外部引擎")
	}
	if got, _ := valueAfter(dArgs, "--concurrent-fragments"); got != "1" {
		t.Fatalf("关闭加速时 --concurrent-fragments 应为 1，got %q", got)
	}
	if contains(BuildArgs(baseOptions(), outDir, baseCtx()), "--downloader") {
		t.Fatal("未发现 aria2 时不该调用外部引擎")
	}
	sub := baseOptions()
	sub.DownloadMode = "subtitle"
	if contains(BuildArgs(sub, outDir, ctx), "--downloader") {
		t.Fatal("字幕模式不该调用外部引擎")
	}
}

func TestArgsJSRuntimeForYouTube(t *testing.T) {
	// YouTube 带 JS 运行时参数；node 与 deno 用不同前缀
	yt := baseOptions()
	yt.URL = "https://www.youtube.com/watch?v=x"

	ctx := baseCtx()
	ctx.JSRuntime = &JSRuntime{Path: "/usr/bin/node", Kind: "node"}
	if got, _ := valueAfter(BuildArgs(yt, outDir, ctx), "--js-runtimes"); got != "node:/usr/bin/node" {
		t.Fatalf("got %q", got)
	}

	ctx.JSRuntime = &JSRuntime{Path: "/usr/bin/deno", Kind: "deno"}
	if got, _ := valueAfter(BuildArgs(yt, outDir, ctx), "--js-runtimes"); got != "deno:/usr/bin/deno" {
		t.Fatalf("got %q", got)
	}
}

func TestArgsNoJSRuntimeOutsideYouTube(t *testing.T) {
	ctx := baseCtx()
	ctx.JSRuntime = &JSRuntime{Path: "/usr/bin/node", Kind: "node"}
	if contains(BuildArgs(baseOptions(), outDir, ctx), "--js-runtimes") {
		t.Fatal("非 YouTube 不该带 --js-runtimes")
	}
}

func TestArgsSingleVideoNotPlaylist(t *testing.T) {
	// 单集下载：不跟播放列表
	args := BuildArgs(baseOptions(), outDir, baseCtx())
	if !contains(args, "--no-playlist") {
		t.Fatal("必须带 --no-playlist")
	}
	if got, _ := valueAfter(args, "--playlist-items"); got != "1" {
		t.Fatalf("--playlist-items got %q", got)
	}
}

// ===== 分块请求（下载速度的关键）=====

func TestChunkSizeAlwaysPresent(t *testing.T) {
	if !contains(BuildArgs(baseOptions(), outDir, baseCtx()), "--http-chunk-size") {
		t.Fatal("必须始终带 --http-chunk-size")
	}
}

func TestChunkSizeFormat(t *testing.T) {
	// 分块大小是正数且带单位（yt-dlp 需要 10M 这类写法）
	size, _ := valueAfter(BuildArgs(baseOptions(), outDir, baseCtx()), "--http-chunk-size")
	if !regexp.MustCompile(`^\d+[KMG]$`).MatchString(size) {
		t.Fatalf("分块大小格式不对：%q", size)
	}
}

func TestChunkSizeInSubtitleMode(t *testing.T) {
	// 字幕模式也带分块（下载字幕文件同样受单连接限速影响）
	o := baseOptions()
	o.DownloadMode = "subtitle"
	o.Subtitles = []string{"en"}
	ctx := baseCtx()
	ctx.FfmpegLocation = ""
	if !contains(BuildArgs(o, outDir, ctx), "--http-chunk-size") {
		t.Fatal("字幕模式也必须带 --http-chunk-size")
	}
}

func TestChunkSizeInAudioMode(t *testing.T) {
	o := baseOptions()
	o.DownloadMode = "audio"
	if !contains(BuildArgs(o, outDir, ctx2()), "--http-chunk-size") {
		t.Fatal("音频模式也必须带 --http-chunk-size")
	}
}

func ctx2() BuildArgsContext { return baseCtx() }
