// Package runtime 负责在机器上查找 yt-dlp / ffmpeg / ffprobe。
//
// 查找顺序（系统优先，缺失才由 DownVid 下载）：
//  1. 显式指定的路径（设置里手动选择）
//  2. userData 托管目录（DownVid 自己下载安装的）
//  3. 登录 shell 的 PATH（GUI 应用常拿不到完整 PATH，这一步很关键）
//  4. 各平台常见安装目录（Homebrew / winget / scoop / 发行版路径）
package runtime

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/yxxbc/downvid/backend/internal/probe"
)

// Kind 依赖种类
type Kind string

const (
	KindYtDlp   Kind = "yt-dlp"
	KindFFmpeg  Kind = "ffmpeg"
	KindFFprobe Kind = "ffprobe"
)

// Kinds 全部依赖，顺序即界面展示顺序
var Kinds = []Kind{KindYtDlp, KindFFmpeg, KindFFprobe}

// Optional 标记非必需依赖：ffprobe 只在部分后处理场景用到
var Optional = map[Kind]bool{KindFFprobe: true}

// BinaryName 工具在磁盘上的文件名
func BinaryName(kind Kind) string {
	if runtime.GOOS == "windows" {
		return string(kind) + ".exe"
	}
	return string(kind)
}

// Source 依赖来源，用于界面标识与排查
type Source string

const (
	SourceManaged Source = "managed" // DownVid 下载到 userData 的
	SourceSystem  Source = "system"  // 系统安装（PATH / 常见目录）
	SourceManual  Source = "manual"  // 用户在设置里手动指定
	SourceScanned Source = "scanned" // 保底全盘扫描发现的（不在已知安装位置）
)

// Options 探测输入
type Options struct {
	ManagedDir  string          // 托管目录，例如 <userData>/runtime/bin
	ManualPaths map[Kind]string // 用户手动指定的绝对路径
}

// Result 单个依赖的探测结果。Found=false 时 Reason 说明为什么没找到。
type Result struct {
	Kind     string `json:"kind"`
	Found    bool   `json:"found"`
	Optional bool   `json:"optional,omitempty"`
	Path     string `json:"path,omitempty"`
	Version  string `json:"version,omitempty"`
	Source   string `json:"source,omitempty"`
	Reason   string `json:"reason,omitempty"`
	Managed  bool   `json:"managed,omitempty"` // 该依赖由 DownVid 托管，可安全覆盖更新
}

// FindAll 依次探测全部依赖
func FindAll(opts Options) []Result {
	results := make([]Result, 0, len(Kinds))
	for _, kind := range Kinds {
		results = append(results, findOne(kind, opts))
	}
	return results
}

// FindOne 探测单个依赖（下载完成后用于回读结果）
func FindOne(kind Kind, opts Options) Result { return findOne(kind, opts) }

func findOne(kind Kind, opts Options) Result {
	res := Result{Kind: string(kind), Optional: Optional[kind]}
	// 重置扫描预算与时限：每个依赖独立计算，避免前一个把额度用光
	scanDirsLeft = 3000
	scanDeadline = time.Now().Add(scanTimeLimit)

	var lastErr error
	for _, c := range candidatesFor(kind, opts) {
		info, err := probeTool(kind, c.Path)
		if err != nil {
			lastErr = err
			continue
		}
		if min, ok := probe.MinimumMajor[string(kind)]; ok && info.Major != 0 && info.Major < min {
			lastErr = errors.New("版本过旧（" + info.Version + "），建议重新下载")
			continue
		}
		res.Found = true
		res.Path = info.Path
		res.Version = info.Version
		res.Source = string(c.Source)
		res.Managed = c.Source == SourceManaged
		return res
	}

	// 保底：已知目录都没命中时，做一次**有界的**全盘扫描。
	//
	// 为什么需要：候选目录是枚举出来的，覆盖不了便携版、自定义安装目录、
	// 或者将来某个包管理器换的新落点。这类情况下用户明明装了却被告知缺失，
	// 且无从下手。
	//
	// 为什么必须有界：全盘遍历在 Windows 上可能耗时很久（且会扫到网络盘）。
	// 因此只扫几个最可能的根目录、限制深度与访问条目数、命中即停。
	if fallback := scanForBinary(kind, opts); fallback != nil {
		res.Found = true
		res.Path = fallback.Path
		res.Version = fallback.Version
		res.Source = string(SourceScanned)
		res.Managed = false
		return res
	}

	if lastErr != nil {
		res.Reason = lastErr.Error()
	} else {
		res.Reason = "未在托管目录、PATH、常见安装目录中找到（已尝试扫描常见位置）"
	}
	return res
}

