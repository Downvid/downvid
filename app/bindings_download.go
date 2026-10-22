package main

// Wails 壳的下载能力绑定。
//
// 与 `app.go` 分开是因为这两块职责不同：`app.go` 是「查信息 + 历史」，
// 这里是「跑进程 + 发进度事件」。混在一起会让 app.go 越来越难读。
//
// ## 依赖解析走 Go 边车
//
// 与桌面旧版一致：yt-dlp 不随包分发，由 Go 边车在用户的机器上**找**，
// 找不到才提示下载。这里调边车的 `detect` 子命令，不自己写候选路径表
// （那正是「依赖页说装了、加速页说没装」的来源）。

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/Downvid/downvid/app/internal/changelog"
	"github.com/Downvid/downvid/app/internal/clipboard"
	"github.com/Downvid/downvid/app/internal/deps"
	"github.com/Downvid/downvid/app/internal/download"
	"github.com/Downvid/downvid/app/internal/fetch"
	"github.com/Downvid/downvid/app/internal/image"
	"github.com/Downvid/downvid/app/internal/jsruntime"
	"github.com/Downvid/downvid/app/internal/netx"
	"github.com/Downvid/downvid/app/internal/parse"
	"github.com/Downvid/downvid/app/internal/settings"
	"github.com/Downvid/downvid/app/internal/shell"
	"github.com/Downvid/downvid/app/internal/sidecar"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Dependency 是一次探测结果。
type Dependency struct {
	Kind    string `json:"kind"`
	Found   bool   `json:"found"`
	Path    string `json:"path,omitempty"`
	Version string `json:"version,omitempty"`
	Source  string `json:"source,omitempty"`
	Reason  string `json:"reason,omitempty"`
}

// DownloadProgress 是发给前端的进度事件载荷。
//
// 字段名与旧版 `download:progress` 事件**逐字一致**：前端只需把
// `window.electronAPI.onDownloadProgress` 换成 `EventsOn('download:progress')`。
type DownloadProgress struct {
	TaskID    string  `json:"taskId"`
	URL       string  `json:"url,omitempty"`
	Status    string  `json:"status"` // downloading / merging / completed / error / paused
	Percent   float64 `json:"percent"`
	TotalSize string  `json:"totalSize,omitempty"`
	Speed     string  `json:"speed,omitempty"`
	ETA       string  `json:"eta,omitempty"`
	Message   string  `json:"message,omitempty"`
	FilePath  string  `json:"filePath,omitempty"`
	Error     string  `json:"error,omitempty"`
}

// DetectDependencies 探测运行依赖（调 Go 边车）。
func (a *App) DetectDependencies() []Dependency {
	sidecar := a.sidecarPath()
	if sidecar == "" {
		// 边车没打进包里时如实说明，而不是返回空列表让界面显示「未找到」
		return []Dependency{
			{Kind: "yt-dlp", Found: false, Reason: "依赖探测程序缺失（downvid-deps 未打包）"},
		}
	}

	out, err := runSidecar(sidecar, "detect", "--managed-dir", a.managedBinDir(), "--json")
	if err != nil {
		log.Printf("[downvid] 依赖探测失败：%v", err)
		return []Dependency{{Kind: "yt-dlp", Found: false, Reason: err.Error()}}
	}

	var payload struct {
		Results []Dependency `json:"results"`
	}
	if err := json.Unmarshal([]byte(out), &payload); err != nil {
		return []Dependency{{Kind: "yt-dlp", Found: false, Reason: "探测结果解析失败"}}
	}
	return payload.Results
}

// ResolveYtdlp 返回可用的 yt-dlp 路径（找不到时返回空串）。
func (a *App) ResolveYtdlp() string {
	if d, ok := a.pathOf("yt-dlp"); ok {
		return d
	}
	return ""
}

// pathOf 在**一次探测**里取某个依赖的路径。
//
// ## 为什么要有这个（性能，但也是正确性）
//
// `StartDownload` 需要 yt-dlp、aria2、ffmpeg 三个路径。早先它分别调用
// `ResolveYtdlp()` / `resolveAria2()` / `ffmpegLocation()`，每个都独立跑一次
// 边车探测——**三次进程启动**，而每次探测都要真的执行 yt-dlp 读版本号
// （PyInstaller 构建首次 8~12 秒），三次就是半分钟。
//
// 用户点「下载」后要等半分钟才有第一字节，看起来就是「点了没反应」。
// 现在三处共享同一次探测结果。
func (a *App) pathOf(kind string) (string, bool) {
	for _, d := range a.detectCached() {
		if d.Kind == kind && d.Found && d.Path != "" {
			return d.Path, true
		}
	}
	return "", false
}

// depsCache / depsCachedAt 缓存一次探测结果。
//
// TTL 与 Go 边车里的 cacheTTL 一致（60 秒）。缓存只用于**下载发起前的路径解析**
// ——界面上的「检测依赖」按钮走 `DetectDependencies` 的实时探测，
// 不会被缓存挡住（用户点「重新检测」必须真的重新检测）。
var (
	depsCache    []Dependency
	depsCachedAt time.Time
	depsCacheMu  sync.Mutex
)

const depsCacheTTL = 60 * time.Second

// detectCached 取最近一次探测结果，超过 TTL 才重新探测。
func (a *App) detectCached() []Dependency {
	depsCacheMu.Lock()
	defer depsCacheMu.Unlock()

	if depsCache != nil && time.Since(depsCachedAt) < depsCacheTTL {
		return depsCache
	}
	result := a.DetectDependencies()
	depsCache = result
	depsCachedAt = time.Now()
	return result
}

// invalidateDepsCache 让下一次解析重新探测。
//
// 依赖刚下载完、或用户在设置里改了手动路径时必须调，否则会拿到旧路径。
func invalidateDepsCache() {
	depsCacheMu.Lock()
	depsCache = nil
	depsCachedAt = time.Time{}
	depsCacheMu.Unlock()
}

