package update

// 基于 wmlUpdate 的更新发现与下载。
//
// ## 为什么保留自己的安装层
//
// wmlUpdate 的 SDK 能把「发现 → 下载 → 校验 → 安装」整条链路做完，但它的
// directory/file/command 策略都要求**固定的安装路径**；DownVid 可以被用户
// 放在任意目录，macOS 还要替换当前运行中的 .app，Windows 还必须等进程退出后
// 再跑 NSIS。所以这里只把「发现 + 下载 + 校验」交给 wmlUpdate，
// `install.type = external` 让它把校验过的安装包路径交回来，安装仍走
// `install_*.go`（那是三平台真机验证过的路径）。
//
// ## 三条更新源
//
// auto = GitHub → Gitee → CNB。Gitee / CNB 都是**完整镜像**：各自的 manifest
// 指向自己 Release 的资产，所以任一条都能独立完成检查与下载。旧的
// jsDelivr / gh-proxy / 官网链路已经移除，减少需要同步的中间层。
//
// Gitee 的清单放在仓库 raw（`website/updates/manifest.gitee.json`）；
// CNB 的 raw API 需要登录，清单作为固定 `update` Release 的公开资产提供。

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"time"

	wmlupdate "github.com/yxxbc/wmlUpdate"
)

const (
	// WMLAppID 必须与 static manifest 里的 app_id 逐字一致。
	WMLAppID = "com.downvid.downvid"
	// WMLChannel 对应 stable 通道，排除 prerelease。
	WMLChannel = "stable"

	wmlOwner = "Downvid"
	wmlRepo  = "downvid"
)

// 三镜像的清单地址。每个镜像的 manifest 都指向**自己的**资产：
//
//	GitHub  —— API（不需要清单）
//	Gitee   —— Xynrin/downvid 仓库 raw 里的 manifest.gitee.json
//	CNB     —— yxxbc/downvid 的固定 update Release 资产 manifest.cnb.json
//
// CNB 的 raw API 需要登录，所以清单放在 Release 资产里；这个 URL 是公开的，
// 客户端不需要任何 token。
const (
	wmlGiteeManifestURL = "https://gitee.com/Xynrin/downvid/raw/main/website/updates/manifest.gitee.json"
	wmlCNBManifestURL   = "https://cnb.cool/yxxbc/downvid/-/releases/download/update/manifest.cnb.json"
)

// WMLProgress 是一次下载进度。
type WMLProgress struct {
	Percent float64
	Bytes   int64
	Total   int64
}

// WMLOptions 是创建 updater 的全部输入。
//
// 全部字段都由调用方解析后传入，`WMLConfig` 因此是纯函数，可以在不联网、
// 不创建 state 目录的情况下断言源链与资产规则。
type WMLOptions struct {
	Source         string
	CurrentVersion string
	Proxy          string
	StateDir       string
	OnProgress     func(WMLProgress)

	// manifestURLs 只用于测试：覆盖 static manifest 的地址，让 Check/Download
	// 能对着 httptest 跑完整链路，而不依赖 jsDelivr / Gitee / 官网。
	manifestURLs []string
}

// WMLRelease 是 `CheckWML` 的结果，只暴露界面需要的字段。
type WMLRelease struct {
	Available      bool
	CurrentVersion string
	Version        string
	Notes          string
	PublishedAt    time.Time
	Source         string
	AssetName      string
	AssetSize      int64
	AssetSHA256    string
}

// WMLDownload 是 `DownloadWML` 的结果。
type WMLDownload struct {
	Version string
	Path    string
	Kind    AssetKind
}

