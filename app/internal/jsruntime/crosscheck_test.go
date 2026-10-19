package jsruntime

// TS ↔ Go 交叉验证（由 scripts/crosscheck-port.mjs 驱动）。
//
// 重点在候选表的路径拼接与目录列举：判错了不会报错，只会让某个平台上
// 「装好了的 Node」又一次找不到。两边读的是同一棵假目录树。
import (
	"encoding/json"
	"fmt"
	"os"
	"testing"
)

func crossModuleJsRuntime() string {
	if m := os.Getenv("DOWNVID_CROSSCHECK_MODULE"); m != "" {
		return m
	}
	return "js-runtime"
}

func TestCrossCheckJsRuntime(t *testing.T) {
	casesPath := "/tmp/downvid-cases-" + crossModuleJsRuntime() + ".json"
	tsPath := "/tmp/downvid-tsout-" + crossModuleJsRuntime() + ".json"

	raw, err := os.ReadFile(casesPath)
	if err != nil {
		t.Skipf("无 %s（先跑 pnpm crosscheck:port --module=js-runtime）", casesPath)
	}
	tsRaw, err := os.ReadFile(tsPath)
	if err != nil {
		t.Skipf("无 %s", tsPath)
	}

	type treeEntry struct {
		Name string `json:"name"`
		Dir  bool   `json:"dir"`
	}
	var cases []struct {
		Kind     string                 `json:"kind"`
		Name     string                 `json:"name"`
		Platform string                 `json:"platform"`
		Env      map[string]string      `json:"env"`
		Home     string                 `json:"home"`
		Tree     map[string][]treeEntry `json:"tree"`
		Runtime  string                 `json:"runtime"`
		Output   string                 `json:"output"`
		Path     string                 `json:"path"`
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
	// Go 侧用 runtime.GOOS 的取值（windows / linux / darwin）。映射只在这一处。
	toGoos := func(p string) string {
		if p == "win32" {
			return "windows"
		}
		return p
	}

	for i, c := range cases {
		var got any
		label := c.Kind
		switch c.Kind {
		case "candidates":
			label += "/" + c.Name
			tree := c.Tree
			env := c.Env
			list := Candidates(Env{
				GOOS:   toGoos(c.Platform),
				Getenv: func(k string) string { return env[k] },
				Home:   c.Home,
				ReadDir: func(dir string) ([]Entry, error) {
					names, ok := tree[dir]
					if !ok {
						return nil, fmt.Errorf("ENOENT: %s", dir)
					}
					entries := make([]Entry, 0, len(names))
					for _, n := range names {
						entries = append(entries, Entry{Name: n.Name, IsDir: n.Dir})
					}
					return entries, nil
				},
			})
			if list == nil {
				list = []Candidate{}
			}
			got = list
		case "version":
			label += fmt.Sprintf("/%s %q", c.Runtime, c.Output)
			// TS 返回 null 表示「不受支持 / 对不上」，Go 返回空串
			if v := SupportedVersion(c.Runtime, c.Output); v != "" {
				got = v
			}
		case "looks-like-node":
			label += "/" + c.Path
			got = LooksLikeNode(c.Path)
		default:
			t.Fatalf("用例 %d 未知 kind=%q", i, c.Kind)
		}

		gotJSON, err := json.Marshal(got)
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
			t.Errorf("用例 %d（%s）与 TS 输出不一致\n got: %s\nwant: %s", i, label, gotNorm, wantNorm)
		}
	}
	t.Logf("交叉验证通过：%d 组候选表 / 版本判定 / Electron 排除与 TS 逐字一致", len(cases))
}