// buildArgs 把请求翻译成 yt-dlp 参数。
//
// 抽成方法是为了**能被测试**：`StartDownload` 会真的起进程，没法在单测里
// 断言参数；而这条映射恰恰出过 bug（`DownloadRequest` 少了 AudioTrack 字段，
// 于是界面上的音轨选择器完全不起作用，且没有任何报错）。
func (a *App) buildArgs(opts DownloadRequest) []string {
	// 只有 YouTube 用得到 JS 运行时；探测要真的执行一次 node，别的站点不付这个代价
	var jsRuntime *download.JSRuntime
	if download.IsYouTube(opts.URL) {
		jsRuntime = a.jsRuntime()
	}
	return download.BuildArgs(download.Options{
		TaskID:       opts.TaskID,
		URL:          opts.URL,
		FormatID:     opts.FormatID,
		DownloadMode: opts.DownloadMode,
		HasAudio:     opts.HasAudio,
		Subtitles:    opts.Subtitles,
		AudioTrack:   toDownloadAudioTrack(opts.AudioTrack),
		Proxy:        a.currentProxy(),
		FilenameTmpl: opts.FilenameTemplate,
		Acceleration: a.acceleration(),
	}, opts.OutputDir, download.BuildArgsContext{
		FfmpegLocation: a.ffmpegLocation(),
		Aria2Path:      a.resolveAria2(),
		JSRuntime:      jsRuntime,
	})
}

// startDirectDownload 走直链下载（抖音/快手），不经过 yt-dlp。
//
// 与 yt-dlp 路径共用的部分：进度事件名、`activeDownloads` 里的暂停句柄、
// 历史记录的落盘时机。差异只在「谁来拉字节」。
func (a *App) startDirectDownload(opts DownloadRequest) StartDownloadResult {
	client, err := netx.Client(a.currentProxy(), 0)
	if err != nil {
		// socks5 这类：如实告诉用户哪些功能用它、哪些不用。
		// 静默直连是最糟的选择（会暴露真实 IP 而用户不知道）。
		return StartDownloadResult{OK: false, Error: err.Error()}
	}

	// 输出文件名：与 yt-dlp 路径同一套模板规则，否则「同一个视频从两条路径下
	// 出来的文件名不一样」，用户会以为是两份东西。
	template := opts.FilenameTemplate
	if template == "" {
		template = "%(title)s.%(ext)s"
	}
	outputDir := opts.OutputDir
	if outputDir == "" {
		outputDir = a.downloadsDir
	}
	outputPath := filepath.Join(outputDir, directFilename(template, opts))

	ctx, cancel := context.WithCancel(context.Background())
	a.mu.Lock()
	if a.directCancels == nil {
		a.directCancels = map[string]context.CancelFunc{}
	}
	a.directCancels[opts.TaskID] = cancel
	a.mu.Unlock()

	// 进度节流：fetch 包已经节流到 200ms，这里可以直接转发
	onProgress := func(p fetch.DirectProgress) {
		a.emitProgress(DownloadProgress{
			TaskID:    opts.TaskID,
			URL:       opts.URL,
			Status:    "downloading",
			Percent:   p.Percent,
			TotalSize: humanBytes(p.Total),
			Speed:     humanSpeed(p.SpeedBps),
			ETA:       humanETA(p.ETASec),
			FilePath:  outputPath,
		})
	}

	go func() {
		defer func() {
			a.mu.Lock()
			delete(a.directCancels, opts.TaskID)
			a.mu.Unlock()
			cancel()
		}()

		res, err := (fetch.Direct{}).Download(ctx, fetch.DirectOptions{
			CDNURL:      opts.DirectURL,
			PageURL:     opts.URL,
			OutputPath:  outputPath,
			Connections: download.AccelerationConnections(a.acceleration()),
			Client:      client,
			OnProgress:  onProgress,
		})

		if errors.Is(err, context.Canceled) {
			// 用户暂停：.part 与检查点都还在，恢复时只请求未写入的范围
			a.emitProgress(DownloadProgress{
				TaskID: opts.TaskID, URL: opts.URL, Status: "paused", FilePath: outputPath,
			})
			return
		}
		if err != nil {
			a.emitProgress(DownloadProgress{
				TaskID: opts.TaskID, URL: opts.URL, Status: "error",
				Error: describeDirectError(err),
			})
			return
		}
		a.emitProgress(DownloadProgress{
			TaskID: opts.TaskID, URL: opts.URL, Status: "completed",
			Percent: 100, FilePath: res.Path,
		})
	}()

	return StartDownloadResult{OK: true}
}

// directFilename 按模板算文件名。
//
// 只实现模板里**真正常用**的几个占位符（title / id / ext / uploader / height）。
// 不追求与 yt-dlp 完全等价：直链这条路径拿不到 info JSON，能填的字段本来就少。
// 认不出来的占位符原样保留——那是用户自己写的，删掉会让文件名变得莫名。
func directFilename(template string, opts DownloadRequest) string {
	name := template

	ext := "mp4"
	if opts.DownloadMode == "audio" {
		ext = "m4a"
	}

	// title 用任务 id 兜底：拿不到标题时至少不会产生一个空文件名
	title := opts.Title
	if title == "" {
		title = opts.TaskID
	}

	replacements := []struct{ from, to string }{
		{"%(title)s", title},
		{"%(id)s", opts.TaskID},
		{"%(ext)s", ext},
		{"%(uploader)s", ""},
	}
	for _, r := range replacements {
		name = strings.ReplaceAll(name, r.from, r.to)
	}

	// 模板里没写扩展名时补上（与 yt-dlp 路径同一规则）
	if !strings.HasSuffix(strings.ToLower(name), "."+ext) {
		name += "." + ext
	}

	// 去掉路径分隔符：模板是用户可编辑的，`../` 之类会写到下载目录之外
	name = strings.Map(func(r rune) rune {
		switch r {
		case '/', '\\', 0:
			return '-'
		}
		return r
	}, name)
	return strings.TrimSpace(name)
}

// describeDirectError 把直链下载的错误翻译成人话。
func describeDirectError(err error) string {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "403"):
		return "平台拒绝了这次下载（403）：直链已过期，请重新解析后再试"
	case strings.Contains(msg, "404"):
		return "直链已失效（404）：请重新解析后再试"
	case strings.Contains(msg, "超时"):
		return "下载连接超时：网络不稳定或直链已失效，请重试"
	}
	return msg
}