// WMLConfig 构造 wmlUpdate 的配置（纯函数）。
func WMLConfig(opts WMLOptions) *wmlupdate.Config {
	return &wmlupdate.Config{
		AppID:          WMLAppID,
		Channel:        WMLChannel,
		CurrentVersion: opts.CurrentVersion,
		Source:         wmlSource(opts.Source, opts.manifestURLs),
		AssetRules:     wmlAssetRules(),
		Install:        wmlupdate.InstallConfig{Type: wmlupdate.InstallExternal},
		StateDir:       opts.StateDir,
		Security: wmlupdate.SecurityConfig{
			ChecksumsAsset: "checksums.txt",
		},
		Download: wmlupdate.DownloadConfig{
			MaxBytes: 512 << 20,
			Timeout:  30 * time.Minute,
			Retries:  3,
			Proxy:    opts.Proxy,
		},
	}
}

// wmlSource 把用户选的更新源映射成 wmlUpdate 的 source。
//
// `auto` 只有三条：GitHub → Gitee → CNB。后两者都是完整镜像，
// 清单里的资产 URL 指向各自的 Release，所以任何一条都能独立完成检查 + 下载。
func wmlSource(source string, manifestURLs []string) wmlupdate.SourceConfig {
	giteeURL := wmlGiteeManifestURL
	cnbURL := wmlCNBManifestURL
	if len(manifestURLs) > 0 {
		giteeURL = manifestURLs[0]
		cnbURL = manifestURLs[len(manifestURLs)-1]
	}
	switch NormalizeSource(source) {
	case SourceGitHub:
		return wmlGitHubSource()
	case SourceGitee:
		return wmlStaticSource(giteeURL)
	case SourceCNB:
		return wmlStaticSource(cnbURL)
	default:
		return wmlupdate.SourceConfig{
			Type: "chain",
			Sources: []wmlupdate.SourceConfig{
				wmlGitHubSource(),
				wmlStaticSource(giteeURL),
				wmlStaticSource(cnbURL),
			},
		}
	}
}

func wmlGitHubSource() wmlupdate.SourceConfig {
	return wmlupdate.SourceConfig{
		Type:      wmlupdate.SourceGitHub,
		Owner:     wmlOwner,
		Repo:      wmlRepo,
		TagPrefix: "v",
	}
}

func wmlStaticSource(url string) wmlupdate.SourceConfig {
	return wmlupdate.SourceConfig{
		Type:         wmlupdate.SourceStatic,
		ManifestURLs: []string{url},
	}
}

// wmlAssetRules 只认 DownVid 现有的产物名。
//
// 每个平台先给「可自动安装」的形态，再给一个只用于**发现版本**的后备形态
// （dmg / zip / deb）。后备形态让 `Check` 在产物不全时仍能报出「有新版本」，
// 下载阶段再由 WMLInstallableKind 拒绝并提示手动下载 —— 否则链停在
// `no_asset`，用户连版本号都看不到。
func wmlAssetRules() []wmlupdate.AssetRule {
	return []wmlupdate.AssetRule{
		{OS: "darwin", Match: "DownVid-Wails-mac-universal-{version}.zip", Format: "zip"},
		{OS: "darwin", Match: "DownVid-Wails-mac-universal-{version}.dmg", Format: "dmg"},
		{OS: "windows", Match: "DownVid-Wails-windows-x64-{version}-installer.exe", Format: "exe"},
		{OS: "windows", Match: "DownVid-Wails-windows-x64-{version}.zip", Format: "zip"},
		{OS: "linux", Match: "DownVid-Wails-linux-x64-{version}.AppImage", Format: "raw"},
		{OS: "linux", Match: "DownVid-Wails-linux-x64-{version}.tar.gz", Format: "tar.gz"},
		{OS: "linux", Match: "DownVid-Wails-linux-x64-{version}.deb", Format: "raw"},
	}
}

// WMLInstallableKind 判断产物在当前平台能否自动安装。
//
// 这与 `PickInstallAsset` 的平台规则保持一致：macOS 只认 zip（内含 .app），
// Windows 只认 NSIS installer，Linux 只认 AppImage（目前不发布）。
// 其他形态只用于发现版本，下载时必须拒绝。
func WMLInstallableKind(name string) AssetKind {
	kind := ClassifyAsset(name)
	switch runtime.GOOS {
	case "darwin":
		if kind != KindZip {
			return KindUnsupported
		}
	case "windows":
		if kind != KindNsis {
			return KindUnsupported
		}
	case "linux":
		if kind != KindAppImage {
			return KindUnsupported
		}
	default:
		return KindUnsupported
	}
	return kind
}

