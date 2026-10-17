// Package runtime 负责在机器上查找 yt-dlp / ffmpeg / ffprobe。
//
// 查找顺序（系统优先，缺失才由 DownVid 下载）：
//  1. 显式指定的路径（设置里手动选择）
//  2. userData 托管目录（DownVid 自己下载安装的）
//  3. 登录 shell 的 PATH（GUI 应用常拿不到完整 PATH，这一步很关键）
//  4. 各平台常见安装目录（Homebrew / winget / scoop / 发行版路径）
package runtime

import (
	"context"
	"errors"
	"io"
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
//   - 各依赖的候选表、扫描预算都是**按 kind 独立**的（`findOneContext` 内部
//     会重置预算），互不共享可变状态；
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
	// 重置扫描预算与时限：每个依赖独立计算，避免前一个把额度用光
	resetScanBudget()
	resetProbeBudget()

	// 记录失败原因时**优先保留有信息量的那个**：
	// 「版本过旧」远比「某个候选路径不存在」重要，而后者总是最后一个，
	// 直接用 lastErr 会把前者覆盖掉（用户只看到 stat no such file）。
	var staleErr error // 找到了文件但版本太旧
	staleSeen := false // 至少有一个副本因版本过旧被拒
	var probeErr error // 找到了文件但执行失败（损坏、无权限等）
	var lastErr error  // 其它（路径不存在之类）
	for _, c := range candidatesFor(kind, opts) {
		if ctx.Err() != nil {
			break
		}
		// 卡死的候选会各自吃掉一个候选预算，若不加这道闸，十几个候选
		// 最坏能把一个依赖拖上几分钟。超过总预算就收手，宁可漏报也不要
		// 让界面一直转圈。
		if probeBudgetExhausted() {
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
			staleErr = staleReason(kind, info)
			staleSeen = true
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

	// 保底：已知目录都没命中时，做一次**有界的**全盘扫描。
	//
	// 为什么需要：候选目录是枚举出来的，覆盖不了便携版、自定义安装目录、
	// 或者将来某个包管理器换的新落点。这类情况下用户明明装了却被告知缺失，
	// 且无从下手。
	//
	// 为什么必须有界：全盘遍历在 Windows 上可能耗时很久（且会扫到网络盘）。
	// 因此只扫几个最可能的根目录、限制深度与访问条目数、命中即停。
	// 扫描预算从扫描开始计算，不能被前面的版本执行消耗掉。
	resetScanBudget()
	if deadline, ok := ctx.Deadline(); ok && deadline.Before(scanDeadline) {
		scanDeadline = deadline
	}
	if fallback := scanForBinary(ctx, kind); fallback != nil {
		res.Found = true
		res.Path = fallback.Path
		res.Version = fallback.Version
		res.Source = string(SourceScanned)
		res.Managed = false
		res.Form = binaryForm(kind, fallback.Path)
		return res
	}

	res.RequiredVersion = requiredVersion(kind)
	res.Stale = staleSeen

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
		res.Reason = "未在托管目录、PATH、常见安装目录中找到（已尝试扫描常见位置）"
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

// probeDeadline 单次探测候选的 wall-clock 上限，由 findOne 在每次探测前设置。
var probeDeadline time.Time

// resetProbeBudget 重置候选执行总预算。与 resetScanBudget 一样是包级状态，
// 抽成函数让测试能显式重置（否则用例之间会互相影响，见 scan 那边的教训）。
func resetProbeBudget() {
	probeDeadline = time.Now().Add(probeTimeLimit)
}

// probeBudgetExhausted 判断候选执行总预算是否已用尽。零值视为无期限。
func probeBudgetExhausted() bool {
	if probeDeadline.IsZero() {
		return false
	}
	return time.Now().After(probeDeadline)
}

// scanForBinary 在常见根目录下有限度地搜索可执行文件。
//
// 只作为保底：正常路径（托管目录 / PATH / 常见安装目录）都已尝试过才会走到这里。
// 扫到的结果标记为 SourceScanned，界面会提示"自动扫描发现"，便于用户判断来源。
func scanForBinary(ctx context.Context, kind Kind) *probe.Info {
	name := BinaryName(kind)
	seen := map[string]bool{}
	var result *probe.Info

	for _, root := range scanRoots() {
		if seen[root] {
			continue
		}
		seen[root] = true

		found := scanDirMatching(root, name, 0, func(file string) bool {
			probeCtx, cancel := context.WithDeadline(ctx, scanDeadline)
			defer cancel()
			info, err := probeToolContext(probeCtx, kind, file)
			if err != nil || !isAcceptableVersion(kind, info) {
				return false
			}
			result = &info
			return true
		})
		if found != "" {
			return result
		}
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
	return scanDirMatching(dir, name, depth, func(string) bool { return true })
}

// 无效或过旧的同名文件不应遮蔽同一目录树中的其他副本。
func scanDirMatching(dir string, name string, depth int, accept func(string) bool) string {
	// 三道闸：深度、目录数预算、以及 wall-clock 上限。
	// 加时间上限是因为目录数预算无法约束"每个目录都很慢"的情况
	// （Windows 上 Program Files 叠加杀软扫描，单次 ReadDir 可能数百毫秒）。
	// 没有它，"保底扫描"可能反而让用户看到"依赖检测超时"。
	if depth > scanMaxDepth || scanDirsLeft <= 0 || scanExpired(time.Now()) {
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
		if strings.EqualFold(e.Name(), name) && accept(full) {
			return full
		}
	}

	for _, sub := range subdirs {
		if found := scanDirMatching(sub, name, depth+1, accept); found != "" {
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
var scanDirsLeft = scanMaxDirs

// scanMaxDirs 单次扫描允许进入的目录数上限
const scanMaxDirs = 3000

// scanDeadline 是单次扫描的 wall-clock 上限，由 findOne 在每次探测前设置。
var scanDeadline time.Time

// scanTimeLimit 单次扫描最多占用多久。宁可漏扫也不要把检测拖成超时。
//
// 必须**大于** probe.CandidateTimeout：否则扫描命中的第一个可执行文件
// （比如正是刚下载好的托管副本，首次执行本机实测最慢 12.4 秒）必然被扫描
// 时限掐断，保底扫描就永远发现不了它。CandidateTimeout + 一个候选的余量。
const scanTimeLimit = 18 * time.Second

// resetScanBudget 重置扫描的目录数预算与时限。
//
// 抽成函数是为了让测试能显式重置全局状态：这两个变量是包级可变状态，
// 用例之间会互相影响（CI 上就出现过"上一个用例把时限设成过去"导致
// 下一个用例静默失败）。
func resetScanBudget() {
	scanDirsLeft = scanMaxDirs
	scanDeadline = time.Now().Add(scanTimeLimit)
}

// scanExpired 判断扫描是否已超时。
//
// **零值必须视为"无期限"而不是"已过期"**：time.Time 的零值下
// `now.After(zero)` 恒为 true，会让扫描静默地什么都不做。
// 这个坑被 CI 抓到了——直接调用 scanDir 的用例（未经过 findOne 设置时限）
// 在 Windows 上（更慢、更容易触到）失败。
func scanExpired(now time.Time) bool {
	if scanDeadline.IsZero() {
		return false
	}
	return now.After(scanDeadline)
}

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
		local := envDir("LOCALAPPDATA", filepath.Join(home, "AppData", "Local"))
		roots = append(roots,
			filepath.Join(local, "Programs"),
			envDir("SCOOP", filepath.Join(home, "scoop")),
			envDir("SCOOP_GLOBAL", filepath.Join(envDir("ProgramData", `C:\ProgramData`), "scoop")),
			envDir("ProgramFiles", `C:\Program Files`),
			envDir("ProgramFiles(x86)", `C:\Program Files (x86)`),
			`C:\tools`,
			`C:\ffmpeg`,
		)
	}
	return roots
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
	return probeToolContext(context.Background(), kind, path)
}

func probeToolContext(ctx context.Context, kind Kind, path string) (probe.Info, error) {
	return probeToolCandidate(ctx, kind, candidate{Path: path, Source: SourceSystem})
}

// probeToolCandidate 按候选来源决定执行时限。
//
// 托管副本是我们自己下载的官方构建（PyInstaller，首次执行最慢实测 12.4 秒），
// 必须给足；系统副本通常是 0.2 秒的 zipapp，卡死时要尽快放弃——
// 候选表里可能有十几个路径，每个都等 15 秒会把一次检测拖到几分钟。
func probeToolCandidate(ctx context.Context, kind Kind, c candidate) (probe.Info, error) {
	if _, err := os.Stat(c.Path); err != nil {
		return probe.Info{Path: c.Path}, err
	}
	timeout := probe.SystemCandidateTimeout
	if c.Source == SourceManaged {
		timeout = probe.CandidateTimeout
	}
	return probe.RunWithTimeout(ctx, string(kind), c.Path, timeout)
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
			// Nix / NixOS：declarative 安装把二进制放在 profile 的 bin 下
			"/nix/var/nix/profiles/default/bin",
			"/run/current-system/sw/bin",
			// Homebrew on Linux
			"/home/linuxbrew/.linuxbrew/bin",
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
	local := envDir("LOCALAPPDATA", filepath.Join(home, "AppData", "Local"))
	programFiles := envDir("ProgramFiles", `C:\Program Files`)
	programData := envDir("ProgramData", `C:\ProgramData`)
	scoop := envDir("SCOOP", filepath.Join(home, "scoop"))
	scoopGlobal := envDir("SCOOP_GLOBAL", filepath.Join(programData, "scoop"))
	wingetBase := filepath.Join(local, "Microsoft", "WinGet")

	// winget 有**两套**落点：用户级与机器级（`--scope machine`）。
	// 只覆盖用户级会让"用管理员装"的用户被判为缺失。
	machineBase := filepath.Join(programFiles, "WinGet")

	dirs := []string{
		filepath.Join(envDir("ChocolateyInstall", filepath.Join(programData, "chocolatey")), "bin"),
		filepath.Join(programFiles, "yt-dlp"),
		filepath.Join(envDir("ProgramFiles(x86)", `C:\Program Files (x86)`), "yt-dlp"),
		`C:\ffmpeg\bin`,
		filepath.Join(programFiles, "ffmpeg", "bin"),
		filepath.Join(scoop, "shims"),
		filepath.Join(scoop, "apps", "yt-dlp", "current"),
		filepath.Join(scoop, "apps", "ffmpeg", "current", "bin"),
		// aria2 的 Scoop 包：`scoop install aria2` → apps\aria2\current\aria2c.exe
		// （不在 bin 子目录里，与 ffmpeg 不同）
		filepath.Join(scoop, "apps", "aria2", "current"),
		filepath.Join(scoopGlobal, "shims"),
		filepath.Join(scoopGlobal, "apps", "yt-dlp", "current"),
		filepath.Join(scoopGlobal, "apps", "ffmpeg", "current", "bin"),
		filepath.Join(scoopGlobal, "apps", "aria2", "current"),
		// 用户级 winget
		filepath.Join(wingetBase, "Links"),
		// 机器级 winget（--scope machine）
		filepath.Join(machineBase, "Links"),
		filepath.Join(local, "Microsoft", "WindowsApps"),
	}

	// Packages 下的目录名含随机哈希，只能展开通配；用户级与机器级都要展开
	dirs = append(dirs, expandWindowsGlobs(wingetBase, WindowsPackagePatterns)...)
	dirs = append(dirs, expandWindowsGlobs(machineBase, WindowsPackagePatterns)...)

	return dirs
}

func envDir(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
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
	// aria2：`winget install aria2.aria2` 是 portable 包，exe 直接在包目录下
	filepath.Join("Packages", "aria2.aria2_*"),
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