// humanBytes / humanSpeed / humanETA 只用于事件里的展示字段。
//
// 前端的进度条用的是 `Percent`，这三个只是给日志与兜底界面用的，
// 因此保持简单实现即可（不做 i18n，单位是通用的）。
func humanBytes(n int64) string {
	if n <= 0 {
		return ""
	}
	units := []string{"B", "KB", "MB", "GB"}
	v := float64(n)
	i := 0
	for v >= 1024 && i < len(units)-1 {
		v /= 1024
		i++
	}
	return fmt.Sprintf("%.1f %s", v, units[i])
}

func humanSpeed(bps float64) string {
	if bps <= 0 {
		return ""
	}
	return humanBytes(int64(bps)) + "/s"
}

func humanETA(sec int64) string {
	if sec <= 0 {
		return ""
	}
	if sec < 60 {
		return fmt.Sprintf("%ds", sec)
	}
	return fmt.Sprintf("%dm%02ds", sec/60, sec%60)
}

// StartDownload 启动一次下载（异步：立即返回，进度走 download:progress 事件）。
//
// 参数用一个结构体而不是长参数列表：Wails 会把结构体生成 TS 类型，
// 前端能获得字段提示；长参数列表在 TS 侧全是位置参数，改一个就全体错位。
func (a *App) StartDownload(opts DownloadRequest) StartDownloadResult {
	if opts.TaskID == "" || opts.URL == "" {
		return StartDownloadResult{OK: false, Error: "缺少 taskId 或 url"}
	}

	// 直链下载不需要 yt-dlp：只有走 yt-dlp 的路径才要求它存在。
	if opts.DirectURL != "" {
		return a.startDirectDownload(opts)
	}

	ytdlp := a.ResolveYtdlp()
	if ytdlp == "" {
		return StartDownloadResult{OK: false, Error: "未找到可用的 yt-dlp，请在「设置 → 运行依赖」中下载",
			MissingKind: "yt-dlp"}
	}

	// 与 electron/download/ytdlp.ts 一致：YouTube 没有可用的 JS 运行时就不起 yt-dlp。
	// 解析时已经要求过一次，这里兜住「解析之后运行时没了」与解析缓存命中这两种情况。
	if download.IsYouTube(opts.URL) && a.jsRuntime() == nil {
		return StartDownloadResult{OK: false, Error: "需要可运行的 Node.js 22+ 或 Deno 2.3+"}
	}

	args := a.buildArgs(opts)

	// 异步：Wails 的绑定方法若阻塞整个下载，界面会卡住
	go func() {
		res, err := a.runner.Run(opts.TaskID, download.RunOptions{
			YtdlpPath:     ytdlp,
			Args:          args,
			URL:           opts.URL,
			CookieArgs:    a.cookieArgs(),
			OutputDir:     opts.OutputDir,
			WantSubtitles: opts.Subtitles,
			OnEvent:       func(ev download.Event) { a.forwardEvent(opts.TaskID, opts.URL, ev) },
		})

		if err != nil {
			a.emitProgress(DownloadProgress{TaskID: opts.TaskID, URL: opts.URL, Status: "error", Error: err.Error()})
			return
		}
		if res.Paused {
			a.emitProgress(DownloadProgress{TaskID: opts.TaskID, URL: opts.URL, Status: "paused", FilePath: res.FilePath})
			return
		}
		if res.Code != nil && *res.Code != 0 {
			// 用错误分类给出人话提示，而不是把 yt-dlp 的英文原文丢给用户
			kind := a.ClassifyError(res.Stderr)
			a.emitProgress(DownloadProgress{
				TaskID: opts.TaskID, URL: opts.URL, Status: "error",
				Error: a.Diagnostic(res.Stderr, "", ""), Message: kind,
			})
			return
		}
		a.emitProgress(DownloadProgress{
			TaskID: opts.TaskID, URL: opts.URL, Status: "completed",
			Percent: 100, FilePath: res.FilePath,
		})
	}()

	return StartDownloadResult{OK: true}
}

// PauseDownload 暂停（终止整棵进程树）。
func (a *App) PauseDownload(taskID string) bool {
	// 先试直链：那条路径没有子进程，靠取消 ctx 停下
	a.mu.Lock()
	cancel, isDirect := a.directCancels[taskID]
	a.mu.Unlock()
	if isDirect {
		cancel()
		return true
	}
	return a.runner.Pause(taskID)
}

// toDownloadAudioTrack 把请求里的音轨转成 download 包的结构。
//
// 抽出来的理由：nil 与「空字段」必须区分开——nil 表示用户没选音轨
// （走默认 `bestaudio`），而非 nil 但 FormatID 为空则是前端传错了，
// 那种情况交给后端按语言匹配，别当成「没选」。
func toDownloadAudioTrack(t *DownloadAudioTrack) *download.AudioTrack {
	if t == nil {
		return nil
	}
	return &download.AudioTrack{
		FormatID: t.FormatID,
		Language: t.Language,
		IsM3U8:   t.IsM3U8,
	}
}

// DownloadRequest 是一次下载的参数。
type DownloadRequest struct {
	TaskID           string   `json:"taskId"`
	URL              string   `json:"url"`
	FormatID         string   `json:"formatId"`
	DownloadMode     string   `json:"downloadMode"` // video / audio / subtitle
	HasAudio         bool     `json:"hasAudio"`
	Subtitles        []string `json:"subtitles"`
	OutputDir        string   `json:"outputDir"`
	FilenameTemplate string   `json:"filenameTemplate"`
	// DirectURL 非空时走**直链下载**（抖音/快手），不经过 yt-dlp。
	//
	// 这两家的解析器给的是平台 CDN 直链，有效期只有几分钟；交给 yt-dlp
	// 会二次请求平台接口，拿不到同一份地址。所以解析器给了直链就必须直连。
	DirectURL string `json:"directUrl,omitempty"`
	// Title 用于直链路径的文件名（拿不到 info JSON，标题只能由前端带过来）
	Title string `json:"title,omitempty"`
	// AudioTrack 是选中的音轨（仅 YouTube 多音轨）。
	//
	// 早先这个字段根本不存在，于是界面上的「音轨」选择器**完全不起作用**：
	// 用户选了日语，下下来还是默认音轨，而且没有任何提示——因为后端
	// 压根没收到这个选择。download.Options.AudioTrack 早就支持了，
	// 断点只在这一次映射上。
	AudioTrack *DownloadAudioTrack `json:"audioTrack,omitempty"`
}

