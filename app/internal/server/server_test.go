package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// ===== 安全：路径穿越 =====

// 静态文件服务不能读到 base 之外的文件。
//
// 这条是安全边界：容器里 StaticDir 之外可能挂着用户的下载目录、数据目录。
// 原 TS 实现用正则剥前导 `../`，只处理了开头——`a/../../b` 仍能穿出去。
func TestJoinUnderBlocksTraversal(t *testing.T) {
	base := "/srv/static"

	allowed := map[string]string{
		"index.html":    "/srv/static/index.html",
		"assets/app.js": "/srv/static/assets/app.js",
		"a/./b/c.css":   "/srv/static/a/b/c.css",
		"a/b/../c.css":  "/srv/static/a/c.css", // 内部 .. 可以消，只要不越界
	}
	for rel, want := range allowed {
		if got := joinUnder(base, rel); got != want {
			t.Errorf("joinUnder(%q) = %q, want %q", rel, got, want)
		}
	}

	blocked := []string{
		"../etc/passwd",
		"a/../../etc/passwd", // 中间穿越（正则只剥开头时这条会漏）
		"../../../root/.ssh/id_rsa",
		"..\\..\\windows\\system32", // 反斜杠形态
	}
	// 注意：`/etc/passwd` 不在这份名单里。它拼到 base 之后变成
	// `/srv/static/etc/passwd`——读不到真实文件，所以是**安全**的。
	// 把它当成穿越来拒绝反而会误伤「前端真的有个叫 etc 的目录」的情况。
	for _, rel := range blocked {
		if got := joinUnder(base, rel); got != "" {
			t.Errorf("joinUnder(%q) 应被拒绝，却得到 %q", rel, got)
		}
	}
}

// 前缀校验必须在分隔符边界上：`/srv/static-evil` 不该匹配 `/srv/static`。
func TestJoinUnderBoundaryCheck(t *testing.T) {
	// base 是 /srv/static，rel 归一化后不可能变成 /srv/static-evil（因为拼在 base 后），
	// 但这里验证「前缀相同但不是一个目录」的情况不会被误放行。
	if got := joinUnder("/srv/static", "../static-evil/x.js"); got != "" {
		t.Fatalf("穿越到同名前缀的另一目录应被拒绝，got %q", got)
	}
}

// 通过真实 HTTP 请求再验一次（端到端，含 mux 与 ServeFile）。
func TestStaticTraversalOverHTTP(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("OK-INDEX"), 0o644); err != nil {
		t.Fatal(err)
	}
	// 在 base 之外放一个「机密」文件，确认读不到
	secret := filepath.Join(filepath.Dir(dir), "secret.txt")
	_ = os.WriteFile(secret, []byte("SHOULD-NOT-LEAK"), 0o644)
	defer os.Remove(secret)

	s := New(Config{StaticDir: dir})
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()

	// 正常请求能拿到
	res, err := http.Get(srv.URL + "/index.html")
	if err != nil {
		t.Fatal(err)
	}
	body := make([]byte, 16)
	n, _ := res.Body.Read(body)
	res.Body.Close()
	if !strings.Contains(string(body[:n]), "OK-INDEX") {
		t.Fatalf("正常请求应拿到 index.html，got %q", body[:n])
	}

	// 穿越请求不能拿到机密文件
	req, _ := http.NewRequest("GET", srv.URL+"/../secret.txt", nil)
	res2, err := srv.Client().Do(req)
	if err != nil {
		return // 客户端自己拒绝了 URL，也算安全
	}
	defer res2.Body.Close()
	b2 := make([]byte, 64)
	n2, _ := res2.Body.Read(b2)
	if strings.Contains(string(b2[:n2]), "SHOULD-NOT-LEAK") {
		t.Fatal("路径穿越读到了 base 之外的文件")
	}
}

// ===== 安全：Origin 校验（CSWSH）=====

