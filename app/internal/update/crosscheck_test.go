package update

// TS ↔ Go 交叉验证（由 scripts/crosscheck-port.mjs 驱动）。
//
// 覆盖纯函数部分：候选生成、响应归一化、状态分类、版本比较、设置清洗。
// 这些一旦不一致，表现是「更新永远失败但没有任何提示」。
import (
	"encoding/json"
	"os"
	"sort"
	"strings"
	"testing"
)

func crossModuleUpdate() string {
	if m := os.Getenv("DOWNVID_CROSSCHECK_MODULE"); m != "" {
		return m
	}
	return "update-sources"
}

func TestCrossCheckUpdateSources(t *testing.T) {
	casesPath := "/tmp/downvid-cases-" + crossModuleUpdate() + ".json"
	tsPath := "/tmp/downvid-tsout-" + crossModuleUpdate() + ".json"

	raw, err := os.ReadFile(casesPath)
	if err != nil {
		t.Skipf("无 %s（先跑 pnpm crosscheck:port --module=update-sources）", casesPath)
	}
	tsRaw, err := os.ReadFile(tsPath)
	if err != nil {
		t.Skipf("无 %s", tsPath)
	}

	var cases []struct {
		Kind    string          `json:"kind"`
		Source  string          `json:"source"`
		Payload json.RawMessage `json:"payload"`
		Status  int             `json:"status"`
		A       string          `json:"a"`
		B       string          `json:"b"`
		Value   json.RawMessage `json:"value"`
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

	repo := Repo{Owner: "Downvid", Repo: "downvid"}
	// 与 crosscheck 脚本里 mocks 的 WEBSITE_URL 一致
	ep := Endpoints{
		GitHubAPI:  "https://api.github.com",
		JSDelivr:   "https://data.jsdelivr.com",
		GHPROXYAPI: "https://gh-proxy.com",
		GiteeAPI:   "https://gitee.com/api/v5",
		WebsiteURL: "https://example.test",
	}

	for i, c := range cases {
		var got any
		switch c.Kind {
		case "candidates":
			cs := LatestCandidates(SourceID(c.Source), repo, ep)
			out := make([]map[string]string, len(cs))
			for j, cand := range cs {
				out[j] = map[string]string{"source": string(cand.Source), "url": cand.URL, "kind": cand.Kind}
			}
			got = out
		case "parse":
			var payload any
			if len(c.Payload) > 0 {
				if err := json.Unmarshal(c.Payload, &payload); err != nil {
					// TS 侧的 payload 可能是原始字符串（如 "v1.5.0\n"），
					// json.RawMessage 直接给 string 是带引号的，这里兜一次
					payload = strings.Trim(string(c.Payload), `"`)
					payload = strings.ReplaceAll(payload.(string), `\\n`, "\n")
				}
			}
			rel, ok := ParseLatestPayload(SourceID(c.Source), payload)
			if ok {
				// 与 TS 的 LatestRelease 形状对齐（键名一致）
				got = map[string]string{
					"version":      rel.Version,
					"releaseNotes": rel.ReleaseNote,
					"releaseDate":  rel.ReleaseDate,
					"source":       string(rel.Source),
				}
			} else {
				got = nil
			}
		case "status":
			got = string(ClassifyHTTPStatus(c.Status))
		case "compare":
			n := CompareVersions(c.A, c.B)
			switch {
			case n > 0:
				got = 1
			case n < 0:
				got = -1
			default:
				got = 0
			}
		case "normalize":
			var v any
			if len(c.Value) > 0 {
				_ = json.Unmarshal(c.Value, &v)
			}
			got = string(NormalizeSource(v))
		default:
			t.Fatalf("用例 %d 未知 kind=%q", i, c.Kind)
		}

		gotJSON, _ := json.Marshal(got)
		var gotVal, wantVal any
		_ = json.Unmarshal(gotJSON, &gotVal)
		_ = json.Unmarshal(want[i], &wantVal)

		// 对象键顺序可能不同 → 归一化后再比
		gotNorm, _ := json.Marshal(sortKeys(gotVal))
		wantNorm, _ := json.Marshal(sortKeys(wantVal))
		if string(gotNorm) != string(wantNorm) {
			t.Errorf("用例 %d（%s %s）不一致\n got: %s\nwant: %s",
				i, c.Kind, c.Source, gotNorm, want[i])
		}
	}
	t.Logf("交叉验证通过：%d 组更新源行为与 TS 逐字一致", len(cases))
}

// sortKeys 把 map 的键排序后重新组装，消除 Go map 迭代顺序的随机性。
func sortKeys(v any) any {
	switch x := v.(type) {
	case map[string]any:
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		ordered := make([][2]any, 0, len(keys))
		for _, k := range keys {
			ordered = append(ordered, [2]any{k, sortKeys(x[k])})
		}
		return ordered
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = sortKeys(e)
		}
		return out
	default:
		return v
	}
}
