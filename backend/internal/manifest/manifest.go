// Package manifest 决定"下载哪个版本、从哪下、校验值是多少"。
//
// 具体的 tag 与 SHA-256 放在 assets.gen.go（由 scripts/gen-deps-manifest.mjs 生成），
// 本文件只保留取用逻辑。版本固定而非"取最新"：安装结果可复现、可校验。
package manifest

import (
	"fmt"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strconv"
	"strings"
	"sync"

	"github.com/yxxbc/downvid/backend/internal/fetch"
	rt "github.com/yxxbc/downvid/backend/internal/runtime"
)

// pythonSupportsZipapp 判断 Python 版本是否满足 yt-dlp 的要求。
//
// 门槛是 **3.11**，不是 3.9：yt-dlp 在启动时自己就会拒绝更旧的版本
// （`ImportError: Only Python versions 3.11 and above are supported`）。
// 曾经这里写成 >= 309，于是 macOS 自带的 3.9 被当成「可用」，
// 给用户下载了一个永远跑不起来的 zipapp，表现为「依赖下载成功却一直说缺失」。
func pythonSupportsZipapp(version int) bool { return version >= 311 }

// HasUsablePython 判断系统里是否有能跑 yt-dlp zipapp 的 python3。
//
// 门槛是 3.11（见 pythonSupportsZipapp）：macOS 自带的 /usr/bin/python3 是
// 3.9.6（Command Line Tools），**跑不了** zipapp；很多机器上甚至只是一个会弹
// 安装提示的 stub。所以要真的执行一次 `--version` 才算数，不能只看文件存在。
//
// 调用前 PATH 已经由 rt.EnsureChildPath 补齐（登录 shell + 3.11+ 前置），
// 否则 GUI 进程会只看到 /usr/bin 里的 3.9，误判成「没有可用 Python」。
//
// 结果缓存：这个函数在每次 fetch 时都会被问一次，而 `python3 --version`
// 要 spawn 一个进程。缓存 10 分钟足够（用户不会在中途换解释器）。
var (
	pythonOnce   sync.Once
	pythonUsable bool
)

func HasUsablePython() bool {
	pythonOnce.Do(func() {
		for _, exe := range []string{"python3", "python"} {
			out, err := exec.Command(exe, "--version").Output()
			if err != nil {
				continue
			}
			if version := parsePythonVersion(string(out)); pythonSupportsZipapp(version) {
				pythonUsable = true
				return
			}
		}
	})
	return pythonUsable
}

// parsePythonVersion 把 "Python 3.11.9" 解析成 311 这种整数（便于比较）。
// 解析失败返回 0 —— 宁可退回自包含包，也不要把跑不起来的 zipapp 装给用户。
func parsePythonVersion(out string) int {
	fields := strings.Fields(strings.TrimSpace(out))
	for _, f := range fields {
		if !strings.Contains(f, ".") {
			continue
		}
		parts := strings.SplitN(f, ".", 3)
		if len(parts) < 2 {
			continue
		}
		major, err1 := strconv.Atoi(parts[0])
		minor, err2 := strconv.Atoi(parts[1])
		if err1 != nil || err2 != nil {
			continue
		}
		return major*100 + minor
	}
	return 0
}

// MinYtDlpVersion 是判定 yt-dlp「过旧」的最低版本，等于清单里 pin 的 tag。
//
// 为什么不能像以前那样只比年份（MinimumMajor = 2024）：yt-dlp 是**日期版本号**，
// 站点修复以周为单位发布。实测 2026.08.19 的版本跑 YouTube 会报
// `Requested format is not available`（上游同类 issue #17586 已在新版修复），
// 而按年份判断它会「通过检测」——用户因此长期停在一个已经跑不动的版本上。
//
// 门槛取**清单里 pin 的那个版本**：我们本来就会下载它，落后即提示重新下载。
// 这样「检测认为可用」与「实际能下载」是同一个标准。
func MinYtDlpVersion() string { return YtDlpTag }

// Platforms 支持的平台组合，供 CI 交叉构建与校验使用
var Platforms = []string{"darwin/arm64", "darwin/x64", "linux/x64", "linux/arm64", "win32/x64"}

// asset 一个可下载产物：上游文件名与下载内容的 SHA-256。
// gzip 产物的校验值针对压缩文件本身（下载即校验，先校验后解压）。
type asset struct {
	Name   string
	SHA256 string
}

// aria2Asset 一个平台的 aria2 下载描述。
//
// 逐平台记完整 URL（而不是共用 base + tag）：五个平台来自三个社区源，
// 各自的 tag 形式不同（1.37.0 / aria2-1.37.0 / latest）。
// Archive 决定解包方式：zip / tar.gz / raw（下载物本身就是可执行文件）。
type aria2Asset struct {
	URL     string
	SHA256  string
	Archive string
	Inner   string // 归档内的文件名；Archive 为 raw 时为空
}

// ytdlpAsset yt-dlp 的产物描述：主用 + 可选回退。
//
// 主用是 Python zipapp（启动 0.4s），回退是 PyInstaller 独立包（启动 9~10s，
// 但不需要解释器）。系统没有可用 python3 时用回退，见 TasksFor。
// Bundled 为空表示该平台两者相同（Windows 的 yt-dlp.exe 本来就自带解释器）。
type ytdlpAsset struct {
	Name          string
	SHA256        string
	Bundled       string
	BundledSHA256 string
	// ZipApp 表示主用产物需要 python3 才能运行
	ZipApp bool
}