// DownloadAudioTrack 是前端传来的音轨选择。
type DownloadAudioTrack struct {
	FormatID string `json:"formatId"`
	Language string `json:"language"`
	IsM3U8   bool   `json:"isM3u8,omitempty"`
}

// StartDownloadResult 是启动结果。
type StartDownloadResult struct {
	OK bool `json:"ok"`
	// Error 是给用户看的说明
	Error string `json:"error,omitempty"`
	// MissingKind 非空时表示缺依赖，前端据此弹「一键下载」
	MissingKind string `json:"missingKind,omitempty"`
}

// ===== 内部：事件转发与路径解析 =====

// forwardEvent 把解析出的事件转成前端认识的形状。
func (a *App) forwardEvent(taskID, url string, ev download.Event) {
	switch ev.Kind {
	case "progress":
		a.emitProgress(DownloadProgress{
			TaskID: taskID, URL: url, Status: "downloading",
			Percent: ev.Percent, TotalSize: ev.TotalSize, Speed: ev.Speed, ETA: ev.ETA,
		})
	case "merging":
		a.emitProgress(DownloadProgress{
			TaskID: taskID, URL: url, Status: "merging",
			Percent: ev.Percent, Message: ev.Message,
		})
	case "file":
		if ev.FilePath != "" {
			a.emitProgress(DownloadProgress{TaskID: taskID, URL: url, Status: "downloading",
				Percent: 99, FilePath: ev.FilePath})
		}
	}
}

func (a *App) emitProgress(p DownloadProgress) {
	a.emit("download:progress", p)
}

// managedBinDir 是 DownVid 自己下载的依赖目录。
func (a *App) managedBinDir() string {
	return filepath.Join(a.dataDir, "runtime", "bin")
}

// sidecarPath 定位 Go 边车。
//
// 打包后放在 `resources/downvid-deps/`（与 Electron 版一致），开发时回落到
// 仓库的 `backend/build/<platform>-<arch>/`。
func (a *App) sidecarPath() string {
	name := "downvid-deps"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}

	exe, err := os.Executable()
	if err == nil {
		bundle := filepath.Join(filepath.Dir(exe), "..", "Resources", "downvid-deps", name)
		if fileExists(bundle) {
			return bundle
		}
		// 直接跑 `go run` / `wails dev` 时的位置
		dev := filepath.Join(filepath.Dir(exe), name)
		if fileExists(dev) {
			return dev
		}
	}

	// 仓库内开发：backend/build/<platform>-<arch>/
	wd, _ := os.Getwd()
	for _, base := range []string{wd, filepath.Join(wd, "..")} {
		p := filepath.Join(base, "backend", "build", platformKey(), name)
		if fileExists(p) {
			return p
		}
	}

	// 打包后的正式路径：边车**内嵌在主二进制里**，运行时落到数据目录。
	//
	// 这是 Wails 版最关键的一处：早先只找 `Resources/downvid-deps/`，
	// 而 Wails 没有 electron-builder 的 extraResources 机制 —— 打出来的
	// app 里根本没有边车，于是 `DetectDependencies` 只返回一条
	// 「探测程序缺失」。用户看到的是「依赖页怎么只剩这么一点」，
	// 而代码里没有任何一处会报错。
	if sidecar.Available {
		dir := filepath.Join(a.dataDir, "runtime", "bin")
		if p, err := sidecar.Extract(dir); err == nil {
			return p
		} else {
			log.Printf("[downvid] 解出内嵌边车失败：%v", err)
		}
	}
	return ""
}

func fileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.Mode().IsRegular()
}

// platformKey 返回 electron 侧的目录命名（`darwin-arm64` 这种）。
func platformKey() string {
	arch := runtime.GOARCH // amd64 / arm64
	if runtime.GOOS == "linux" && arch == "amd64" {
		return "linux-x64"
	}
	if runtime.GOOS == "linux" && arch == "arm64" {
		return "linux-arm64"
	}
	if runtime.GOOS == "darwin" && arch == "amd64" {
		return "darwin-x64"
	}
	if runtime.GOOS == "windows" && arch == "amd64" {
		return "win32-x64"
	}
	return runtime.GOOS + "-" + arch
}

// ffmpegLocation 返回 ffmpeg 所在目录（yt-dlp 会在该目录里同时找 ffmpeg 与 ffprobe）。
func (a *App) ffmpegLocation() string {
	p, ok := a.pathOf("ffmpeg")
	if !ok {
		return ""
	}
	return filepath.Dir(p)
}

func (a *App) resolveAria2() string {
	p, _ := a.pathOf("aria2")
	return p
}

// acceleration 返回当前生效的加速设置。
//
// ## 这里的 bug 曾经让「加速」完全无效
//
// 早先 `accelEnabled` / `accelConnections` 只在 `NewApp()` 里初始化成
// `true / 8`，之后再没有任何地方写它们——`UpdateSettings` 只落盘，
// `ResetSettings` 只写默认文件。于是：
//
//   - 用户在滑块上拖到「激进」（16）→ 界面显示 16，实际仍是 8
//   - 用户关掉加速开关 → 界面关着，实际仍按 8 连接跑
//   - 重启后读回设置，但运行时状态还是 NewApp 的那份
//
// 表现是「加速开关和滑块都像摆设」。现在改为**每次都从设置文件读**，
// 唯一真相是 settings.json，运行时不再持有第二份可漂移的副本。
func (a *App) acceleration() *download.Acceleration {
	st, err := a.settingsStore().Load()
	if err != nil {
		// 设置读不出来时退回默认（开启 + 8 连接），而不是「静默关闭加速」：
		// 关掉加速会让下载慢一倍，用户却看不到任何提示。
		log.Printf("[downvid] 读取加速设置失败，回退默认值：%v", err)
		return download.NormalizeAccelerationPtr(nil)
	}
	return download.NormalizeAccelerationPtr(&download.Acceleration{
		Enabled:        st.Acceleration.Enabled,
		MaxConnections: st.Acceleration.MaxConnections,
	})
}

