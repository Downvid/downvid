package parse

// TS ↔ Go 交叉验证（由 scripts/crosscheck-port.mjs 驱动）。
//
// 覆盖错误分类、脱敏诊断、YouTube 回退策略——这三块决定用户看到什么提示、
// 以及「提交 Issue」按钮出不出现。判错了不会报错，只会让提示变成废话。
import (
	"encoding/json"
	"os"
	"testing"
)

func crossModuleParseTx() string {
	if m := os.Getenv("DOWNVID_CROSSCHECK_MODULE"); m != "" {
		return m
	}
	return "parse-error"
}

func TestCrossCheckParseError(t *testing.T) {
	casesPath := "/tmp/downvid-cases-" + crossModuleParseTx() + ".json"
	tsPath := "/tmp/downvid-tsout-" + crossModuleParseTx() + ".json"

	raw, err := os.ReadFile(casesPath)
	if err != nil {
		t.Skipf("无 %s（先跑 pnpm crosscheck:port --module=parse-error）", casesPath)
	}
	tsRaw, err := os.ReadFile(tsPath)
	if err != nil {
		t.Skipf("无 %s", tsPath)
	}

	var cases []struct {
		Kind     string `json:"kind"`
		Raw      string `json:"raw"`
		Versions struct {
			Ytdlp   string `json:"ytdlp"`
			Runtime string `json:"runtime"`
		} `json:"versions"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	var want []json.RawMessage
	if err := json.Unmarshal(tsRaw, &want); err != nil {
		t.Fatal(err)
	}
	if len(cases) != len(want) {
		t.Fatalf("用例数不一致 %d vs %d", len(cases), len(want))
	}

	for i, c := range cases {
		var got any
		switch c.Kind {
		case "classify":
			got = string(ClassifyParseError(c.Raw))
		case "diagnostic":
			got = ParseDiagnostic(c.Raw, Versions{Ytdlp: c.Versions.Ytdlp, Runtime: c.Versions.Runtime})
		default:
			t.Fatalf("用例 %d 未知 kind=%q", i, c.Kind)
		}

		gotJSON, _ := json.Marshal(got)
		var gotVal, wantVal any
		_ = json.Unmarshal(gotJSON, &gotVal)
		_ = json.Unmarshal(want[i], &wantVal)

		gotNorm, _ := json.Marshal(gotVal)
		wantNorm, _ := json.Marshal(wantVal)
		if string(gotNorm) != string(wantNorm) {
			t.Errorf("用例 %d（%s）不一致\n got: %s\nwant: %s", i, c.Kind, gotNorm, want[i])
		}
	}
	t.Logf("交叉验证通过：%d 组错误分类/诊断与 TS 逐字一致", len(cases))
}

func TestCrossCheckYoutubeRetry(t *testing.T) {
	casesPath := "/tmp/downvid-cases-youtube-retry.json"
	tsPath := "/tmp/downvid-tsout-youtube-retry.json"
	if m := os.Getenv("DOWNVID_CROSSCHECK_MODULE"); m == "youtube-retry" {
		// 正常路径
	} else if m != "" {
		// 别的模块在跑，跳过
		t.Skip("当前模块不是 youtube-retry")
	}

	raw, err := os.ReadFile(casesPath)
	if err != nil {
		t.Skipf("无 %s（先跑 pnpm crosscheck:port --module=youtube-retry）", casesPath)
	}
	tsRaw, err := os.ReadFile(tsPath)
	if err != nil {
		t.Skipf("无 %s", tsPath)
	}

	var cases []struct {
		Kind    string     `json:"kind"`
		Err     string     `json:"err"`
		State   RetryState `json:"state"`
		Version string     `json:"version"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	var want []json.RawMessage
	if err := json.Unmarshal(tsRaw, &want); err != nil {
		t.Fatal(err)
	}
	if len(cases) != len(want) {
		t.Fatalf("用例数不一致 %d vs %d", len(cases), len(want))
	}

	for i, c := range cases {
		var got any
		switch c.Kind {
		case "retry":
			next := NextYoutubeRetry(c.Err, c.State, c.Version)
			if next == nil {
				got = nil
			} else {
				got = map[string]any{"manifests": next.Manifests, "client": next.Client}
			}
		case "args":
			args := YoutubeExtractorArgs(c.State)
			// TS 返回 [] 而 Go 返回 nil —— 归一化成空数组
			if args == nil {
				args = []string{}
			}
			got = args
		default:
			t.Fatalf("用例 %d 未知 kind=%q", i, c.Kind)
		}

		gotJSON, _ := json.Marshal(got)
		var gotVal, wantVal any
		_ = json.Unmarshal(gotJSON, &gotVal)
		_ = json.Unmarshal(want[i], &wantVal)

		gotNorm, _ := json.Marshal(gotVal)
		wantNorm, _ := json.Marshal(wantVal)
		if string(gotNorm) != string(wantNorm) {
			t.Errorf("用例 %d（%s err=%q state=%+v v=%q）不一致\n got: %s\nwant: %s",
				i, c.Kind, c.Err, c.State, c.Version, gotNorm, want[i])
		}
	}
	t.Logf("交叉验证通过：%d 组 YouTube 回退与 TS 逐字一致", len(cases))
}