// WMLErrorCode 把 wmlUpdate 的错误归成稳定的分类，供界面诊断使用。
func WMLErrorCode(err error) string {
	if err == nil {
		return ""
	}
	if code := wmlupdate.Code(err); code != "" {
		return code
	}
	return "source"
}

// NewWMLUpdater 创建 updater；调用方负责 Close。
func NewWMLUpdater(opts WMLOptions) (*wmlupdate.Updater, error) {
	if opts.StateDir == "" {
		return nil, errors.New("更新状态目录为空")
	}
	var events wmlupdate.EventFunc
	if opts.OnProgress != nil {
		events = func(e wmlupdate.Event) {
			if e.Type == wmlupdate.EventProgress {
				opts.OnProgress(WMLProgress{Percent: e.Percent, Bytes: e.Bytes, Total: e.Total})
			}
		}
	}
	return wmlupdate.New(wmlupdate.Options{
		Config:         WMLConfig(opts),
		BaseDir:        opts.StateDir,
		CurrentVersion: opts.CurrentVersion,
		Events:         events,
	})
}

// CheckWML 查一次最新版本。
//
// 返回的 WMLRelease 不持有 updater，调用方可以直接使用；下载必须重新
// Check + Apply（wmlUpdate 要求 Apply 使用同一次 Check 的快照）。
func CheckWML(ctx context.Context, opts WMLOptions) (*WMLRelease, error) {
	u, err := NewWMLUpdater(opts)
	if err != nil {
		return nil, err
	}
	defer u.Close()

	upd, err := u.Check(ctx)
	if err != nil {
		return nil, err
	}
	out := &WMLRelease{
		Available:      upd.Available,
		CurrentVersion: upd.CurrentVersion,
		Version:        upd.Version,
		Notes:          upd.Notes,
		PublishedAt:    upd.PublishedAt,
		Source:         upd.Source,
		AssetName:      upd.Asset.Name,
		AssetSize:      upd.Asset.Size,
		AssetSHA256:    upd.Asset.SHA256,
	}
	return out, nil
}

// DownloadWML 重新检查并下载指定版本，返回校验过的安装包路径。
//
// `wantVersion` 非空时必须与本次检查到的版本一致：界面显示的是检查时的
// 版本，如果这期间发了新版，宁可让用户重新检查，也不要在后台静默装一个
// 他没看过的版本。
func DownloadWML(ctx context.Context, opts WMLOptions, wantVersion string) (*WMLDownload, error) {
	u, err := NewWMLUpdater(opts)
	if err != nil {
		return nil, err
	}
	defer u.Close()

	upd, err := u.Check(ctx)
	if err != nil {
		return nil, err
	}
	if !upd.Available {
		return nil, errors.New("当前已是最新版本")
	}
	if wantVersion != "" && upd.Version != wantVersion {
		return nil, fmt.Errorf("发现新版本 %s，请重新检查更新", upd.Version)
	}

	kind := WMLInstallableKind(upd.Asset.Name)
	if kind == KindUnsupported {
		return nil, errors.New("这一版没有提供适合本机自动更新的安装包，请到 Releases 页面手动下载")
	}

	res, err := u.Apply(ctx, upd, wmlupdate.ApplyOptions{})
	if err != nil {
		return nil, err
	}
	if res.ArtifactPath == "" {
		return nil, errors.New("下载完成但没有拿到安装包路径")
	}
	version := res.Version
	if version == "" {
		version = upd.Version
	}
	return &WMLDownload{Version: version, Path: res.ArtifactPath, Kind: kind}, nil
}
