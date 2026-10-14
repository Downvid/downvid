package manifest

import (
	"runtime"
	"testing"
)

// 平台键必须与 electron-builder 的 ${platform}-${arch} 命名一致。
//
// 回归背景：这里原先直接用 Go 的 GOOS/GOARCH，Windows 上得到 "windows/amd64"，
// 而资产表的 key 是 "win32/x64"，查表永远失败 → 用户看到
// 「暂不支持 windows/amd64 平台的 yt-dlp 下载」。
// macOS / Linux 两种命名恰好一致，所以本地与 CI 的 mac/linux job 都发现不了。
//
// 因此用例必须**显式喂入 Windows 的取值**，而不是 `if runtime.GOOS == "windows"`
// 才断言——后者在 macOS 上等于没测（第一版就是这么写的，注入变异后仍然通过）。

func TestPlatformKeyMapsWindowsNaming(t *testing.T) {
	cases := []struct {
		goos, goarch string
		want         string
		why          string
	}{
		{"windows", "amd64", "win32/x64", "Go 的 windows/amd64 ≠ electron 的 win32/x64（事故现场）"},
		{"windows", "arm64", "win32/arm64", "Windows arm64"},
		{"darwin", "arm64", "darwin/arm64", "两种命名一致，不应被改名"},
		{"darwin", "amd64", "darwin/x64", "amd64 → x64"},
		{"linux", "amd64", "linux/x64", "amd64 → x64"},
		{"linux", "arm64", "linux/arm64", "arm64 保持"},
	}
	for _, c := range cases {
		if got := PlatformKey(c.goos, c.goarch); got != c.want {
			t.Errorf("PlatformKey(%q, %q) = %q，期望 %q（%s）", c.goos, c.goarch, got, c.want, c.why)
		}
	}
}

// 绝不能把 Go 的命名当成资产表的 key
func TestGoNamingIsNotUsedAsKey(t *testing.T) {
	if _, ok := ytdlpAssets["windows/amd64"]; ok {
		t.Error("资产表里出现了 Go 命名 windows/amd64，应统一为 win32/x64")
	}
	if _, ok := ytdlpAssets["win32/x64"]; !ok {
		t.Error("资产表缺少 win32/x64 — Windows 用户将无法下载依赖")
	}
	if got := PlatformKey("windows", "amd64"); got != "win32/x64" {
		t.Errorf("Windows 上必须得到 win32/x64，实际 %q", got)
	}
}

// 当前宿主平台也必须能查到表（否则 Tasks 直接报错）
func TestCurrentPlatformResolvable(t *testing.T) {
	got := CurrentPlatform()
	if _, ok := ytdlpAssets[got]; !ok {
		t.Errorf("平台键 %q 在 ytdlpAssets 中不存在", got)
	}
	if _, ok := ffmpegAssets[got]; !ok {
		t.Errorf("平台键 %q 在 ffmpegAssets 中不存在", got)
	}
	if _, err := Tasks("/tmp/x", nil); err != nil {
		t.Fatalf("当前平台（%s，Go 侧 %s/%s）应能生成下载任务：%v", got, runtime.GOOS, runtime.GOARCH, err)
	}
}
