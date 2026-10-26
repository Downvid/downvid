// Package runtime 负责在机器上查找 yt-dlp / ffmpeg / ffprobe。
//
// 查找顺序（只认托管目录，三端一致）：
//  1. 显式指定的路径（设置里手动选择）
//  2. `~/.downvid/runtime/bin` 托管目录（DownVid 自己下载安装的）
//
// **不再扫描系统 PATH / Homebrew / WinGet 等目录**：同一台机器上「装了 Homebrew 的
// ffmpeg 但 yt-dlp 是托管的」这种混合状态会让三端表现各不相同，排障时说不清
// 到底跑的是哪一份。现在只有一处来源，缺了就由边车下载到同一目录。
package runtime

import (
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
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
	// KindAria2 是可选的下载加速器。放进同一套探测体系（而不是像以前那样
	// 在 electron/download/aria2.ts 里自己再写一遍候选表）有三个好处：
	//   1. 跨端一致：Windows 的 Scoop/WinGet/Chocolatey、macOS 的 Homebrew、
	//      Linux 的 snap/nix 等路径只在这里维护一份；
	//   2. 能复用同一套下载与 SHA-256 校验（Windows/Linux 有官方静态构建）；
	//   3. 界面只需要一个来源，不用在两个页面各显示一半状态。
	KindAria2 Kind = "aria2"
)

// Kinds 全部依赖，顺序即界面展示顺序
var Kinds = []Kind{KindYtDlp, KindFFmpeg, KindFFprobe, KindAria2}

// Optional 标记非必需依赖：ffprobe 只在部分后处理场景用到；
// aria2 只影响加速开关（没有它就用内置分块下载器，功能不缺失）
var Optional = map[Kind]bool{KindFFprobe: true, KindAria2: true}

// BinaryName 工具在磁盘上的文件名
//
// 只有 aria2 的二进制叫 aria2c（其余与 Kind 同名）。写错的表现是
// 「明明装了却永远显示未找到」，所以单独列出而不是靠命名约定。
func BinaryName(kind Kind) string {
	name := string(kind)
	if kind == KindAria2 {
		name = "aria2c"
	}
	if runtime.GOOS == "windows" {
		return name + ".exe"
	}
	return name
}

// Source 依赖来源，用于界面标识与排查
type Source string

const (
	SourceManaged Source = "managed" // DownVid 下载到 ~/.downvid/runtime/bin 的
	SourceManual  Source = "manual"  // 用户在设置里手动指定
	// SourceSystem / SourceScanned 已不再产生：探测只认托管目录与手动路径。
	// 常量保留是因为前端与历史结果里可能还带着这两个值，删掉会让旧数据解析成空串。
	SourceSystem  Source = "system"
	SourceScanned Source = "scanned"
)

// Options 探测输入
type Options struct {
	ManagedDir  string          // 托管目录，例如 ~/.downvid/runtime/bin
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
	// RequiredVersion 是当前清单要求的最低版本。界面用它判断「是否真的该提示更新」：
	// 早先只看 Managed 就显示「更新」按钮，于是**版本与清单一致时也显示更新**，
	// 用户点了才发现白下 37MB。
	RequiredVersion string `json:"requiredVersion,omitempty"`
	// Stale 表示「找到了可用副本，但版本落后于清单」。Found=false + Stale=true
	// 时界面才应该主动引导更新。
	Stale bool `json:"stale,omitempty"`
	// Form 是二进制的**形态**：`zipapp` / `native`。仅 yt-dlp 有意义。
	//
	// 为什么需要它：yt-dlp 的 Python zipapp 启动 0.4s，PyInstaller 独立包启动
	// 9~10s（每次都要解压 72MB），而两者的 `--version` **完全相同**。
	// 只看版本号的话，「装的是慢的那个」永远显示「已是最新」——
	// 用户明明被升级了清单却仍要等十几秒，而且没有任何提示说明为什么。
	Form string `json:"form,omitempty"`
}

// FindAll 依次探测全部依赖
func FindAll(opts Options) []Result {
	ctx, cancel := context.WithTimeout(context.Background(), DetectTimeout)
	defer cancel()
	return FindAllContext(ctx, opts)
}

