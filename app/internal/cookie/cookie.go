// Package cookie 管理 yt-dlp 的 Cookie 策略与浏览器 Cookie 提取。
//
// 本包是 electron/utils/cookies.ts 与 electron/utils/browser.ts 的 Go 移植。
//
// ## Cookie 策略
//
// 直接 `--cookies-from-browser` 在浏览器运行时常失败（Windows 下 Chrome 锁库 / App-Bound 加密、
// macOS 钥匙串等），且一旦失败整个解析/下载都会报错。这里按顺序尝试多个 Cookie 来源，
// 并把成功读取的浏览器 Cookie 导出为快照，供后续下载直接复用（也省去每次解密的耗时）。
//
// 尝试顺序：
//   - 手动模式：用户指定的 cookies.txt → 无 Cookie
//   - 自动模式（解析）：已安装浏览器（上次成功的优先）→ 快照 → 无 Cookie
//   - 自动模式（下载，preferSnapshot）：新鲜快照 → 各浏览器 → 旧快照 → 无 Cookie
package cookie

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	// CookieDirName 目录名：不能命名为 cookies，macOS/Windows 文件系统不区分大小写，
	// 会与 Chromium 在 userData 下的 Cookies 数据库文件冲突（issue #31）。
	CookieDirName = "ytdlp-cookies"

	// SnapshotFreshDuration 快照新鲜期：30 分钟内认为是新鲜的。
	SnapshotFreshDuration = 30 * time.Minute

	// BrowserFailureTTL 浏览器失败冷却期：10 分钟内失败过的浏览器在自动模式中跳过。
	BrowserFailureTTL = 10 * time.Minute

	// CookieHintMarker 提示标记，前端据此拆分
	CookieHintMarker = "\n\n提示："
)

// Status 是当前 Cookie 的可用状态，供前端判断「要不要提示用户去配置 Cookie」。
type Status struct {
	// Manual 用户是否已手动指定可用的 cookies.txt
	Manual bool `json:"manual"`
	// HasSnapshot 已有快照（自动读取成功过）
	HasSnapshot bool `json:"hasSnapshot"`
	// SnapshotAgeMs 快照距今毫秒数（无快照时为 -1）
	SnapshotAgeMs int64 `json:"snapshotAgeMs"`
	// LastGoodBrowser 最近一次成功读取到 Cookie 的浏览器
	LastGoodBrowser string `json:"lastGoodBrowser"`
	// AvailableBrowsers 目前已安装、可供尝试的浏览器
	AvailableBrowsers []string `json:"availableBrowsers"`
	// CookieReady 表示是否有可用登录态（手动、快照或有可读浏览器）
	CookieReady bool `json:"cookieReady"`
}

// Attempt 是一次 Cookie 提取尝试。
type Attempt struct {
	Label     string   // "manual" / "chrome" / "snapshot" / "none"
	Args      []string // yt-dlp 参数
	TempFile  string   // 导出的临时文件（若有）
	IsBrowser bool     // 是否是浏览器尝试
	Browser   string   // 浏览器代号
}

// Cleanup 清理临时文件。
func (a *Attempt) Cleanup() {
	if a.TempFile != "" {
		_ = os.Remove(a.TempFile)
	}
}

// Manager 管理 Cookie 快照与浏览器重试。
type Manager struct {
	mu              sync.Mutex
	dataDir         string
	lastGoodBrowser string
	failures        map[string]time.Time
}

// NewManager 创建 Cookie 管理器。
func NewManager(dataDir string) *Manager {
	return &Manager{
		dataDir:  dataDir,
		failures: make(map[string]time.Time),
	}
}

// CookieDir 返回 Cookie 工作目录。
func (m *Manager) CookieDir() string {
	m.mu.Lock()
	base := m.dataDir
	m.mu.Unlock()

	candidates := []string{
		filepath.Join(base, CookieDirName),
		filepath.Join(os.TempDir(), "downvid-"+CookieDirName),
	}
	for _, dir := range candidates {
		if err := os.MkdirAll(dir, 0o700); err == nil {
			if st, err := os.Stat(dir); err == nil && st.IsDir() {
				return dir
			}
		}
	}
	return filepath.Join(os.TempDir(), "downvid-"+CookieDirName)
}

