package download

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 用假 yt-dlp 把**实际收到的参数**回显出来，验证自动字幕开关真的传到了子进程。
//
// 为什么需要这一层：纯函数测试只能证明 `BuildArgs` 拼对了字符串，
// 但真正的失败模式是「参数没进到 argv」——比如有人在中途重建了参数列表。
// 这条用例完整走一次 Run，从子进程侧把 argv 原样读回来。
func TestRunPassesAutoSubsFlagToProcess(t *testing.T) {
	fake := writeFakeYtdlp(t, `
# 把本次调用的完整参数写进文件，供测试断言
printf '%s\n' "$@" > "$ARGV_FILE"
echo "[dvfile]/tmp/out/x.srt"
exit 0
`)
	argvFile := filepath.Join(t.TempDir(), "argv.txt")
	t.Setenv("ARGV_FILE", argvFile)

	o := Options{
		TaskID: "t1", URL: "https://example.com/v",
		DownloadMode: "subtitle", AutoSubtitles: []string{"ja"},
	}
	args := BuildArgs(o, t.TempDir(), BuildArgsContext{})

	r := NewRunner()
	res, err := r.Run("t1", RunOptions{
		YtdlpPath: fake, Args: args, URL: o.URL, WantSubtitles: []string{"ja"},
	})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if res.Code == nil || *res.Code != 0 {
		t.Fatalf("exit code = %v", res.Code)
	}

	raw, err := os.ReadFile(argvFile)
	if err != nil {
		t.Fatalf("假 yt-dlp 没写出 argv：%v", err)
	}
	got := string(raw)
	if !strings.Contains(got, "--write-auto-subs") {
		t.Errorf("子进程没收到 --write-auto-subs（自动字幕会一条都下不到）：\n%s", got)
	}
	if strings.Contains(got, "--write-subs\n") {
		t.Errorf("只选了自动字幕时不该传 --write-subs：\n%s", got)
	}
	if !strings.Contains(got, "ja") {
		t.Errorf("--sub-langs 应带 ja：\n%s", got)
	}
}

// 只选人工字幕时不能传 --write-auto-subs。
//
// 变异点：两个开关混用时，用户选的「人工字幕」会连带把几十种机器转录
// 一起下下来（yt-dlp 对 auto 的语言列表是独立的）。
func TestRunDoesNotPassAutoSubsForManualOnly(t *testing.T) {
	fake := writeFakeYtdlp(t, `
printf '%s\n' "$@" > "$ARGV_FILE"
echo "[dvfile]/tmp/out/x.srt"
exit 0
`)
	argvFile := filepath.Join(t.TempDir(), "argv.txt")
	t.Setenv("ARGV_FILE", argvFile)

	o := Options{
		TaskID: "t1", URL: "https://example.com/v",
		DownloadMode: "subtitle", Subtitles: []string{"en"},
	}
	args := BuildArgs(o, t.TempDir(), BuildArgsContext{})
	r := NewRunner()
	if _, err := r.Run("t1", RunOptions{
		YtdlpPath: fake, Args: args, URL: o.URL, WantSubtitles: []string{"en"},
	}); err != nil {
		t.Fatalf("run: %v", err)
	}

	raw, _ := os.ReadFile(argvFile)
	if strings.Contains(string(raw), "--write-auto-subs") {
		t.Errorf("只选人工字幕时不该传 --write-auto-subs：\n%s", raw)
	}
	if !strings.Contains(string(raw), "--write-subs") {
		t.Errorf("人工字幕必须传 --write-subs：\n%s", raw)
	}
}
