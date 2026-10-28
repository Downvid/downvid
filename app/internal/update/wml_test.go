package update

import (
	"errors"
	"runtime"
	"strings"
	"testing"

	wmlupdate "github.com/yxxbc/wmlUpdate"
)

// TestWMLSourceMapping 钉住「用户选的源 → wmlUpdate source」的映射。
//
// 现在只有三条：GitHub / Gitee / CNB。Gitee 与 CNB 都是完整镜像，
// 清单里的资产 URL 指向各自的 Release。
func TestWMLSourceMapping(t *testing.T) {
	t.Run("auto 是三级链", func(t *testing.T) {
		sc := wmlSource("auto", nil)
		if sc.Type != "chain" {
			t.Fatalf("type = %q, want chain", sc.Type)
		}
		if len(sc.Sources) != 3 {
			t.Fatalf("sources = %d, want 3", len(sc.Sources))
		}
		if sc.Sources[0].Type != wmlupdate.SourceGitHub {
			t.Fatalf("source[0] = %+v, want github", sc.Sources[0])
		}
		if sc.Sources[1].Type != wmlupdate.SourceStatic ||
			!strings.Contains(sc.Sources[1].ManifestURLs[0], "/Xynrin/downvid/") {
			t.Fatalf("source[1] = %+v, want gitee static", sc.Sources[1])
		}
		if sc.Sources[2].Type != wmlupdate.SourceStatic ||
			!strings.Contains(sc.Sources[2].ManifestURLs[0], "cnb.cool/yxxbc/downvid") {
			t.Fatalf("source[2] = %+v, want cnb static", sc.Sources[2])
		}
	})

	t.Run("钉死单个源", func(t *testing.T) {
		cases := []struct {
			source string
			typ    string
			host   string
		}{
			{"github", wmlupdate.SourceGitHub, ""},
			{"gitee", wmlupdate.SourceStatic, "gitee.com"},
			{"cnb", wmlupdate.SourceStatic, "cnb.cool"},
		}
		for _, tc := range cases {
			t.Run(tc.source, func(t *testing.T) {
				sc := wmlSource(tc.source, nil)
				if sc.Type != tc.typ {
					t.Fatalf("type = %q, want %q", sc.Type, tc.typ)
				}
				if tc.host != "" {
					if len(sc.ManifestURLs) != 1 || !strings.Contains(sc.ManifestURLs[0], tc.host) {
						t.Fatalf("manifest urls = %v, want host %s", sc.ManifestURLs, tc.host)
					}
				}
			})
		}
	})

	t.Run("旧源值回退 auto", func(t *testing.T) {
		for _, old := range []string{"jsdelivr", "ghproxy", "website", "not-a-source"} {
			if sc := wmlSource(old, nil); sc.Type != "chain" {
				t.Errorf("%s: type = %q, want chain", old, sc.Type)
			}
		}
	})
}

// TestWMLManifestOrder 钉住两个完整镜像的清单地址。
func TestWMLManifestOrder(t *testing.T) {
	if !strings.Contains(wmlGiteeManifestURL, "/Xynrin/downvid/") ||
		!strings.Contains(wmlGiteeManifestURL, "manifest.gitee.json") {
		t.Errorf("gitee manifest = %q", wmlGiteeManifestURL)
	}
	if !strings.Contains(wmlCNBManifestURL, "cnb.cool/yxxbc/downvid") ||
		!strings.Contains(wmlCNBManifestURL, "/releases/download/update/manifest.cnb.json") {
		t.Errorf("cnb manifest = %q", wmlCNBManifestURL)
	}
}

// TestWMLAssetRulesOrder 钉住平台资产的选择顺序。
//
// 第一规则必须是可自动安装的形态；后备规则只用于发现版本。
func TestWMLAssetRulesOrder(t *testing.T) {
	rules := wmlAssetRules()
	want := []struct {
		os     string
		match  string
		format string
	}{
		{"darwin", "DownVid-Wails-mac-universal-{version}.zip", "zip"},
		{"darwin", "DownVid-Wails-mac-universal-{version}.dmg", "dmg"},
		{"windows", "DownVid-Wails-windows-x64-{version}-installer.exe", "exe"},
		{"windows", "DownVid-Wails-windows-x64-{version}.zip", "zip"},
		{"linux", "DownVid-Wails-linux-x64-{version}.AppImage", "raw"},
		{"linux", "DownVid-Wails-linux-x64-{version}.tar.gz", "tar.gz"},
		{"linux", "DownVid-Wails-linux-x64-{version}.deb", "raw"},
	}
	if len(rules) != len(want) {
		t.Fatalf("rules = %d, want %d", len(rules), len(want))
	}
	for i := range want {
		if rules[i].OS != want[i].os || rules[i].Match != want[i].match || rules[i].Format != want[i].format {
			t.Errorf("rule[%d] = %+v, want %+v", i, rules[i], want[i])
		}
	}
}

