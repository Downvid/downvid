// Package jsruntime —— 找 YouTube 解析/下载要用的 JS 运行时（Node.js 22+ / Deno 2.3+）。
//
// 这是 electron/utils/js-runtime.ts 的移植。候选表与版本判定由
// `pnpm crosscheck:port --module=js-runtime` 与 TS 版对同一批输入逐字比对。
//
// ## 为什么不能只用 exec.LookPath
//
// Wails 版最初只用 `exec.LookPath("node")`。可 macOS 从 Finder / 程序坞启动的应用只有
// `/usr/bin:/bin:/usr/sbin:/sbin`，Linux 从桌面启动也不读 `.zshrc` / `.bashrc`——
// Homebrew、nvm、fnm、mise、asdf 装的 node 都不在这个 PATH 里。于是终端里 `node -v`
// 明明是 v22，应用却报「YouTube 解析需要可运行的 Node.js 22+ 或 Deno 2.3+」
// （#62、#64、#65、#66、#67、#71、#75、#80 反复出现的同一句）。
//
// ## 从 TS 版继承的三条约束
//
//  1. **不能把 Electron 应用的可执行文件当成运行时**（LooksLikeNode）：TS 版曾把
//     DownVid.app 自己当成 deno 传给 yt-dlp，yt-dlp 照常执行，拉起了一整个应用。
//  2. **必须真的执行并校验版本**：文件存在不代表能用；低于 yt-dlp 的
//     `MIN_SUPPORTED_VERSION` 时 yt-dlp 不会用它。
//  3. **有总预算**：总共 6 秒、每个候选至多 1 秒。候选表里可能有几十个路径，
//     一个卡死的候选不能把解析拖住。
package jsruntime

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Kind 是运行时种类，取值与 yt-dlp 的 `--js-runtimes` 一致。
type Kind = string

const (
	KindNode Kind = "node"
	KindDeno Kind = "deno"
)

// Info 是一次探测的结果，字段与 TS 的 JsRuntimeInfo 一致。
type Info struct {
	Available bool   `json:"available"`
	Path      string `json:"path"`
	Kind      Kind   `json:"kind"`
	Name      string `json:"name"`
	Version   string `json:"version,omitempty"`
}

// Candidate 是一个待验证的候选路径。
type Candidate struct {
	Kind Kind   `json:"kind"`
	Path string `json:"path"`
}

// Entry 是目录里的一项：候选表只用到名字与「是不是目录」。
type Entry struct {
	Name  string
	IsDir bool
}

// Env 是生成候选时读取的外部状态。
//
// 全部可注入，是为了**在任意宿主上测任意平台**：在 macOS / Linux 上跑 Windows 的
// 候选表，才能抓到「只在 Windows 上错」的路径拼接（TS 版靠 vitest mock fs.readdirSync）。
type Env struct {
	// GOOS 用 Go 风格的取值（windows / darwin / linux）；空表示当前平台
	GOOS string
	// Getenv 读环境变量；nil 表示 os.Getenv（Windows 上大小写不敏感，与 Node 的 process.env 一致）
	Getenv func(string) string
	// Home 是用户目录；空表示 os.UserHomeDir()
	Home string
	// ReadDir 列目录；nil 表示 os.ReadDir
	ReadDir func(dir string) ([]Entry, error)
}

func (e Env) withDefaults() Env {
	if e.GOOS == "" {
		e.GOOS = runtime.GOOS
	}
	if e.Getenv == nil {
		e.Getenv = os.Getenv
	}
	if e.Home == "" {
		e.Home, _ = os.UserHomeDir()
	}
	if e.ReadDir == nil {
		e.ReadDir = readDir
	}
	return e
}

func readDir(dir string) ([]Entry, error) {
	list, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	entries := make([]Entry, 0, len(list))
	for _, d := range list {
		entries = append(entries, Entry{Name: d.Name(), IsDir: d.IsDir()})
	}
	return entries, nil
}

