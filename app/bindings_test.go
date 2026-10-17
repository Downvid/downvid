package main

// 无头验证 Wails 绑定方法本身。
//
// 窗口渲染由前端构建产物 + 手动启动验证；这里验证**业务侧**——
// 绑定方法签名改了或被误改时，编译期就红，比等人工点一遍可靠。
import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/Downvid/downvid/app/internal/download"
	"github.com/Downvid/downvid/app/internal/history"
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
