//go:build windows

package download

import (
	"context"
	"testing"
)

// issue #100：Windows 上宿主是 GUI 进程，spawn 控制台程序时系统会给它新建一个
// 控制台窗口，标题就是 exe 的完整路径（`...\runtime\bin\yt-dlp.exe`）。
// 没设 HideWindow 时，用户每点一次下载就弹一个空黑框，下载看起来像「卡住/失败」。
//
// 这个用例只能在 Windows 上跑（`SysProcAttr.HideWindow` 只有那边存在），
// 由 CI 的 windows-latest job 覆盖；macOS / Linux 上由 build tag 排除。
func TestNewYtdlpCmdHidesConsoleWindow(t *testing.T) {
	cmd := newYtdlpCmd(context.Background(), RunOptions{
		YtdlpPath: `C:\Users\example\.downvid\runtime\bin\yt-dlp.exe`,
		OutputDir: `C:\Users\example\Downloads`,
	}, []string{"https://example.com/v"})

	if cmd.SysProcAttr == nil || !cmd.SysProcAttr.HideWindow {
		t.Fatal("yt-dlp 子进程没有设置 HideWindow：Windows 上每点一次下载就弹一个控制台黑框（issue #100）")
	}
}