// jsRuntime / parseJSRuntime 返回可用的 JS 运行时（YouTube 需要），没有时返回 nil。
//
// 探测在 internal/jsruntime（electron/utils/js-runtime.ts 的移植，与 TS 交叉验证过）。
// 早先这里只用 exec.LookPath 查 PATH，而从 Finder / 程序坞 / 桌面启动的 GUI 进程
// 拿不到 shell 里配置的 PATH：Homebrew、nvm、fnm、mise 装的 node 全都找不到，
// 也不校验版本——低于 yt-dlp 最低要求的 Node 照样会被传过去。
func (a *App) jsRuntime() *download.JSRuntime {
	info := cachedJSRuntime()
	if !info.Available {
		return nil
	}
	return &download.JSRuntime{Path: info.Path, Kind: info.Kind}
}

func (a *App) parseJSRuntime() *parse.JSRuntime {
	info := cachedJSRuntime()
	if !info.Available {
		return nil
	}
	return &parse.JSRuntime{Path: info.Path, Kind: info.Kind, Version: info.Version}
}

// checkJSRuntime 是真实探测；测试里替换它，避免用例依赖宿主机装没装 Node。
var checkJSRuntime = jsruntime.Check

// jsRuntimeCache 只缓存**找到**的结果，TTL 与依赖探测一致（60 秒）。
//
// 每次解析 / 下载都执行一遍 `node --version` 没有必要；但「没找到」不能缓存——
// 用户照着提示装好 Node 后马上重试，必须立刻能用。
var (
	jsRuntimeCache    jsruntime.Info
	jsRuntimeCachedAt time.Time
	jsRuntimeCacheMu  sync.Mutex
)

func cachedJSRuntime() jsruntime.Info {
	jsRuntimeCacheMu.Lock()
	defer jsRuntimeCacheMu.Unlock()

	if jsRuntimeCache.Available && time.Since(jsRuntimeCachedAt) < depsCacheTTL {
		return jsRuntimeCache
	}
	info := checkJSRuntime(context.Background())
	if info.Available {
		jsRuntimeCache = info
		jsRuntimeCachedAt = time.Now()
	}
	return info
}

func (a *App) cookieArgs() []string { return nil }

// runSidecar 执行 Go 边车并返回 stdout。
//
// **必须有超时**：边车在探测依赖时会真的执行 yt-dlp / ffmpeg，
// 而 PyInstaller 构建的 yt-dlp 首次启动要 8~12 秒。没有超时的话
// 一个卡死的二进制会把整个界面拖住（Wails 的绑定调用是同步的）。
func runSidecar(sidecar string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, sidecar, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return stdout.String(), fmt.Errorf("%v：%s", err, strings.TrimSpace(stderr.String()))
	}
	return stdout.String(), nil
}

// ===== 解析（前端最需要的能力）=====

// Parse 解析一个 URL，返回视频信息（格式列表、音轨、字幕）。
//
// 这是 UI 的入口：粘贴链接 → 调这个 → 显示格式选择器。
//
// 失败时返回带 `[[parse-error:kind]]` 标记的错误消息，前端据此显示可行动提示
// （分类逻辑在 `internal/parse`，前端不重复实现——两处各判一次必然漂移）。
func (a *App) Parse(url string, proxy string) (*parse.VideoInfo, error) {
	ytdlp := a.ResolveYtdlp()
	if ytdlp == "" {
		// 前端据此弹「一键下载」，而不是显示一句「解析失败」
		return nil, fmt.Errorf("[[deps-missing:yt-dlp]]未找到可用的 yt-dlp，请在「设置 → 运行依赖」中下载后重试")
	}

	a.mu.Lock()
	parser := a.parser
	if parser == nil {
		parser = parse.NewParser()
		a.parser = parser
	}
	// 取一份局部的代理值：下面要多处用到，读字段两次中间可能被
	// UpdateSettings 改掉（那是另一个 goroutine），读到两个不同的值。
	effectiveProxy := a.proxy
	a.mu.Unlock()
	if proxy != "" {
		effectiveProxy = proxy
	}

	info, err := parser.Parse(parse.ParseOptions{
		YtdlpPath:  ytdlp,
		URL:        url,
		Proxy:      effectiveProxy,
		CookieArgs: a.cookieArgs(),
		// 原始 info JSON 落在数据目录下而不是 /tmp：
		// 桌面端可能长期运行，/tmp 会被系统清理，而下载时要读它
		CacheDir:  filepath.Join(a.dataDir, "parse-cache"),
		Timeout:   90 * time.Second,
		JSRuntime: a.parseJSRuntime,
	})
	if err != nil {
		return nil, err
	}
	return info, nil
}

// ParseDump 返回一份**固定的**解析结果，供 UI 在没有网络或依赖时联调。
//
// 单独一个方法而不是给 Parse 加 mock 开关：生产路径上不该有「假数据」分支，
// 那种开关迟早会在真实调用里被误开。
func (a *App) ParseDump() *parse.VideoInfo {
	acodecNone := "none"
	fi := parse.FmtInfo{
		Duration: 754,
		Formats: []parse.RawFormat{
			{FormatID: "30077", Vcodec: "hev1.1.6.L150", Acodec: &acodecNone, Height: 1080, FPS: 29.969, Tbr: 2070},
			{FormatID: "100026", Vcodec: "av01.0.00M.10", Acodec: &acodecNone, Height: 1080, FPS: 29.969, Tbr: 2000},
			{FormatID: "30080", Vcodec: "avc1.640032", Acodec: &acodecNone, Height: 1080, FPS: 29.97, Tbr: 3252},
			{FormatID: "30064", Vcodec: "avc1.640028", Acodec: &acodecNone, Height: 720, FPS: 29.97, Tbr: 1301},
		},
	}
	return &parse.VideoInfo{
		ID:         "demo",
		Title:      "示例视频标题 · 中文与 English 混排，用来检查换行与截断",
		Uploader:   "示例 UP 主",
		Duration:   754,
		WebpageURL: "https://example.com/v",
		Formats:    parse.BuildVideoFormats(fi, false),
		IsYoutube:  true,
		Subtitles: []parse.Subtitle{
			{Language: "zh-Hans", Name: "中文（简体）"},
			{Language: "en", Name: "English"},
		},
		AudioFormats: []parse.AudioFormat{
			{FormatID: "140", Quality: "128kbps", Ext: "m4a", Filesize: 12_000_000, ABR: 128},
			{FormatID: "251", Quality: "160kbps", Ext: "webm", Filesize: 15_000_000, ABR: 160},
		},
		AudioTracks: []parse.AudioTrack{
			{ID: "en", Name: "English", Language: "en", FormatID: "251"},
			{ID: "ja", Name: "日本語", Language: "ja", FormatID: "251"},
		},
	}
}

