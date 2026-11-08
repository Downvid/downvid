// Command downvid 是 DownVid 的命令行下载器。
//
// 它复用桌面版的设置与运行依赖：默认下载目录、代理、Cookie、加速设置来自
// `settings.json`，yt-dlp / ffmpeg / aria2 优先从 `~/.downvid/runtime/bin`
// 找。没有 GUI 也能用，装好的依赖不需要再下一遍。
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/Downvid/downvid/app/internal/appdir"
	"github.com/Downvid/downvid/app/internal/cookie"
	"github.com/Downvid/downvid/app/internal/download"
	"github.com/Downvid/downvid/app/internal/fetch"
	"github.com/Downvid/downvid/app/internal/history"
	"github.com/Downvid/downvid/app/internal/jsruntime"
	"github.com/Downvid/downvid/app/internal/netx"
	"github.com/Downvid/downvid/app/internal/parse"
	"github.com/Downvid/downvid/app/internal/settings"
)

// version / buildDate 由构建期注入：
// go build -ldflags "-X main.version=1.10.1 -X main.buildDate=2026.11.09"。
var (
	version   = "0.0.0-dev"
	buildDate = ""
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("downvid", flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.Usage = func() { usage(stderr) }

	var (
		format      string
		quality     string
		output      string
		proxy       string
		cookiesFile string
		audio       bool
		listFormats bool
		asJSON      bool
		noHistory   bool
		showVersion bool
		timeout     time.Duration
		only        string
		mirror      string
		force       bool
	)
	fs.StringVar(&format, "f", "", "yt-dlp 格式 ID（见 --list-formats）")
	fs.StringVar(&format, "format", "", "yt-dlp 格式 ID（见 --list-formats）")
	fs.StringVar(&quality, "q", "best", "最高分辨率：best/2160/1440/1080/720/480/360")
	fs.StringVar(&quality, "quality", "best", "最高分辨率：best/2160/1440/1080/720/480/360")
	fs.StringVar(&output, "o", "", "保存目录")
	fs.StringVar(&output, "output", "", "保存目录")
	fs.StringVar(&proxy, "proxy", "", "覆盖设置里的代理")
	fs.StringVar(&cookiesFile, "cookies", "", "cookies.txt 路径")
	fs.BoolVar(&audio, "a", false, "只下载音频（mp3）")
	fs.BoolVar(&audio, "audio", false, "只下载音频（mp3）")
	fs.BoolVar(&listFormats, "l", false, "列出可用格式后退出")
	fs.BoolVar(&listFormats, "list-formats", false, "列出可用格式后退出")
	fs.BoolVar(&asJSON, "json", false, "以 JSON 输出")
	fs.BoolVar(&noHistory, "no-history", false, "不写入下载历史")
	fs.BoolVar(&showVersion, "version", false, "显示版本")
	fs.DurationVar(&timeout, "timeout", 90*time.Second, "解析超时")
	fs.StringVar(&only, "only", "", "deps install：只装指定依赖（逗号分隔）")
	fs.StringVar(&mirror, "mirror", "", "deps install：下载源（默认取设置）")
	fs.BoolVar(&force, "force", false, "deps install：已存在也重新下载")

	if err := fs.Parse(splitArgs(args)); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if showVersion {
		if buildDate != "" {
			fmt.Fprintf(stdout, "downvid %s (%s)\n", version, buildDate)
		} else {
			fmt.Fprintf(stdout, "downvid %s\n", version)
		}
		return 0
	}
	if fs.NArg() > 0 && fs.Arg(0) == "deps" {
		return runDeps(fs.Args()[1:], only, force, mirror, stdout, stderr, asJSON)
	}
	if fs.NArg() != 1 {
		fs.Usage()
		return 2
	}
	url := strings.TrimSpace(fs.Arg(0))
	if url == "" {
		fs.Usage()
		return 2
	}

	fail := func(format string, args ...any) int {
		msg := fmt.Sprintf(format, args...)
		fmt.Fprintf(stderr, "downvid: %s\n", msg)
		if asJSON {
			_ = json.NewEncoder(stdout).Encode(map[string]any{"ok": false, "error": msg})
		}
		return 1
	}

	userData := appdir.UserData()
	store := settings.NewStore(appdir.SettingsPath(userData))
	st, err := store.Load()
	if err != nil {
		fmt.Fprintf(stderr, "提示：读取设置失败，使用默认值（%v）\n", err)
	}
	st = settings.Normalize(st)

	dir := strings.TrimSpace(output)
	if dir == "" {
		dir = st.DownloadDir
	}
	if dir == "" {
		dir = appdir.DownloadsDir()
	}
	dir = expandHome(dir)
	if abs, err := filepath.Abs(dir); err == nil {
		dir = abs
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fail("无法创建下载目录 %s：%v", dir, err)
	}

	effectiveProxy := st.Proxy
	if st.BypassProxy {
		effectiveProxy = ""
	}
	if proxy != "" {
		effectiveProxy = proxy
	}

	ytdlp, ok := appdir.FindTool("yt-dlp", st.DepPaths)
	if !ok {
		return fail("没找到 yt-dlp。先打开 DownVid 在「设置 → 运行依赖」下载，或把它放进 PATH / %s", filepath.Join(appdir.Home(), "runtime", "bin"))
	}
	ffmpeg, hasFFmpeg := appdir.FindTool("ffmpeg", st.DepPaths)
	if !hasFFmpeg {
		fmt.Fprintln(stderr, "提示：没找到 ffmpeg，需要合并音视频的格式可能失败")
	}
	aria2, hasAria2 := appdir.FindTool("aria2", st.DepPaths)
	if st.Acceleration.Aria2Path != "" && fileExists(st.Acceleration.Aria2Path) {
		aria2, hasAria2 = st.Acceleration.Aria2Path, true
	}

	manualCookies := cookiesFile
	if manualCookies == "" && st.CookieMode == "manual" {
		manualCookies = st.CookiesFile
	}
	directCookies := manualCookies
	if directCookies == "" {
		if p := cookie.NewManager(userData).SnapshotPath(); fileExists(p) {
			directCookies = p
		}
	}
	cookieManager := cookie.NewManager(userData)
	attempts := cookieManager.GetAttempts(manualCookies, false)
	if len(attempts) == 0 {
		attempts = []cookie.Attempt{{Label: "none"}}
	}

	var jsOnce sync.Once
	var jsInfo jsruntime.Info
	jsCheck := func() jsruntime.Info {
		jsOnce.Do(func() { jsInfo = jsruntime.Check(context.Background()) })
		return jsInfo
	}
	parseJS := func() *parse.JSRuntime {
		i := jsCheck()
		if !i.Available {
			return nil
		}
		return &parse.JSRuntime{Path: i.Path, Kind: string(i.Kind), Version: i.Version}
	}

	parser := parse.NewParser()
	defer parser.CleanupTempFiles()

	var info *parse.VideoInfo
	var chosen = -1
	var lastErr error
	for i := range attempts {
		att := &attempts[i]
		var rawStderr string
		info, err = parser.Parse(parse.ParseOptions{
			YtdlpPath:   ytdlp,
			URL:         url,
			Proxy:       effectiveProxy,
			CookieArgs:  att.Args,
			CookiesFile: directCookies,
			CacheDir:    appdir.ParseCacheDir(userData),
			Timeout:     timeout,
			RawStderr:   &rawStderr,
			JSRuntime:   parseJS,
		})
		if err == nil {
			chosen = i
			cookieManager.OnAttemptSuccess(*att)
			break
		}
		lastErr = err
		cookieManager.OnAttemptFailure(*att, rawStderr)
	}
	for i := range attempts {
		if i != chosen {
			attempts[i].Cleanup()
		}
	}
	if info == nil {
		if lastErr == nil {
			lastErr = errors.New("解析没有返回结果")
		}
		return fail("解析失败：%v", lastErr)
	}
	defer attempts[chosen].Cleanup()

	accel := download.NormalizeAccelerationPtr(&download.Acceleration{
		Enabled:        st.Acceleration.Enabled,
		MaxConnections: st.Acceleration.MaxConnections,
	})

	if listFormats {
		if asJSON {
			_ = json.NewEncoder(stdout).Encode(map[string]any{
				"ok": true, "title": info.Title, "formats": info.Formats, "audioFormats": info.AudioFormats,
			})
		} else {
			printFormats(stdout, info)
		}
		return 0
	}

	mode := "video"
	formatID := ""
	hasAudio := false
	ext := "mp4"
	qualityLabel := ""
	size := int64(0)

	// 抖音 / 快手给的是平台直链，走 fetch 而不是 yt-dlp。
	if info.DirectURL != "" && !audio {
		client, err := netx.Client(effectiveProxy, 0)
		if err != nil {
			return fail("代理不可用：%v", err)
		}
		taskID := newID()
		outputPath := filepath.Join(dir, directFilename(st.FilenameTemplate, info, taskID, "mp4"))
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		interrupt := make(chan os.Signal, 1)
		signal.Notify(interrupt, os.Interrupt)
		defer signal.Stop(interrupt)
		go func() {
			<-interrupt
			cancel()
		}()

		progress := &progressPrinter{w: stderr, tty: isTerminal(os.Stderr)}
		res, err := (fetch.Direct{}).Download(ctx, fetch.DirectOptions{
			CDNURL:      info.DirectURL,
			PageURL:     url,
			OutputPath:  outputPath,
			Connections: download.AccelerationConnections(accel),
			Client:      client,
			OnProgress:  progress.direct,
		})
		progress.finish()
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return fail("下载被中断")
			}
			return fail("直链下载失败：%v", err)
		}
		finalPath := res.Path
		size := res.Total
		if st, err := os.Stat(finalPath); err == nil {
			size = st.Size()
		}
		if !noHistory {
			if err := saveHistory(userData, url, info, finalPath, "mp4", "原始画质", size); err != nil {
				fmt.Fprintf(stderr, "提示：历史写入失败（下载已完成）：%v\n", err)
			}
		}
		writeResult(stdout, asJSON, info.Title, finalPath, "", "原始画质", "mp4", size)
		return 0
	}
	if info.DirectURL != "" && audio {
		return fail("这个平台的直链只提供视频，暂不支持 --audio")
	}

	if audio {
		mode = "audio"
		// BuildArgs 统一转成 mp3；解析结果里的 ext 是下载源的容器，不是产物。
		ext = "mp3"
		if format != "" {
			formatID = format
		} else {
			af := pickAudio(info)
			formatID, qualityLabel, size = af.FormatID, af.Quality, af.Filesize
		}
	} else {
		f, err := pickVideo(info, quality, format)
		if err != nil {
			return fail("%v", err)
		}
		// 视频统一 --merge-output-format mp4。
		ext = "mp4"
		formatID, hasAudio, qualityLabel, size = f.FormatID, f.HasAudio, f.Quality, f.Filesize
	}

	var downloadJS *download.JSRuntime
	if download.IsYouTube(url) {
		if i := jsCheck(); i.Available {
			downloadJS = &download.JSRuntime{Path: i.Path, Kind: string(i.Kind)}
		}
	}

	taskID := newID()
	ffmpegDir := ""
	if hasFFmpeg {
		ffmpegDir = filepath.Dir(ffmpeg)
	}
	aria2Path := ""
	if hasAria2 {
		aria2Path = aria2
	}
	argsList := download.BuildArgs(download.Options{
		TaskID:       taskID,
		URL:          url,
		FormatID:     formatID,
		DownloadMode: mode,
		HasAudio:     hasAudio,
		Proxy:        effectiveProxy,
		FilenameTmpl: st.FilenameTemplate,
		Acceleration: accel,
	}, dir, download.BuildArgsContext{
		FfmpegLocation: ffmpegDir,
		Aria2Path:      aria2Path,
		JSRuntime:      downloadJS,
	})
	// 解析刚落盘的 info JSON 直接交给下载，省掉 YouTube 的第二次提取。
	if info.CacheFile != "" && fileExists(info.CacheFile) {
		argsList = append(argsList, "--load-info-json", info.CacheFile)
	}

	progress := &progressPrinter{w: stderr, tty: isTerminal(os.Stderr)}
	defer progress.finish()

	runner := download.NewRunner()
	interrupt := make(chan os.Signal, 1)
	signal.Notify(interrupt, os.Interrupt)
	defer signal.Stop(interrupt)
	go func() {
		<-interrupt
		runner.Pause(taskID)
	}()

	res, err := runner.Run(taskID, download.RunOptions{
		YtdlpPath:  ytdlp,
		Args:       argsList,
		URL:        url,
		CookieArgs: attempts[chosen].Args,
		OutputDir:  dir,
		OnEvent:    progress.event,
	})
	_ = os.RemoveAll(download.TempDirFor(dir, taskID))
	progress.finish()

	if err != nil {
		return fail("下载失败：%v", err)
	}
	if res.StartErr != nil {
		return fail("下载失败：%v", res.StartErr)
	}
	if res.Paused {
		return fail("下载被中断")
	}
	if res.Code != nil && *res.Code != 0 {
		msg := strings.TrimSpace(res.Stderr)
		if msg != "" {
			return fail("yt-dlp 退出码 %d：%s", *res.Code, tail(msg, 3))
		}
		return fail("yt-dlp 退出码 %d", *res.Code)
	}
	finalPath := res.FilePath
	if finalPath == "" {
		return fail("下载完成，但没有拿到输出文件路径")
	}
	if st, err := os.Stat(finalPath); err == nil {
		size = st.Size()
	}
	if !noHistory {
		if err := saveHistory(userData, url, info, finalPath, ext, qualityLabel, size); err != nil {
			fmt.Fprintf(stderr, "提示：历史写入失败（下载已完成）：%v\n", err)
		}
	}

	writeResult(stdout, asJSON, info.Title, finalPath, formatID, qualityLabel, ext, size)
	return 0
}

