package update

import (
	"runtime"
	"strings"
	"testing"
)

// 自更新的选包与校验。
//
// 这个文件的每条用例都对着「装错了会怎样」：
//   - 选错平台 → 用户下到打不开的包
//   - 选到 Electron 包 → 新架构把自己换回旧架构
//   - 不校验 → 损坏的包装上去，应用再也打不开

func TestClassifyAsset(t *testing.T) {
	cases := map[string]AssetKind{
		"DownVid-Wails-mac-universal-1.5.0.zip":  KindZip,
		"DownVid-Wails-windows-x64-1.5.0.zip":    KindZip,
		"DownVid-Setup-1.5.0.exe":                KindNsis,
		"DownVid-Wails-linux-x64-1.5.0.AppImage": KindAppImage,
		"DownVid-x86_64-Linux-1.5.0.AppImage":    KindAppImage,
		// 这些必须判为不可自动安装
		"DownVid-amd64-Linux-1.5.0.deb":        KindUnsupported,
		"DownVid-x86_64-Linux-1.5.0.rpm":       KindUnsupported,
		"DownVid-Wails-linux-x64-1.5.0.tar.gz": KindUnsupported,
	}
	for name, want := range cases {
		if got := ClassifyAsset(name); got != want {
			t.Errorf("ClassifyAsset(%q) = %q，期望 %q", name, got, want)
		}
	}
}

func TestPickInstallAssetPicksCurrentPlatform(t *testing.T) {
	names := []string{
		"DownVid-Wails-mac-universal-1.5.0.zip",
		"DownVid-Wails-windows-x64-1.5.0.zip",
		"DownVid-Wails-linux-x64-1.5.0.tar.gz",
		// Electron 干扰项
		"DownVid-Setup-1.5.0.exe",
		"DownVid-arm64-Mac-1.5.0.zip",
	}
	got := PickInstallAsset(names, nil, nil)
	if got == nil {
		t.Skipf("当前平台（%s/%s）没有对应的新架构包", runtime.GOOS, runtime.GOARCH)
	}

	wantPlatform := platformName(runtime.GOOS)
	if !belongsToPlatform(strings.ToLower(got.Name), wantPlatform) {
		t.Errorf("选到了别的平台的包：%s（当前 %s）", got.Name, wantPlatform)
	}

	// Linux 上 tar.gz 不可自动安装，必须返回 nil
	if runtime.GOOS == "linux" && got.Kind != KindAppImage {
		t.Errorf("Linux 只能选 AppImage，实际选了 %s（%s）", got.Kind, got.Name)
	}
}

// **最关键的一条**：绝不能选到 Electron 的包。
//
// 选中的话，Wails 版会把自己替换成 Electron 版 —— 用户视角是
// 「更新之后界面退回旧版了」，而日志里没有任何异常。
func TestPickInstallAssetNeverPicksElectron(t *testing.T) {
	// 只给 Electron 产物：应该一个都挑不到
	names := []string{
		"DownVid-Setup-1.5.0.exe",
		"DownVid-Portable-1.5.0.exe",
		"DownVid-arm64-Mac-1.5.0.zip",
		"DownVid-x64-Mac-1.5.0.zip",
		"DownVid-x86_64-Linux-1.5.0.AppImage",
	}
	if got := PickInstallAsset(names, nil, nil); got != nil {
		t.Fatalf("只给 Electron 产物时不该挑到任何包，实际 %s", got.Name)
	}
}

// universal 包在没有精确架构匹配时作为兜底。
func TestPickInstallAssetUniversalFallback(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("universal 只对 macOS 有意义")
	}
	names := []string{"DownVid-Wails-mac-universal-1.5.0.zip"}
	got := PickInstallAsset(names, nil, nil)
	if got == nil {
		t.Fatal("macOS 上 universal 包应可作为兜底")
	}
	if !strings.Contains(strings.ToLower(got.Name), "universal") {
		t.Errorf("挑到的不是 universal 包：%s", got.Name)
	}
}

func TestValidateDownloadChecksSize(t *testing.T) {
	data := []byte("hello")
	asset := &InstallAsset{Name: "a.zip", Size: 999}
	if err := ValidateDownload(data, asset); err == nil {
		t.Fatal("大小不符时应报错（清单写 999，实际 5）")
	}
	// 大小对得上就不再报大小错
	asset.Size = int64(len(data))
	if err := ValidateDownload(data, asset); err != nil {
		t.Errorf("大小一致时不该因为大小报错：%v", err)
	}
}

func TestValidateDownloadChecksSHA512(t *testing.T) {
	data := []byte("update payload")
	good := sha512Base64(data)

	if err := ValidateDownload(data, &InstallAsset{SHA512: good}); err != nil {
		t.Fatalf("校验值一致时应通过：%v", err)
	}

	err := ValidateDownload(data, &InstallAsset{SHA512: "AAAA" + good[4:]})
	if err == nil {
		t.Fatal("校验值不一致时必须报错（包可能损坏或被替换）")
	}
	if !strings.Contains(err.Error(), "sha512") {
		t.Errorf("错误信息应指明是校验失败：%v", err)
	}
}

func TestValidateDownloadNilAsset(t *testing.T) {
	if err := ValidateDownload([]byte("x"), nil); err == nil {
		t.Fatal("没有安装包时应报错")
	}
}

// 开发模式下不能自动安装：替换的是 go build 的临时产物，
// 装完下次 `go run` 又变回去，只会让开发者困惑。
func TestCanSelfInstallRejectsDevMode(t *testing.T) {
	ok, reason := CanSelfInstall("/tmp/go-build123/b001/exe/downvid", func(string) bool { return true })
	if ok {
		t.Error("go run 的产物不该允许自更新")
	}
	if reason == "" {
		t.Error("拒绝时必须给出原因")
	}
}

func TestCanSelfInstallRejectsReadOnly(t *testing.T) {
	ok, reason := CanSelfInstall("/opt/downvid/downvid", func(string) bool { return false })
	if ok {
		t.Error("不可写位置不该允许自更新（会静默失败）")
	}
	if reason == "" {
		t.Error("拒绝时必须给出原因")
	}
}

func TestCanSelfInstallAcceptsNormalInstall(t *testing.T) {
	exe := "/Users/x/Applications/DownVid.app/Contents/MacOS/downvid"
	if runtime.GOOS != "darwin" {
		exe = "/opt/homebrew/bin/downvid"
	}
	ok, reason := CanSelfInstall(exe, func(string) bool { return true })
	if !ok {
		t.Errorf("正常的用户目录安装应允许自更新，实际拒绝：%s", reason)
	}
}

// macOS 要替换整个 .app，而不是里面那个可执行文件。
//
// 只替换 MacOS/downvid 的话，Info.plist / Resources 还是旧的，
// 表现为「版本号变了但功能没变」，很难排查。
func TestInstallPathForMacTargetsAppBundle(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("只在 macOS 上验证 .app 路径推导")
	}
	exe := "/Applications/DownVid.app/Contents/MacOS/downvid"
	got := installPathFor(exe)
	if !strings.HasSuffix(got, ".app") {
		t.Errorf("macOS 的目标应是 .app 包本身，实际 %q", got)
	}
	if got != "/Applications/DownVid.app" {
		t.Errorf("路径推导错误：%q", got)
	}
}