// scanForBinary 在常见根目录下有限度地搜索可执行文件。
//
// 只作为保底：正常路径（托管目录 / PATH / 常见安装目录）都已尝试过才会走到这里。
// 扫到的结果标记为 SourceScanned，界面会提示"自动扫描发现"，便于用户判断来源。
func scanForBinary(kind Kind, opts Options) *probe.Info {
	name := BinaryName(kind)
	seen := map[string]bool{}

	for _, root := range scanRoots() {
		if seen[root] {
			continue
		}
		seen[root] = true

		found := scanDir(root, name, 0)
		if found == "" {
			continue
		}
		info, err := probeTool(kind, found)
		if err != nil {
			continue
		}
		if min, ok := probe.MinimumMajor[string(kind)]; ok && info.Major != 0 && info.Major < min {
			continue
		}
		return &info
	}
	return nil
}

// scanDir 在 dir 下最多下探 maxDepth 层查找 name。
//
// 限制点：
//   - 深度（默认 4 层）：够到 `.../bin/yt-dlp`、`.../ffmpeg/bin/ffmpeg.exe` 这类层级
//   - 目录数预算：真正决定耗时的是**递归进入的目录数**（每次 ReadDir 是系统调用），
//     而不是单个目录里有多少文件
//   - 跳过明显无关的目录（node_modules、缓存、系统目录）
func scanDir(dir string, name string, depth int) string {
	// 三道闸：深度、目录数预算、以及 wall-clock 上限。
	// 加时间上限是因为目录数预算无法约束"每个目录都很慢"的情况
	// （Windows 上 Program Files 叠加杀软扫描，单次 ReadDir 可能数百毫秒）。
	// 没有它，"保底扫描"可能反而让用户看到"依赖检测超时"。
	if depth > scanMaxDepth || scanDirsLeft <= 0 || time.Now().After(scanDeadline) {
		return ""
	}
	scanDirsLeft--

	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}

	var subdirs []string
	for _, e := range entries {
		full := filepath.Join(dir, e.Name())

		if e.IsDir() {
			if shouldSkipDir(e.Name()) {
				continue
			}
			subdirs = append(subdirs, full)
			continue
		}

		// 命中：文件名完全匹配（Windows 上大小写不敏感）
		if strings.EqualFold(e.Name(), name) {
			return full
		}
	}

	for _, sub := range subdirs {
		if found := scanDir(sub, name, depth+1); found != "" {
			return found
		}
	}
	return ""
}

const scanMaxDepth = 4

// scanDirsLeft 是单次扫描允许**进入**的目录数上限。
//
// 刻意按目录数而不是条目数计：早先按条目计（20000 条），在 Windows 上扫
// `C:\Program Files` 一个大目录就耗尽了预算，导致保底扫描形同虚设
// ——CI 的 windows job 正是这样把它暴露出来的。
//
// 每探测一个依赖都会重置。
var scanDirsLeft = 3000

// scanDeadline 是单次扫描的 wall-clock 上限。
// 由 findOne 在每次探测前设置。
var scanDeadline time.Time

// scanTimeLimit 单次扫描最多占用多久。宁可漏扫也不要把检测拖成超时。
const scanTimeLimit = 3 * time.Second

// shouldSkipDir 跳过明显不可能放可执行文件、或体量过大的目录
func shouldSkipDir(name string) bool {
	switch strings.ToLower(name) {
	case "node_modules", ".git", ".cache", "cache", "caches", "logs", "tmp", "temp",
		"windows", "system32", "winsxs", "$recycle.bin", "appdata":
		return true
	}
	return false
}

// scanRoots 返回扫描的根目录，按可能性排序。
//
// 只放"用户会自己放东西"的地方，不放整个磁盘根（在 Windows 上遍历 C:\ 太慢）。
func scanRoots() []string {
	home, _ := os.UserHomeDir()
	var roots []string

	if home != "" {
		roots = append(roots,
			filepath.Join(home, "Downloads"),
			filepath.Join(home, "Desktop"),
			filepath.Join(home, "Documents"),
			filepath.Join(home, "bin"),
			filepath.Join(home, ".local", "bin"),
			filepath.Join(home, "scoop", "apps"),
			filepath.Join(home, "AppData", "Local", "Programs"),
		)
	}

	switch runtime.GOOS {
	case "darwin":
		roots = append(roots, "/opt/homebrew/bin", "/usr/local/bin", "/Applications", "/opt/local/bin")
	case "linux":
		roots = append(roots, "/usr/local/bin", "/usr/bin", "/opt", "/snap/bin")
	case "windows":
		roots = append(roots,
			`C:\Program Files`,
			`C:\Program Files (x86)`,
			`C:\tools`,
			`C:\ffmpeg`,
		)
	}
	return roots
}

