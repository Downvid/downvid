package main

// 无头验证 Wails 绑定方法本身。
//
// 窗口渲染由前端构建产物 + 手动启动验证；这里验证**业务侧**——
// 绑定方法签名改了或被误改时，编译期就红，比等人工点一遍可靠。
import (
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/Downvid/downvid/app/internal/changelog"
	"github.com/Downvid/downvid/app/internal/download"
	"github.com/Downvid/downvid/app/internal/history"
	"github.com/Downvid/downvid/app/internal/update"
)

// newTestApp 造一个指向临时目录的 App，不启动 Wails。
func newTestApp(t *testing.T) *App {
	t.Helper()
	dir := t.TempDir()
	app := NewApp()
	app.dataDir = dir
	app.downloadsDir = filepath.Join(dir, "dl")
	app.historyPath = filepath.Join(dir, "download-history.json")
	if err := os.MkdirAll(app.downloadsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	return app
}

func TestBindingsBasicInfo(t *testing.T) {
	app := newTestApp(t)
	if app.GetVersion() == "" {
		t.Fatal("版本号不该为空")
	}
	if app.GetPlatform() == "" {
		t.Fatal("平台不该为空")
	}
	if app.GetDataDir() != app.dataDir {
		t.Fatal("GetDataDir 应返回注入的目录")
	}
	if app.GetDefaultDownloadDir() != app.downloadsDir {
		t.Fatal("GetDefaultDownloadDir 应返回注入的目录")
	}
}

func TestBindingsHistoryRoundTrip(t *testing.T) {
	app := newTestApp(t)

	if got := app.HistoryGet(); len(got) != 0 {
		t.Fatalf("初始应为空，got %d", len(got))
	}

	if !app.HistoryAdd(history.Record{Title: "标题1", FilePath: "/x/1.mp4", URL: "u", Format: "mp4"}) {
		t.Fatal("添加应成功")
	}

	got := app.HistoryGet()
	if len(got) != 1 || got[0].Title != "标题1" {
		t.Fatalf("got %+v", got)
	}
	// 不存在的文件要标记出来——这是「文件已删」提示的依据
	if got[0].FileExists == nil || *got[0].FileExists {
		t.Fatal("不存在的文件应标记 fileExists=false")
	}

	if !app.HistoryDelete(got[0].ID) {
		t.Fatal("删除应成功")
	}
	if got := app.HistoryGet(); len(got) != 0 {
		t.Fatalf("删除后应为空，got %d", len(got))
	}
}

// 同一个文件反复添加只保留一条，且沿用原 id（与 internal/history 的规则一致）。
func TestBindingsHistoryUpsert(t *testing.T) {
	app := newTestApp(t)

	app.HistoryAdd(history.Record{Title: "第一次", FilePath: "/x/same.mp4"})
	first := app.HistoryGet()
	if len(first) != 1 {
		t.Fatalf("got %d", len(first))
	}

	app.HistoryAdd(history.Record{Title: "第二次", FilePath: "/x/same.mp4"})
	second := app.HistoryGet()
	if len(second) != 1 {
		t.Fatalf("同一文件应只有一条，got %d", len(second))
	}
	if second[0].ID != first[0].ID {
		t.Fatal("应沿用原 id（重下不该变成新记录）")
	}
	if second[0].Title != "第二次" {
		t.Fatalf("标题应更新，got %q", second[0].Title)
	}
}

func TestBindingsHistoryClear(t *testing.T) {
	app := newTestApp(t)
	app.HistoryAdd(history.Record{Title: "a", FilePath: "/x/a.mp4"})
	app.HistoryAdd(history.Record{Title: "b", FilePath: "/x/b.mp4"})
	if got := app.HistoryGet(); len(got) != 2 {
		t.Fatalf("got %d", len(got))
	}
	if !app.HistoryClear() {
		t.Fatal("清空应成功")
	}
	if got := app.HistoryGet(); len(got) != 0 {
		t.Fatalf("清空后应为空，got %d", len(got))
	}
}

// 空 filePath 要拒绝：否则历史里会多出无法打开的条目。
func TestBindingsHistoryRejectsEmptyPath(t *testing.T) {
	app := newTestApp(t)
	if app.HistoryAdd(history.Record{Title: "无路径"}) {
		t.Fatal("空 filePath 应被拒绝")
	}
}

func TestBindingBuildFormatsDedupes(t *testing.T) {
	app := newTestApp(t)
	// bilibili 三编码 + 浮点 fps：应去重成 1 条并选 AVC
	// （这正是曾经显示「两个 1080P」的那个 bug）
	info := `{"formats":[
		{"format_id":"hevc","vcodec":"hev1.1.6.L150","height":1080,"fps":29.969,"acodec":"none","tbr":2070},
		{"format_id":"av1","vcodec":"av01.0.00M.10","height":1080,"fps":29.969,"acodec":"none","tbr":2000},
		{"format_id":"avc","vcodec":"avc1.640032","height":1080,"fps":29.97,"acodec":"none","tbr":3252}
	]}`

	formats, err := app.BuildFormatsFromJSON(info, false, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(formats) != 1 {
		t.Fatalf("应去重成 1 条，got %d", len(formats))
	}
	if formats[0].FormatID != "avc" {
		t.Fatalf("应保留 AVC（兼容性最好），got %s", formats[0].FormatID)
	}
}

func TestBindingBuildFormatsRejectsBadJSON(t *testing.T) {
	app := newTestApp(t)
	if _, err := app.BuildFormatsFromJSON("not json", false, false); err == nil {
		t.Fatal("坏 JSON 应报错，而不是返回空列表（空列表会让界面显示「无可选格式」）")
	}
}

func TestBindingDiagnosticRedactsSecrets(t *testing.T) {
	app := newTestApp(t)
	raw := "ERROR: Requested format is not available https://x/?token=secret /private/local-file"

	if kind := app.ClassifyError(raw); kind != "format-unavailable" {
		t.Fatalf("got %s", kind)
	}

	diag := app.Diagnostic(raw, "2026.10.10.233141", "node@22.0.0")
	for _, leak := range []string{"secret", "https://", "/private"} {
		if strings.Contains(diag, leak) {
			t.Fatalf("诊断泄露了 %q：\n%s", leak, diag)
		}
	}
	if !strings.Contains(diag, "2026.10.10.233141") {
		t.Fatalf("诊断应保留版本号：\n%s", diag)
	}
}

func TestBindingShouldOfferIssue(t *testing.T) {
	app := newTestApp(t)
	// 用户自己能解决的：不该给 Issue 入口
	if app.ShouldOfferIssue("authentication") {
		t.Fatal("authentication 不该提示提 Issue")
	}
	// 可能对应真实回归：必须给入口
	if !app.ShouldOfferIssue("page-reload") {
		t.Fatal("page-reload 必须保留 Issue 入口（历史上 #50 就是它）")
	}
	// 未分类保守给入口
	if !app.ShouldOfferIssue("") {
		t.Fatal("未分类错误应给 Issue 入口")
	}
}

// 数据目录必须与 Electron 的 app.getPath('userData') 一致。
//
// 大小写错了同样会让数据「消失」（macOS 上大小写不敏感，Linux 上敏感），
// 而这在任何测试里都看不出来——所以单独钉住。
func TestResolveDataDirMatchesElectron(t *testing.T) {
	got := resolveDataDir()
	if got == "" {
		t.Fatal("不该为空")
	}
	// 末段必须是 downvid（package.json 的 name），不是显示名 DownVid
	if filepath.Base(got) != "downvid" {
		t.Fatalf("末段应为 downvid（与 package.json name 一致），got %q", got)
	}
}

// allowManifests 参数必须真的生效，不能「传了但被忽略」。
//
// 变异「BuildFormats 忽略 allowManifests（恒传 true）」在补这条之前**没被检出**——
// 因为原有用例只测了 false 分支。这类「参数被吞掉」的问题不会报错，
// 只会让 YouTube 的流格式回退行为与 TS 版不一致。
func TestBindingBuildFormatsHonorsAllowManifests(t *testing.T) {
	app := newTestApp(t)
	// 只有 m3u8 的清晰度
	info := `{"formats":[{"format_id":"hls","vcodec":"h264","acodec":"aac","height":720,"protocol":"m3u8_native"}]}`

	// 不允许 manifest：YouTube 上该被过滤掉 → 无可用格式 → 走兜底
	blocked, err := app.BuildFormatsFromJSON(info, true, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range blocked {
		if f.FormatID == "hls" {
			t.Fatal("allowManifests=false 时不该保留仅有的 m3u8")
		}
	}

	// 允许 manifest：应保留
	allowed, err := app.BuildFormatsFromJSON(info, true, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(allowed) != 1 || allowed[0].FormatID != "hls" {
		t.Fatalf("allowManifests=true 时应保留 hls，got %+v", allowed)
	}
}

// ===== 下载绑定 =====

// 缺 yt-dlp 时必须给出**可行动**的提示，并带上 missingKind 让前端弹一键下载。
//
// 返回空指针或空字符串会让界面卡在「下载中」——那比报错更难排查。
func TestStartDownloadWithoutYtdlp(t *testing.T) {
	app := newTestApp(t)
	app.runner = download.NewRunner()

	depsCacheMu.Lock()
	oldCache, oldAt := depsCache, depsCachedAt
	depsCache = []Dependency{}
	depsCachedAt = time.Now()
	depsCacheMu.Unlock()
	defer func() {
		depsCacheMu.Lock()
		depsCache, depsCachedAt = oldCache, oldAt
		depsCacheMu.Unlock()
	}()

	res := app.StartDownload(DownloadRequest{
		TaskID: "t1", URL: "https://example.com/v", FormatID: "137", OutputDir: t.TempDir(),
	})
	if res.OK {
		t.Fatal("没有 yt-dlp 时不该报告成功")
	}
	if res.Error == "" {
		t.Fatal("必须给出错误说明")
	}
	if res.MissingKind != "yt-dlp" {
		t.Fatalf("应带 missingKind=yt-dlp（前端据此弹「一键下载」），got %q", res.MissingKind)
	}
}

// 「找到了但版本过旧」不能报成「没找到」。
//
// 两者此前都返回 deps-missing：检测页明明写着「版本过旧」，解析却说
// 「未找到可用的 yt-dlp」。用户按提示重新下载也解决不了，因为真正缺的
// 不是安装，而是可用的新版。这里钉住两条出口各自的措辞与标记。
func TestStaleYtdlpMessage(t *testing.T) {
	app := newTestApp(t)
	app.runner = download.NewRunner()

	depsCacheMu.Lock()
	oldCache, oldAt := depsCache, depsCachedAt
	depsCache = []Dependency{{
		Kind: "yt-dlp", Found: false, Stale: true, Version: "2026.10.21",
		Reason: "版本过旧（当前 2026.10.21，需要 2026.10.23.233055 或更新）",
	}}
	depsCachedAt = time.Now()
	depsCacheMu.Unlock()
	defer func() {
		depsCacheMu.Lock()
		depsCache, depsCachedAt = oldCache, oldAt
		depsCacheMu.Unlock()
	}()

	// 下载入口：给人看的话里不能残留标记，且必须说明是「过旧」
	res := app.StartDownload(DownloadRequest{
		TaskID: "t1", URL: "https://example.com/v", FormatID: "137", OutputDir: t.TempDir(),
	})
	if res.OK {
		t.Fatal("yt-dlp 过旧时不该报告成功")
	}
	if !strings.Contains(res.Error, "版本过旧") {
		t.Fatalf("应说明是版本过旧，got %q", res.Error)
	}
	if strings.Contains(res.Error, "[[") {
		t.Fatalf("下载错误里不该出现内部标记，got %q", res.Error)
	}
	if res.MissingKind != "yt-dlp" {
		t.Fatalf("MissingKind 应仍为 yt-dlp（前端据此打开依赖面板），got %q", res.MissingKind)
	}

	// 解析入口：带 deps-stale 标记，前端才能把它与「没装」区分开
	if _, err := app.Parse("https://www.youtube.com/watch?v=abcdefghijk", ""); err == nil {
		t.Fatal("应返回错误")
	} else if !strings.Contains(err.Error(), "[[deps-stale:yt-dlp]]") {
		t.Fatalf("解析错误应带 deps-stale 标记，got %q", err.Error())
	}
}

// 缺 taskId / url 时立刻拒绝。
func TestStartDownloadValidatesInput(t *testing.T) {
	app := newTestApp(t)
	app.runner = download.NewRunner()

	for _, req := range []DownloadRequest{
		{URL: "https://x"}, // 缺 taskId
		{TaskID: "t1"},     // 缺 url
		{},                 // 都缺
	} {
		if res := app.StartDownload(req); res.OK {
			t.Fatalf("参数不全应拒绝：%+v", req)
		}
	}
}

// PauseDownload 对不存在的任务返回 false（而不是 panic）。
func TestPauseDownloadUnknownTask(t *testing.T) {
	app := newTestApp(t)
	app.runner = download.NewRunner()
	if app.PauseDownload("nope") {
		t.Fatal("不存在的任务应返回 false")
	}
}

// 平台的目录键必须与 electron 侧的命名一致。
//
// 不一致的话边车在打包产物里找不到，表现是「依赖一直显示未找到」。
func TestPlatformKeyMatchesElectronNaming(t *testing.T) {
	key := platformKey()
	switch runtime.GOOS {
	case "darwin":
		if !strings.HasPrefix(key, "darwin-") {
			t.Fatalf("macOS 的键应以 darwin- 开头，got %q", key)
		}
		if strings.HasSuffix(key, "amd64") {
			t.Fatal("macOS 上应写 x64 而不是 amd64（与 backend/build 的目录名一致）")
		}
	case "linux":
		if !strings.HasPrefix(key, "linux-") {
			t.Fatalf("Linux 的键应以 linux- 开头，got %q", key)
		}
		if strings.HasSuffix(key, "amd64") {
			t.Fatal("Linux 上应写 x64 而不是 amd64")
		}
	case "windows":
		// **关键**：Node 用 win32，Go 用 windows。直接透传会找不到边车。
		if !strings.HasPrefix(key, "win32-") {
			t.Fatalf("Windows 的键必须以 win32- 开头（Node 的命名），got %q", key)
		}
	}
}

// TestAudioTrackReachesBuildArgs 音轨选择必须真的进到 yt-dlp 参数里。
//
// 回归背景：前端一直有「音轨」选择器，`download.Options.AudioTrack` 也支持，
// 但 `DownloadRequest` 里**没有这个字段**——断点在中间那一层映射上。
// 表现是「选了日语，下下来还是默认音轨」，而且没有任何提示，
// 因为后端压根没收到这个选择。
func TestAudioTrackReachesBuildArgs(t *testing.T) {
	// 1) nil 保持不变（走默认 bestaudio）
	if got := toDownloadAudioTrack(nil); got != nil {
		t.Fatalf("nil 应原样返回 nil，实际 %+v", got)
	}

	// 2) 字段逐个传过去。这里刻意用**非 m3u8**：m3u8 分支会直接用自己的
	//    format id、根本不看语言，用它验不出「语言有没有传过去」。
	got := toDownloadAudioTrack(&DownloadAudioTrack{
		FormatID: "251-3", Language: "ja", IsM3U8: false,
	})
	if got == nil {
		t.Fatal("非 nil 输入不该得到 nil")
	}
	if got.FormatID != "251-3" || got.Language != "ja" || got.IsM3U8 {
		t.Fatalf("字段没传全：%+v", got)
	}

	// 3) 走**真实入口**：`buildArgs` 是 StartDownload 用的那一段映射。
	//
	// 早先这段用例直接调 `download.BuildArgs(... AudioTrack: got)`，
	// 于是它只验证了 download 包——把 `StartDownload` 里的
	// `toDownloadAudioTrack(...)` 改成 nil，用例照样通过（变异验证抓到的）。
	// 现在从 DownloadRequest 进、到参数出，中间不能有断点。
	app := NewApp()
	app.dataDir = t.TempDir()

	args := app.buildArgs(DownloadRequest{
		TaskID: "t", URL: "https://youtu.be/x", FormatID: "137", DownloadMode: "video",
		OutputDir:  t.TempDir(),
		AudioTrack: &DownloadAudioTrack{FormatID: "251-3", Language: "ja"},
	})
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "language^=ja") {
		t.Fatalf("音轨语言没有进到格式选择器（请求里的音轨没被传下去）：%s", joined)
	}

	// 4) m3u8 音轨要**直接**用它的 format id，而不是走 bestaudio 选择器
	argsM3U8 := app.buildArgs(DownloadRequest{
		TaskID: "t", URL: "https://youtu.be/x", FormatID: "137", DownloadMode: "video",
		OutputDir:  t.TempDir(),
		AudioTrack: &DownloadAudioTrack{FormatID: "hls-audio", Language: "ja", IsM3U8: true},
	})
	if !strings.Contains(strings.Join(argsM3U8, " "), "hls-audio") {
		t.Fatalf("m3u8 音轨应直接用自己的 format id：%s", strings.Join(argsM3U8, " "))
	}
}

// TestDirectFilename 直链路径的文件名规则。
//
// 两条路径（yt-dlp / 直链）必须产出**同样风格**的文件名，否则同一个视频
// 从不同平台下出来是两种命名，用户会当成两份东西。
//
// 这里重点钉住两个安全/正确性细节：
//   - 模板是用户可编辑的，`../` 不能写到下载目录之外
//   - 模板里没写扩展名时要补上（与 yt-dlp 路径同一规则）
func TestDirectFilename(t *testing.T) {
	cases := []struct {
		name     string
		template string
		opts     DownloadRequest
		want     string
	}{
		{
			name:     "默认模板",
			template: "%(title)s.%(ext)s",
			opts:     DownloadRequest{Title: "猫咪视频", TaskID: "t1"},
			want:     "猫咪视频.mp4",
		},
		{
			name:     "音频模式用 m4a",
			template: "%(title)s.%(ext)s",
			opts:     DownloadRequest{Title: "播客", TaskID: "t1", DownloadMode: "audio"},
			want:     "播客.m4a",
		},
		{
			name:     "模板没写扩展名时补上",
			template: "%(title)s",
			opts:     DownloadRequest{Title: "标题", TaskID: "t1"},
			want:     "标题.mp4",
		},
		{
			name:     "含 id 的模板",
			template: "%(title)s-%(id)s.%(ext)s",
			opts:     DownloadRequest{Title: "标题", TaskID: "abc123"},
			want:     "标题-abc123.mp4",
		},
		{
			name:     "标题为空时用 taskId 兜底（不能产生空文件名）",
			template: "%(title)s.%(ext)s",
			opts:     DownloadRequest{Title: "", TaskID: "fallback"},
			want:     "fallback.mp4",
		},
		{
			name:     "路径分隔符必须被替换（模板可被用户改成 ../evil）",
			template: "../%(title)s.%(ext)s",
			opts:     DownloadRequest{Title: "x", TaskID: "t1"},
			want:     "..-x.mp4",
		},
		{
			name:     "反斜杠同样要替换（Windows 路径分隔符）",
			template: "..\\%(title)s.%(ext)s",
			opts:     DownloadRequest{Title: "x", TaskID: "t1"},
			want:     "..-x.mp4",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := directFilename(c.template, c.opts)
			if got != c.want {
				t.Fatalf("directFilename(%q) = %q，期望 %q", c.template, got, c.want)
			}
			// 无论模板怎么写，产物都必须留在下载目录里
			if strings.ContainsAny(got, `/\`) {
				t.Fatalf("文件名里还有路径分隔符：%q", got)
			}
		})
	}
}

// TestStartDownloadDirectDoesNotRequireYtdlp 直链路径不该被 yt-dlp 缺失挡住。
//
// 抖音/快手的直链下载完全不经过 yt-dlp。如果这里仍然要求 yt-dlp，
// 那些「没装 yt-dlp 但只想下个抖音视频」的用户会看到一个莫名其妙的
// 「未找到 yt-dlp」——而这条路径根本用不上它。
func TestStartDownloadDirectDoesNotRequireYtdlp(t *testing.T) {
	app := NewApp()
	app.dataDir = t.TempDir()
	app.downloadsDir = t.TempDir()

	// 用一个刚关闭的本地端口作为 CDN 地址：预期是「下载失败」，
	// 但**不能**是「未找到 yt-dlp」——后者说明判定顺序错了。
	//
	// 用真实的临时端口而不是编造的地址：`StartDownload` 会立刻返回
	// （它在 goroutine 里拉数据），这里只关心**被接受**，
	// 所以地址本身能连上与否无关紧要，但拿一个真实存在过的端口
	// 比写死一个魔数更诚实。
	closed := closedPortURL(t)
	res := app.StartDownload(DownloadRequest{
		TaskID:    "direct-1",
		URL:       "https://www.douyin.com/video/1",
		DirectURL: closed,
		Title:     "测试",
		OutputDir: app.downloadsDir,
	})
	if !res.OK {
		t.Fatalf("直链任务应当被接受（缺 yt-dlp 不该拦住它）：%s", res.Error)
	}
	if res.MissingKind == "yt-dlp" {
		t.Fatal("直链路径不应要求 yt-dlp")
	}
}

// closedPortURL 返回一个「刚被关闭」的本地地址。
//
// 用途：需要「连接必然失败」的地址时，用一个真实分配过又立刻关闭的端口，
// 而不是写死 `127.0.0.1:1` 这种魔数——后者在某些环境里可能被别的东西占用，
// 让用例的失败原因变得不可预测。
func closedPortURL(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("无法分配临时端口：%v", err)
	}
	addr := ln.Addr().String()
	_ = ln.Close()
	return "http://" + addr + "/"
}

// TestChangelogBindingsNeverNil 绑定方法**不能返回 nil 切片**。
//
// Go 的 nil 切片 JSON 序列化成 `null`，而前端的 `.map()` / `.length` 对
// null 会直接抛 TypeError。真实故障：真机上点开「关于」页一片空白，
// 控制台是 `Cannot read properties of null (reading 'length')` ——
// 因为 `ChangelogHistory()` 在出错路径上 `return nil`。
//
// 类型检查看不出这条：Go 的 `[]Entry` 和 `nil` 是同一个类型。
func TestChangelogBindingsNeverNil(t *testing.T) {
	app := NewApp()

	if got := app.ChangelogList(); got == nil {
		t.Error("ChangelogList 返回 nil（JSON 会是 null，前端崩）")
	}
	if got := app.ChangelogHistory(); got == nil {
		t.Error("ChangelogHistory 返回 nil（JSON 会是 null，前端崩）")
	}
	// Current 返回指针，nil 是合法语义（前端有 currentChangelog 兜底），
	// 但内容读得出来时必须给出对象
	cur := app.ChangelogCurrent()
	if cur == nil {
		t.Skip("当前构建读不到内嵌 CHANGELOG，跳过内容断言")
	}
	if cur.Version == "" && !cur.Unreleased {
		t.Error("ChangelogCurrent 返回的条目既没有 version 也不是 unreleased")
	}
}

// 序列化后必须真的是 JSON 数组，而不是 `null`。
//
// 上面那条只测了 Go 侧的 nil，这条测**前端实际收到的字节**。
func TestChangelogJSONIsArray(t *testing.T) {
	app := NewApp()
	// 先验证「nil 切片会序列化成 null」这个前提本身成立——
	// 否则下面那条断言在没有内嵌 CHANGELOG 的构建里会假通过。
	var nilSlice []changelog.Entry
	rawNil, _ := json.Marshal(nilSlice)
	if string(rawNil) != "null" {
		t.Fatalf("前提不成立：nil 切片序列化成了 %q（期望 null）", rawNil)
	}

	raw, err := json.Marshal(app.ChangelogHistory())
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) == "null" {
		t.Fatal("序列化结果是 null，前端 .map() 会崩")
	}
	if !strings.HasPrefix(string(raw), "[") {
		t.Fatalf("序列化结果不是数组：%.40s", raw)
	}
}

// TestArchitectureDefaultsToElectron 未注入时必须是 electron。
//
// 这个默认值是**安全方向**：
//   - 若默认 wails，过渡版（Electron 外壳）会误判自己是新架构，
//     从而跳过 electron-updater 的 `latest*.yml` —— 存量用户直接失去更新
//   - 若默认 electron，最坏情况只是新版不提示「你已经迁移过」，
//     不影响任何人的更新通道
func TestArchitectureDefaultsToElectron(t *testing.T) {
	// `go test` 不带 -ldflags，所以这里就是「未注入」的场景
	if arch != string(update.ArchElectron) {
		t.Errorf("未注入时 arch 应为 electron，实际 %q", arch)
	}
	if update.CurrentArchitecture != update.ArchElectron {
		t.Errorf("update.CurrentArchitecture 应为 electron，实际 %q", update.CurrentArchitecture)
	}
}

// TestCheckUpdateReportsArchitecture CheckUpdate 必须如实报告当前架构，
// 并给出迁移判定。
//
// 这条不依赖网络：全挂时也要有 `architecture` 与 `migration` 两个键，
// 否则前端读不到会当成「没有新架构版本」，永远不提示。
func TestCheckUpdateReportsArchitecture(t *testing.T) {
	app := NewApp()
	app.dataDir = t.TempDir()
	// 用一个必然失败的源避免测试依赖网络；重点是有没有这两个键
	out := app.CheckUpdate("website")

	if _, ok := out["architecture"]; !ok {
		t.Error("CheckUpdate 必须返回 architecture（前端据此判断该读哪套通道）")
	}
	if _, ok := out["migration"]; !ok {
		t.Error("CheckUpdate 必须返回 migration（否则界面永远不提示新架构）")
	}
	if out["architecture"] != string(update.ArchElectron) {
		t.Errorf("architecture = %v，期望 electron", out["architecture"])
	}
}
