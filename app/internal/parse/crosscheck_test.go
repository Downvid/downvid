package parse

// TS ↔ Go 交叉验证（由 scripts/crosscheck-port.mjs 驱动）。
//
// 读宿主生成的 /tmp/cases.json 与 /tmp/ts-out.json，用 Go 重算并逐字比对。
// 没有这两个文件时跳过——这样 `go test ./...` 在 CI 里不依赖宿主先跑过脚本。
import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func TestCrossCheckFormats(t *testing.T) {
	raw, err := os.ReadFile(casesPath())
	if err != nil {
		t.Skip("无 /tmp/cases.json（先跑 pnpm crosscheck:port）")
	}
	tsRaw, err := os.ReadFile(tsOutPath())
	if err != nil {
		t.Skip("无 /tmp/ts-out.json（先跑 pnpm crosscheck:port）")
	}

	var cases []struct {
		Info      json.RawMessage `json:"info"`
		IsYoutube bool            `json:"isYoutube"`
		Allow     bool            `json:"allow"`
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
		var info FmtInfo
		if err := json.Unmarshal(c.Info, &info); err != nil {
			t.Fatalf("用例 %d 解析 info 失败：%v", i, err)
		}
		got := BuildVideoFormatsWithManifests(info, c.IsYoutube, c.Allow)

		// 转成与 TS 输出同形状的 JSON 再比：直接比结构体会被内部字段 tbr/codecRank 干扰
		gotJSON := toComparableJSON(t, got)

		var wantVal any
		if err := json.Unmarshal(want[i], &wantVal); err != nil {
			t.Fatalf("用例 %d 解析 TS 输出失败：%v", i, err)
		}
		var gotVal any
		if err := json.Unmarshal(gotJSON, &gotVal); err != nil {
			t.Fatalf("用例 %d 解析 Go 输出失败：%v", i, err)
		}

		if !reflect.DeepEqual(gotVal, wantVal) {
			t.Errorf("用例 %d 与 TS 输出不一致\ngot:  %s\nwant: %s", i, string(gotJSON), string(want[i]))
		}
	}
	t.Logf("交叉验证通过：%d 组格式列表与 TS 逐字一致", len(cases))
}

func toComparableJSON(t *testing.T, fs []Format) []byte {
	t.Helper()
	b, err := json.Marshal(fs)
	if err != nil {
		t.Fatalf("序列化失败：%v", err)
	}
	return b
}

// 用例文件按模块命名，由 scripts/crosscheck-port.mjs 通过环境变量指定。
//
// 早先所有模块共用一个 /tmp/cases.json，靠「写一份→立刻比对」的顺序才碰巧没出错；
// 一旦有人把比对挪出循环，后一个模块就会覆盖前一个的用例。
func crossModule() string {
	if m := os.Getenv("DOWNVID_CROSSCHECK_MODULE"); m != "" {
		return m
	}
	return "formats"
}

func casesPath() string { return "/tmp/downvid-cases-" + crossModule() + ".json" }
func tsOutPath() string { return "/tmp/downvid-tsout-" + crossModule() + ".json" }
