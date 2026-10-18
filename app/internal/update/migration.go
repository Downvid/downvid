package update

// 「新架构（Wails）产物」的识别与自更新能力判定。
//
// ## 这个文件解决什么
//
// 项目正在从 Electron 迁移到 Wails。两个架构**并行发布**：
//
//	DownVid-Setup-*.exe / DownVid-*-Mac-*.dmg   ← Electron（存量用户）
//	DownVid-Wails-<platform>-*                  ← Wails（新架构）
//
// 过渡版本（Electron 外壳）需要能**认出**「这一版已经提供了新架构的包」，
// 并在界面上如实告诉用户：可以选择迁移到新架构，但迁移是**手动、可回退**的。
//
// 反过来，Wails 版也要能认出「我自己是新架构」，从而不去读
// electron-updater 的 `latest*.yml`（那份清单只描述 Electron 产物）。
//
// ## 为什么不直接自动迁移
//
// 自动迁移是单向的：老用户装上新架构后再也回不到 Electron
// （新架构没有 electron-updater，无法用同一条通道退回）。
// 在新架构稳定之前，把这种不可逆操作做成自动的，风险远大于收益。
//
// 所以这里只做「识别 + 告知」，迁移动作由用户点。

import (
	"runtime"
	"strings"
)

// Architecture 是应用外壳的实现架构。
type Architecture string

const (
	// ArchElectron 是旧架构（Vue + Electron）。
	ArchElectron Architecture = "electron"
	// ArchWails 是新架构（Go + Wails + Svelte）。
	ArchWails Architecture = "wails"
)

// WailsAssetPrefix 是新架构产物的文件名前缀。
//
// 与 `release.yml` 的 `build-wails` job 和 `verify-release.mjs` 里的
// 字符串**必须逐字一致**。写错的表现是「新架构产物发布了但没人检测到」，
// 而这类问题不会报错 —— 界面上永远显示「没有新架构版本」。
const WailsAssetPrefix = "DownVid-Wails-"

// CurrentArchitecture 返回**当前运行的这个二进制**属于哪个架构。
//
// 由构建期注入：`-ldflags "-X main.arch=wails"`。
// 默认 electron —— 与「存量用户最多」的现状一致，也让未注入时的行为
// 保守（不会把 Electron 版误判成 Wails 版而去读错误的更新通道）。
var CurrentArchitecture = ArchElectron

// WailsAsset 描述一个可用的新架构安装包。
type WailsAsset struct {
	// Name 是完整文件名（下载时用）
	Name string `json:"name"`
	// Platform 是从文件名解析出的平台标识（macos / windows / linux）
	Platform string `json:"platform"`
	// Arch 是 CPU 架构（arm64 / x64 / 空表示通用）
	Arch string `json:"arch"`
	// Universal 表示这是 universal 包（macOS 同时含两种架构）
	Universal bool `json:"universal,omitempty"`
}

// ParseWailsAssets 从 Release 的产物列表里挑出新架构的包。
//
// 命名约定（与 release.yml 一致）：
//
//	DownVid-Wails-mac-universal-1.6.0.zip
//	DownVid-Wails-windows-x64-1.6.0.zip
//	DownVid-Wails-linux-x64-1.6.0.tar.gz
//
// 解析刻意宽松：只认「前缀 + 平台段」，版本号与扩展名不参与判断。
// 严格匹配会让「改了一次命名规则」变成静默失效。
func ParseWailsAssets(names []string) []WailsAsset {
	out := make([]WailsAsset, 0, 2)
	for _, name := range names {
		if !strings.HasPrefix(name, WailsAssetPrefix) {
			continue
		}
		rest := strings.TrimPrefix(name, WailsAssetPrefix)

		a := WailsAsset{Name: name}
		switch {
		case strings.HasPrefix(rest, "mac-"):
			a.Platform = "macos"
			rest = strings.TrimPrefix(rest, "mac-")
		case strings.HasPrefix(rest, "windows-"):
			a.Platform = "windows"
			rest = strings.TrimPrefix(rest, "windows-")
		case strings.HasPrefix(rest, "linux-"):
			a.Platform = "linux"
			rest = strings.TrimPrefix(rest, "linux-")
		default:
			// 认不出平台：跳过而不是猜。猜错会让用户下到别的平台的包，
			// 而那个包在他机器上根本打不开。
			continue
		}

		// 平台段之后紧跟架构段，如 `universal-1.6.0.zip` / `x64-1.6.0.zip`
		if arch, _, ok := strings.Cut(rest, "-"); ok {
			switch arch {
			case "universal":
				a.Universal = true
			case "arm64", "x64", "amd64":
				a.Arch = arch
			}
		}
		out = append(out, a)
	}
	return out
}

