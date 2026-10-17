package history

// TS ↔ Go 交叉验证（由 scripts/crosscheck-port.mjs 驱动）。
//
// 重点在 Windows 路径归一与「反复写同一文件只剩一条」——判错了不会报错，
// 只会让用户看到重复历史，或重下时堆出多条记录。
import (
	"encoding/json"
	"os"
	"testing"
)

func crossModuleHistory() string {
	if m := os.Getenv("DOWNVID_CROSSCHECK_MODULE"); m != "" {
		return m
	}
	return "history"
}

func TestCrossCheckHistory(t *testing.T) {
	casesPath := "/tmp/downvid-cases-" + crossModuleHistory() + ".json"
	tsPath := "/tmp/downvid-tsout-" + crossModuleHistory() + ".json"

	raw, err := os.ReadFile(casesPath)
	if err != nil {
		t.Skipf("无 %s（先跑 pnpm crosscheck:port --module=history）", casesPath)
	}
	tsRaw, err := os.ReadFile(tsPath)
	if err != nil {
		t.Skipf("无 %s", tsPath)
	}

	var cases []struct {
		Kind      string   `json:"kind"`
		Platform  string   `json:"platform"`
		List      []Record `json:"list"`
		History   []Record `json:"history"`
		Incoming  Record   `json:"incoming"`
		ID        string   `json:"id"`
		CreatedAt string   `json:"createdAt"`
		Name      string   `json:"name"`
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

	// TS 侧用 `process.platform` 的取值（win32 / linux / darwin），
	// 而 Go 侧用 runtime.GOOS 的取值（windows / linux / darwin）。
	// 映射只在这一处，避免散落在各个用例里。
	toGoos := func(p string) string {
		if p == "win32" {
			return "windows"
		}
		return p
	}

	for i, c := range cases {
		var got []Record
		switch c.Kind {
		case "dedupe":
			got = Dedupe(c.List, toGoos(c.Platform))
		case "upsert":
			got = Upsert(c.History, c.Incoming, c.ID, c.CreatedAt, toGoos(c.Platform))
		default:
			t.Fatalf("用例 %d 未知 kind=%q", i, c.Kind)
		}

		gotJSON, err := json.Marshal(normalizeForCompare(got))
		if err != nil {
			t.Fatalf("用例 %d 序列化失败：%v", i, err)
		}
		var gotVal, wantVal any
		if err := json.Unmarshal(gotJSON, &gotVal); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(want[i], &wantVal); err != nil {
			t.Fatal(err)
		}

		gotNorm, _ := json.Marshal(gotVal)
		wantNorm, _ := json.Marshal(wantVal)
		if string(gotNorm) != string(wantNorm) {
			t.Errorf("用例 %d（%s/%s）与 TS 输出不一致\n got: %s\nwant: %s",
				i, c.Kind, c.Name, gotNorm, want[i])
		}
	}
	t.Logf("交叉验证通过：%d 组历史操作与 TS 逐字一致", len(cases))
}

// normalizeForCompare 把 nil 切片统一成空切片，避免 `null` 与 `[]` 的假差异。
//
// 注意：**落盘时**必须区分这一点（`Save` 会把 nil 写成 `[]`，有单独用例钉住），
// 但**比较时**不该因为 nil 与空切片而报不一致——那是序列化细节，不是行为差异。
func normalizeForCompare(records []Record) []Record {
	if records == nil {
		return []Record{}
	}
	out := make([]Record, len(records))
	for i, r := range records {
		r.FileExists = nil // 展示期字段，不参与比较
		out[i] = r
	}
	return out
}
