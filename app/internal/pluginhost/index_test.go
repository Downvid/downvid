package pluginhost

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func parseOK(t *testing.T, raw string) *Index {
	t.Helper()
	idx, err := ParseIndex([]byte(raw))
	if err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	return idx
}

// 正常索引能读出全部字段。
func TestParseIndexHappyPath(t *testing.T) {
	idx := parseOK(t, `{
	  "version": 1,
	  "updated": "2026-11-10",
	  "plugins": [
	    {"id":"bilibili","name":"哔哩哔哩","repo":"alice/downvid-bilibili","sites":["bilibili.com"]}
	  ]
	}`)
	if len(idx.Plugins) != 1 {
		t.Fatalf("got %d 条", len(idx.Plugins))
	}
	p := idx.Plugins[0]
	if p.ID != "bilibili" || p.Repo != "alice/downvid-bilibili" || len(p.Sites) != 1 {
		t.Errorf("字段丢失：%+v", p)
	}
}

// 索引格式比应用新时必须报明确错误，而不是按旧字段瞎读。
//
// 变异点：不校验 version 时，新版索引（字段改名）会被解析成一批零值，
// 界面显示一堆空名字的插件——比直接报错更难排查。
func TestParseIndexRejectsFutureVersion(t *testing.T) {
	_, err := ParseIndex([]byte(`{"version": 99, "plugins": []}`))
	if !errors.Is(err, ErrIndexTooNew) {
		t.Fatalf("应返回 ErrIndexTooNew，got %v", err)
	}
}

// 坏条目丢弃，但不能连累其他条目。
//
// 变异点：一条写错就让整份索引失败时，一个人手抖，所有用户都看不到插件列表。
func TestParseIndexDropsBadEntriesOnly(t *testing.T) {
	idx := parseOK(t, `{
	  "version": 1,
	  "plugins": [
	    {"id":"good","name":"好的","repo":"alice/good"},
	    {"id":"bad-repo","name":"坏仓库","repo":"../../etc/passwd"},
	    {"id":"noname","repo":"alice/x"},
	    {"id":"a/b","name":"带斜杠的 id","repo":"alice/x"},
	    {"id":"dotdot","name":"点点","repo":".."}
	  ]
	}`)
	if len(idx.Plugins) != 1 || idx.Plugins[0].ID != "good" {
		t.Fatalf("应只保留 good，got %+v", idx.Plugins)
	}
}

// repo 必须严格是 owner/name —— 它会被拼成下载地址。
func TestValidRepoRejectsTraversal(t *testing.T) {
	good := []string{"a/b", "owner/name", "A-B_c.d/e-f"}
	bad := []string{"", "a", "a/b/c", "/b", "a/", "../x", "a/..", "a/b c", "a\\b"}

	for _, s := range good {
		if !ValidRepo(s) {
			t.Errorf("%q 应合法", s)
		}
	}
	for _, s := range bad {
		if ValidRepo(s) {
			t.Errorf("%q 应被拒绝（会被拼进 URL）", s)
		}
	}
}

// 重复 id 只保留第一条，避免列表里出现两个同名插件。
func TestParseIndexDedupesIDs(t *testing.T) {
	idx := parseOK(t, `{"version":1,"plugins":[
	  {"id":"dup","name":"第一个","repo":"a/one"},
	  {"id":"dup","name":"第二个","repo":"b/two"}
	]}`)
	if len(idx.Plugins) != 1 {
		t.Fatalf("got %d 条", len(idx.Plugins))
	}
	if idx.Plugins[0].Name != "第一个" {
		t.Errorf("应保留第一条，got %q", idx.Plugins[0].Name)
	}
}

// 排序必须稳定：索引文件里的顺序会被人为调整，界面不该跟着跳。
func TestParseIndexSortsByID(t *testing.T) {
	idx := parseOK(t, `{"version":1,"plugins":[
	  {"id":"zebra","name":"z","repo":"a/z"},
	  {"id":"alpha","name":"a","repo":"a/a"}
	]}`)
	if idx.Plugins[0].ID != "alpha" {
		t.Errorf("应按 id 排序，got %q 在前", idx.Plugins[0].ID)
	}
}

// FetchIndex 走 HTTP 时也要能正确解析，并且非 200 要报错。
func TestFetchIndex(t *testing.T) {
	body := `{"version":1,"plugins":[{"id":"x","name":"X","repo":"a/x"}]}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(body))
	}))
	defer srv.Close()

	idx, err := FetchIndex(context.Background(), srv.Client(), srv.URL)
	if err != nil {
		t.Fatalf("拉取失败：%v", err)
	}
	if len(idx.Plugins) != 1 {
		t.Fatalf("got %+v", idx.Plugins)
	}
}

func TestFetchIndexHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	if _, err := FetchIndex(context.Background(), srv.Client(), srv.URL); err == nil {
		t.Fatal("404 应报错")
	} else if !strings.Contains(err.Error(), "404") {
		t.Errorf("错误应带上状态码，got %q", err)
	}
}

// 超时/取消要能被上层感知（否则界面会一直转圈）。
func TestFetchIndexRespectsContext(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(2 * time.Second)
		w.Write([]byte(`{"version":1,"plugins":[]}`))
	}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := FetchIndex(ctx, srv.Client(), srv.URL); err == nil {
		t.Fatal("超时应当报错")
	}
}
