package update

// 应用自更新：选择安装包、校验、以及各平台的安装方式。
//
// ## 这个文件补的是什么
//
// 此前 Wails 版的「检查更新」只做到**发现新版本**就停了：
//
//	downloadUpdate() → 打开 Releases 页面
//	installUpdate()  → 打开 Releases 页面
//
// 也就是说用户装了 Wails 版以后，每出一版都要自己回来看一眼。
// 在 9600+ 用户的规模下这不成立 —— 而且它让「迁移到新架构」变成单向门：
// 一旦老用户被迁移过来，我们没有任何手段推修复。
//
// 所以自更新是迁移的**前置条件**，不是锦上添花。
//
// ## 各平台的安装方式（都是实测过的系统机制）
//
//	macOS    zip → ditto 解压 → 替换 .app → 重开
//	         与 Electron 版同一套（那边已经跑了很多版本，逻辑稳妥）
//	Windows  NSIS 安装器 → 静默安装 → 重启
//	         必须是真安装器，裸 exe 无法静默替换正在运行的程序
//	Linux    AppImage → 替换文件本身 → 重开
//	         其他格式（deb/rpm/tar.gz）需要包管理器，不做自动安装

import (
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"runtime"
	"strings"
)

// AssetKind 是安装包的形态。
type AssetKind string

const (
	// KindZip 是 macOS 的 .app 压缩包
	KindZip AssetKind = "zip"
	// KindNsis 是 Windows 的 NSIS 安装器
	KindNsis AssetKind = "nsis"
	// KindAppImage 是 Linux 的自挂载可执行文件
	KindAppImage AssetKind = "appimage"
	// KindUnsupported 表示该格式不支持自动安装（deb / rpm / tar.gz）
	KindUnsupported AssetKind = "unsupported"
)

// InstallAsset 是一个可用于自动更新的安装包。
type InstallAsset struct {
	Name string `json:"name"`
	URL  string `json:"url"`
	// SHA512 是 base64 编码的校验值（与 electron-updater 的清单同一格式）
	SHA512 string `json:"sha512,omitempty"`
	// Digest 是 GitHub 自带的摘要（形如 `sha256:<hex>`），作为 SHA512 的兜底
	Digest string    `json:"digest,omitempty"`
	Size   int64     `json:"size,omitempty"`
	Kind   AssetKind `json:"kind"`
}

// ClassifyAsset 按文件名判断安装包形态。
//
// 返回 KindUnsupported 时调用方应退回「打开下载页」而不是尝试安装 ——
// deb / rpm 需要通过包管理器，静默替换会破坏系统包数据库。
func ClassifyAsset(name string) AssetKind {
	lower := strings.ToLower(name)
	switch {
	case strings.HasSuffix(lower, ".zip"):
		return KindZip
	// NSIS 安装器就是 .exe，但裸 exe 也会被归到这里 ——
	// 调用方要再确认它是安装器（我们的发布流程里 DownVid-Wails 是 zip，
	// 只有经由 NSIS 打包才会出 .exe）
	case strings.HasSuffix(lower, ".exe"):
		return KindNsis
	case strings.HasSuffix(lower, ".appimage"):
		return KindAppImage
	default:
		return KindUnsupported
	}
}

