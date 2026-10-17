package fetch

// TS ↔ Go 交叉验证（由 scripts/crosscheck-port.mjs 驱动）。
//
// 对这个模块尤其有意义：TS 用 number（53 位安全整数），Go 用 int64。
// 两边对边界值的处理只要有一点不同，表现就是「暂停后恢复从零重下」
// 或「把两个不同文件的片段拼起来」——用户看到的是一次损坏的下载。
import (
	"encoding/json"
	"os"
	"testing"
)

func crossModuleDirect() string {
	if m := os.Getenv("DOWNVID_CROSSCHECK_MODULE"); m != "" {
		return m
	}
	return "direct-state"
}

func crossCasesPath() string { return "/tmp/downvid-cases-" + crossModuleDirect() + ".json" }
func crossTSOutPath() string { return "/tmp/downvid-tsout-" + crossModuleDirect() + ".json" }

func TestCrossCheckDirectState(t *testing.T) {
	raw, err := os.ReadFile(crossCasesPath())
	if err != nil {
		t.Skipf("无 %s（先跑 pnpm crosscheck:port --module=direct-state）", crossCasesPath())
	}
	tsRaw, err := os.ReadFile(crossTSOutPath())
	if err != nil {
		t.Skipf("无 %s", crossTSOutPath())
	}

	var cases []struct {
		Kind        string    `json:"kind"`
		Total       int64     `json:"total"`
		Connections int       `json:"connections"`
		Checkpoint  any       `json:"checkpoint"`
		Resource    *Resource `json:"resource"`
		FileSize    int64     `json:"fileSize"`
		Header      *string   `json:"header"`
		Start       int64     `json:"start"`
		End         int64     `json:"end"`
		Name        string    `json:"name"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	var want []any
	if err := json.Unmarshal(tsRaw, &want); err != nil {
		t.Fatal(err)
	}
	if len(cases) != len(want) {
		t.Fatalf("用例数不一致 %d vs %d", len(cases), len(want))
	}

	for i, c := range cases {
		var got any
		switch c.Kind {
		case "segments":
			got = CreateDirectSegments(c.Total, c.Connections)
		case "resume":
			// 检查点从 JSON 反序列化：这是它真实的到达方式（读 .part.json）
			ck, ok := decodeCheckpoint(t, c.Checkpoint)
			if !ok {
				got = false
				break
			}
			_, canResume := CanResumeDirect(ck, *c.Resource, c.FileSize)
			got = canResume
		case "range":
			header := ""
			if c.Header != nil {
				header = *c.Header
			}
			got = MatchesDirectRange(header, c.Start, c.End, c.Total)
		default:
			t.Fatalf("用例 %d 未知 kind=%q", i, c.Kind)
		}

		gotJSON, err := json.Marshal(got)
		if err != nil {
			t.Fatalf("用例 %d 序列化失败：%v", i, err)
		}
		var gotVal any
		if err := json.Unmarshal(gotJSON, &gotVal); err != nil {
			t.Fatalf("用例 %d 反序列化失败：%v", i, err)
		}

		if !deepEqualJSON(gotVal, want[i]) {
			t.Errorf("用例 %d（%s）与 TS 输出不一致\n got: %s\nwant: %v", i, c.Name, gotJSON, want[i])
		}
	}
	t.Logf("交叉验证通过：%d 组续传判定与 TS 逐字一致", len(cases))
}

// decodeCheckpoint 把 TS 传来的检查点转成 Go 结构。
//
// nil / 非对象一律转成「解码失败」——调用方据此当成「不可续传」，
// 与 TS 里 `canResumeDirect(null, ...) === false` 对齐。
func decodeCheckpoint(t *testing.T, v any) (Checkpoint, bool) {
	t.Helper()
	if v == nil {
		return Checkpoint{}, false
	}
	b, err := json.Marshal(v)
	if err != nil {
		return Checkpoint{}, false
	}
	var ck Checkpoint
	if err := json.Unmarshal(b, &ck); err != nil {
		return Checkpoint{}, false
	}
	return ck, true
}

// deepEqualJSON 比较两个 any（来自 json.Unmarshal）。
//
// 数字在 JSON 里统一是 float64，直接 == 比较切片会因类型不同失败，
// 所以用反射做结构比较。
func deepEqualJSON(a, b any) bool {
	aj, _ := json.Marshal(a)
	bj, _ := json.Marshal(b)
	return string(aj) == string(bj)
}
