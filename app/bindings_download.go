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
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/Downvid/downvid/app/internal/download"
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
	for _, d := range a.DetectDependencies() {
		if d.Kind == "yt-dlp" && d.Found && d.Path != "" {
			return d.Path
		}
	}
	return ""
}

// StartDownload 启动一次下载（异步：立即返回，进度走 download:progress 事件）。
//
// 参数用一个结构体而不是长参数列表：Wails 会把结构体生成 TS 类型，
// 前端能获得字段提示；长参数列表在 TS 侧全是位置参数，改一个就全体错位。
func (a *App) StartDownload(opts DownloadRequest) StartDownloadResult {
	if opts.TaskID == "" || opts.URL == "" {
		return StartDownloadResult{OK: false, Error: "缺少 taskId 或 url"}
	}

	ytdlp := a.ResolveYtdlp()
	if ytdlp == "" {
		return StartDownloadResult{OK: false, Error: "未找到可用的 yt-dlp，请在「设置 → 运行依赖」中下载",
			MissingKind: "yt-dlp"}
	}

	args := download.BuildArgs(download.Options{
		TaskID:       opts.TaskID,
		URL:          opts.URL,
		FormatID:     opts.FormatID,
		DownloadMode: opts.DownloadMode,
		HasAudio:     opts.HasAudio,
		Subtitles:    opts.Subtitles,
		Proxy:        a.proxy,
		FilenameTmpl: opts.FilenameTemplate,
		Acceleration: a.acceleration(),
	}, opts.OutputDir, download.BuildArgsContext{
		FfmpegLocation: a.ffmpegLocation(),
		Aria2Path:      a.resolveAria2(),
		JSRuntime:      a.jsRuntime(),
	})

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
	return a.runner.Pause(taskID)
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
	for _, d := range a.DetectDependencies() {
		if d.Kind == "ffmpeg" && d.Found && d.Path != "" {
			return filepath.Dir(d.Path)
		}
	}
	return ""
}

func (a *App) resolveAria2() string {
	for _, d := range a.DetectDependencies() {
		if d.Kind == "aria2" && d.Found && d.Path != "" {
			return d.Path
		}
	}
	return ""
}

func (a *App) acceleration() *download.Acceleration {
	if !a.accelEnabled {
		off := false
		return &download.Acceleration{Enabled: &off}
	}
	on := true
	return &download.Acceleration{Enabled: &on, MaxConnections: a.accelConnections}
}

// jsRuntime 返回可用的 JS 运行时（YouTube 需要）。
//
// 这里只做最小实现：找系统 PATH 里的 node/deno。
// 完整的 js-runtime 探测（含版本校验与缓存）在后续移植。
func (a *App) jsRuntime() *download.JSRuntime {
	for _, kind := range []string{"node", "deno"} {
		if p, err := lookPath(kind); err == nil {
			return &download.JSRuntime{Path: p, Kind: kind}
		}
	}
	return nil
}

func (a *App) cookieArgs() []string { return nil }

// 小工具：os/exec 的 LookPath 包一层，避免主文件再 import 一次。
func lookPath(name string) (string, error) { return exec.LookPath(name) }

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
