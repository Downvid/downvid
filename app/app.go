package main

// Wails 桌面壳的 Go 侧。
//
// ## 设计原则：壳只做「搬运」
//
// 这个文件里**不该有业务逻辑**——所有规则都在 `internal/*` 里（那些都有测试
// 与 TS 对拍）。壳的职责只有三件：
//   1. 把窗口/启动/退出接起来
//   2. 把 `internal/*` 暴露成 Wails 绑定方法（前端可调）
//   3. 把数据目录从 Electron 的 `app.getPath('userData')` 换成 Go 侧推导
//
// 一旦业务规则漏到这里，就会出现「桌面端一套、容器端另一套」——
// 那正是这次重构要消掉的东西。
//
// ## 与容器端的关系
//
// 容器端（`cmd/downvid-server`）与本壳**共用同一批 `internal/*`**，
// 区别只在传输层：那边是 WebSocket RPC，这边是 Wails 绑定。

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"sync"
	"time"

	"github.com/Downvid/downvid/app/internal/deps"
	"github.com/Downvid/downvid/app/internal/download"
	"github.com/Downvid/downvid/app/internal/history"
	"github.com/Downvid/downvid/app/internal/image"
	"github.com/Downvid/downvid/app/internal/parse"
	"github.com/Downvid/downvid/app/internal/settings"
	"github.com/Downvid/downvid/app/internal/shell"
	"github.com/Downvid/downvid/app/internal/update"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// version 由构建期注入：-ldflags "-X main.version=1.5.0"
var version = "0.0.0-dev"

// App 是暴露给前端的绑定对象。
//
// Wails 会把它的**导出方法**生成到 `frontend/wailsjs/go/main/App.js`。
// 方法签名要简单：参数与返回值都必须是可 JSON 序列化的类型，
// 不要用 interface{}（生成的 TS 声明会变成 any，前端失去类型检查）。
type App struct {
	ctx context.Context

	dataDir      string
	downloadsDir string
	historyPath  string

	// emitHook 是测试钩子：非 nil 时代替 Wails 的事件发送。
	// 生产路径上永远是 nil——这样测试不用启动 Wails 运行时也能验证事件。
	emitHook func(event string, data any)

	// 解析器（带缓存，复用避免每次解析都新建）
	parser *parse.Parser

	// 依赖管理器（惰性创建，见 bindings_download.go 的 depsManager）
	deps *deps.Manager

	// 设置存储（惰性创建）
	settings *settings.Store

	// 图片抓取客户端（惰性创建）
	imageClient *image.Client

	// 下载相关（由 bindings_download.go 使用）
	runner *download.Runner

	// proxy 是**当前生效**的代理。
	//
	// 与加速设置不同，它必须缓存在内存里：`Parse` 每次都会带上它，
	// 而每次解析都去读一次设置文件纯属浪费。启动时从设置载入（见 startup），
	// `UpdateSettings` / `ResetSettings` 写回（见 syncRuntimeSettings）。
	proxy string

	mu sync.Mutex
}

// NewApp 构造绑定对象。
//
// 加速设置**不放在这里**：它必须每次从 settings.json 读（见
// bindings_download.go 的 acceleration）。留一份内存副本就会有
// 「设置页显示 16、实际跑 8」这种漂移，而那正是之前的 bug。
func NewApp() *App {
	return &App{runner: download.NewRunner()}
}

// startup 是 Wails 的启动回调，拿到可用于发事件的 context。
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	a.dataDir = resolveDataDir()
	a.downloadsDir = resolveDownloadsDir()
	a.historyPath = filepath.Join(a.dataDir, "download-history.json")

	if err := os.MkdirAll(a.downloadsDir, 0o755); err != nil {
		log.Printf("[downvid] 无法创建下载目录 %s：%v", a.downloadsDir, err)
	}

	// 把设置里「运行时要用到」的字段载入内存。
	//
	// 不做这一步的话，**重启后代理设置不生效**：settings.json 里有 proxy，
	// 但内存里的 a.proxy 只在 NewApp() 里被置空过，之后没人读文件。
	// 用户会以为「代理设置丢了」，实际是从来没被读回来。
	a.syncRuntimeSettings()

	log.Printf("[downvid] version=%s dataDir=%s downloads=%s", version, a.dataDir, a.downloadsDir)
}

// shutdown 在退出时清理。
func (a *App) shutdown(ctx context.Context) {
	// 目前没有需要清理的资源。留这个函数是因为一旦加上「退出时清理临时
	// info JSON」之类的工作（TS 侧挂在 will-quit 上），这里是唯一正确的落点。
}

// ===== 应用信息 =====

