package main

// YouTube 的 JS 运行时在 Wails 壳里的接线。
//
// internal/jsruntime 的候选表与 TS 交叉验证过，但「探测结果有没有真的送到 yt-dlp 手里」
// 只有从绑定入口走一遍才看得出来——Wails 版此前正是在这一层只用 LookPath 查 PATH，
// 解析时更是根本不传 `--js-runtimes`（yt-dlp 于是只会在 PATH 里找 deno）。
import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/Downvid/downvid/app/internal/download"
	"github.com/Downvid/downvid/app/internal/jsruntime"
)

var nodeRuntime = jsruntime.Info{Available: true, Path: "/opt/node/bin/node", Kind: "node", Name: "Node.js", Version: "22.11.0"}

func resetJSRuntimeCache() {
	jsRuntimeCacheMu.Lock()
	jsRuntimeCache = jsruntime.Info{}
	jsRuntimeCachedAt = time.Time{}
	jsRuntimeCacheMu.Unlock()
}

// stubJSRuntime 把真实探测换成固定结果（并清空缓存），返回探测次数。
// 不替换的话用例会依赖宿主机装没装 Node。
func stubJSRuntime(t *testing.T, info jsruntime.Info) *int {
	t.Helper()
	calls := 0
	orig := checkJSRuntime
	checkJSRuntime = func(context.Context) jsruntime.Info {
		calls++
		return info
	}
	resetJSRuntimeCache()
	t.Cleanup(func() {
		checkJSRuntime = orig
		resetJSRuntimeCache()
	})
	return &calls
}

// stubYtdlp 让依赖探测直接返回一个假的 yt-dlp：它把收到的参数逐行写进返回的文件，再执行 script。
func stubYtdlp(t *testing.T, script string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("用 shell 脚本做夹具，Windows 上跳过")
	}
	dir := t.TempDir()
	argsFile := filepath.Join(dir, "args")
	path := filepath.Join(dir, "yt-dlp")
	body := "#!/bin/sh\nprintf '%s\\n' \"$@\" > '" + argsFile + "'\n" + script
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	depsCacheMu.Lock()
	depsCache = []Dependency{{Kind: "yt-dlp", Found: true, Path: path}}
	depsCachedAt = time.Now()
	depsCacheMu.Unlock()
	t.Cleanup(invalidateDepsCache)
	return argsFile
}

func jsRuntimeArg(args []string) string {
	if i := slices.Index(args, "--js-runtimes"); i >= 0 && i+1 < len(args) {
		return args[i+1]
	}
	return ""
}

func TestBuildArgsUsesDetectedJSRuntime(t *testing.T) {
	calls := stubJSRuntime(t, nodeRuntime)
	app := newTestApp(t)

	// 非 YouTube：不探测（探测要真的执行一次 node），也不传
	args := app.buildArgs(DownloadRequest{
		TaskID: "t", URL: "https://www.bilibili.com/video/BV1xx", FormatID: "80", DownloadMode: "video", OutputDir: t.TempDir(),
	})
	if *calls != 0 || jsRuntimeArg(args) != "" {
		t.Fatalf("非 YouTube 不该探测、也不该传 --js-runtimes（探测 %d 次）：%q", *calls, args)
	}

	args = app.buildArgs(DownloadRequest{
		TaskID: "t", URL: "https://youtu.be/x", FormatID: "137", DownloadMode: "video", OutputDir: t.TempDir(),
	})
	if got := jsRuntimeArg(args); got != "node:/opt/node/bin/node" {
		t.Fatalf("YouTube 应带上探测到的运行时，got %q：%q", got, args)
	}
}

// 「没找到」不能缓存：用户照着提示装好 Node 后马上重试，必须立刻能用。
func TestJSRuntimeCacheKeepsOnlyFoundResults(t *testing.T) {
	calls := stubJSRuntime(t, jsruntime.Info{})
	cachedJSRuntime()
	cachedJSRuntime()
	if *calls != 2 {
		t.Fatalf("没找到的结果被缓存了：探测 %d 次，应为 2", *calls)
	}

	calls = stubJSRuntime(t, nodeRuntime)
	cachedJSRuntime()
	if got := cachedJSRuntime(); got != nodeRuntime || *calls != 1 {
		t.Fatalf("找到的结果应缓存复用：探测 %d 次，结果 %+v", *calls, got)
	}
}

func TestParseBindingRequiresJSRuntimeForYoutube(t *testing.T) {
	stubJSRuntime(t, jsruntime.Info{})
	argsFile := stubYtdlp(t, "exit 1\n")

	_, err := newTestApp(t).Parse("https://youtu.be/x", "")
	if err == nil || !strings.Contains(err.Error(), "[[parse-error:runtime-unavailable]]") {
		t.Fatalf("应报 runtime-unavailable，got %v", err)
	}
	if _, statErr := os.Stat(argsFile); statErr == nil {
		t.Fatal("没有 JS 运行时时不该起 yt-dlp")
	}
}

func TestParseBindingPassesJSRuntime(t *testing.T) {
	stubJSRuntime(t, nodeRuntime)
	argsFile := stubYtdlp(t, "echo 'ERROR: Connection timed out' >&2\nexit 1\n")

	_, _ = newTestApp(t).Parse("https://youtu.be/x", "")
	raw, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatalf("yt-dlp 没有被执行：%v", err)
	}
	args := strings.Split(strings.TrimSpace(string(raw)), "\n")
	if got := jsRuntimeArg(args); got != "node:/opt/node/bin/node" {
		t.Fatalf("解析时应带上探测到的运行时，got %q：%q", got, args)
	}
}

func TestStartDownloadYoutubeRequiresJSRuntime(t *testing.T) {
	stubJSRuntime(t, jsruntime.Info{})
	argsFile := stubYtdlp(t, "exit 0\n")
	app := newTestApp(t)
	app.runner = download.NewRunner()

	res := app.StartDownload(DownloadRequest{TaskID: "t1", URL: "https://youtu.be/x", FormatID: "137", OutputDir: t.TempDir()})
	if res.OK || !strings.Contains(res.Error, "Node.js 22+") {
		t.Fatalf("YouTube 没有 JS 运行时应拒绝下载并说明原因：%+v", res)
	}
	if _, err := os.Stat(argsFile); err == nil {
		t.Fatal("没有 JS 运行时时不该起 yt-dlp")
	}
}