func writeJSON(w io.Writer, v any) {
	_ = json.NewEncoder(w).Encode(v)
}

func writeResult(w io.Writer, asJSON bool, title, path, formatID, quality, ext string, size int64) {
	if asJSON {
		writeJSON(w, map[string]any{
			"ok": true, "title": title, "path": path,
			"formatId": formatID, "quality": quality, "ext": ext, "size": size,
		})
		return
	}
	fmt.Fprintf(w, "已保存：%s\n", path)
}

// directFilename 按文件名模板算直链下载的产物名。
func directFilename(template string, info *parse.VideoInfo, taskID, ext string) string {
	if template == "" {
		template = "%(title)s.%(ext)s"
	}
	title := info.Title
	if title == "" {
		title = taskID
	}
	name := strings.NewReplacer(
		"%(title)s", title,
		"%(id)s", info.ID,
		"%(ext)s", ext,
		"%(uploader)s", info.Uploader,
	).Replace(template)
	if !strings.HasSuffix(strings.ToLower(name), "."+ext) {
		name += "." + ext
	}
	name = strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r == 0 {
			return '-'
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	if name == "" {
		name = taskID + "." + ext
	}
	return name
}

func usage(w io.Writer) {
	fmt.Fprint(w, `downvid —— 用 DownVid 的设置和运行依赖下载视频

用法:
  downvid <链接> [选项]

示例:
  downvid "https://www.bilibili.com/video/BV..."
  downvid "https://youtu.be/..." -q 1080
  downvid "https://youtu.be/..." --list-formats
  downvid "https://youtu.be/..." -f 137+140 -o ~/Videos
  downvid "https://youtu.be/..." -a

  downvid deps status
  downvid deps install
  downvid deps install --only yt-dlp,ffmpeg --force

选项:
  -o, --output 目录     保存目录（默认取设置，否则 ~/Downloads）
  -f, --format ID       指定格式 ID（见 --list-formats）
  -q, --quality 高度    最高分辨率：best、2160、1440、1080、720、480、360
  -a, --audio           只下载音频（mp3）
  -l, --list-formats    列出可用格式后退出
      --json            以 JSON 输出结果
      --proxy URL       覆盖设置里的代理
      --cookies 文件    指定 cookies.txt
      --no-history      不写入 ~/.downvid/download-history.json
      --timeout 时长    解析超时（默认 90s）
      --only 列表       deps install：只装指定依赖（逗号分隔）
      --mirror 源       deps install：下载源（默认取设置）
      --force           deps install：已存在也重新下载
      --version         显示版本
`)
}

func expandHome(p string) string {
	if p != "~" && !strings.HasPrefix(p, "~/") && !strings.HasPrefix(p, `~\`) {
		return p
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return p
	}
	if p == "~" {
		return home
	}
	return filepath.Join(home, p[2:])
}

func fileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

func nowISO() string { return time.Now().UTC().Format(time.RFC3339Nano) }

func saveHistory(userData, url string, info *parse.VideoInfo, path, ext, quality string, size int64) error {
	historyPath := appdir.HistoryPath(userData)
	records, _ := history.Load(historyPath)
	rec := history.Record{
		Title:     info.Title,
		Thumbnail: info.Thumbnail,
		URL:       url,
		FilePath:  path,
		Format:    ext,
		Quality:   quality,
	}
	if size > 0 {
		rec.FileSize = download.FormatBytesInt(size)
	}
	next := history.Upsert(records, rec, newID(), nowISO(), "")
	return history.Save(historyPath, next)
}

func tail(s string, n int) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, " | ")
}

func isTerminal(f *os.File) bool {
	st, err := f.Stat()
	return err == nil && st.Mode()&os.ModeCharDevice != 0
}

type progressPrinter struct {
	w     io.Writer
	tty   bool
	last  time.Time
	wrote bool
}

func (p *progressPrinter) event(ev download.Event) {
	switch ev.Kind {
	case "progress":
		if !p.tty {
			return
		}
		now := time.Now()
		if now.Sub(p.last) < 100*time.Millisecond && ev.Percent < 100 {
			return
		}
		p.last = now
		p.wrote = true
		fmt.Fprintf(p.w, "\r  %5.1f%%  %-10s  %-10s  %-8s", ev.Percent, ev.TotalSize, ev.Speed, ev.ETA)
	case "merging":
		if !p.tty {
			return
		}
		p.wrote = true
		fmt.Fprintf(p.w, "\r  %-48s", ev.Message)
	}
}

func (p *progressPrinter) direct(ev fetch.DirectProgress) {
	if !p.tty {
		return
	}
	now := time.Now()
	if now.Sub(p.last) < 100*time.Millisecond && ev.Percent < 100 {
		return
	}
	p.last = now
	p.wrote = true
	speed := ""
	if ev.SpeedBps > 0 {
		speed = download.FormatBytesInt(int64(ev.SpeedBps)) + "/s"
	}
	fmt.Fprintf(p.w, "\r  %5.1f%%  %-10s  %-10s  %-8s", ev.Percent, download.FormatBytesInt(ev.Total), speed, download.FormatETA(float64(ev.ETASec)))
}

func (p *progressPrinter) finish() {
	if p.wrote {
		fmt.Fprintln(p.w)
		p.wrote = false
	}
}