// ===== 候选路径 =====

type candidate struct {
	Path   string
	Source Source
}

func candidatesFor(kind Kind, opts Options) []candidate {
	name := BinaryName(kind)
	list := make([]candidate, 0, 16)
	add := func(dir string, source Source) {
		if dir == "" {
			return
		}
		list = append(list, candidate{Path: filepath.Join(dir, name), Source: source})
	}

	if p := opts.ManualPaths[kind]; p != "" {
		list = append(list, candidate{Path: p, Source: SourceManual})
	}
	add(opts.ManagedDir, SourceManaged)
	for _, dir := range systemDirs() {
		add(dir, SourceSystem)
	}
	return dedupe(list)
}

func dedupe(list []candidate) []candidate {
	seen := make(map[string]struct{}, len(list))
	out := make([]candidate, 0, len(list))
	for _, c := range list {
		key := filepath.Clean(c.Path)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, candidate{Path: key, Source: c.Source})
	}
	return out
}

func probeTool(kind Kind, path string) (probe.Info, error) {
	if _, err := os.Stat(path); err != nil {
		return probe.Info{Path: path}, err
	}
	return probe.Run(string(kind), path)
}

// ===== PATH 解析 =====

var (
	shellPathsOnce sync.Once
	shellPaths     []string
)

// systemDirs 返回登录 shell 的 PATH、当前 PATH 与各平台常见安装目录
func systemDirs() []string {
	dirs := filepath.SplitList(livePath())
	dirs = append(dirs, commonInstallDirs()...)

	filtered := make([]string, 0, len(dirs))
	for _, d := range dirs {
		d = strings.TrimSpace(d)
		// 打包应用会把自身目录塞进 PATH，需排除以免误判
		if d == "" || strings.Contains(d, "app.asar") {
			continue
		}
		filtered = append(filtered, filepath.Clean(d))
	}
	return filtered
}

// livePath 合并当前进程 PATH 与登录 shell 的 PATH。
//
// macOS / Linux 上从 Finder 或桌面启动的 GUI 应用只有精简 PATH
// （不含 /opt/homebrew/bin、~/.local/bin 等），所以补一次登录 shell 的输出。
func livePath() string {
	current := os.Getenv("PATH")
	if runtime.GOOS != "windows" {
		shellPathsOnce.Do(func() { shellPaths = loginShellPath() })
		if len(shellPaths) > 0 {
			current += string(os.PathListSeparator) + strings.Join(shellPaths, string(os.PathListSeparator))
		}
	}
	return current
}

func loginShellPath() []string {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
	}
	// -l 加载用户 rc 文件；超时后放弃，不阻塞探测
	out, err := outputWithTimeout(exec.Command(shell, "-l", "-c", `printf %s "$PATH"`), 3*time.Second)
	if err != nil {
		return nil
	}
	return filepath.SplitList(strings.TrimSpace(string(out)))
}

// expandWindowsGlobs 展开 WinGet\Packages 下的通配路径。
//
// 那里的目录名带随机哈希（yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe），
// 无法写死，只能列出来再按前缀匹配。
func expandWindowsGlobs(base string, patterns []string) []string {
	var out []string
	for _, pattern := range patterns {
		matches, err := filepath.Glob(filepath.Join(base, pattern))
		if err != nil {
			continue
		}
		out = append(out, matches...)
	}
	return out
}

func commonInstallDirs() []string {
	home, _ := os.UserHomeDir()
	var dirs []string

	switch runtime.GOOS {
	case "darwin":
		dirs = []string{
			"/opt/homebrew/bin", "/opt/homebrew/sbin",
			"/usr/local/bin", "/usr/local/sbin",
			"/opt/local/bin", "/opt/local/sbin",
			"/Library/Apple/usr/bin",
			"/usr/bin", "/bin", "/usr/sbin", "/sbin",
			"/Applications/yt-dlp.app/Contents/MacOS",
		}
	case "linux":
		dirs = []string{
			"/usr/local/bin", "/usr/local/sbin",
			"/usr/bin", "/bin", "/usr/sbin", "/sbin",
			"/snap/bin",
			"/var/lib/flatpak/exports/bin",
			"/usr/lib/yt-dlp/bin", "/usr/local/lib/yt-dlp/bin",
			"/app/bin", // Flatpak 沙箱内
		}
	case "windows":
		dirs = windowsInstallDirs(home)
		return append(dirs, extraDirs(home)...)
	}

	if home != "" {
		dirs = append(dirs, filepath.Join(home, "bin"), filepath.Join(home, ".local", "bin"))
	}
	return dirs
}