// SnapshotPath 返回 Cookie 快照文件路径。
func (m *Manager) SnapshotPath() string {
	return filepath.Join(m.CookieDir(), "browser-cookies.txt")
}

// SnapshotAge 返回快照存在时长（不存在返回 -1）。
func (m *Manager) SnapshotAge() time.Duration {
	p := m.SnapshotPath()
	st, err := os.Stat(p)
	if err != nil || st.Size() == 0 {
		return -1
	}
	return time.Since(st.ModTime())
}

// GetCookieStatus 返回当前机器的 Cookie 可用状态。
func (m *Manager) GetCookieStatus(manualFile string) Status {
	m.mu.Lock()
	lastGood := m.lastGoodBrowser
	m.mu.Unlock()

	manual := false
	if manualFile != "" {
		if st, err := os.Stat(manualFile); err == nil && !st.IsDir() && st.Size() > 0 {
			manual = true
		}
	}

	age := m.SnapshotAge()
	hasSnapshot := age >= 0
	var ageMs int64 = -1
	if hasSnapshot {
		ageMs = age.Milliseconds()
	}

	browsers := GetInstalledBrowsers()
	cookieReady := manual || hasSnapshot || len(browsers) > 0

	return Status{
		Manual:            manual,
		HasSnapshot:       hasSnapshot,
		SnapshotAgeMs:     ageMs,
		LastGoodBrowser:   lastGood,
		AvailableBrowsers: browsers,
		CookieReady:       cookieReady,
	}
}

func randomTag() string {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano()%1000000)
	}
	return hex.EncodeToString(b)
}

func (m *Manager) tempPath(tag string) string {
	name := fmt.Sprintf("tmp-%s-%d-%d-%s.txt", tag, os.Getpid(), time.Now().UnixNano(), randomTag())
	return filepath.Join(m.CookieDir(), name)
}

// GetAttempts 生成按顺序尝试的 Cookie 来源。
func (m *Manager) GetAttempts(manualFile string, preferSnapshot bool) []Attempt {
	if manualFile != "" {
		if st, err := os.Stat(manualFile); err == nil && !st.IsDir() && st.Size() > 0 {
			return []Attempt{
				{
					Label: "manual",
					Args:  []string{"--cookies", manualFile},
				},
				{
					Label: "none",
					Args:  nil,
				},
			}
		}
	}

	var attempts []Attempt
	age := m.SnapshotAge()
	fresh := age >= 0 && age < SnapshotFreshDuration

	snapAttempt := func() Attempt {
		snap := m.SnapshotPath()
		copyFile := m.tempPath("snap")
		if err := copySnapshot(snap, copyFile); err == nil {
			return Attempt{
				Label:    "snapshot",
				Args:     []string{"--cookies", copyFile},
				TempFile: copyFile,
			}
		}
		return Attempt{Label: "snapshot", Args: nil}
	}

	if preferSnapshot && fresh {
		attempts = append(attempts, snapAttempt())
	}

	m.mu.Lock()
	now := time.Now()
	var candidates []string
	for _, b := range GetInstalledBrowsers() {
		failAt, failed := m.failures[b]
		if !failed || now.Sub(failAt) > BrowserFailureTTL {
			candidates = append(candidates, b)
		}
	}
	lastGood := m.lastGoodBrowser
	m.mu.Unlock()

	// 上次成功的浏览器排在最前
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i] == lastGood {
			return true
		}
		if candidates[j] == lastGood {
			return false
		}
		return false
	})

	for _, b := range candidates {
		exported := m.tempPath(b)
		attempts = append(attempts, Attempt{
			Label:     b,
			Args:      []string{"--cookies-from-browser", b, "--cookies", exported},
			TempFile:  exported,
			IsBrowser: true,
			Browser:   b,
		})
	}

	if age >= 0 && !(preferSnapshot && fresh) {
		attempts = append(attempts, snapAttempt())
	}

	attempts = append(attempts, Attempt{Label: "none", Args: nil})
	return attempts
}

