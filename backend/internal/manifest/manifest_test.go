package manifest

import (
	"regexp"
	"testing"
)

var reSHA256 = regexp.MustCompile(`^[0-9a-f]{64}$`)

// 每个受支持的平台都必须能生成完整任务，否则 CI 构建出来的 sidecar 会在用户机上失败
func TestTasksCoverEveryPlatform(t *testing.T) {
	for _, platform := range Platforms {
		if _, ok := ytdlpAssets[platform]; !ok {
			t.Errorf("平台 %s 缺少 yt-dlp 产物", platform)
		}
		if _, ok := ffmpegAssets[platform]; !ok {
			t.Errorf("平台 %s 缺少 ffmpeg 产物", platform)
		}
	}
}

func TestAssetNamesAndHashesWellFormed(t *testing.T) {
	// 清单文件是生成出来的；哈希必须齐全，否则校验形同虚设
	for platform, a := range ytdlpAssets {
		if a.Name == "" {
			t.Errorf("%s 的 yt-dlp 产物名为空", platform)
		}
		if !reSHA256.MatchString(a.SHA256) {
			t.Errorf("%s 的 yt-dlp 校验值不是 64 位十六进制（清单可能未更新）：%q", platform, a.SHA256)
		}
	}
	for platform, byKind := range ffmpegAssets {
		for kind, a := range byKind {
			if a.Name == "" {
				t.Errorf("%s/%s 产物名为空", platform, kind)
			}
			if !reSHA256.MatchString(a.SHA256) {
				t.Errorf("%s/%s 校验值不是 64 位十六进制：%q", platform, kind, a.SHA256)
			}
		}
	}
}

func TestTasksForCurrentPlatform(t *testing.T) {
	tasks, err := Tasks("/tmp/downvid-runtime/bin", nil)
	if err != nil {
		t.Skipf("当前平台 %s 无下载任务：%v", CurrentPlatform(), err)
	}
	if len(tasks) == 0 {
		t.Fatal("应至少生成一个下载任务")
	}

	seen := map[string]bool{}
	for _, task := range tasks {
		if task.Tool == "" || task.URL == "" || task.Target == "" {
			t.Errorf("任务字段不完整：%+v", task)
		}
		if !reSHA256.MatchString(task.SHA256) {
			t.Errorf("%s 缺少有效校验值：%q", task.Tool, task.SHA256)
		}
		// 归档形态按依赖种类区分，且每个任务必须恰好命中一种：
		//   yt-dlp        → 裸二进制（zipapp / 自包含 exe）
		//   ffmpeg/probe  → gzip 单文件
		//   aria2         → zip / tar.gz / 裸文件，**三端不同**（见 aria2Assets 注释）
		archives := 0
		if task.Gzip {
			archives++
		}
		if task.ZipInner != "" {
			archives++
		}
		if task.TarInner != "" {
			archives++
		}
		if archives > 1 {
			t.Errorf("%s 同时声明了多种归档格式：%+v", task.Tool, task)
		}
		switch task.Tool {
		case "yt-dlp":
			if archives != 0 {
				t.Errorf("yt-dlp 应是裸二进制，不应带归档标记：%+v", task)
			}
		case "ffmpeg", "ffprobe":
			if !task.Gzip {
				t.Errorf("%s 应标记为 gzip", task.Tool)
			}
		case "aria2":
			// 三种都合法，只要 URL 与形态对得上即可
			if task.URL == "" {
				t.Error("aria2 任务缺少 URL")
			}
		}
		seen[task.Tool] = true
	}

	if !seen["yt-dlp"] || !seen["ffmpeg"] {
		t.Errorf("必须包含 yt-dlp 与 ffmpeg，实际：%v", seen)
	}
}

func TestTasksOnlyFilter(t *testing.T) {
	tasks, err := Tasks("/tmp/downvid-runtime/bin", []string{"ffmpeg"})
	if err != nil {
		t.Skipf("当前平台无任务：%v", err)
	}
	for _, task := range tasks {
		if task.Tool != "ffmpeg" {
			t.Errorf("--only ffmpeg 时不应出现 %s", task.Tool)
		}
	}
}

// Windows arm64 上游没有 ffmpeg 构建：应跳过而不是让整机不可用
func TestWindowsArm64FfmpegIsSkippedNotFatal(t *testing.T) {
	if _, ok := ffmpegAssets["win32/arm64"]; ok {
		t.Skip("上游已提供 Windows arm64 构建，可移除本用例")
	}
	if _, err := Tasks("/tmp/x", []string{"ffmpeg"}); err != nil {
		// 当前平台若不支持，Tasks 允许报错；这里只确认不会 panic
		t.Logf("当前平台无 ffmpeg 任务：%v", err)
	}
}
