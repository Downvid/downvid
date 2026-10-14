package runtime

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/yxxbc/downvid/backend/internal/probe"
)

// Windows 的候选目录必须能在 **macOS 上** 被验证。
//
// 回归背景：winget 装的依赖此前检测不到，因为候选目录只覆盖了
// WinGet\Links（portable 包的软链），漏掉了 WinGet\Packages 下真正解压
// 出来的目录。本机是 macOS，若直接读 os.UserHomeDir 就只能看到 macOS 路径，
// 这个缺口在本地永远测不出来。
func TestWindowsInstallDirsCoverWinget(t *testing.T) {
	home := `C:\Users\tester`
	dirs := windowsInstallDirs(home)

	// 归一化分隔符再断言：filepath.Join 跟随**宿主**平台，在 macOS 上
	// 会拼出正斜杠，写死反斜杠会让用例在本地失败（这正是之前反复踩的坑）。
	joined := strings.ReplaceAll(strings.Join(dirs, "\n"), "\\", "/")

	// 只断言**静态**目录。Packages 下的路径含随机哈希、且在本机不存在，
	// 断言展开结果等于在断言环境；它们的模式由 TestWindowsPackagePatternsCoverWinget 覆盖。
	must := []struct{ path, why string }{
		{"WinGet/Links", "yt-dlp.yt-dlp 是 portable 包，软链落在这里"},
		{"scoop/shims", "scoop 的软链目录"},
		{"chocolatey/bin", "choco 的软链目录"},
		{"WindowsApps", "微软商店应用的别名目录"},
	}
	for _, m := range must {
		if !strings.Contains(joined, m.path) {
			t.Errorf("候选目录缺少 %s（%s）", m.path, m.why)
		}
	}
}

func TestWindowsInstallDirsUseGivenHome(t *testing.T) {
	home := `D:\Users\someone`
	dirs := windowsInstallDirs(home)
	// 用 filepath.Join 拼的路径应基于传入的 home，而不是当前用户的
	found := false
	for _, d := range dirs {
		if strings.Contains(d, "D:") && strings.Contains(d, "someone") {
			found = true
		}
		if strings.Contains(d, "/Users/mac") {
			t.Errorf("不应出现宿主用户目录：%s", d)
		}
	}
	if !found {
		t.Error("未按传入的 home 生成路径")
	}
}

// 通配模式是**数据**，因此可以在 macOS 上断言其正确性。
//
// 之前的写法把模式内联在 windowsInstallDirs 里，而 filepath.Glob 在 macOS 上
// 对 Windows 路径必然返回空，用例只能看到"结果为空"，等于没测——注入变异
// （删掉某个模式）也不会失败。
func TestWindowsPackagePatternsCoverWinget(t *testing.T) {
	joined := strings.ReplaceAll(strings.Join(WindowsPackagePatterns, "\n"), "\\", "/")

	must := []struct{ pattern, why string }{
		{"Packages/yt-dlp.yt-dlp_*", "portable 包：exe 在包目录下"},
		{"Packages/yt-dlp.FFmpeg_*", "zip+nested portable：先有一层包目录"},
		{"Packages/yt-dlp.FFmpeg_*/*/bin", "再一层解压目录，ffmpeg/ffprobe 在 bin 下"},
		{"Packages/DenoLand.Deno_*", "yt-dlp 的清单把 Deno 列为依赖（JS 运行时）"},
	}
	for _, m := range must {
		if !strings.Contains(joined, m.pattern) {
			t.Errorf("缺少通配模式 %q（%s）", m.pattern, m.why)
		}
	}
}

// ffprobe 必须也能被找到：yt-dlp 在托管目录里同时找 ffmpeg 与 ffprobe
func TestWindowsPatternsIncludeFfprobeBin(t *testing.T) {
	joined := strings.Join(WindowsPackagePatterns, "\n")
	if !strings.Contains(joined, "bin") {
		t.Error("没有任何模式指向 bin 目录，ffprobe 将找不到")
	}
}

