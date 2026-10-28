package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"testing"
	"time"
)

// installableAssetName 返回当前平台可自动安装的 Wails 产物名与格式。
func installableAssetName(version string) (string, string) {
	switch runtime.GOOS {
	case "darwin":
		return fmt.Sprintf("DownVid-Wails-mac-universal-%s.zip", version), "zip"
	case "windows":
		return fmt.Sprintf("DownVid-Wails-windows-x64-%s-installer.exe", version), "exe"
	default:
		return fmt.Sprintf("DownVid-Wails-linux-x64-%s.AppImage", version), "raw"
	}
}

// TestCheckAndDownloadAgainstStaticManifest 端到端跑一遍 static manifest：
// Check 选资产 → Apply(external) 下载并校验 SHA-256 → 返回安装包路径。
//
// 这条链路的核心风险不是「请求发不出去」，而是「选错资产 / 哈希没校验 /
// 下载路径没交回来」——它们都不会在编译期暴露。用 httptest 把真实
// wmlUpdate 引擎跑起来，才能覆盖。
func TestCheckAndDownloadAgainstStaticManifest(t *testing.T) {
	const version = "1.7.4"
	payload := []byte("downvid update artifact bytes")
	sum := sha256.Sum256(payload)
	name, format := installableAssetName(version)

	var baseURL string
	mux := http.NewServeMux()
	mux.HandleFunc("/manifest.json", func(w http.ResponseWriter, _ *http.Request) {
		manifest := map[string]any{
			"schema_version": 1,
			"app_id":         WMLAppID,
			"channel":        WMLChannel,
			"version":        version,
			"published_at":   time.Now().UTC().Format(time.RFC3339),
			"notes":          "test release",
			"assets": []map[string]any{{
				"name":   name,
				"os":     runtime.GOOS,
				"url":    baseURL + "/" + name,
				"sha256": hex.EncodeToString(sum[:]),
				"size":   len(payload),
				"format": format,
			}},
		}
		_ = json.NewEncoder(w).Encode(manifest)
	})
	mux.HandleFunc("/"+name, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(payload)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	baseURL = srv.URL

	opts := WMLOptions{
		Source:         "gitee",
		CurrentVersion: "1.7.3",
		StateDir:       t.TempDir(),
		manifestURLs:   []string{srv.URL + "/manifest.json"},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	rel, err := CheckWML(ctx, opts)
	if err != nil {
		t.Fatalf("CheckWML: %v", err)
	}
	if !rel.Available {
		t.Fatal("应报告有更新")
	}
	if rel.Version != version {
		t.Fatalf("version = %q, want %s", rel.Version, version)
	}
	if rel.AssetName != name {
		t.Fatalf("asset = %q, want %s", rel.AssetName, name)
	}
	if rel.AssetSHA256 != hex.EncodeToString(sum[:]) {
		t.Fatalf("sha256 = %q", rel.AssetSHA256)
	}

	dl, err := DownloadWML(ctx, opts, version)
	if err != nil {
		t.Fatalf("DownloadWML: %v", err)
	}
	if dl.Version != version {
		t.Fatalf("downloaded version = %q", dl.Version)
	}
	if dl.Kind != WMLInstallableKind(name) {
		t.Fatalf("kind = %q, want %q", dl.Kind, WMLInstallableKind(name))
	}
	got, err := os.ReadFile(dl.Path)
	if err != nil {
		t.Fatalf("read artifact: %v", err)
	}
	if string(got) != string(payload) {
		t.Fatalf("artifact bytes = %q", got)
	}
}
