// Package manifest 决定"下载哪个版本、从哪下、校验值是多少"。
//
// 具体的 tag 与 SHA-256 放在 assets.gen.go（由 scripts/gen-deps-manifest.mjs 生成），
// 本文件只保留取用逻辑。版本固定而非"取最新"：安装结果可复现、可校验。
package manifest

import (
	"fmt"
	"path/filepath"
	goruntime "runtime"

	"github.com/yxxbc/downvid/backend/internal/fetch"
	rt "github.com/yxxbc/downvid/backend/internal/runtime"
)

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
		tasks = append(tasks, fetch.Task{
			Tool:   string(rt.KindYtDlp),
			URL:    ytdlpBase + "/" + a.Name,
			SHA256: a.SHA256,
			Target: filepath.Join(managedDir, rt.BinaryName(rt.KindYtDlp)),
		})
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