// 用一个仿造的 WinGet\Packages 目录树**真正验证展开逻辑**。
//
// 这比断言模式字符串更强：它能抓住"模式对但没被用上"的情况。
// 之所以能在 macOS 上跑，是因为模式由 filepath.Join 拼接，跟随宿主分隔符。
func TestExpandWindowsGlobsMatchesRealWingetLayout(t *testing.T) {
	base := t.TempDir()

	// 仿造 winget 安装后的真实层级
	mk := func(parts ...string) {
		dir := filepath.Join(append([]string{base}, parts...)...)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		// 放一个占位文件，模拟二进制
		if err := os.WriteFile(filepath.Join(dir, "ffmpeg"), []byte("x"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	mk("Packages", "yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe")
	mk("Packages", "yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe",
		"ffmpeg-N-126374-g089a48eb36-win64-gpl", "bin")
	mk("Packages", "DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe")

	got := expandWindowsGlobs(base, WindowsPackagePatterns)
	joined := strings.ReplaceAll(strings.Join(got, "\n"), "\\", "/")

	// 必须展开出含 bin 的那一层（ffmpeg / ffprobe 在那里）
	if !strings.Contains(joined, "win64-gpl/bin") {
		t.Errorf("未展开出嵌套的 bin 目录，ffmpeg/ffprobe 将找不到。实际：\n%s", joined)
	}
	// 也必须展开出包根目录（yt-dlp.exe 直接在包目录下）
	if !strings.Contains(joined, "yt-dlp.yt-dlp_Microsoft") {
		t.Errorf("未展开出 yt-dlp 的包目录。实际：\n%s", joined)
	}
	if len(got) == 0 {
		t.Fatal("完全没有展开出任何目录")
	}
}

// 通过**真实入口** windowsInstallDirs 验证，而不是直接调 expandWindowsGlobs。
//
// 这样"模式写对了但忘了调用"也能被抓到——直接调展开函数时，删掉调用点
// 用例照样通过（实测：注入该变异后 0 个用例失败）。
func TestWindowsInstallDirsExpandsFakeWingetTree(t *testing.T) {
	home := t.TempDir()
	t.Setenv("LOCALAPPDATA", filepath.Join(home, "AppData", "Local"))

	bin := filepath.Join(home, "AppData", "Local", "Microsoft", "WinGet",
		"Packages", "yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe",
		"ffmpeg-N-126374-g089a48eb36-win64-gpl", "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}

	dirs := windowsInstallDirs(home)
	joined := strings.ReplaceAll(strings.Join(dirs, "\n"), "\\", "/")

	if !strings.Contains(joined, "win64-gpl/bin") {
		t.Errorf("windowsInstallDirs 未把 WinGet\\Packages 展开进来（忘了调用展开？）。实际：\n%s", joined)
	}
}

func TestWindowsInstallDirsHonorEnvironment(t *testing.T) {
	root := t.TempDir()
	local := filepath.Join(root, "relocated-local")
	programFiles := filepath.Join(root, "programs")
	scoop := filepath.Join(root, "scoop-custom")
	scoopGlobal := filepath.Join(root, "scoop-global")
	chocolatey := filepath.Join(root, "choco-custom")
	t.Setenv("LOCALAPPDATA", local)
	t.Setenv("ProgramFiles", programFiles)
	t.Setenv("SCOOP", scoop)
	t.Setenv("SCOOP_GLOBAL", scoopGlobal)
	t.Setenv("ChocolateyInstall", chocolatey)
	winget := filepath.Join(local, "Microsoft", "WinGet", "Packages", "yt-dlp.yt-dlp_test")
	if err := os.MkdirAll(winget, 0o755); err != nil {
		t.Fatal(err)
	}
	dirs := windowsInstallDirs(filepath.Join(root, "home"))
	for _, want := range []string{winget, filepath.Join(programFiles, "WinGet", "Links"), filepath.Join(scoop, "shims"), filepath.Join(scoopGlobal, "shims"), filepath.Join(chocolatey, "bin")} {
		found := false
		for _, dir := range dirs {
			found = found || dir == want
		}
		if !found {
			t.Errorf("未使用实际安装目录 %s", want)
		}
	}
}

// winget 的机器级落点（--scope machine）与用户级是两套路径，都要覆盖。
//
// 只覆盖用户级会让"用管理员安装"的用户被判为缺失。
func TestWindowsInstallDirsCoverMachineScope(t *testing.T) {
	home := `C:\Users\tester`
	dirs := windowsInstallDirs(home)
	joined := strings.ReplaceAll(strings.Join(dirs, "\n"), "\\", "/")

	if !strings.Contains(joined, "Program Files/WinGet/Links") {
		t.Error("缺少机器级 winget 的 Links（winget install --scope machine）")
	}
	// 用户级也要还在
	if !strings.Contains(joined, "AppData/Local/Microsoft/WinGet/Links") {
		t.Error("缺少用户级 winget 的 Links")
	}
}

// 扫描必须有 wall-clock 上限：目录数预算约束不了"每个目录都很慢"的情况
// （Windows 上叠加杀软扫描，单次 ReadDir 可能数百毫秒）。
// 没有上限时，"保底扫描"会变成用户看到的"依赖检测超时"。
func TestScanRespectsDeadline(t *testing.T) {
	root := t.TempDir()
	deep := filepath.Join(root, "a", "b", "c")
	if err := os.MkdirAll(deep, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(deep, BinaryName(KindFFmpeg)), []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}

	resetScanBudget()
	scanDeadline = time.Now().Add(-1 * time.Second) // 已过期
	if got := scanDir(root, BinaryName(KindFFmpeg), 0); got != "" {
		t.Errorf("超过时限仍继续扫描：%s", got)
	}
}

// findOne 必须重置时限，否则第一个依赖超时后其余都扫不了。
//
// 断言「时限被换成了比原来更晚的值」，而不是「时限在当前时间之后」：
// 后者依赖**扫描实际耗时**——Windows 上 ffprobe 缺失会真的扫满 3 秒预算，
// 时限随之落在过去，断言失败；macOS 上候选目录命中、不触发扫描，断言通过。
// 同一份代码两个平台结论不同，说明断言选错了对象（CI 抓到的就是这个）。
func TestFindOneResetsScanDeadline(t *testing.T) {
	stale := time.Now().Add(-1 * time.Second)
	scanDeadline = stale

	_ = FindOne(KindFFprobe, Options{ManagedDir: t.TempDir()})

	if !scanDeadline.After(stale) {
		t.Errorf("FindOne 未重置扫描时限：仍是 %v", scanDeadline)
	}
}

// yt-dlp 的版本门槛必须与清单 pin 的 tag 一致，而不是只比年份。
//
// 回归背景：原先 MinimumMajor["yt-dlp"] = 2024 只按年份判断，
// 实测 2026.08.19 的版本跑 YouTube 会报 `Requested format is not available`
// （上游同类 issue 已在新版修复），却「通过检测」——用户因此长期停在跑不动的版本上。
func TestYtDlpVersionGateUsesPinnedTag(t *testing.T) {
	const pinned = "2026.10.10.233141"
	MinVersions[KindYtDlp] = pinned
	defer delete(MinVersions, KindYtDlp)

	older := probe.Info{Version: "2026.08.19", Major: 2026}
	if isAcceptableVersion(KindYtDlp, older) {
		t.Error("2026.08.19 早于 pin 的版本，应判为不可用（这正是用户报的版本）")
	}
	// 提示里要带上「当前版本」与「要求版本」，便于用户判断
	reason := staleReason(KindYtDlp, older).Error()
	if !strings.Contains(reason, "2026.08.19") || !strings.Contains(reason, pinned) {
		t.Errorf("过旧提示应同时包含当前版本与要求版本，实际：%s", reason)
	}

	same := probe.Info{Version: pinned, Major: 2026}
	if !isAcceptableVersion(KindYtDlp, same) {
		t.Error("与 pin 相同的版本应可用")
	}
	newer := probe.Info{Version: "2026.11.01", Major: 2026}
	if !isAcceptableVersion(KindYtDlp, newer) {
		t.Error("比 pin 新的版本应可用")
	}
}

// 未注入门槛时退回粗判，不应把所有版本都判死
func TestVersionGateFallsBackWhenNotInjected(t *testing.T) {
	delete(MinVersions, KindYtDlp)
	if !isAcceptableVersion(KindYtDlp, probe.Info{Version: "2026.08.19", Major: 2026}) {
		t.Error("未注入门槛时应退回按主版本号判断")
	}
}

// ffmpeg 等仍按主版本号判断，不应受 yt-dlp 的日期门槛影响
func TestFfmpegGateUnaffected(t *testing.T) {
	MinVersions[KindYtDlp] = "2026.10.10.233141"
	defer delete(MinVersions, KindYtDlp)
	if !isAcceptableVersion(KindFFmpeg, probe.Info{Version: "6.0", Major: 6}) {
		t.Error("ffmpeg 6.0 应可用")
	}
	if isAcceptableVersion(KindFFmpeg, probe.Info{Version: "2.8", Major: 2}) {
		t.Error("ffmpeg 2.8 过旧，应不可用")
	}
}
