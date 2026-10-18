package update

import (
	"runtime"
	"strings"
	"testing"
)

// 「过渡版本预留下一架构更新检测」的判定。
//
// 这组用例守护的是**单向门**：老用户一旦被引导装上新架构，就再也回不到
// Electron（新架构没有 electron-updater，无法用同一条通道退回）。
// 所以「该不该提示迁移」必须判得准 —— 既不能漏报（用户永远收不到新架构），
// 也不能误报（在拿不到产物清单的源上瞎提示）。

// 真实发布用的文件名（与 release.yml 的 build-wails job 一致）
func realAssets() []string {
	return []string{
		// Electron 产物（存量用户的更新通道）
		"DownVid-Setup-1.6.0.exe",
		"DownVid-Portable-1.6.0.exe",
		"DownVid-arm64-Mac-1.6.0.zip",
		"DownVid-arm64-Mac-1.6.0.dmg",
		"DownVid-x64-Mac-1.6.0.zip",
		"DownVid-x86_64-Linux-1.6.0.AppImage",
		// 新架构产物
		"DownVid-Wails-mac-universal-1.6.0.zip",
		"DownVid-Wails-windows-x64-1.6.0.zip",
		"DownVid-Wails-linux-x64-1.6.0.tar.gz",
		// 干扰项：更新清单不能被当成产物
		"latest.yml",
		"latest-mac.yml",
	}
}

func TestParseWailsAssets(t *testing.T) {
	got := ParseWailsAssets(realAssets())

	if len(got) != 3 {
		t.Fatalf("应识别出 3 个新架构包，实际 %d：%+v", len(got), got)
	}

	byPlatform := map[string]WailsAsset{}
	for _, a := range got {
		byPlatform[a.Platform] = a
	}

	mac, ok := byPlatform["macos"]
	if !ok {
		t.Fatal("没有识别出 macOS 包")
	}
	if !mac.Universal {
		t.Error("macOS 包应标记为 universal（文件名里是 mac-universal）")
	}

	win, ok := byPlatform["windows"]
	if !ok {
		t.Fatal("没有识别出 Windows 包")
	}
	if win.Arch != "x64" {
		t.Errorf("Windows 包的架构 = %q，期望 x64", win.Arch)
	}

	linux, ok := byPlatform["linux"]
	if !ok {
		t.Fatal("没有识别出 Linux 包")
	}
	if linux.Arch != "x64" {
		t.Errorf("Linux 包的架构 = %q，期望 x64", linux.Arch)
	}
}

// Electron 产物绝不能被误认成新架构 —— 那会让过渡版本提示用户
// 「下载新架构包」，而下载到的是他自己正在用的 Electron 版。
func TestParseWailsAssetsIgnoresElectron(t *testing.T) {
	for _, a := range ParseWailsAssets(realAssets()) {
		if strings.Contains(a.Name, "Setup") || strings.Contains(a.Name, "Portable") {
			t.Errorf("Electron 产物被误判成新架构：%s", a.Name)
		}
		if strings.HasPrefix(a.Name, "latest") {
			t.Errorf("更新清单被误判成新架构产物：%s", a.Name)
		}
	}
}

// 认不出平台时必须**跳过**而不是猜。
//
// 猜错会让用户下到别的平台的包，而那个包在他机器上根本打不开
// （Windows exe 在 mac 上、mac zip 在 Linux 上）。
func TestParseWailsAssetsSkipsUnknownPlatform(t *testing.T) {
	got := ParseWailsAssets([]string{
		"DownVid-Wails-bsd-x64-1.6.0.tar.gz",   // 不支持的平台
		"DownVid-Wails-1.6.0.zip",              // 没有平台段
		"DownVid-Wails-linux-x64-1.6.0.tar.gz", // 正常
	})
	if len(got) != 1 {
		t.Fatalf("应只保留 1 个可识别的包，实际 %d：%+v", len(got), got)
	}
	if got[0].Platform != "linux" {
		t.Errorf("保留的应是 linux 包，实际 %q", got[0].Platform)
	}
}

func TestPickWailsAssetMatchesCurrentPlatform(t *testing.T) {
	assets := ParseWailsAssets(realAssets())
	picked := PickWailsAsset(assets)
	if picked == nil {
		t.Fatalf("当前平台（%s/%s）应该能挑到包", runtime.GOOS, runtime.GOARCH)
	}

	wantPlatform := platformName(runtime.GOOS)
	if picked.Platform != wantPlatform {
		t.Errorf("挑到的平台 = %q，期望 %q", picked.Platform, wantPlatform)
	}
}