// LooksLikeNode 排除 Electron 应用（含打包后的 DownVid 自己）的可执行文件。
func LooksLikeNode(candidate string) bool {
	normalized := strings.ReplaceAll(strings.ToLower(candidate), `\`, "/")
	return !strings.Contains(normalized, ".app/contents/macos/") && !strings.Contains(normalized, "electron")
}

// isSupportedVersion 与 yt-dlp 的 `MIN_SUPPORTED_VERSION` 一致：低于 Node 22.0.0 / Deno 2.3.0 时 yt-dlp 不会用它
func isSupportedVersion(kind Kind, major, minor int) bool {
	if kind == KindNode {
		return major >= 22
	}
	return major > 2 || major == 2 && minor >= 3
}

// jsSpace 是 JS 正则里 `\s` 与 String.prototype.trim 认的空白（WhiteSpace + LineTerminator）。
//
// Go 的 `\s` 只有 ASCII 的五个，strings.TrimSpace 又比 JS 多去 U+0085、少去 U+FEFF：
// 直接用它们会在这些字符上与 TS 版分叉，所以显式写出同一组字符。
const jsSpace = "\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"

var (
	nodeVersionOutput = regexp.MustCompile(`^v(\d+)\.(\d+)\.(\d+)[` + jsSpace + `]*$`)
	denoVersionOutput = regexp.MustCompile(`^deno (\d+)\.(\d+)\.(\d+)(?:[` + jsSpace + `]|$)`)
)

func isJSSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0x00a0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

// SupportedVersion 从 `--version` 的输出里取受支持的版本号（`x.y.z`）。
// 输出对不上、或版本过旧时返回空串（TS 版返回 null）。
func SupportedVersion(kind Kind, output string) string {
	pattern := denoVersionOutput
	if kind == KindNode {
		pattern = nodeVersionOutput
	}
	m := pattern.FindStringSubmatch(strings.TrimFunc(output, isJSSpace))
	if m == nil {
		return ""
	}
	major, _ := strconv.Atoi(m[1])
	minor, _ := strconv.Atoi(m[2])
	if !isSupportedVersion(kind, major, minor) {
		return ""
	}
	return m[1] + "." + m[2] + "." + m[3]
}

// versionDir 是版本管理器的版本目录名：`v22.11.0`（nvm、fnm、nvm-windows）或 `22.11.0`（mise、asdf、Volta）
var versionDir = regexp.MustCompile(`^v?(\d+)\.(\d+)\.(\d+)$`)

// kegOnlyNode 是 Homebrew 的版本化 formula（`node@22`），keg-only，不会链接进 bin
var kegOnlyNode = regexp.MustCompile(`^node@(\d+)$`)

// versionedBinaries 列出 `root` 下以版本号命名的安装目录，返回其中受支持版本的可执行文件，从新到旧。
//
// 不去猜用户的「默认版本」：只要有一个受支持的版本能跑就够了。
// 不匹配 `pattern` 的名字一律跳过——mise 的 `22`、`latest` 这类别名只是指向完整版本目录的软链，
// 不会因此漏掉版本。低于最低版本的目录不执行，免得把探测预算花在注定被拒的旧版本上。
// 只看名字、不看 IsDir：Homebrew 的 `opt/node@22` 是软链，Windows 的联接点也被报告成链接，
// 两者的 IsDir 都是 false；断掉的链接会在执行前的 stat 那一步被跳过。
func versionedBinaries(e Env, join func(...string) string, kind Kind, root string, pattern *regexp.Regexp, binary ...string) []string {
	entries, err := e.ReadDir(root)
	if err != nil {
		return nil
	}
	type found struct {
		name    string
		version [3]int
	}
	var list []found
	for _, entry := range entries {
		m := pattern.FindStringSubmatch(entry.Name)
		if m == nil {
			continue
		}
		var v [3]int
		for i := range v {
			if i+1 < len(m) {
				v[i], _ = strconv.Atoi(m[i+1])
			}
		}
		if isSupportedVersion(kind, v[0], v[1]) {
			list = append(list, found{name: entry.Name, version: v})
		}
	}
	sort.SliceStable(list, func(i, j int) bool {
		a, b := list[i].version, list[j].version
		for k := range a {
			if a[k] != b[k] {
				return a[k] > b[k]
			}
		}
		return false
	})
	paths := make([]string, 0, len(list))
	for _, f := range list {
		paths = append(paths, join(append([]string{root, f.name}, binary...)...))
	}
	return paths
}

// Candidates 按优先级列出所有候选（只拼路径，不检查是否存在，也不执行）。
//
// GUI 进程可能持有旧 PATH（或根本没有 shell 里配置的 PATH），Node 与 Deno 都要有安装目录兜底。
func Candidates(e Env) []Candidate {
	e = e.withDefaults()
	win := e.GOOS == "windows"
	join := posixJoin
	sep := ":"
	if win {
		join = win32Join
		sep = ";"
	}
	exe := func(kind Kind) string {
		if win {
			return kind + ".exe"
		}
		return kind
	}

	var list []Candidate
	add := func(kind Kind, file string) {
		if file != "" {
			list = append(list, Candidate{Kind: kind, Path: file})
		}
	}
	for _, dir := range strings.Split(e.Getenv("PATH"), sep) {
		if dir == "" {
			continue
		}
		for _, kind := range []Kind{KindNode, KindDeno} {
			add(kind, join(dir, exe(kind)))
		}
	}
	add(KindNode, e.Getenv("DOWNVID_NODE_PATH"))
	if win {
		local := or(e.Getenv("LOCALAPPDATA"), join(e.Home, "AppData", "Local"))
		programFiles := or(e.Getenv("ProgramFiles"), `C:\Program Files`)
		programData := or(e.Getenv("ProgramData"), `C:\ProgramData`)
		for _, dir := range []string{programFiles, or(e.Getenv("ProgramFiles(x86)"), `C:\Program Files (x86)`)} {
			add(KindNode, join(dir, "nodejs", "node.exe"))
		}
		add(KindNode, join(or(e.Getenv("APPDATA"), join(e.Home, "AppData", "Roaming")), "npm", "node.exe"))
		add(KindNode, join(local, "Programs", "nodejs", "node.exe"))
		for _, scoop := range []string{or(e.Getenv("SCOOP"), join(e.Home, "scoop")), or(e.Getenv("SCOOP_GLOBAL"), join(programData, "scoop"))} {
			for _, kind := range []Kind{KindNode, KindDeno} {
				add(kind, join(scoop, "shims", kind+".exe"))
			}
			add(KindDeno, join(scoop, "apps", "deno", "current", "deno.exe"))
		}
		for _, winget := range []string{join(local, "Microsoft", "WinGet"), join(programFiles, "WinGet")} {
			add(KindDeno, join(winget, "Links", "deno.exe"))
			packages := join(winget, "Packages")
			if entries, err := e.ReadDir(packages); err == nil {
				for _, entry := range entries {
					if entry.IsDir && strings.HasPrefix(strings.ToLower(entry.Name), "denoland.deno_") {
						add(KindDeno, join(packages, entry.Name, "deno.exe"))
					}
				}
			}
		}
	} else {
		for _, dir := range []string{"/usr/bin", "/usr/local/bin", "/opt/homebrew/bin", join(e.Home, ".local", "bin")} {
			for _, kind := range []Kind{KindNode, KindDeno} {
				add(kind, join(dir, kind))
			}
		}
	}
	add(KindDeno, join(e.Home, ".deno", "bin", exe(KindDeno)))
	return append(list, installDirFallbacks(e, win, join)...)
}

// installDirFallbacks 是系统安装目录与版本管理器的兜底候选。
//
// macOS 从 Finder / 程序坞启动的应用只有 `/usr/bin:/bin:/usr/sbin:/sbin`，Linux 从桌面启动也不读
// `.zshrc` / `.bashrc`——而 nvm、fnm、mise、asdf 正是在这些文件里把 node 加进 PATH 的，
// Homebrew 的 `node@22` 这类 keg-only 版本和 MacPorts 也要用户自己改 PATH。
// Windows 上 fnm、mise 通常只在 PowerShell profile 里激活；nvm-windows 的 `nvm use` 要管理员权限建软链，
// 失败时版本已经装好却不在 PATH 里。
//
// 这些候选排在原有候选**之后**：原有候选里只要有一个可用，选中的仍是同一个，
// 新候选只在原来什么都找不到时才会被执行到。
// 各工具的根目录先看环境变量，再看它不同版本的默认位置（GUI 进程通常没有这些环境变量）。
func installDirFallbacks(e Env, win bool, join func(...string) string) []Candidate {
	var list []Candidate
	add := func(kind Kind, files ...string) {
		for _, file := range files {
			list = append(list, Candidate{Kind: kind, Path: file})
		}
	}
	versions := func(kind Kind, roots []string, sub []string, binary ...string) {
		for _, root := range roots {
			if root != "" {
				add(kind, versionedBinaries(e, join, kind, join(append([]string{root}, sub...)...), versionDir, binary...)...)
			}
		}
	}
	if win {
		local := or(e.Getenv("LOCALAPPDATA"), join(e.Home, "AppData", "Local"))
		roaming := or(e.Getenv("APPDATA"), join(e.Home, "AppData", "Roaming"))
		// nvm-windows 1.2.1 起默认 %LOCALAPPDATA%\nvm，更早是 %APPDATA%\nvm；当前版本链接在 NVM_SYMLINK
		add(KindNode, join(or(e.Getenv("NVM_SYMLINK"), `C:\nvm4w\nodejs`), "node.exe"))
		versions(KindNode, []string{e.Getenv("NVM_HOME"), join(local, "nvm"), join(roaming, "nvm")}, nil, "node.exe")
		versions(KindNode, []string{e.Getenv("FNM_DIR"), join(roaming, "fnm"), join(e.Home, ".fnm")}, []string{"node-versions"}, "installation", "node.exe")
		// Volta 的 bin\ 里只有 node.cmd（不能直接执行），真正的二进制在 tools\image 下
		versions(KindNode, []string{or(e.Getenv("VOLTA_HOME"), join(local, "Volta"))}, []string{"tools", "image", "node"}, "node.exe")
		mise := or(e.Getenv("MISE_DATA_DIR"), join(local, "mise"))
		versions(KindNode, []string{mise}, []string{"installs", "node"}, "node.exe")
		versions(KindDeno, []string{mise}, []string{"installs", "deno"}, "bin", "deno.exe")
		return list
	}
	// 与运行依赖边车的 commonInstallDirs 对齐：MacPorts、Snap、Linuxbrew、Nix
	for _, dir := range []string{
		"/opt/local/bin", "/snap/bin", "/home/linuxbrew/.linuxbrew/bin",
		join(e.Home, ".nix-profile", "bin"), "/nix/var/nix/profiles/default/bin", "/run/current-system/sw/bin",
	} {
		for _, kind := range []Kind{KindNode, KindDeno} {
			add(kind, join(dir, kind))
		}
	}
	// Homebrew 的 node@22、node@24 是 keg-only，不会链接进 bin
	for _, prefix := range []string{"/opt/homebrew", "/usr/local", "/home/linuxbrew/.linuxbrew"} {
		add(KindNode, versionedBinaries(e, join, KindNode, join(prefix, "opt"), kegOnlyNode, "bin", "node")...)
	}
	data := or(e.Getenv("XDG_DATA_HOME"), join(e.Home, ".local", "share"))
	config := or(e.Getenv("XDG_CONFIG_HOME"), join(e.Home, ".config"))
	// nvm 的安装脚本在设置了 XDG_CONFIG_HOME 时装进 $XDG_CONFIG_HOME/nvm，否则 ~/.nvm
	versions(KindNode, []string{e.Getenv("NVM_DIR"), join(e.Home, ".nvm"), join(config, "nvm")}, []string{"versions", "node"}, "bin", "node")
	// fnm 在 macOS 上也用 XDG 目录；但官方安装脚本把 fnm 本体放进 ~/Library/Application Support/fnm，
	// 这个目录一旦存在，fnm 就把版本也装在那里
	versions(KindNode, []string{
		e.Getenv("FNM_DIR"), join(data, "fnm"), join(e.Home, ".fnm"), join(e.Home, "Library", "Application Support", "fnm"),
	}, []string{"node-versions"}, "installation", "bin", "node")
	// Volta 的 bin/node 是不依赖 PATH 的 shim（走用户的默认版本），tools/image 下是真正的二进制
	volta := or(e.Getenv("VOLTA_HOME"), join(e.Home, ".volta"))
	add(KindNode, join(volta, "bin", "node"))
	versions(KindNode, []string{volta}, []string{"tools", "image", "node"}, "bin", "node")
	// mise / asdf 的 shims 要它们自己在 PATH 里才能工作，所以直接取 installs 下的真实二进制
	for _, kind := range []Kind{KindNode, KindDeno} {
		asdfPlugin := "deno"
		if kind == KindNode {
			asdfPlugin = "nodejs"
		}
		versions(kind, []string{or(e.Getenv("MISE_DATA_DIR"), join(data, "mise"))}, []string{"installs", kind}, "bin", kind)
		versions(kind, []string{or(e.Getenv("ASDF_DATA_DIR"), join(e.Home, ".asdf"))}, []string{"installs", asdfPlugin}, "bin", kind)
	}
	// n 默认装进 /usr/local/bin（原有候选已覆盖）；n-install 的默认前缀是 ~/n
	add(KindNode, join(or(e.Getenv("N_PREFIX"), join(e.Home, "n")), "bin", "node"))
	return list
}

// or 对应 TS 的 `a || b`：空串视为没有设置。
func or(value, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}

const (
	// totalBudget / candidateBudget 与 TS 版一致：总共 6 秒，每个候选至多 1 秒
	totalBudget     = 6 * time.Second
	candidateBudget = time.Second
	// maxOutput 与 TS 版 execFile 的 maxBuffer 一致：`--version` 输出超过它就视为失败
	maxOutput = 16384
	// waitDelay：候选被杀之后最多再等这么久让 stdout 关闭（见 runVersion）
	waitDelay = 500 * time.Millisecond
)

// Check 找到第一个能实际执行、且版本受支持的运行时；都不行时 Available 为 false。
func Check(ctx context.Context) Info { return CheckWith(ctx, Env{}) }

// CheckWith 用给定的环境生成候选，再逐个真实执行验证。
func CheckWith(ctx context.Context, e Env) Info {
	return probe(ctx, Candidates(e), isRegularFile, runVersion)
}

// probe 是 TS 版 checkJsRuntime 的循环：判定「存在 → 执行 → 校验版本」的顺序与预算都在这里。
//
// 文件检查与执行都是注入的，单测才能在不起进程的情况下钉住「跳过谁、选中谁」。
func probe(ctx context.Context, candidates []Candidate, isFile func(string) bool, run func(context.Context, string) (string, error)) Info {
	deadline := time.Now().Add(totalBudget)
	checked := make(map[string]bool, len(candidates))
	for _, c := range candidates {
		if c.Kind == KindNode && !LooksLikeNode(c.Path) {
			continue
		}
		if checked[c.Path] {
			continue
		}
		checked[c.Path] = true
		if !isFile(c.Path) {
			continue
		}
		remaining := time.Until(deadline)
		if remaining <= 0 || ctx.Err() != nil {
			break
		}
		runCtx, cancel := context.WithTimeout(ctx, min(candidateBudget, remaining))
		out, err := run(runCtx, c.Path)
		cancel()
		if err != nil {
			continue
		}
		version := SupportedVersion(c.Kind, out)
		if version == "" {
			continue
		}
		name := "Deno"
		if c.Kind == KindNode {
			name = "Node.js"
		}
		return Info{Available: true, Path: c.Path, Kind: c.Kind, Name: name, Version: version}
	}
	return Info{}
}

func isRegularFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

var errOutputTooLarge = errors.New("--version 输出过长")

// runVersion 执行 `<path> --version` 并返回 stdout。
//
// WaitDelay 不能省（与边车 probe.run 同一个教训）：超时只会杀掉直接子进程，
// 而候选可能是 shell 脚本（如 PATH 里的 asdf shim），它的孙进程还占着 stdout，
// 没有 WaitDelay 时 Wait 会一直等管道关闭，1 秒的预算形同虚设。
func runVersion(ctx context.Context, path string) (string, error) {
	cmd := exec.CommandContext(ctx, path, "--version")
	hideWindow(cmd)
	cmd.WaitDelay = waitDelay
	out := &cappedBuffer{limit: maxOutput}
	cmd.Stdout = out
	if err := cmd.Run(); err != nil {
		return "", err
	}
	if out.overflow {
		return "", errOutputTooLarge
	}
	return out.buf.String(), nil
}

// cappedBuffer 只保留前 limit 个字节，超出时记下 overflow 并丢弃其余输出。
type cappedBuffer struct {
	buf      strings.Builder
	limit    int
	overflow bool
}

func (b *cappedBuffer) Write(p []byte) (int, error) {
	if room := b.limit - b.buf.Len(); room < len(p) {
		b.overflow = true
		if room > 0 {
			b.buf.Write(p[:room])
		}
		return len(p), nil
	}
	return b.buf.Write(p)
}