// DetectTimeout 小于 Electron 的 90 秒超时，给 JSON 回传留出余量。
//
// 总时限必须容得下「一个依赖里最坏的那条路径」：托管副本 15 秒
// （见 probe.CandidateTimeout，yt-dlp 官方 macOS 构建首次执行最慢实测
// 12.4 秒）＋ 保底扫描 18 秒（见 scanTimeLimit）＝ 33 秒，仍远小于 80。
//
// 这是总时限的**唯一来源**：Electron 侧刻意不再传 `--timeout`（曾硬编码
// 70 秒把它覆盖掉，让「文档写 80、实际跑 70」静默对不上）。
const DetectTimeout = 80 * time.Second

// FindAllContext 并行探测全部依赖。
//
// ## 为什么必须并行
//
// 每个候选都要**真的执行一次**工具来读版本号，而 yt-dlp 的 PyInstaller 构建
// 单次启动实测 8~10 秒（每次都要把 72MB 解压到临时目录）。串行探测时，
// 总耗时是三者之和：设置面板打开后要等十几秒才显示状态，而用户看到的
// 只是一个转圈的图标 —— 很容易被理解成「应用卡死了」。
//
// 并行之后总耗时≈最慢的那一个（yt-dlp），ffmpeg / ffprobe / aria2 的探测
// 全都藏进它的阴影里。
//
// ## 为什么安全
//
//   - 各依赖的候选表、扫描/执行预算都是**按 kind 独立**的：预算现在是一次
//     探测私有的 `budget` 对象（见下方 budget 注释），不再是包级变量；
//   - 唯一的共享是 `ctx`（总时限）与只读的 `MinVersions`；
//   - 结果按 `Kinds` 的顺序写回固定下标，因此输出顺序稳定（界面按它展示）。
func FindAllContext(ctx context.Context, opts Options) []Result {
	results := make([]Result, len(Kinds))
	var wg sync.WaitGroup
	for i, kind := range Kinds {
		wg.Add(1)
		go func(i int, kind Kind) {
			defer wg.Done()
			results[i] = findOneContext(ctx, kind, opts)
		}(i, kind)
	}
	wg.Wait()
	return results
}

// FindOne 探测单个依赖（下载完成后用于回读结果）
func FindOne(kind Kind, opts Options) Result { return findOne(kind, opts) }

func findOne(kind Kind, opts Options) Result {
	return findOneContext(context.Background(), kind, opts)
}

func findOneContext(parent context.Context, kind Kind, opts Options) Result {
	ctx, cancel := context.WithTimeout(parent, probeTimeLimit)
	defer cancel()
	res := Result{Kind: string(kind), Optional: Optional[kind]}
	// 本次探测私有的预算：并行探测时绝不与其他依赖共享（见 budget 注释）
	b := newBudget()

	// 记录失败原因时**优先保留有信息量的那个**：
	// 「版本过旧」远比「某个候选路径不存在」重要，而后者总是最后一个，
	// 直接用 lastErr 会把前者覆盖掉（用户只看到 stat no such file）。
	var staleErr error // 找到了文件但版本太旧
	staleSeen := false // 至少有一个副本因版本过旧被拒
	var staleInfo probe.Info
	var staleSource Source
	var probeErr error // 找到了文件但执行失败（损坏、无权限等）
	var lastErr error  // 其它（路径不存在之类）
	for _, c := range candidatesFor(kind, opts) {
		if ctx.Err() != nil {
			break
		}
		// 卡死的候选会各自吃掉一个候选预算，若不加这道闸，十几个候选
		// 最坏能把一个依赖拖上几分钟。超过总预算就收手，宁可漏报也不要
		// 让界面一直转圈。
		if b.probeBudgetExhausted() {
			break
		}
		info, err := probeToolCandidate(ctx, kind, c)
		if err != nil {
			if _, statErr := os.Stat(c.Path); statErr == nil {
				probeErr = err // 文件存在但跑不起来，值得展示
			} else {
				lastErr = err // 路径不存在，信息量最低
			}
			continue
		}
		if !isAcceptableVersion(kind, info) {
			staleSeen = true
			// 始终让 staleInfo、staleSource 和 staleErr 保持同一份候选，
			// 且优先保留版本较新的那一个（例如 ~/.local/bin 的 2026.10.21 优于 /usr/bin 的 2026.07.04）
			if staleInfo.Path == "" || probe.CompareVersions(info.Version, staleInfo.Version) > 0 {
				staleInfo = info
				staleSource = c.Source
				staleErr = staleReason(kind, info)
			}
			continue
		}
		res.Found = true
		res.Path = info.Path
		res.Version = info.Version
		res.Source = string(c.Source)
		res.Managed = c.Source == SourceManaged
		res.RequiredVersion = requiredVersion(kind)
		res.Form = binaryForm(kind, info.Path)
		return res
	}

	res.RequiredVersion = requiredVersion(kind)
	res.Stale = staleSeen
	if staleSeen {
		res.Path = staleInfo.Path
		res.Version = staleInfo.Version
		res.Source = string(staleSource)
		res.Managed = staleSource == SourceManaged
		res.Form = binaryForm(kind, staleInfo.Path)
	}

	switch {
	case ctx.Err() != nil:
		res.Reason = "依赖检测达到时限，请手动指定可执行文件路径后重试"
	case staleErr != nil:
		// 「版本过旧」比「某个路径不存在」有信息量得多，必须优先展示
		res.Reason = staleErr.Error()
	case probeErr != nil:
		res.Reason = probeErr.Error()
	case lastErr != nil && !isNotExist(lastErr):
		res.Reason = lastErr.Error()
	default:
		res.Reason = "未在托管目录（~/.downvid/runtime/bin）或手动指定路径中找到，可在「设置 → 运行依赖」下载"
	}
	return res
}