// ===== 运行依赖（你的 DepsDialog / SettingsView 需要）=====

// DetectDeps 探测所有运行依赖（带 60 秒缓存）。
//
// 边车缺失时返回一条「未找到」而不是空数组：空数组会让界面显示
// 「没有依赖」而不是「探测程序缺失」，两者的排查方向完全不同。
func (a *App) DetectDeps(force bool) []deps.Status {
	m := a.depsManager()
	snap, err := m.Detect(force)
	if err != nil {
		return []deps.Status{{
			Kind: deps.KindYtdlp, Found: false,
			Reason: err.Error(),
		}}
	}
	return snap.Results
}

// DepsSummary 返回「缺什么 / 哪个版本过旧」。
//
// 分开返回是因为修法不同：缺失要点「下载」，过旧要点「更新」。
func (a *App) DepsSummary() map[string]any {
	m := a.depsManager()
	snap, err := m.Detect(false)
	if err != nil {
		return map[string]any{"error": err.Error()}
	}
	missing, stale := deps.Summarize(snap)
	return map[string]any{
		"missing":    missing,
		"stale":      stale,
		"managedDir": m.ManagedDir(),
		"platform":   snap.Platform,
	}
}

// InstallDeps 下载并安装依赖。
//
// **异步**：立即返回，进度走 `deps:progress` 事件。
// 同步的话整个下载期间（可能几分钟）界面会卡住。
func (a *App) InstallDeps(opts DepsInstallRequest) StartDownloadResult {
	m := a.depsManager()

	go func() {
		// 装之前先让探测缓存失效：装完的路径与版本都不一样了，
		// 不清的话下载发起时还会拿旧路径去 spawn
		invalidateDepsCache()
		defer invalidateDepsCache()

		err := m.Install(deps.FetchOptions{
			Only:    opts.Only,
			Force:   opts.Force,
			Proxy:   a.currentProxy(),
			Mirror:  opts.Mirror,
			Timeout: 10 * time.Minute,
		}, func(p deps.Progress) {
			// 事件名与 TS 版一致：前端只把订阅方式换成 EventsOn
			a.emit("deps:progress", p)
		})

		if err != nil {
			a.emit("deps:progress", deps.Progress{Event: "error", Message: err.Error()})
			return
		}
		// 下载完成后探测结果已失效（内容变了），主动推一次新状态
		a.emit("deps:progress", deps.Progress{Event: "done", Message: "依赖已就绪"})
	}()

	return StartDownloadResult{OK: true}
}

// CancelDepsInstall 取消依赖下载。
func (a *App) CancelDepsInstall() bool {
	return a.depsManager().Cancel()
}

// IsInstallingDeps 报告是否正在下载依赖。
func (a *App) IsInstallingDeps() bool {
	return a.depsManager().IsDownloading()
}

// OpenManagedDir 返回托管目录路径（前端用 OpenPath 打开）。
func (a *App) OpenManagedDir() string {
	return a.depsManager().ManagedDir()
}

// DepsInstallRequest 是依赖下载参数。
type DepsInstallRequest struct {
	Only   []deps.Kind `json:"only"`
	Force  bool        `json:"force"`
	Mirror string      `json:"mirror"`
}

// depsManager 惰性创建（sidecarPath 依赖 startup 里算出的路径）。
func (a *App) depsManager() *deps.Manager {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.deps == nil {
		a.deps = deps.NewManager(a.sidecarPath(), filepath.Join(a.dataDir, "runtime", "bin"))
	}
	return a.deps
}

// ===== 系统集成（打开文件 / 目录 / 链接 / 磁盘空间）=====

// OpenPathResult 是打开操作的结果。
//
// 用结构体而不是单个 bool：失败时前端要显示原因
// （「文件已被删除」与「没有权限」的处理方式完全不同）。
type OpenPathResult struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

// OpenPath 用系统默认程序打开文件或目录。
func (a *App) OpenPath(path string) OpenPathResult {
	if err := shell.OpenPath(path); err != nil {
		return OpenPathResult{Error: err.Error()}
	}
	return OpenPathResult{OK: true}
}

// ShowInFolder 在文件管理器里定位到该文件。
func (a *App) ShowInFolder(path string) OpenPathResult {
	if err := shell.ShowInFolder(path); err != nil {
		return OpenPathResult{Error: err.Error()}
	}
	return OpenPathResult{OK: true}
}

// DiskSpaceResult 是磁盘空间查询结果。
type DiskSpaceResult struct {
	Free  int64  `json:"free"`
	Total int64  `json:"total"`
	Error string `json:"error,omitempty"`
}

// GetDiskSpace 返回指定目录所在磁盘的剩余/总空间（字节）。
//
// 目录为空时用默认下载目录——前端不该为了查空间而先问一次下载目录在哪。
func (a *App) GetDiskSpace(dir string) DiskSpaceResult {
	if dir == "" {
		dir = a.downloadsDir
	}
	free, total, err := shell.DiskSpace(dir)
	if err != nil {
		return DiskSpaceResult{Error: err.Error()}
	}
	return DiskSpaceResult{Free: free, Total: total}
}

// ReadClipboard 返回系统剪贴板里的文本。
//
// ## 为什么由 Go 读而不是 navigator.clipboard
//
// WebView 里 `navigator.clipboard.readText()` 需要剪贴板权限，macOS 上会弹
// 系统授权对话框。用户点「粘贴」，看到的是一个权限菜单而不是真的粘贴，
// 还得再点一次「允许」——体验上就是「这个按钮没用」。
//
// 桌面程序读本机剪贴板是天经地义的，也不需要授权。失败时返回空串 +
// 错误信息，前端据此提示（而不是静默当成"剪贴板是空的"）。
func (a *App) ReadClipboard() ClipboardResult {
	text, err := clipboard.Read()
	if err != nil {
		return ClipboardResult{Error: err.Error()}
	}
	return ClipboardResult{Text: text}
}