// CurrentPlatform 当前平台，键名与 electron-builder 的 ${platform}-${arch} 一致。
//
// **不能直接用 Go 的 GOOS/GOARCH**：Go 是 windows/amd64，electron-builder 是
// win32/x64。资产表按后者命名，直接拼 Go 的值会在 Windows 上永远查不到表
// （报"暂不支持 windows/amd64 平台的下载"），而 macOS/Linux 因为两种命名恰好
// 一致所以看不出问题——这个 bug 只在 Windows 上出现。
func CurrentPlatform() string {
	return PlatformKey(goruntime.GOOS, goruntime.GOARCH)
}

// PlatformKey 把 Go 的 GOOS/GOARCH 映射为 electron-builder 的平台键。
//
// 做成接受参数的纯函数，是为了能**在 macOS 上测试 Windows 的映射**——
// 之前把映射写成读全局 GOOS/GOARCH，用例只能 `if runtime.GOOS == "windows"`
// 才断言，于是这个 Windows 专属 bug 在本地永远测不出来（实测：注入变异后
// 用例照样通过）。
func PlatformKey(goos, goarch string) string {
	return nodePlatform(goos) + "/" + nodeArch(goarch)
}

// nodePlatform 把 GOOS 映射为 Node/electron-builder 的平台名
func nodePlatform(goos string) string {
	if goos == "windows" {
		return "win32"
	}
	return goos
}

// nodeArch 把 GOARCH 映射为 Node/electron-builder 的架构名
func nodeArch(goarch string) string {
	switch goarch {
	case "amd64":
		return "x64"
	case "386":
		return "ia32"
	default:
		return goarch
	}
}

// Tasks 生成当前平台的下载任务；only 为空表示全部依赖。
func Tasks(managedDir string, only []string) ([]fetch.Task, error) {
	return TasksFor(CurrentPlatform(), managedDir, only)
}

// TasksFor 与 Tasks 相同，但显式指定平台键。
//
// 单独暴露是为了能在 macOS 上验证 **Windows 的完整下载路径**——issue #40 的
// 最小复现是 Windows 上跑 `downvid-deps.exe fetch --only ffmpeg`，而本机跑不了
// Windows 二进制。有了这个入口，就能用 "win32/x64" 直接断言任务能生成。
func TasksFor(platform, managedDir string, only []string) ([]fetch.Task, error) {
	want := make(map[string]bool, len(only))
	for _, k := range only {
		want[k] = true
	}
	need := func(kind string) bool { return len(want) == 0 || want[kind] }

	var tasks []fetch.Task

	if need(string(rt.KindYtDlp)) {
		a, ok := ytdlpAssets[platform]
		if !ok {
			return nil, fmt.Errorf("暂不支持 %s 平台的 yt-dlp 下载", platform)
		}
		// zipapp 需要 python3。有就用它（启动 0.4s vs 独立包的 9~10s，
		// 用户能直接感觉到差别），没有就退回自包含包 —— 那个一定能跑，
		// 只是每次启动都要解压 72MB。
		chosen, chosenHash, name := a.Name, a.SHA256, a.Name
		if a.ZipApp && a.Bundled != "" && !HasUsablePython() {
			chosen, chosenHash, name = a.Bundled, a.BundledSHA256, a.Bundled
		}
		tasks = append(tasks, fetch.Task{
			Tool:   string(rt.KindYtDlp),
			URL:    ytdlpBase + "/" + chosen,
			SHA256: chosenHash,
			Target: filepath.Join(managedDir, rt.BinaryName(rt.KindYtDlp)),
		})
		_ = name
	}

	// aria2：五个平台来自三个社区源，见 assets.gen.go 的说明。
	// 万一某个平台缺项也**跳过而不是报错**——它是可选加速器，
	// 报错会让用户以为整个依赖下载坏了。
	if need(string(rt.KindAria2)) {
		if a, ok := aria2Assets[platform]; ok {
			task := fetch.Task{
				Tool:   string(rt.KindAria2),
				URL:    a.URL,
				SHA256: a.SHA256,
				Target: filepath.Join(managedDir, rt.BinaryName(rt.KindAria2)),
			}
			switch a.Archive {
			case "zip":
				task.ZipInner = a.Inner
			case "tar.gz":
				task.TarInner = a.Inner
			case "raw":
				// 下载物就是可执行文件本身
			default:
				return nil, fmt.Errorf("%s 的 aria2 归档格式未知：%q", platform, a.Archive)
			}
			tasks = append(tasks, task)
		}
	}

	for _, kind := range []rt.Kind{rt.KindFFmpeg, rt.KindFFprobe} {
		if !need(string(kind)) {
			continue
		}
		byKind, ok := ffmpegAssets[platform]
		if !ok {
			return nil, fmt.Errorf("暂不支持 %s 平台的 ffmpeg 下载", platform)
		}
		a, ok := byKind[kind]
		if !ok {
			// Windows arm64 上游没有对应构建，跳过而非报错
			continue
		}
		tasks = append(tasks, fetch.Task{
			Tool:   string(kind),
			URL:    ffmpegBase + "/" + a.Name + ".gz",
			SHA256: a.SHA256,
			Gzip:   true,
			Target: filepath.Join(managedDir, rt.BinaryName(kind)),
		})
	}

	if len(tasks) == 0 {
		return nil, fmt.Errorf("没有适用于 %s 的下载任务", platform)
	}
	return tasks, nil
}
