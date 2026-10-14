package manifest

import (
	"path/filepath"
	"strings"
	"testing"
)

// 直接验证 issue #40 里那条命令行对应的任务生成结果
func TestIssue40Repro(t *testing.T) {
	// downvid-deps.exe fetch --managed-dir C:\Users\x\AppData\Roaming\downvid\runtime\bin --only ffmpeg
	tasks, err := TasksFor("win32/x64", `C:\Users\x\AppData\Roaming\downvid\runtime\bin`, []string{"ffmpeg"})
	if err != nil {
		t.Fatalf("issue #40 的场景仍报错：%v", err)
	}
	if len(tasks) != 1 {
		t.Fatalf("应只生成 ffmpeg 一个任务，实际 %d 个", len(tasks))
	}
	task := tasks[0]
	if task.Tool != "ffmpeg" {
		t.Errorf("工具应为 ffmpeg，实际 %q", task.Tool)
	}
	if task.URL == "" || task.SHA256 == "" {
		t.Error("任务缺少下载地址或校验值")
	}
	// 路径用 filepath.Join 拼接，分隔符跟随**宿主**平台——在 macOS 上跑
	// 会得到 `C:\...\bin/ffmpeg` 这种混用形态，但真实 Windows 上是反斜杠。
	// 因此这里只断言结尾是文件名，不写死分隔符（写死会在另一平台上失败）。
	// BinaryName 也跟随宿主平台（macOS 上是 "ffmpeg"，Windows 上是 "ffmpeg.exe"），
	// 所以用 filepath.Base 取文件名再比对，避免把平台差异写进断言。
	if base := filepath.Base(task.Target); !strings.HasPrefix(base, "ffmpeg") {
		t.Errorf("目标路径的文件名应以 ffmpeg 开头，实际 %q", base)
	}
	t.Logf("生成任务：%s → %s", task.URL, task.Target)
}