// PickInstallAsset 从产物列表里挑出**当前平台可自动安装**的那一个。
//
// 返回 nil 表示这一版没有适合本机的自动更新包。
//
// 平台差异写在这里而不是散落在调用点：
//   - macOS 要区分 arm64 / x64（Wails 也可能发 universal）
//   - Windows 只要 x64（本项目不产 32 位）
//   - Linux 只要 AppImage（deb/rpm 不可静默替换）
func PickInstallAsset(names []string, sha512Of map[string]string, sizeOf map[string]int64) *InstallAsset {
	wantPlatform := platformName(runtime.GOOS)
	wantArch := archName(runtime.GOARCH)

	// 优先找「本平台 + 本架构」的精确匹配，其次 universal
	var universal *InstallAsset
	var winFallback *InstallAsset
	for _, name := range names {
		kind := ClassifyAsset(name)
		if kind == KindUnsupported {
			continue
		}
		lower := strings.ToLower(name)

		// 只看本平台的产物：Electron 与 Wails 两套同时在 Release 里，
		// 认错平台会让用户下到打不开的包
		if !belongsToPlatform(lower, wantPlatform) {
			continue
		}
		// 必须是**新架构产物**：Electron 的包也满足上面的条件，
		// 但 Wails 版不该去装 Electron 的包（那等于自己把自己换回旧架构）
		if !strings.HasPrefix(name, WailsAssetPrefix) {
			continue
		}
		// Linux 只认 AppImage
		if wantPlatform == "linux" && kind != KindAppImage {
			continue
		}

		asset := &InstallAsset{
			Name:   name,
			SHA512: sha512Of[name],
			Size:   sizeOf[name],
			Kind:   kind,
		}

		// Windows 上优先选择可静默安装的 NSIS 安装器（.exe）
		if wantPlatform == "windows" {
			if strings.Contains(lower, wantArch) {
				if kind == KindNsis {
					return asset
				}
				if winFallback == nil {
					winFallback = asset
				}
			}
			continue
		}

		if strings.Contains(lower, "universal") {
			if universal == nil {
				universal = asset
			}
			continue
		}
		if strings.Contains(lower, wantArch) {
			return asset
		}
	}
	if wantPlatform == "windows" && winFallback != nil {
		return winFallback
	}
	return universal
}

// belongsToPlatform 判断产物名是否属于目标平台。
func belongsToPlatform(lowerName, platform string) bool {
	switch platform {
	case "macos":
		return strings.Contains(lowerName, "mac")
	case "windows":
		return strings.Contains(lowerName, "win")
	case "linux":
		return strings.Contains(lowerName, "linux")
	}
	return false
}

// ValidateDownload 校验下载结果。
//
// **必须校验**：更新包是从网络拿的，损坏或被中间人替换的包装上去
// 就是「应用再也打不开」，而且用户不会知道是更新弄坏的。
func ValidateDownload(data []byte, asset *InstallAsset) error {
	if asset == nil {
		return fmt.Errorf("没有可用的安装包")
	}
	if asset.Size > 0 && int64(len(data)) != asset.Size {
		return fmt.Errorf("下载大小不符：收到 %d 字节，清单写的 %d 字节", len(data), asset.Size)
	}
	// 优先用发布流程提供的 sha512（与 electron-updater 同一格式）
	if asset.SHA512 != "" {
		if sha512Base64(data) != asset.SHA512 {
			return fmt.Errorf("sha512 校验失败（包可能损坏或被替换），请重试")
		}
		return nil
	}

	// 退回 GitHub 自带的 digest（形状是 `sha256:<hex>`）。
	//
	// 这条兜底是必要的：`sha512` 来自我们自己生成的 latest*.yml，
	// 而 Wails 版不走那份清单 —— 它直接读 Release API 的产物列表，
	// 那里只有 GitHub 算的 sha256。两条通道都要能校验。
	if asset.Digest != "" {
		if err := verifyDigest(data, asset.Digest); err != nil {
			return err
		}
		return nil
	}
	return nil
}

// verifyDigest 校验 GitHub 的 `algo:hex` 形式摘要。
func verifyDigest(data []byte, digest string) error {
	algo, want, ok := strings.Cut(digest, ":")
	if !ok || want == "" {
		return fmt.Errorf("无法识别的摘要格式：%s", digest)
	}
	var got string
	switch strings.ToLower(algo) {
	case "sha256":
		sum := sha256.Sum256(data)
		got = hex.EncodeToString(sum[:])
	case "sha512":
		sum := sha512.Sum512(data)
		got = hex.EncodeToString(sum[:])
	default:
		// 不认识的算法**不跳过校验**：那等于完全不校验。
		return fmt.Errorf("不支持的摘要算法 %q", algo)
	}
	if !strings.EqualFold(got, want) {
		return fmt.Errorf("%s 校验失败（包可能损坏或被替换），请重试", algo)
	}
	return nil
}