// windowsInstallDirs 返回 Windows 上的候选目录。
//
// 抽成接受 home 的纯函数，是为了能**在 macOS 上测试 Windows 的路径**——
// 直接读 os.UserHomeDir 的话，本地跑只能看到 macOS 的路径，等于没测
// （平台键那个 bug 就是这么漏过去的）。
func windowsInstallDirs(home string) []string {
	// winget 的几种落点（查 winget 清单 + 实际安装结果得出，不是猜的）：
	//   - WinGet\Links：portable 包（yt-dlp.yt-dlp）把 exe 软链到这里
	//   - WinGet\Packages：真正解压出来的目录，层级带包名与随机哈希
	//   - yt-dlp.FFmpeg 是 zip + nested portable，解压后为
	//     <hash>\ffmpeg-N-xxxx-win64-gpl\bin\{ffmpeg,ffprobe}.exe
	//   - DenoLand.Deno 提供 JS 运行时（yt-dlp 的清单把它列为依赖）
	wingetBase := filepath.Join(home, "AppData", "Local", "Microsoft", "WinGet")

	// winget 有**两套**落点：用户级与机器级（`--scope machine`）。
	// 只覆盖用户级会让"用管理员装"的用户被判为缺失。
	machineBase := filepath.Join(`C:\Program Files`, "WinGet")

	dirs := []string{
		`C:\ProgramData\chocolatey\bin`,
		`C:\Program Files\yt-dlp`,
		`C:\Program Files (x86)\yt-dlp`,
		`C:\ffmpeg\bin`,
		`C:\Program Files\ffmpeg\bin`,
		filepath.Join(home, "scoop", "shims"),
		filepath.Join(home, "scoop", "apps", "yt-dlp", "current"),
		filepath.Join(home, "scoop", "apps", "ffmpeg", "current", "bin"),
		// 用户级 winget
		filepath.Join(wingetBase, "Links"),
		// 机器级 winget（--scope machine）
		filepath.Join(machineBase, "Links"),
		filepath.Join(home, "AppData", "Local", "Microsoft", "WindowsApps"),
	}

	// Packages 下的目录名含随机哈希，只能展开通配；用户级与机器级都要展开
	dirs = append(dirs, expandWindowsGlobs(wingetBase, WindowsPackagePatterns)...)
	dirs = append(dirs, expandWindowsGlobs(machineBase, WindowsPackagePatterns)...)

	return dirs
}

// WindowsPackagePatterns 是 WinGet\Packages 下需要展开的通配模式。
//
// 用 filepath.Join 拼接而不是写死反斜杠，有两个好处：
//  1. 在 Windows 上得到正确的 `\` 分隔（filepath.Glob 用宿主分隔符匹配）
//  2. 在 macOS 上得到 `/`，于是可以用一个仿造的目录树**真正验证展开逻辑**
//     ——写死反斜杠时本地只能看到"展开结果为空"，等于没测
var WindowsPackagePatterns = []string{
	// yt-dlp.yt-dlp 是 portable 包，解压后的 exe 直接在包目录下
	filepath.Join("Packages", "yt-dlp.yt-dlp_*"),
	// yt-dlp.FFmpeg 是 zip + nested portable，多一层解压目录与 bin
	filepath.Join("Packages", "yt-dlp.FFmpeg_*"),
	filepath.Join("Packages", "yt-dlp.FFmpeg_*", "*", "bin"),
	// DenoLand.Deno 提供 JS 运行时（yt-dlp 的清单把它列为依赖）
	filepath.Join("Packages", "DenoLand.Deno_*"),
	// 用户直接装 Gyan.FFmpeg 的情况
	filepath.Join("Packages", "Gyan.FFmpeg_*"),
	filepath.Join("Packages", "Gyan.FFmpeg_*", "*", "bin"),
}

// extraDirs 跨平台都适用的用户级目录
func extraDirs(home string) []string {
	if home == "" {
		return nil
	}
	return []string{filepath.Join(home, "bin"), filepath.Join(home, ".local", "bin")}
}

func outputWithTimeout(cmd *exec.Cmd, timeout time.Duration) ([]byte, error) {
	type result struct {
		out []byte
		err error
	}
	ch := make(chan result, 1)
	go func() {
		out, err := cmd.Output()
		ch <- result{out, err}
	}()
	select {
	case r := <-ch:
		return r.out, r.err
	case <-time.After(timeout):
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		<-ch
		return nil, errors.New("timeout")
	}
}