// OnAttemptSuccess 在一次尝试成功后更新快照与浏览器记忆。
func (m *Manager) OnAttemptSuccess(attempt Attempt) {
	if !attempt.IsBrowser {
		return
	}

	m.mu.Lock()
	m.lastGoodBrowser = attempt.Browser
	delete(m.failures, attempt.Browser)
	m.mu.Unlock()

	if attempt.TempFile == "" {
		return
	}

	st, err := os.Stat(attempt.TempFile)
	if err != nil || st.Size() == 0 {
		return
	}

	target := m.SnapshotPath()
	_ = os.Rename(attempt.TempFile, target)
	if runtime.GOOS != "windows" {
		_ = os.Chmod(target, 0o600)
	}
}

// OnAttemptFailure 在一次尝试因 Cookie 失败时记录冷却。
func (m *Manager) OnAttemptFailure(attempt Attempt, stderr string) {
	if !attempt.IsBrowser {
		return
	}
	if !IsCookieError(stderr) {
		return
	}

	m.mu.Lock()
	m.failures[attempt.Browser] = time.Now()
	if m.lastGoodBrowser == attempt.Browser {
		m.lastGoodBrowser = ""
	}
	m.mu.Unlock()
}

func copySnapshot(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}

// --- Cookie 错误识别与提示 ---

var cookieErrorRegexes = []*regexp.Regexp{
	regexp.MustCompile(`(?i)could not (?:find|copy) \S+ cookie`),
	regexp.MustCompile(`(?i)failed to (?:decrypt|load cookies)`),
	regexp.MustCompile(`(?i)cookies? database`),
	regexp.MustCompile(`(?i)keyring|keychain|secretstorage|kwallet`),
	regexp.MustCompile(`(?i)unsupported (?:browser|keyring)`),
	regexp.MustCompile(`(?i)database is locked|unable to open database`),
	regexp.MustCompile(`(?i)no such table|is not a database|database disk image is malformed`),
	regexp.MustCompile(`(?i)netscape format|invalid (?:length|expires)`),
	regexp.MustCompile(`(?i)operation not permitted`),
	regexp.MustCompile(`(?i)(?:permission denied|access is denied)\b`),
	regexp.MustCompile(`(?i)binarycookies`),
	regexp.MustCompile(`(?i)could not (?:find|open|read) (?:the )?\S* ?(?:cookie|profile|browser data)`),
}

// IsCookieError 检查 stderr 是否包含浏览器 Cookie 加载失败的错误。
func IsCookieError(stderr string) bool {
	lines := strings.Split(stderr, "\n")
	for _, line := range lines {
		if strings.HasPrefix(strings.TrimSpace(line), "ERROR:") {
			if strings.Contains(line, "--cookies-from-browser or --cookies") {
				// YouTube 的 "Use --cookies-from-browser or --cookies for the authentication"
				// 属于需要登录，不是读取失败
				continue
			}
			for _, re := range cookieErrorRegexes {
				if re.MatchString(line) {
					return true
				}
			}
		}
	}
	return false
}

var browserDisplayNames = map[string]string{
	"chrome":   "Chrome",
	"edge":     "Edge",
	"firefox":  "Firefox",
	"safari":   "Safari",
	"brave":    "Brave",
	"chromium": "Chromium",
}