func TestCheckOrigin(t *testing.T) {
	cases := []struct {
		origin, host string
		want         bool
		why          string
	}{
		{"", "", true, "无 Origin（curl / 移动客户端）"},
		{"http://127.0.0.1:6080", "127.0.0.1:6080", true, "同源"},
		{"http://localhost:6080", "localhost:6080", true, "同源（localhost）"},
		{"http://localhost:3000", "127.0.0.1:6080", true, "本地回环——开发时跨端口常见"},
		{"http://127.0.0.1:9999", "example.com", true, "本地回环放行"},
		{"https://evil.example.com", "127.0.0.1:6080", false, "第三方网页企图偷用本地服务"},
		{"https://evil.example.com", "evil.example.com", true, "同源（用户主动部署在该域名）"},
		{"not-a-url", "x", false, "畸形 Origin"},
	}
	for _, c := range cases {
		if got := CheckOrigin(c.origin, c.host); got != c.want {
			t.Errorf("CheckOrigin(%q,%q) = %v, want %v（%s）", c.origin, c.host, got, c.want, c.why)
		}
	}
}

// 非法 Origin 的 WebSocket 握手必须被拒（403），不是升级后再断。
func TestWSRejectsBadOrigin(t *testing.T) {
	s := New(Config{})
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()

	u, _ := url.Parse(srv.URL)
	u.Scheme = "ws"
	u.Path = "/ws"

	h := http.Header{}
	h.Set("Origin", "https://evil.example.com")
	if _, _, err := websocket.DefaultDialer.Dial(u.String(), h); err == nil {
		t.Fatal("非法 Origin 的握手应失败")
	}
}

// ===== 协议一致性 =====

// 请求 → 响应必须带回同一个 id，且结果形状与 bridge.ts 期望的一致。
func TestRPCRoundTrip(t *testing.T) {
	s := New(Config{Version: "1.5.0"})
	s.Handle("app:getVersion", func(args []any) (any, error) { return s.cfg.Version, nil })
	s.Handle("history:add", func(args []any) (any, error) {
		return true, nil
	})

	srv := httptest.NewServer(s.Handler())
	defer srv.Close()

	c := dial(t, srv.URL, nil)
	defer c.Close()

	// 正常调用
	writeJSON(t, c, map[string]any{"id": 1, "channel": "app:getVersion", "args": []any{}})
	resp := readJSON(t, c)
	if resp["id"] != float64(1) {
		t.Fatalf("响应 id 不匹配：%v", resp)
	}
	if resp["result"] != "1.5.0" {
		t.Fatalf("got %v", resp["result"])
	}

	// 带参数的调用
	writeJSON(t, c, map[string]any{"id": 2, "channel": "history:add", "args": []any{map[string]any{"filePath": "/v/1.mp4"}}})
	if resp := readJSON(t, c); resp["result"] != true {
		t.Fatalf("got %v", resp)
	}
}

// 方法返回 error 时前端收到 `{error}`，且**连接不断**（后续调用仍可用）。
func TestRPCErrorDoesNotKillConnection(t *testing.T) {
	s := New(Config{})
	s.Handle("boom", func(args []any) (any, error) { return nil, errors.New("出错了") })
	s.Handle("ok", func(args []any) (any, error) { return "fine", nil })

	srv := httptest.NewServer(s.Handler())
	defer srv.Close()
	c := dial(t, srv.URL, nil)
	defer c.Close()

	writeJSON(t, c, map[string]any{"id": 1, "channel": "boom", "args": []any{}})
	resp := readJSON(t, c)
	if resp["error"] != "出错了" {
		t.Fatalf("got %v", resp)
	}

	// 连接仍可用
	writeJSON(t, c, map[string]any{"id": 2, "channel": "ok", "args": []any{}})
	if resp := readJSON(t, c); resp["result"] != "fine" {
		t.Fatalf("一次失败调用不该影响后续调用，got %v", resp)
	}
}

