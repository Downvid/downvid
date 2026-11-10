package download

import (
	"strings"
	"testing"
)

// subtitlesArgs 统计某个开关出现的次数与它后面的语言列表。
func subtitleFlagCount(args []string, flag string) int {
	n := 0
	for _, a := range args {
		if a == flag {
			n++
		}
	}
	return n
}

// 选了自动字幕就必须传 `--write-auto-subs`。
//
// 变异点（修之前真实存在的失败）：代码只传 `--write-subs`，于是用户在界面上
// 勾选「自动字幕」后，yt-dlp **一个文件都不会下**，退出码却是 0 ——
// 界面显示「已完成」，下载目录里空空的。这是最糟的一类失败：看起来成功了。
func TestAutoSubtitlesUseWriteAutoSubs(t *testing.T) {
	o := baseOptions()
	o.Subtitles = nil
	o.AutoSubtitles = []string{"en", "ja"}
	args := BuildArgs(o, "/tmp/out", baseCtx())

	if subtitleFlagCount(args, "--write-subs") != 0 {
		t.Error("只选了自动字幕时不该传 --write-subs（它只下人工字幕）")
	}
	if subtitleFlagCount(args, "--write-auto-subs") != 1 {
		t.Fatalf("必须传一次 --write-auto-subs，got args=%v", args)
	}
	if langs, ok := valueAfter(args, "--sub-langs"); !ok || langs != "en,ja" {
		t.Errorf("--sub-langs = %q, want %q", langs, "en,ja")
	}
}

// 人工与自动字幕同时选：两个开关都要有，各带自己的语言列表。
func TestBothSubtitleKindsEmitted(t *testing.T) {
	o := baseOptions()
	o.Subtitles = []string{"en"}
	o.AutoSubtitles = []string{"ja"}
	args := BuildArgs(o, "/tmp/out", baseCtx())

	if subtitleFlagCount(args, "--write-subs") != 1 {
		t.Error("选了人工字幕必须传 --write-subs")
	}
	if subtitleFlagCount(args, "--write-auto-subs") != 1 {
		t.Error("选了自动字幕必须传 --write-auto-subs")
	}
	// 两个 --sub-langs 必须都存在（yt-dlp 按开关各自取语言）
	if subtitleFlagCount(args, "--sub-langs") != 2 {
		t.Errorf("两类字幕各需一个 --sub-langs，got %v", args)
	}
}

// 纯字幕模式下同样要区分人工 / 自动。
//
// 变异点：早先字幕模式把 langs 拼成一个 "all" 或人工列表，自动字幕永远拿不到。
func TestSubtitleOnlyModeKeepsAutoSplit(t *testing.T) {
	o := baseOptions()
	o.DownloadMode = "subtitle"
	o.AutoSubtitles = []string{"ko"}
	args := BuildArgs(o, "/tmp/out", baseCtx())

	if subtitleFlagCount(args, "--skip-download") != 1 {
		t.Error("字幕模式必须 --skip-download")
	}
	if subtitleFlagCount(args, "--write-auto-subs") != 1 {
		t.Error("字幕模式也要为自动字幕传 --write-auto-subs")
	}
	if !strings.Contains(strings.Join(args, " "), "srt") {
		t.Error("字幕模式应要求转成 srt")
	}
}

// 两类都没选时不许出现任何字幕参数（否则会拖慢下载、多出文件）。
func TestNoSubtitleArgsWhenNoneSelected(t *testing.T) {
	args := BuildArgs(baseOptions(), "/tmp/out", baseCtx())
	for _, flag := range []string{"--write-subs", "--write-auto-subs", "--sub-langs"} {
		if subtitleFlagCount(args, flag) != 0 {
			t.Errorf("未选字幕时不该出现 %s", flag)
		}
	}
}