// ClipboardResult 是读取剪贴板的结果。
type ClipboardResult struct {
	Text string `json:"text"`
	// Error 是给人看的原因（"剪贴板里没有文本" / "找不到命令 wl-paste"）
	Error string `json:"error,omitempty"`
}

// PickDirectory 弹系统目录选择框，返回用户选的目录（取消时返回空串）。
//
// ## 为什么必须是系统对话框
//
// 设置页「默认下载目录」旁边那个文件夹按钮，早先调的是 `openDownloadDir()`
// ——**打开**目录而不是**选择**目录。用户想换个保存位置，点一下却弹出了
// Finder，只能自己手动把路径敲进输入框。
//
// Wails 的对话框只能在 Go 侧弹（`runtime.OpenDirectoryDialog`），
// 前端的 `wailsjs/runtime` 里没有对应函数。
func (a *App) PickDirectory(title string) string {
	if a.ctx == nil {
		return ""
	}
	if strings.TrimSpace(title) == "" {
		title = "选择下载目录"
	}
	dir, err := wruntime.OpenDirectoryDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: title,
		// 从当前下载目录开始：用户多半只是想换到相邻目录
		DefaultDirectory: a.downloadsDir,
	})
	if err != nil {
		log.Printf("[downvid] 打开目录选择框失败：%v", err)
		return ""
	}
	return dir
}

// PickFile 弹系统文件选择框，返回选中文件的路径（取消时返回空串）。
//
// 用于「Cookie 文件」。过滤器按扩展名收窄：这个字段只接受 cookies.txt
// 格式，让用户随手选一个 mp4 只会得到一句「格式不对」。
func (a *App) PickFile(title string, extensions []string) string {
	if a.ctx == nil {
		return ""
	}
	if strings.TrimSpace(title) == "" {
		title = "选择文件"
	}
	if len(extensions) == 0 {
		extensions = []string{"txt"}
	}
	// 传目录时带上当前值所在目录，比每次都从主目录开始顺手
	file, err := wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{
		Title:   title,
		Filters: []wruntime.FileFilter{{DisplayName: "文件", Pattern: "*." + strings.Join(extensions, ";*.")}},
	})
	if err != nil {
		log.Printf("[downvid] 打开文件选择框失败：%v", err)
		return ""
	}
	return file
}

// ChangelogList 返回全部更新日志条目（本地内嵌，离线可用）。
//
// 分了两个用途：
//   - 「关于」页展示历史版本
//   - 更新弹窗里，若 Release 没带 body（Gitee / 部分镜像不给），退回本地记录
//
// **出错时返回空切片而不是 nil**：Go 的 nil 切片会被 JSON 序列化成 `null`，
// 而前端的 `.map()` / `.length` 对 null 会直接抛 TypeError，整个「关于」页白屏。
// 空切片序列化成 `[]`，前端无需额外判空——这条是「后端把数据形状收紧」，
// 比让每个调用点都记得判空更可靠。
func (a *App) ChangelogList() []changelog.Entry {
	entries, err := changelog.Local()
	if err != nil {
		log.Printf("[downvid] 读取更新日志失败：%v", err)
		return []changelog.Entry{}
	}
	if entries == nil {
		return []changelog.Entry{}
	}
	return entries
}

// ChangelogCurrent 返回**当前运行版本**对应的更新日志。
//
// 找不到精确匹配时退回最新一条已发布版本 —— 开发构建（版本号为
// `0.0.0-dev`）在 CHANGELOG 里没有对应段落，直接返回空会让「关于」页
// 一片空白，用户会以为功能坏了。
func (a *App) ChangelogCurrent() *changelog.Entry {
	entries, err := changelog.Local()
	if err != nil {
		log.Printf("[downvid] 读取更新日志失败：%v", err)
		return nil
	}
	if e, ok := changelog.Find(entries, version); ok {
		return &e
	}
	for _, e := range entries {
		if !e.Unreleased && e.Version != "" {
			return &e
		}
	}
	return nil
}

// ChangelogHistory 返回历史版本（从新到旧，不含 Unreleased）。
func (a *App) ChangelogHistory() []changelog.Entry {
	entries, err := changelog.Local()
	if err != nil {
		return []changelog.Entry{}
	}
	out := changelog.History(entries, version)
	if out == nil {
		return []changelog.Entry{}
	}
	return out
}

// TestProxy 实际测一次代理连通性。
//
// ## 为什么不能只做格式校验
//
// 早先前端的「测试」按钮只跑一个正则，于是 Clash 没开、端口填错、
// 协议写成 socks5 都显示「代理可用」。随后所有下载都超时，而用户
// 以为代理是好的——**假阳性比不检查更糟**。
//
// 现在真的发一次 HTTP 请求（经代理），并把失败翻译成人话
// （「连接被拒绝：代理软件没启动」比 `dial tcp ... connection refused` 有用）。
func (a *App) TestProxy(proxy string) netx.ProbeResult {
	// 空串表示「测直连」：这种情况下也值得测一次——用户可能只是想确认
	// 网络本身通不通，而那时不该返回「未配置代理」这种答非所问的结果。
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	return netx.Probe(ctx, proxy)
}

// ===== 用户设置 =====

// GetSettings 读取用户设置。
//
// 文件损坏时**不静默**：返回默认值，同时通过 `settings:error` 事件告知前端
// （附备份路径）。旧实现吞掉错误返回默认值，用户看到「设置全丢」却没有提示。
func (a *App) GetSettings() settings.Settings {
	s := a.settingsStore()
	got, err := s.Load()
	if err != nil {
		a.emit("settings:error", map[string]any{
			"message": err.Error(),
			"path":    s.Path(),
		})
	}
	return got
}

