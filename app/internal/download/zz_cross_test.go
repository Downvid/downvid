package download

// 临时交叉验证：读 /tmp/cases.json，用 Go 的 BuildArgs 重算，与 TS 输出逐字比对。
import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

type tsCase struct {
	Options struct {
		URL          string   `json:"url"`
		FormatID     string   `json:"formatId"`
		DownloadMode string   `json:"downloadMode"`
		HasAudio     bool     `json:"hasAudio"`
		FilenameTmpl string   `json:"filenameTemplate"`
		Proxy        string   `json:"proxy"`
		Subtitles    []string `json:"subtitles"`
		AudioTrack   *struct {
			FormatID string `json:"formatId"`
			Language string `json:"language"`
			IsM3U8   bool   `json:"isM3u8"`
		} `json:"audioTrack"`
		Acceleration *struct {
			Enabled        bool `json:"enabled"`
			MaxConnections int  `json:"maxConnections"`
		} `json:"acceleration"`
	} `json:"options"`
	OutDir string `json:"outDir"`
	Ctx    struct {
		FfmpegLocation string `json:"ffmpegLocation"`
		Aria2Path      string `json:"aria2Path"`
		JSRuntime      *struct {
			Path string `json:"path"`
			Kind string `json:"kind"`
		} `json:"jsRuntime"`
	} `json:"ctx"`
}

func TestCrossCheckWithTS(t *testing.T) {
	raw, err := os.ReadFile(casesPath())
	if err != nil {
		t.Skip("无 /tmp/cases.json，跳过交叉验证")
	}
	tsRaw, err := os.ReadFile(tsOutPath())
	if err != nil {
		t.Skip("无 /tmp/ts-out.json，跳过交叉验证")
	}
	var cases []tsCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	var want [][]string
	if err := json.Unmarshal(tsRaw, &want); err != nil {
		t.Fatal(err)
	}
	if len(cases) != len(want) {
		t.Fatalf("用例数不一致 %d vs %d", len(cases), len(want))
	}

	for i, c := range cases {
		o := Options{
			URL: c.Options.URL, FormatID: c.Options.FormatID,
			DownloadMode: c.Options.DownloadMode, HasAudio: c.Options.HasAudio,
			FilenameTmpl: c.Options.FilenameTmpl, Proxy: c.Options.Proxy,
			Subtitles: c.Options.Subtitles,
		}
		if c.Options.AudioTrack != nil {
			o.AudioTrack = &AudioTrack{
				FormatID: c.Options.AudioTrack.FormatID,
				Language: c.Options.AudioTrack.Language,
				IsM3U8:   c.Options.AudioTrack.IsM3U8,
			}
		}
		if c.Options.Acceleration != nil {
			o.Acceleration = &Acceleration{
				Enabled:        boolPtr(c.Options.Acceleration.Enabled),
				MaxConnections: c.Options.Acceleration.MaxConnections,
			}
		}
		ctx := BuildArgsContext{Aria2Path: c.Ctx.Aria2Path, FfmpegLocation: c.Ctx.FfmpegLocation}
		if c.Ctx.JSRuntime != nil {
			ctx.JSRuntime = &JSRuntime{Path: c.Ctx.JSRuntime.Path, Kind: c.Ctx.JSRuntime.Kind}
		}
		got := BuildArgs(o, c.OutDir, ctx)
		if !reflect.DeepEqual(got, want[i]) {
			t.Errorf("用例 %d 与 TS 输出不一致\n got: %v\nwant: %v", i, got, want[i])
		}
	}
	t.Logf("交叉验证通过：%d 组参数与 TS 逐字一致", len(cases))
}

// 用例文件按模块命名，由 scripts/crosscheck-port.mjs 通过环境变量指定。
//
// 早先所有模块共用一个 /tmp/cases.json，靠「写一份→立刻比对」的顺序才碰巧没出错；
// 一旦有人把比对挪出循环，后一个模块就会覆盖前一个的用例。
func crossModule() string {
	if m := os.Getenv("DOWNVID_CROSSCHECK_MODULE"); m != "" {
		return m
	}
	return "ytdlp-args"
}

func casesPath() string { return "/tmp/downvid-cases-" + crossModule() + ".json" }
func tsOutPath() string { return "/tmp/downvid-tsout-" + crossModule() + ".json" }