// CookieFailureHint 生成 Cookie 读取失败的解决建议。
func CookieFailureHint(failedBrowsers []string) string {
	if len(failedBrowsers) == 0 {
		return ""
	}
	names := make([]string, len(failedBrowsers))
	hasChromiumOnWindows := false
	hasFirefox := false
	for i, b := range failedBrowsers {
		name, ok := browserDisplayNames[b]
		if !ok {
			name = b
		}
		names[i] = name
		if runtime.GOOS == "windows" && (b == "chrome" || b == "edge" || b == "brave" || b == "chromium") {
			hasChromiumOnWindows = true
		}
		if b == "firefox" {
			hasFirefox = true
		}
	}

	hint := fmt.Sprintf("%s未能读取 %s 的 Cookie，本次未携带登录信息。", CookieHintMarker, strings.Join(names, "、"))
	if hasChromiumOnWindows {
		hint += "Windows 上 Chrome/Edge 运行时 Cookie 数据库被锁定且加密，无法读取。"
	}
	hint += "若视频需要登录才能访问：① 完全退出该浏览器后重试；"
	if hasFirefox {
		hint += "② 或改用其他浏览器登录该网站；"
	} else {
		hint += "② 或使用 Firefox 登录该网站（其 Cookie 可随时读取）；"
	}
	hint += "③ 或在“设置 → 网络与 Cookie”中手动导入 cookies.txt。"
	return hint
}

// --- 已安装浏览器探测（跨平台）---

// GetInstalledBrowsers 返回本系统已安装且 yt-dlp 支持读取 Cookie 的浏览器。
func GetInstalledBrowsers() []string {
	var found []string
	add := func(name string, paths []string) {
		for _, f := range found {
			if f == name {
				return
			}
		}
		for _, p := range paths {
			if st, err := os.Stat(p); err == nil {
				if st.IsDir() || st.Mode().IsRegular() {
					found = append(found, name)
					return
				}
			}
		}
	}

	home, _ := os.UserHomeDir()

	switch runtime.GOOS {
	case "darwin":
		add("chrome", []string{
			"/Applications/Google Chrome.app",
			filepath.Join(home, "Applications", "Google Chrome.app"),
		})
		add("edge", []string{
			"/Applications/Microsoft Edge.app",
			filepath.Join(home, "Applications", "Microsoft Edge.app"),
		})
		add("safari", []string{
			"/Applications/Safari.app",
		})
		add("firefox", []string{
			"/Applications/Firefox.app",
			filepath.Join(home, "Applications", "Firefox.app"),
		})
		add("brave", []string{
			"/Applications/Brave Browser.app",
			filepath.Join(home, "Applications", "Brave Browser.app"),
		})

	case "windows":
		local := os.Getenv("LOCALAPPDATA")
		progFiles := os.Getenv("ProgramFiles")
		progFilesX86 := os.Getenv("ProgramFiles(x86)")

		add("chrome", []string{
			filepath.Join(progFiles, "Google", "Chrome", "Application", "chrome.exe"),
			filepath.Join(progFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
			filepath.Join(local, "Google", "Chrome", "Application", "chrome.exe"),
		})
		add("edge", []string{
			filepath.Join(progFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
			filepath.Join(progFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
			filepath.Join(local, "Microsoft", "Edge", "Application", "msedge.exe"),
		})
		add("firefox", []string{
			filepath.Join(local, "Mozilla Firefox", "firefox.exe"),
			filepath.Join(progFiles, "Mozilla Firefox", "firefox.exe"),
			filepath.Join(progFilesX86, "Mozilla Firefox", "firefox.exe"),
		})
		add("brave", []string{
			filepath.Join(progFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
			filepath.Join(local, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
		})

	default: // Linux
		add("chrome", []string{
			"/usr/bin/google-chrome",
			"/usr/bin/google-chrome-stable",
		})
		add("chromium", []string{
			"/usr/bin/chromium-browser",
			"/usr/bin/chromium",
			"/snap/bin/chromium",
		})
		add("firefox", []string{
			"/usr/bin/firefox",
			"/snap/bin/firefox",
		})
		add("edge", []string{
			"/usr/bin/microsoft-edge",
			"/usr/bin/microsoft-edge-stable",
		})
		add("brave", []string{
			"/usr/bin/brave-browser",
			"/usr/bin/brave",
		})
	}

	return found
}