// 未知通道如实报错——静默无响应会让前端一直转圈。
func TestUnknownChannelReportsError(t *testing.T) {
	s := New(Config{})
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()
	c := dial(t, srv.URL, nil)
	defer c.Close()

	writeJSON(t, c, map[string]any{"id": 7, "channel": "nope:nope", "args": []any{}})
	resp := readJSON(t, c)
	errMsg, _ := resp["error"].(string)
	if !strings.Contains(errMsg, "unknown channel") {
		t.Fatalf("got %v", resp)
	}
}

// 事件广播：订阅后能收到，退订后收不到。
func TestEventBroadcast(t *testing.T) {
	s := New(Config{})
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()
	c := dial(t, srv.URL, nil)
	defer c.Close()

	writeJSON(t, c, map[string]any{"subscribe": "download:progress"})
	// 给订阅一点时间生效（同一连接上的顺序消息，读协程逐条处理）
	time.Sleep(50 * time.Millisecond)

	s.Emit("download:progress", map[string]any{"taskId": "t1", "percent": 42})

	c.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, raw, err := c.ReadMessage()
	if err != nil {
		t.Fatalf("应收到事件：%v", err)
	}
	var msg map[string]any
	_ = json.Unmarshal(raw, &msg)
	if msg["event"] != "download:progress" {
		t.Fatalf("got %v", msg)
	}
	data, _ := msg["data"].(map[string]any)
	if data["percent"] != float64(42) {
		t.Fatalf("事件数据不对：%v", data)
	}

	// 退订后不该再收到
	writeJSON(t, c, map[string]any{"unsubscribe": "download:progress"})
	time.Sleep(50 * time.Millisecond)
	s.Emit("download:progress", map[string]any{"taskId": "t1", "percent": 99})

	c.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, _, err := c.ReadMessage(); err == nil {
		t.Fatal("退订后不该再收到事件")
	}
}

// 广播不阻塞：没有订阅者时 Emit 立即返回。
func TestEmitWithoutSubscribers(t *testing.T) {
	s := New(Config{})
	done := make(chan struct{})
	go func() {
		for i := 0; i < 1000; i++ {
			s.Emit("nobody:listens", map[string]any{"i": i})
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("无订阅者时 Emit 不该阻塞")
	}
}

// ===== 其它 =====

func TestHealthz(t *testing.T) {
	s := New(Config{Version: "1.5.0"})
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()

	res, err := http.Get(srv.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("status = %d", res.StatusCode)
	}
	var body map[string]any
	_ = json.NewDecoder(res.Body).Decode(&body)
	if body["ok"] != true || body["version"] != "1.5.0" {
		t.Fatalf("got %v", body)
	}
}

// Channels 的顺序必须稳定（契约校验会比对它）。
func TestChannelsSorted(t *testing.T) {
	s := New(Config{})
	for _, ch := range []string{"z:z", "a:a", "m:m"} {
		s.Handle(ch, func([]any) (any, error) { return nil, nil })
	}
	got := s.Channels()
	want := []string{"a:a", "m:m", "z:z"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

// ===== 测试辅助 =====

func dial(t *testing.T, srvURL string, headers http.Header) *websocket.Conn {
	t.Helper()
	u, _ := url.Parse(srvURL)
	u.Scheme = "ws"
	u.Path = "/ws"
	c, _, err := websocket.DefaultDialer.Dial(u.String(), headers)
	if err != nil {
		t.Fatalf("连接失败：%v", err)
	}
	return c
}

func writeJSON(t *testing.T, c *websocket.Conn, v any) {
	t.Helper()
	b, _ := json.Marshal(v)
	if err := c.WriteMessage(websocket.TextMessage, b); err != nil {
		t.Fatalf("写入失败：%v", err)
	}
}

func readJSON(t *testing.T, c *websocket.Conn) map[string]any {
	t.Helper()
	c.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, raw, err := c.ReadMessage()
	if err != nil {
		t.Fatalf("读取失败：%v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	return out
}