// GetVersion 返回应用版本。
func (a *App) GetVersion() string { return version }

// GetPlatform 返回平台标识（Go 风格：windows / darwin / linux）。
//
// 前端用它决定是否显示窗口控制按钮（macOS 用原生红绿灯）。
func (a *App) GetPlatform() string { return runtime.GOOS }

// GetDataDir 返回数据目录（排障时贴给维护者用）。
func (a *App) GetDataDir() string { return a.dataDir }

// GetDefaultDownloadDir 返回默认下载目录。
func (a *App) GetDefaultDownloadDir() string { return a.downloadsDir }

// ===== 历史 =====

// HistoryGet 读取历史（含文件是否存在）。
//
// 文件损坏时**不静默**：把能读到的部分返回，同时通过 `history:error` 事件
// 告知前端。原 TS 实现吞掉错误返回空列表，用户看到「历史空了」却没有任何提示。
func (a *App) HistoryGet() []history.Record {
	records, err := history.Load(a.historyPath)
	if err != nil {
		log.Printf("[downvid] 历史文件读取异常：%v", err)
		a.emit("history:error", map[string]any{
			"message": err.Error(),
			// 备份路径让用户还有机会手工捞回数据
			"backup": backupPathOf(err),
		})
	}
	return history.AttachFileState(records, nil)
}

// HistoryAdd 新增或更新一条历史。
//
// 同一个本地文件只保留一条（`history.Upsert` 保证），并沿用原有的 id 与 createdAt
// ——那是「第一次下载这个文件」的时间，每次重下都刷新会让历史失去意义。
func (a *App) HistoryAdd(record history.Record) bool {
	a.mu.Lock()
	defer a.mu.Unlock()

	if record.FilePath == "" {
		return false
	}

	records, _ := history.Load(a.historyPath)
	next := history.Upsert(records, record, newID(), nowISO(), "")
	if err := history.Save(a.historyPath, next); err != nil {
		log.Printf("[downvid] 历史写入失败：%v", err)
		a.emit("history:error", map[string]any{"message": err.Error()})
		return false
	}

	a.emit("history:updated", history.AttachFileState(next, nil))
	return true
}

// HistoryDelete 按 id 删除一条。
func (a *App) HistoryDelete(id string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()

	records, _ := history.Load(a.historyPath)
	kept := make([]history.Record, 0, len(records))
	for _, r := range records {
		if r.ID != id {
			kept = append(kept, r)
		}
	}
	if err := history.Save(a.historyPath, kept); err != nil {
		log.Printf("[downvid] 历史写入失败：%v", err)
		return false
	}

	a.emit("history:updated", history.AttachFileState(kept, nil))
	return true
}

// HistoryClear 清空历史。
func (a *App) HistoryClear() bool {
	a.mu.Lock()
	defer a.mu.Unlock()

	if err := history.Save(a.historyPath, nil); err != nil {
		log.Printf("[downvid] 历史清空失败：%v", err)
		return false
	}
	a.emit("history:updated", []history.Record{})
	return true
}

// ===== 解析结果（本地文件，不联网）=====

// BuildFormatsFromJSON 把一份 yt-dlp 的 info JSON 转成界面可选的格式列表。
//
// 参数是 JSON 字符串而不是结构体：这样前端可以把**原样的** info JSON 传进来，
// 不必先在 TS 侧复刻它的形状（复刻就会漂移）。
//
// isYoutube / allowManifests 与 TS 的 `buildVideoFormats(info, isYoutube, allow)` 对应。
func (a *App) BuildFormatsFromJSON(infoJSON string, isYoutube bool, allowManifests bool) ([]parse.Format, error) {
	var info parse.FmtInfo
	if err := json.Unmarshal([]byte(infoJSON), &info); err != nil {
		return nil, err
	}
	return parse.BuildVideoFormatsWithManifests(info, isYoutube, allowManifests), nil
}

// ===== 错误分类与诊断 =====

// ClassifyError 判断一段错误输出属于哪一类。
//
// 前端据此决定显示什么提示、要不要给「提交 Issue」入口。
func (a *App) ClassifyError(raw string) string {
	return string(parse.ClassifyParseError(raw))
}

// Diagnostic 生成脱敏诊断（只含错误类别与版本号，不含 URL/Cookie）。
func (a *App) Diagnostic(raw string, ytdlpVersion string, runtimeVersion string) string {
	return parse.ParseDiagnostic(raw, parse.Versions{Ytdlp: ytdlpVersion, Runtime: runtimeVersion})
}

// ShouldOfferIssue 这条错误是否值得开 Issue。
func (a *App) ShouldOfferIssue(kind string) bool {
	return parse.ShouldOfferIssue(parse.ErrorKind(kind))
}