// binaryForm 判断可执行文件的形态，目前只对 yt-dlp 有意义。
//
// 判定方式是**读首字节**而不是「大小」或「文件名」：
//   - `#!`      → 脚本（zipapp 的 shebang）
//   - 其他      → 原生二进制（PyInstaller 独立包 / 官方 exe）
//
// 只看前两字节就够，因此这个探测几乎零成本（相比执行一次 `--version` 的 0.4~10 秒）。
func binaryForm(kind Kind, path string) string {
	if kind != KindYtDlp || path == "" {
		return ""
	}
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	var head [2]byte
	if _, err := io.ReadFull(f, head[:]); err != nil {
		return ""
	}
	if head[0] == '#' && head[1] == '!' {
		return "zipapp"
	}
	return "native"
}

// requiredVersion 返回该依赖当前要求的最低版本；未注入时为 ""。
//
// 单独抽出来是因为它要出现在**每一条**返回路径上：界面靠它判断
// 「装了但版本不够」与「装的就是要求的版本」——后者不该提示更新。
func requiredVersion(kind Kind) string {
	return MinVersions[kind]
}

// isNotExist 判断错误是否只是"路径不存在"——这类原因没有诊断价值，
// 展示出来只会把真正的原因（版本过旧、文件损坏）挤掉
func isNotExist(err error) bool {
	return errors.Is(err, os.ErrNotExist) || strings.Contains(err.Error(), "no such file or directory")
}

// probeTimeoutMarker 与 probe 包的超时文案约定一致（probe.describeRunError）。
// 用字符串而不是错误类型，是因为超时可能由 probe 自己的子超时产生，
// 也可能由上游 ctx 取消产生，两者都被包装成了 errors.New。
const probeTimeoutMarker = "执行超时"

// isProbeTimeout 判断错误是否为"执行超时"（而非损坏、无权限、格式不对）
func isProbeTimeout(err error) bool {
	return err != nil && strings.Contains(err.Error(), probeTimeoutMarker)
}

// probeTimeLimit 是**一个依赖内**执行候选文件的总预算。
//
// 为什么需要这道闸：卡死的候选会各自吃掉一个候选预算，而候选表里可能有
// 十几个路径（PATH + 各平台常见安装目录），最坏情况能把一个依赖拖上几分钟。
//
// 取值：托管副本 15 秒（首次执行最慢实测 12.4 秒）＋ 若干个 5 秒的系统候选。
// 这个数字是**上界**而不是典型值：正常情况下托管副本命中就结束了。
const probeTimeLimit = 45 * time.Second

// budget 是一次依赖探测**私有**的预算对象。
//
// ## 为什么不再是包级变量（这是真出过事故的）
//
// `FindAllContext` 会并行探测四个依赖，`probeDeadline` 早先是包级变量：
// 四个 goroutine 同时 reset，彼此的额度互相覆盖。症状非常隐蔽——「A 是坏文件，
// 应继续找到 B」这类用例**始终**失败（另一个依赖先把预算抢到 0），单跑该用例
// 又必过；`go test -race` 一次就报出 DATA RACE。
//
// 预算天生是「一次探测之内」的状态，就该挂在这次探测上，而不是进程上。
type budget struct {
	probeDeadline time.Time
}