// UpdateSettings 合并写入设置。
//
// 参数是 JSON 字符串而不是结构体：Wails 生成的 TS 类型对「部分字段」表达不出来
// （Go 的结构体字段没有 optional），而合并写入的前提就是「只传要改的字段」。
// 前端传 `{"proxy": "http://..."}` 即可，其余字段保持不变。
//
// **这是唯一的写入入口**。整体覆盖会把别的组件写的字段抹掉——
// 历史事故：在设置面板点一次「保存」，`depPaths` 就没了。
func (a *App) UpdateSettings(patchJSON string) OpenPathResult {
	var patch map[string]any
	if err := json.Unmarshal([]byte(patchJSON), &patch); err != nil {
		return OpenPathResult{Error: "设置格式无效：" + err.Error()}
	}
	if len(patch) == 0 {
		return OpenPathResult{OK: true}
	}

	s := a.settingsStore()
	_, err := s.Update(func(st *settings.Settings) {
		applySettingsPatch(st, patch)
	})
	if err != nil {
		return OpenPathResult{Error: err.Error()}
	}

	// 设置变了：重新从文件读运行时字段（代理），并清依赖探测缓存
	// （手动路径 / 代理会影响探测结果）
	a.syncRuntimeSettings()
	a.depsManager().InvalidateCache()
	// 手动路径 / 代理都可能改变探测结果：清掉这里的 60 秒缓存，
	// 否则用户改完设置后第一次下载仍会用旧路径
	invalidateDepsCache()
	return OpenPathResult{OK: true}
}

// ResetSettings 恢复默认值。
func (a *App) ResetSettings() OpenPathResult {
	if err := a.settingsStore().Save(settings.Defaults()); err != nil {
		return OpenPathResult{Error: err.Error()}
	}
	a.syncRuntimeSettings()
	a.depsManager().InvalidateCache()
	// 手动路径 / 代理都可能改变探测结果：清掉这里的 60 秒缓存，
	// 否则用户改完设置后第一次下载仍会用旧路径
	invalidateDepsCache()
	return OpenPathResult{OK: true}
}

// GetSettingsPath 返回设置文件路径（排障用）。
func (a *App) GetSettingsPath() string { return a.settingsStore().Path() }

// applySettingsPatch 把 JSON patch 应用到设置上。
//
// 逐字段处理而不是 `json.Unmarshal` 到结构体：后者对**部分字段**会把
// 未传的字段置零（`false` / `""`），那正是「合并写入」要避免的事。
func applySettingsPatch(st *settings.Settings, patch map[string]any) {
	str := func(key string, dst *string) {
		if v, ok := patch[key].(string); ok {
			*dst = v
		}
	}
	boolean := func(key string, dst *bool) {
		if v, ok := patch[key].(bool); ok {
			*dst = v
		}
	}

	str("downloadDir", &st.DownloadDir)
	str("filenameTemplate", &st.FilenameTemplate)
	str("preferredQuality", &st.PreferredQuality)
	str("cookieMode", &st.CookieMode)
	str("cookiesFile", &st.CookiesFile)
	str("proxy", &st.Proxy)
	str("depMirror", &st.DepMirror)
	str("updateSource", &st.UpdateSource)
	str("language", &st.Language)
	boolean("autoCheckUpdate", &st.AutoCheckUpdate)
	boolean("autoDownloadUpdate", &st.AutoDownloadUpdate)

	if v, ok := patch["acceleration"].(map[string]any); ok {
		if enabled, ok := v["enabled"].(bool); ok {
			st.Acceleration.Enabled = &enabled
		}
		if n, ok := v["maxConnections"].(float64); ok {
			st.Acceleration.MaxConnections = int(n)
		}
		if p, ok := v["aria2Path"].(string); ok {
			st.Acceleration.Aria2Path = p
		}
	}

	if v, ok := patch["depPaths"].(map[string]any); ok {
		next := map[string]string{}
		for k, raw := range v {
			if s, ok := raw.(string); ok && s != "" {
				next[k] = s
			}
		}
		st.DepPaths = next
	}
}

// currentProxy 返回当前生效的代理（线程安全）。
func (a *App) currentProxy() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.proxy
}

// syncRuntimeSettings 把设置里「运行时要用到的字段」同步进内存。
//
// ## 为什么必须有这个函数
//
// 设置落盘 ≠ 生效。早先 `UpdateSettings` 只把 patch 写进 settings.json，
// 而 `Parse` / `StartDownload` / `InstallDeps` 读的是内存里的 `a.proxy`，
// `NewApp()` 之后再没人写过它。表现：
//
//   - 在设置页填了代理 → 解析/下载完全不走代理，用户以为代理不生效
//   - 重启后 `a.proxy` 仍是空串 → 代理「自己消失了」
//
// 加速设置在 `acceleration()` 里每次从文件读，不需要这份缓存；
// 代理需要，因为解析每次都会带上它。
func (a *App) syncRuntimeSettings() {
	st, err := a.settingsStore().Load()
	if err != nil {
		// 读不出来时保持现状：把代理清空会让「本来能下的」变成「下不了」
		log.Printf("[downvid] 读取设置失败，保留当前代理：%v", err)
		return
	}
	a.mu.Lock()
	a.proxy = strings.TrimSpace(st.Proxy)
	a.mu.Unlock()
}

// settingsStore 惰性创建设置存储。
func (a *App) settingsStore() *settings.Store {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.settings == nil {
		a.settings = settings.NewStore(filepath.Join(a.dataDir, "settings.json"))
	}
	return a.settings
}

// ===== 远程图片（B 站封面防盗链）=====

// FetchImage 抓取远程图片并返回 data URL。
//
// B 站（以及部分其他站点）的缩略图有防盗链：不带 Referer 直接请求会 403
// 或返回占位图。浏览器里 `<img src>` 拿不到，所以由主进程代抓。
//
// 失败时返回空串而不是抛错：前端用它渲染缩略图，失败应当退化成占位图，
// 弹错误框对用户没有价值。
func (a *App) FetchImage(url string, referer string) string {
	a.mu.Lock()
	client := a.imageClient
	if client == nil {
		client = image.NewClient()
		a.imageClient = client
	}
	a.mu.Unlock()

	data, err := client.Fetch(url, referer)
	if err != nil {
		// 记日志而不是抛给前端：封面加载失败不是用户需要处理的事
		log.Printf("[downvid] 抓取图片失败 %s：%v", url, err)
		return ""
	}
	return data
}