// installPathFor 返回安装动作要替换的目标。
//
// macOS 是整个 `.app`（只换里面的二进制，Info.plist / Resources 还是旧的）；
// Windows / Linux 是可执行文件本身（安装器替换、或直接覆盖文件）。
func installPathFor(exePath string) string {
	return installPathForOS(runtime.GOOS, exePath)
}

// installPathForOS 是 installPathFor 的纯函数版本。
//
// 把 GOOS 作为参数传进来，测试才能在任意平台上覆盖三条分支——
// 按 runtime.GOOS 分支的写法会让 Windows / Linux 的目标推导在 CI 上永远测不到。
func installPathForOS(goos, exePath string) string {
	if goos == "darwin" {
		// exe 在 `<name>.app/Contents/MacOS/<name>`，往上三层是 `.app`
		return filepath.Clean(filepath.Join(exePath, "..", "..", ".."))
	}
	return exePath
}

// CanSelfInstall 报告当前运行方式是否支持自动安装。
//
// 必须排除的场景：
//   - **开发模式**（`go run` / 未打包）：替换的是 go build 的临时产物，
//     装完下次跑 `go run` 又变回去，纯属混乱
//   - **只读位置**（macOS / Linux）：我们自己替换文件，没有写权限会静默失败
//
// Windows 是例外：替换由 NSIS 安装器完成，它会自己申请管理员权限，
// 应用不需要对 Program Files 可写。
func CanSelfInstall(exePath string, writable func(string) bool) (bool, string) {
	return canSelfInstallOS(runtime.GOOS, exePath, writable)
}

// canSelfInstallOS 是 CanSelfInstall 的纯函数版本（理由同 installPathForOS）。
func canSelfInstallOS(goos, exePath string, writable func(string) bool) (bool, string) {
	if exePath == "" {
		return false, "拿不到可执行文件路径"
	}
	// `go run` 的产物落在临时目录，不是真实安装。
	// 统一分隔符后再判断，这样 Windows 的 `\go-build\` 在任何平台上都能识别。
	normalized := strings.ReplaceAll(exePath, "\\", "/")
	if strings.Contains(normalized, "/go-build") ||
		strings.Contains(exePath, "___go_build") {
		return false, "开发模式下不支持自动更新，请前往发布页下载"
	}
	// Windows 由安装器提权替换，应用自身不需要写权限。
	//
	// 曾经这里和其它平台一样要求「目标可写」：Windows 上目标被当成 exe 文件
	// 而不是目录，`WriteFile("<exe>\\.downvid-write-test")` 必然失败，于是
	// **每次**点击「重启并安装」都返回「没有写入权限」，前端只好打开浏览器
	// 跳到 Releases 页（issue #95 的后续反馈）。
	if goos == "windows" {
		return true, ""
	}
	// 其余平台由我们替换文件，真正需要写权限的是目标的**父目录**：
	//   macOS 要把整个 .app 移走再放新的 → /Applications
	//   Linux 要在可执行文件旁写临时文件再 rename → 可执行文件所在目录
	target := installPathForOS(goos, exePath)
	if !writable(filepath.Dir(target)) {
		return false, "没有写入权限，请手动下载安装包"
	}
	return true, ""
}

// sha512Base64 计算 base64 编码的 SHA-512。
//
// 格式与 electron-updater 的 latest*.yml 里 sha512 字段一致 ——
// 两套更新通道（Electron / Wails）用同一个校验口径，
// 生成清单的脚本就不必区分是谁在消费。
func sha512Base64(data []byte) string {
	sum := sha512.Sum512(data)
	return base64.StdEncoding.EncodeToString(sum[:])
}

// InstallTarget 返回安装动作要替换的目标路径。
//
// macOS 是 `.app` 包本身（要整个替换）；其余平台是可执行文件路径。
// 导出它是因为 app.go 的 InstallUpdate 需要先算出目标再分平台调用。
func InstallTarget(exePath string) string {
	return installPathFor(exePath)
}