// newBudget 构造一份满额预算。
func newBudget() *budget {
	return &budget{probeDeadline: time.Now().Add(probeTimeLimit)}
}

// probeBudgetExhausted 判断候选执行总预算是否已用尽。
func (b *budget) probeBudgetExhausted() bool {
	if b == nil || b.probeDeadline.IsZero() {
		return false
	}
	return time.Now().After(b.probeDeadline)
}

// MinVersions 是各依赖的最低可用版本，由 CLI 从清单注入。
//
// 为什么不让本包直接读清单：`manifest` 需要 import 本包（为了平台键），
// 反向引用会造成 import cycle。因此由 CLI（同时能看到两者）注入。
//
// **yt-dlp 的值是清单里 pin 的 tag**：它是日期版本号，站点修复以周为单位发布，
// 按年份判断太松 —— 实测 2026.08.19 的版本跑 YouTube 会报
// `Requested format is not available`（上游同类 issue 已在新版修复），
// 而按年份它会「通过检测」，用户因此长期停在跑不动的版本上。
var MinVersions = map[Kind]string{}

// isAcceptableVersion 判断探测到的版本是否可用
func isAcceptableVersion(kind Kind, info probe.Info) bool {
	if min, ok := MinVersions[kind]; ok && min != "" {
		return !probe.IsOlder(info.Version, min)
	}
	// 未注入门槛时退回粗判（按主版本号）
	// aria2 的门槛是 1.36.0，比不了主版本号（主版本永远是 1）
	if kind == KindAria2 {
		return !probe.IsOlder(info.Version, Aria2MinVersion)
	}
	if min, ok := probe.MinimumMajor[string(kind)]; ok {
		return info.Major >= min
	}
	return true
}

// Aria2MinVersion aria2 的最低可用版本。
//
// 1.36 起修复了若干分段续传问题；更早的版本在 `--max-connection-per-server`
// 下会出现「暂停后再恢复从头下」——正是我们这次要修的类问题，
// 让老版本通过检测等于把同一个故障留给用户。
const Aria2MinVersion = "1.36.0"

// staleReason 生成「版本过旧」的提示，带上当前版本与要求版本，便于用户判断
func staleReason(kind Kind, info probe.Info) error {
	if kind == KindAria2 {
		return errors.New("aria2 版本过旧（当前 " + info.Version + "，需要 " + Aria2MinVersion +
			" 或更新），请在「设置 → 运行依赖」中下载")
	}
	if min, ok := MinVersions[kind]; ok && min != "" {
		return errors.New("版本过旧（当前 " + info.Version + "，需要 " + min +
			" 或更新），建议在「设置 → 运行依赖」中重新下载")
	}
	return errors.New("版本过旧（" + info.Version + "），建议重新下载")
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
	return probeToolContext(context.Background(), kind, path)
}

func probeToolContext(ctx context.Context, kind Kind, path string) (probe.Info, error) {
	return probeToolCandidate(ctx, kind, candidate{Path: path, Source: SourceSystem})
}

// probeToolCandidate 按候选来源决定执行时限。
//
// 托管副本与用户手动指定的路径都可能是官方 PyInstaller 构建（首次执行最慢
// 实测 12.4 秒），必须给足 15 秒；其余来源（理论上已不存在）用短预算尽快放弃。
func probeToolCandidate(ctx context.Context, kind Kind, c candidate) (probe.Info, error) {
	if _, err := os.Stat(c.Path); err != nil {
		return probe.Info{Path: c.Path}, err
	}
	timeout := probe.SystemCandidateTimeout
	if c.Source == SourceManaged || c.Source == SourceManual {
		timeout = probe.CandidateTimeout
	}
	return probe.RunWithTimeout(ctx, string(kind), c.Path, timeout)
}

// ===== PATH 解析 =====

var (
	shellPathsOnce sync.Once
	shellPaths     []string
)

// livePath 合并当前进程 PATH 与登录 shell 的 PATH。
//
// macOS / Linux 上从 Finder 或桌面启动的 GUI 应用只有精简 PATH
// （不含 /opt/homebrew/bin、~/.local/bin 等），所以补一次登录 shell 的输出。
func livePath() string {
	current := os.Getenv("PATH")
	if runtime.GOOS == "windows" {
		return current
	}
	shellPathsOnce.Do(func() { shellPaths = loginShellPath() })
	return mergePath(current, shellPaths)
}