// PickWailsAsset 为**当前平台**挑出最合适的新架构包。
//
// 返回 nil 表示这一版没有适合本机的包（比如只发了 macOS，用户在 Windows）。
func PickWailsAsset(assets []WailsAsset) *WailsAsset {
	wantPlatform := platformName(runtime.GOOS)
	wantArch := archName(runtime.GOARCH)

	var fallback *WailsAsset
	for i := range assets {
		a := &assets[i]
		if a.Platform != wantPlatform {
			continue
		}
		// universal 包适用任何架构，但优先级低于精确匹配
		if a.Universal {
			if fallback == nil {
				fallback = a
			}
			continue
		}
		if a.Arch == wantArch {
			return a
		}
	}
	return fallback
}

// platformName 把 Go 的 GOOS 映射成产物名里的平台段。
func platformName(goos string) string {
	switch goos {
	case "darwin":
		return "macos"
	case "windows":
		return "windows"
	default:
		return "linux"
	}
}

// archName 把 Go 的 GOARCH 映射成产物名里的架构段。
func archName(goarch string) string {
	switch goarch {
	case "arm64":
		return "arm64"
	case "amd64":
		return "x64"
	default:
		return goarch
	}
}

// MigrationHint 是「可以迁移到新架构」的判定结果。
type MigrationHint struct {
	// Available 表示这一版确实发布了适合本机的新架构包
	Available bool `json:"available"`
	// AssetName 是那个包的文件名（界面上显示给用户，方便他手动作业）
	AssetName string `json:"assetName,omitempty"`
	// Version 是该 Release 的版本号
	Version string `json:"version,omitempty"`
	// Reason 说明「为什么不可用 / 为什么不该迁移」，用于界面提示
	Reason string `json:"reason,omitempty"`
}

// EvaluateMigration 判断当前这一版要不要提示用户迁移到新架构。
//
// 三条规则，缺一不可：
//
//  1. **当前已经是新架构** → 不提示（用户已经在用新架构了）
//  2. **产物列表为空**（jsDelivr / 官网只报版本号，拿不到 assets）→ 不提示，
//     并在 Reason 里说明「这个更新源给不出产物清单」——
//     否则用户会以为「这版没发新架构」，实际只是查不到
//  3. **本机平台没有对应包** → 不提示（发了 macOS 但用户在 Windows）
func EvaluateMigration(current Architecture, release *Release) MigrationHint {
	if current == ArchWails {
		return MigrationHint{Reason: "当前已经是新架构"}
	}
	if release == nil {
		return MigrationHint{Reason: "没有可用的版本信息"}
	}
	if len(release.Assets) == 0 {
		return MigrationHint{
			Version: release.Version,
			Reason:  "这个更新源只给版本号，拿不到产物清单（换成 GitHub 源才能检测新架构）",
		}
	}

	assets := ParseWailsAssets(release.Assets)
	if len(assets) == 0 {
		return MigrationHint{Version: release.Version, Reason: "这一版没有发布新架构的安装包"}
	}

	picked := PickWailsAsset(assets)
	if picked == nil {
		return MigrationHint{
			Version: release.Version,
			Reason:  "这一版发布了新架构包，但没有适合本机平台的（" + runtime.GOOS + "/" + runtime.GOARCH + "）",
		}
	}

	return MigrationHint{
		Available: true,
		AssetName: picked.Name,
		Version:   release.Version,
	}
}
