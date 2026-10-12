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

	if lastErr != nil {
		res.Reason = lastErr.Error()
	} else {
		res.Reason = "未在主目录、PATH 与常见安装目录中找到"
	}
	return res
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
		dirs = []string{
			`C:\ProgramData\chocolatey\bin`,
			`C:\Program Files\yt-dlp`,
			`C:\Program Files (x86)\yt-dlp`,
			`C:\ffmpeg\bin`,
			`C:\Program Files\ffmpeg\bin`,
			filepath.Join(home, "scoop", "shims"),
			filepath.Join(home, "scoop", "apps", "yt-dlp", "current"),
			filepath.Join(home, "scoop", "apps", "ffmpeg", "current", "bin"),
			filepath.Join(home, "AppData", "Local", "Microsoft", "WinGet", "Links"),
			filepath.Join(home, "AppData", "Local", "Microsoft", "WindowsApps"),
		}
	}

	if home != "" {
		dirs = append(dirs, filepath.Join(home, "bin"), filepath.Join(home, ".local", "bin"))
	}
	return dirs
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