// ===== 更新检查（真实网络）=====

// CheckUpdate 沿降级链查最新版本。
//
// 返回结构里带上每次尝试的轨迹：用户遇到「检查失败」时，诊断面板能显示
// 「哪个源、什么原因」，而不是一句笼统的「网络错误」。
//
// **不抛错**：全挂时 `Release` 为 nil + 轨迹，前端据此显示人话提示。
func (a *App) CheckUpdate(source string) map[string]any {
	result := update.LookupLatestRelease(update.LookupOptions{
		Source:    update.NormalizeSource(source),
		Client:    update.DefaultHTTPClient,
		Repo:      update.Repo{Owner: "Downvid", Repo: "downvid"},
		TimeoutMs: 8000,
		Headers: map[string]string{
			// GitHub API 缺 UA 会直接 403
			"User-Agent": "DownVid/" + version,
		},
	})

	out := map[string]any{
		"attempts": result.Attempts,
		"summary":  update.SummarizeFailures(result.Attempts),
		"version":  version,
	}
	if result.Release != nil {
		out["release"] = result.Release
		out["hasUpdate"] = update.CompareVersions(result.Release.Version, version) > 0
	} else {
		out["release"] = nil
		out["hasUpdate"] = false
	}
	return out
}

// ===== 前端用得到的辅助 =====

// OpenExternal 用系统浏览器打开链接。
//
// 走 shell 包而不是 Wails 的 BrowserOpenURL：前者会校验协议，
// 只允许 http/https——历史记录里的 URL 是可被手工编辑的 JSON，
// 能打开任意 scheme 就等于给了一个「执行系统命令」的入口。
func (a *App) OpenExternal(url string) OpenPathResult {
	if err := shell.OpenExternal(url); err != nil {
		return OpenPathResult{Error: err.Error()}
	}
	return OpenPathResult{OK: true}
}

// emit 发事件给前端。
//
// 事件名与容器端的 WebSocket 事件保持一致，这样前端只写一套订阅逻辑。
func (a *App) emit(event string, data any) {
	if a.emitHook != nil {
		a.emitHook(event, data)
		return
	}
	if a.ctx == nil {
		return
	}
	wruntime.EventsEmit(a.ctx, event, data)
}

// ===== 数据目录推导 =====

// resolveDataDir 复刻 Electron `app.getPath('userData')` 的位置。
//
// **必须与旧版本一致**，否则用户升级后历史、Cookie、托管的 yt-dlp 全部「消失」。
// Electron 在三个平台上的取值：
//
//	macOS   ~/Library/Application Support/<name>
//	Windows %APPDATA%\<name>
//	Linux   $XDG_CONFIG_HOME/<name> 或 ~/.config/<name>
//
// `<name>` 是 package.json 的 name（`downvid`），不是显示名 `DownVid`——
// 大小写错了同样会让数据「消失」，而这在任何测试里都看不出来。
func resolveDataDir() string {
	const appName = "downvid"

	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}

	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", appName)
	case "windows":
		if appData := os.Getenv("APPDATA"); appData != "" {
			return filepath.Join(appData, appName)
		}
		return filepath.Join(home, "AppData", "Roaming", appName)
	default:
		if xdg := os.Getenv("XDG_CONFIG_HOME"); xdg != "" {
			return filepath.Join(xdg, appName)
		}
		return filepath.Join(home, ".config", appName)
	}
}

// resolveDownloadsDir 返回默认下载目录。
//
// 沿用旧版行为：设置里没指定时用系统「下载」目录。
func resolveDownloadsDir() string {
	if home, err := os.UserHomeDir(); err == nil {
		downloads := filepath.Join(home, "Downloads")
		if st, err := os.Stat(downloads); err == nil && st.IsDir() {
			return downloads
		}
	}
	// 没有标准下载目录时退到当前目录下的 downloads（容器/极简环境常见）
	wd, _ := os.Getwd()
	return filepath.Join(wd, "downloads")
}

// backupPathOf 从 CorruptError 里取备份路径。
func backupPathOf(err error) string {
	var ce *history.CorruptError
	if errorsAs(err, &ce) {
		return ce.Backup
	}
	return ""
}

func newID() string { return hexOf(16) }

func nowISO() string { return time.Now().UTC().Format(time.RFC3339Nano) }

// ===== 小工具 =====

func hexOf(n int) string {
	b := make([]byte, n)
	if _, err := randRead(b); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return hex.EncodeToString(b)
}

func randRead(b []byte) (int, error) { return rand.Read(b) }

func errorsAs(err error, target **history.CorruptError) bool { return errors.As(err, target) }
