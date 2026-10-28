package update

import (
	"crypto/sha256"
	"encoding/hex"
	"path/filepath"
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
		"DownVid-Wails-mac-universal-1.5.0.zip":         KindZip,
		"DownVid-Wails-windows-x64-1.5.0.zip":           KindZip,
		"DownVid-Wails-windows-x64-1.6.4-installer.exe": KindNsis,
		"DownVid-Setup-1.5.0.exe":                       KindNsis,
		"DownVid-Wails-linux-x64-1.5.0.AppImage":        KindAppImage,
		"DownVid-x86_64-Linux-1.5.0.AppImage":           KindAppImage,
		// 这些必须判为不可自动安装
		"DownVid-Wails-mac-universal-1.6.4.dmg": KindUnsupported,
		"DownVid-Wails-linux-x64-1.6.4.deb":     KindUnsupported,
		"DownVid-amd64-Linux-1.5.0.deb":         KindUnsupported,
		"DownVid-x86_64-Linux-1.5.0.rpm":        KindUnsupported,
		"DownVid-Wails-linux-x64-1.5.0.tar.gz":  KindUnsupported,
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
	// 三种写法都要能识别：POSIX、Windows、以及 `___go_build` 形式。
	// 统一分隔符后判断，Windows 路径在任何平台上都能覆盖到。
	for _, exe := range []string{
		"/tmp/go-build123/b001/exe/downvid",
		`C:\Users\me\AppData\Local\Temp\go-build123\b001\exe\downvid.exe`,
		"/tmp/___go_build_main_go",
	} {
		ok, reason := canSelfInstallOS("linux", exe, func(string) bool { return true })
		if ok {
			t.Errorf("%q：go run 的产物不该允许自更新", exe)
		}
		if reason == "" {
			t.Errorf("%q：拒绝时必须给出原因", exe)
		}
	}
}

func TestCanSelfInstallRejectsReadOnly(t *testing.T) {
	for _, goos := range []string{"darwin", "linux"} {
		ok, reason := canSelfInstallOS(goos, "/opt/downvid/downvid", func(string) bool { return false })
		if ok {
			t.Errorf("%s：不可写位置不该允许自更新（会静默失败）", goos)
		}
		if reason == "" {
			t.Errorf("%s：拒绝时必须给出原因", goos)
		}
	}
}

// Windows 的自更新由 NSIS 安装器完成，安装器自己会申请管理员权限，
// 应用不需要对 Program Files 可写。
//
// 这条用例守的是 issue #95 的后续反馈：此前 Windows 被当成「目标不可写」，
// 每次点「重启并安装」都直接返回失败，前端只好打开浏览器跳到 Releases 页。
func TestCanSelfInstallAllowsWindowsInstaller(t *testing.T) {
	exe := `C:\Program Files\DownVid\downvid.exe`
	ok, reason := canSelfInstallOS("windows", exe, func(string) bool {
		t.Fatal("Windows 不应检查应用自身是否有写权限")
		return false
	})
	if !ok {
		t.Fatalf("Windows 安装器会提权，应允许自更新：%s", reason)
	}
}

// 需要写权限的是**目标的父目录**，不是目标本身：
//
//	macOS 要把整个 .app 移走再放新的 → /Applications
//	Linux 要在可执行文件旁写临时文件再 rename → 所在目录
func TestCanSelfInstallChecksParentDirectory(t *testing.T) {
	cases := []struct {
		goos string
		exe  string
		// 期望被检查的目录（故意不用 installPathForOS 推导，
		// 否则路径推导本身写错时这条用例也会跟着错）
		want string
	}{
		{"darwin", "/Applications/DownVid.app/Contents/MacOS/downvid", "/Applications"},
		{"linux", "/opt/downvid/downvid", "/opt/downvid"},
	}
	for _, c := range cases {
		var got string
		ok, reason := canSelfInstallOS(c.goos, c.exe, func(dir string) bool {
			got = dir
			return true
		})
		if !ok {
			t.Errorf("%s：正常安装应允许自更新，实际拒绝：%s", c.goos, reason)
		}
		want := filepath.Clean(filepath.FromSlash(c.want))
		if got != want {
			t.Errorf("%s：应检查父目录 %q，实际 %q", c.goos, want, got)
		}
	}
}

// macOS 要替换整个 .app，而不是里面那个可执行文件。
//
// 只替换 MacOS/downvid 的话，Info.plist / Resources 还是旧的，
// 表现为「版本号变了但功能没变」，很难排查。
func TestInstallPathForOS(t *testing.T) {
	mac := installPathForOS("darwin", "/Applications/DownVid.app/Contents/MacOS/downvid")
	wantMac := filepath.Clean(filepath.FromSlash("/Applications/DownVid.app"))
	if mac != wantMac {
		t.Errorf("macOS 的目标应是 .app 包本身，实际 %q", mac)
	}

	// 其余平台的目标是可执行文件本身（安装器替换 / 直接覆盖）。
	for _, c := range []struct{ goos, exe string }{
		{"linux", "/opt/downvid/downvid"},
		{"windows", `C:\Program Files\DownVid\downvid.exe`},
	} {
		if got := installPathForOS(c.goos, c.exe); got != c.exe {
			t.Errorf("%s 的目标应是可执行文件本身，实际 %q", c.goos, got)
		}
	}
}

// GitHub 的产物只有 sha256 digest（形状 `sha256:<hex>`），
// 而我们自己生成的 latest*.yml 才有 sha512。两条通道都要能校验。
func TestValidateDownloadFallsBackToDigest(t *testing.T) {
	data := []byte("payload for digest test")

	// 正确摘要
	good := "sha256:" + sha256Hex(data)
	if err := ValidateDownload(data, &InstallAsset{Digest: good}); err != nil {
		t.Fatalf("sha256 摘要正确时应通过：%v", err)
	}

	// 错误摘要
	bad := "sha256:" + sha256Hex([]byte("other"))
	if err := ValidateDownload(data, &InstallAsset{Digest: bad}); err == nil {
		t.Fatal("sha256 摘要不符时必须报错")
	}

	// 不认识的算法**不能静默跳过** —— 那等于完全不校验
	if err := ValidateDownload(data, &InstallAsset{Digest: "md5:abc"}); err == nil {
		t.Fatal("不支持的算法应报错，而不是跳过校验")
	}

	// 格式不对也要报错
	if err := ValidateDownload(data, &InstallAsset{Digest: "no-colon"}); err == nil {
		t.Fatal("无法识别的摘要格式应报错")
	}
}

// sha512 优先于 digest：两条都有时按 sha512 判。
func TestValidateDownloadPrefersSHA512(t *testing.T) {
	data := []byte("payload")
	asset := &InstallAsset{
		SHA512: sha512Base64(data),
		Digest: "sha256:" + sha256Hex([]byte("wrong")), // 故意错
	}
	if err := ValidateDownload(data, asset); err != nil {
		t.Fatalf("sha512 正确时不该因为 digest 错而失败：%v", err)
	}
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