// universal 包能在任何 macOS 架构上跑，但优先级低于精确匹配。
func TestPickWailsAssetPrefersExactArch(t *testing.T) {
	assets := []WailsAsset{
		{Name: "DownVid-Wails-mac-universal-1.0.0.zip", Platform: "macos", Universal: true},
		{Name: "DownVid-Wails-mac-arm64-1.0.0.zip", Platform: "macos", Arch: "arm64"},
	}
	// 模拟在 arm64 上
	got := pickFor(assets, "macos", "arm64")
	if got == nil || got.Name != "DownVid-Wails-mac-arm64-1.0.0.zip" {
		t.Fatalf("应优先精确匹配 arm64，实际 %+v", got)
	}
	// 模拟在 amd64 上：没有精确的 x64，退回 universal
	got = pickFor(assets, "macos", "x64")
	if got == nil || !got.Universal {
		t.Fatalf("没有精确匹配时应退回 universal，实际 %+v", got)
	}
}

// pickFor 是 PickWailsAsset 的可控版本（测试里不能改 runtime.GOOS/GOARCH）。
func pickFor(assets []WailsAsset, platform, arch string) *WailsAsset {
	var fallback *WailsAsset
	for i := range assets {
		a := &assets[i]
		if a.Platform != platform {
			continue
		}
		if a.Universal {
			if fallback == nil {
				fallback = a
			}
			continue
		}
		if a.Arch == arch {
			return a
		}
	}
	return fallback
}

// ===== EvaluateMigration =====

func TestEvaluateMigrationHappyPath(t *testing.T) {
	release := &Release{Version: "1.6.0", Assets: realAssets()}
	hint := EvaluateMigration(ArchElectron, release)

	if !hint.Available {
		t.Fatalf("有对应平台的新架构包时应可用，实际：%+v", hint)
	}
	if hint.AssetName == "" {
		t.Error("必须给出文件名（界面要显示给用户）")
	}
	if hint.Version != "1.6.0" {
		t.Errorf("Version = %q", hint.Version)
	}
	if !strings.HasPrefix(hint.AssetName, WailsAssetPrefix) {
		t.Errorf("挑到的不是新架构包：%s", hint.AssetName)
	}
}

// 已经是新架构时不该再提示迁移（否则用户会看到"建议迁移到自己"）。
func TestEvaluateMigrationAlreadyOnWails(t *testing.T) {
	hint := EvaluateMigration(ArchWails, &Release{Version: "1.6.0", Assets: realAssets()})
	if hint.Available {
		t.Error("已经是新架构，不该提示迁移")
	}
	if hint.Reason == "" {
		t.Error("不可用时必须给出原因")
	}
}

// **这条最重要**：拿不到产物清单时不能说「没有新架构」。
//
// jsDelivr / 官网只返回版本号，`Assets` 为空。这时如果判「没有新架构包」，
// 用户会以为是项目没发，实际只是换了个更新源就查不到。
func TestEvaluateMigrationWithoutAssetList(t *testing.T) {
	hint := EvaluateMigration(ArchElectron, &Release{Version: "1.6.0"})
	if hint.Available {
		t.Error("拿不到产物清单时不该说可用（不能瞎猜）")
	}
	// 但原因必须说清「是查不到，不是没发」
	if !strings.Contains(hint.Reason, "更新源") {
		t.Errorf("原因应指明是更新源的限制，实际：%q", hint.Reason)
	}
}

// 这一版只发了 Electron，没发新架构。
func TestEvaluateMigrationNoWailsAssets(t *testing.T) {
	hint := EvaluateMigration(ArchElectron, &Release{
		Version: "1.4.0",
		Assets:  []string{"DownVid-Setup-1.4.0.exe", "DownVid-arm64-Mac-1.4.0.zip"},
	})
	if hint.Available {
		t.Error("没有新架构包时不该提示可用")
	}
	if !strings.Contains(hint.Reason, "没有发布") {
		t.Errorf("原因应说明这一版没发新架构，实际：%q", hint.Reason)
	}
}

// 发了新架构但**不含本机平台**时，不能提示用户下载。
func TestEvaluateMigrationNoAssetForThisPlatform(t *testing.T) {
	// 只发 macOS。在 Linux/Windows 上跑这条时应判为不可用。
	if runtime.GOOS == "darwin" {
		t.Skip("当前是 macOS，这条用例针对非 macOS 平台")
	}
	hint := EvaluateMigration(ArchElectron, &Release{
		Version: "1.6.0",
		Assets:  []string{"DownVid-Wails-mac-universal-1.6.0.zip"},
	})
	if hint.Available {
		t.Error("本机平台没有对应的包时不该提示可用")
	}
	if !strings.Contains(hint.Reason, "平台") {
		t.Errorf("原因应指明平台不匹配，实际：%q", hint.Reason)
	}
}

func TestEvaluateMigrationNilRelease(t *testing.T) {
	hint := EvaluateMigration(ArchElectron, nil)
	if hint.Available {
		t.Error("没有版本信息时不该提示可用")
	}
	if hint.Reason == "" {
		t.Error("必须说明原因")
	}
}
