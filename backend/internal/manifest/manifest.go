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

// Platforms 支持的平台组合，供 CI 交叉构建与校验使用
var Platforms = []string{"darwin/arm64", "darwin/x64", "linux/x64", "linux/arm64", "win32/x64"}

// asset 一个可下载产物：上游文件名与下载内容的 SHA-256。
// gzip 产物的校验值针对压缩文件本身（下载即校验，先校验后解压）。
type asset struct {
	Name   string
	SHA256 string
}

// CurrentPlatform 当前构建/运行平台，形如 darwin/arm64
func CurrentPlatform() string { return goruntime.GOOS + "/" + goruntime.GOARCH }

// Tasks 生成当前平台的下载任务；only 为空表示全部依赖。
func Tasks(managedDir string, only []string) ([]fetch.Task, error) {
	platform := CurrentPlatform()
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