// mergePath 把 extra 并入 current：去空、去重、保留顺序。
//
// 去重不是洁癖：EnsureChildPath 会把它写回 os.PATH，之后再调 livePath()
// 时 current 已经包含 shell 路径，没有去重就会一次次变长。
func mergePath(current string, extra []string) string {
	seen := make(map[string]struct{}, len(extra))
	out := make([]string, 0, len(extra)+8)
	for _, dir := range append(filepath.SplitList(current), extra...) {
		dir = strings.TrimSpace(dir)
		if dir == "" {
			continue
		}
		if _, ok := seen[dir]; ok {
			continue
		}
		seen[dir] = struct{}{}
		out = append(out, dir)
	}
	return strings.Join(out, string(os.PathListSeparator))
}

// LivePath 返回合并后的 PATH（当前进程 + 登录 shell）。
//
// 边车把自己解析出的 PATH 一起回传，宿主（Wails）就能用同一份 PATH
// 启动 yt-dlp，而不必再实现一遍登录 shell 解析。
func LivePath() string { return livePath() }

var childPathOnce sync.Once

// EnsureChildPath 把合并后的 PATH 写回本进程，供**之后启动的子进程**继承。
//
// 为什么必须做：macOS 上从 Finder 启动的 GUI 只有 /usr/bin:/bin:/usr/sbin:/sbin。
// 托管目录里的 yt-dlp 是 zipapp，shebang 是 `#!/usr/bin/env python3`；
// PATH 里只有系统自带的 Python 3.9 时，它会在启动瞬间报
// `ImportError: Only Python versions 3.11 and above are supported`。
// 结果是「刚下载完、版本也是最新的依赖」被探测成跑不起来 → 界面一直说
// 缺依赖，而用户无论重下多少次都一样。
//
// 光合并 PATH 不够：/usr/bin 通常排在第一位，里面就有 Python 3.9。
// 所以再确保一个满足要求的 python3 目录排在 PATH 最前面。
//
// 只在启动时合并一次：重复调用会重复执行登录 shell，白白拖慢启动。
func EnsureChildPath() {
	childPathOnce.Do(func() {
		merged := livePath()
		if runtime.GOOS != "windows" {
			merged = ensureModernPython(merged)
		}
		if merged != "" {
			_ = os.Setenv("PATH", merged)
		}
	})
}

// pythonSuitable 判断 `python3 --version` 的输出是否满足 yt-dlp 的要求
// （3.11+；yt-dlp 自己在启动时就会拒绝更旧的版本）。
func pythonSuitable(out string) bool {
	fields := strings.Fields(out)
	if len(fields) < 2 || fields[0] != "Python" {
		return false
	}
	parts := strings.Split(fields[1], ".")
	if len(parts) < 2 {
		return false
	}
	major, err := strconv.Atoi(parts[0])
	if err != nil {
		return false
	}
	minor, err := strconv.Atoi(parts[1])
	if err != nil {
		return false
	}
	return major > 3 || (major == 3 && minor >= 11)
}

// ensureModernPython 把满足 yt-dlp 要求的 python3 所在目录提到 PATH 最前。
//
// 只合并登录 shell 的 PATH 不够：/usr/bin 通常排第一，里面有系统自带的
// Python 3.9；zipapp 的 shebang 会先命中它，于是用户机器上明明装着 3.15，
// 仍然 `ImportError`。这里按 PATH 顺序找到第一个 3.11+ 的 python3，
// 把它的目录前置；一个都没有时原样返回（探测会如实报「跑不起来」）。
func ensureModernPython(path string) string {
	sep := string(os.PathListSeparator)
	dirs := filepath.SplitList(path)
	for i, dir := range dirs {
		if strings.TrimSpace(dir) == "" {
			continue
		}
		cand := filepath.Join(dir, "python3")
		if fi, err := os.Stat(cand); err != nil || fi.IsDir() {
			continue
		}
		out, err := outputWithTimeout(exec.Command(cand, "--version"), 2*time.Second)
		if err != nil || !pythonSuitable(string(out)) {
			continue
		}
		if i == 0 {
			return path
		}
		return dir + sep + path
	}
	return path
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