// TestWMLInstallableKind 钉住「哪些产物可以自动安装」。
//
// 后备资产（dmg / zip / deb）只能用来发现版本；如果这里放行，用户会下载
// 一个装不上的包，然后在 InstallUpdate 里失败。
func TestWMLInstallableKind(t *testing.T) {
	zipName := "DownVid-Wails-mac-universal-1.7.3.zip"
	dmgName := "DownVid-Wails-mac-universal-1.7.3.dmg"
	exeName := "DownVid-Wails-windows-x64-1.7.3-installer.exe"
	winZipName := "DownVid-Wails-windows-x64-1.7.3.zip"
	appImageName := "DownVid-1.7.3.AppImage"
	tarName := "DownVid-Wails-linux-x64-1.7.3.tar.gz"

	switch runtime.GOOS {
	case "darwin":
		if got := WMLInstallableKind(zipName); got != KindZip {
			t.Errorf("zip = %q, want zip", got)
		}
		if got := WMLInstallableKind(dmgName); got != KindUnsupported {
			t.Errorf("dmg = %q, want unsupported", got)
		}
		if got := WMLInstallableKind(exeName); got != KindUnsupported {
			t.Errorf("exe = %q, want unsupported", got)
		}
	case "windows":
		if got := WMLInstallableKind(exeName); got != KindNsis {
			t.Errorf("exe = %q, want nsis", got)
		}
		if got := WMLInstallableKind(winZipName); got != KindUnsupported {
			t.Errorf("zip = %q, want unsupported", got)
		}
		if got := WMLInstallableKind(dmgName); got != KindUnsupported {
			t.Errorf("dmg = %q, want unsupported", got)
		}
	case "linux":
		if got := WMLInstallableKind(appImageName); got != KindAppImage {
			t.Errorf("appimage = %q, want appimage", got)
		}
		if got := WMLInstallableKind(tarName); got != KindUnsupported {
			t.Errorf("tar.gz = %q, want unsupported", got)
		}
		if got := WMLInstallableKind(zipName); got != KindUnsupported {
			t.Errorf("zip = %q, want unsupported", got)
		}
	}
}

func TestWMLConfigCarriesRuntimeOptions(t *testing.T) {
	cfg := WMLConfig(WMLOptions{
		Source:         "auto",
		CurrentVersion: "1.7.3",
		Proxy:          "socks5://127.0.0.1:7890",
		StateDir:       "/tmp/downvid-updater",
	})
	if cfg.AppID != WMLAppID || cfg.Channel != WMLChannel {
		t.Fatalf("app id/channel = %q/%q", cfg.AppID, cfg.Channel)
	}
	if cfg.CurrentVersion != "1.7.3" {
		t.Fatalf("current version = %q", cfg.CurrentVersion)
	}
	if cfg.Install.Type != wmlupdate.InstallExternal {
		t.Fatalf("install type = %q, want external", cfg.Install.Type)
	}
	if cfg.Download.Proxy != "socks5://127.0.0.1:7890" {
		t.Fatalf("proxy = %q", cfg.Download.Proxy)
	}
	if cfg.StateDir != "/tmp/downvid-updater" {
		t.Fatalf("state dir = %q", cfg.StateDir)
	}
}

func TestWMLErrorCode(t *testing.T) {
	if got := WMLErrorCode(nil); got != "" {
		t.Fatalf("nil = %q, want empty", got)
	}
	if got := WMLErrorCode(errors.New("boom")); got != "internal" {
		t.Fatalf("plain error = %q, want internal", got)
	}
	if got := WMLErrorCode(&wmlupdate.Error{Code: "no_asset", Err: errors.New("boom")}); got != "no_asset" {
		t.Fatalf("typed error = %q, want no_asset", got)
	}
}
