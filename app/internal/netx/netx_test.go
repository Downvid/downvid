package netx

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// 用户最常粘贴的是 `127.0.0.1:7890`（Clash/Surge 界面显示的就是这个）。
//
// 不补 scheme 的话 `url.Parse` 会把 `127.0.0.1` 当成 scheme，
// http.Transport 随后报 `unsupported protocol scheme`——而那条错误在下载
// 失败时被归成「网络错误」，用户完全指不到代理格式上。
func TestParseProxyAddsScheme(t *testing.T) {
	cases := []struct {
		name    string
		input   string
		wantURL string
		wantKnd ProxyKind
	}{
		{"裸 host:port 补 http", "127.0.0.1:7890", "http://127.0.0.1:7890", ProxyHTTP},
		{"http 原样", "http://127.0.0.1:7890", "http://127.0.0.1:7890", ProxyHTTP},
		{"https 原样", "https://proxy.example:8443", "https://proxy.example:8443", ProxyHTTPS},
		{"socks5 原样", "socks5://127.0.0.1:1080", "socks5://127.0.0.1:1080", ProxySocks5},
		{"socks5 缺端口补 1080", "socks5://127.0.0.1", "socks5://127.0.0.1:1080", ProxySocks5},
		{"http 缺端口补 8080", "http://proxy.example", "http://proxy.example:8080", ProxyHTTP},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p, err := ParseProxy(c.input)
			if err != nil {
				t.Fatalf("解析 %q 失败：%v", c.input, err)
			}
			if p.URL.String() != c.wantURL {
				t.Errorf("URL = %q，期望 %q", p.URL.String(), c.wantURL)
			}
			if p.Kind != c.wantKnd {
				t.Errorf("Kind = %q，期望 %q", p.Kind, c.wantKnd)
			}
			// Raw 要保留用户原始输入：界面回显与日志要能看到「他到底填了什么」
			if p.Raw != strings.TrimSpace(c.input) {
				t.Errorf("Raw = %q，期望原样 %q", p.Raw, c.input)
			}
		})
	}
}

func TestParseProxyRejectsBadInput(t *testing.T) {
	cases := []struct {
		input string
		why   string
	}{
		{"", "空串表示未配置，应返回 ErrEmptyProxy"},
		{"   ", "只有空白同样算未配置"},
		{"http://", "缺主机名"},
		{"ftp://proxy:21", "不支持的协议"},
		{"://bad", "完全无法解析"},
	}
	for _, c := range cases {
		t.Run(c.why, func(t *testing.T) {
			_, err := ParseProxy(c.input)
			if err == nil {
				t.Fatalf("%q 应该被拒绝（%s）", c.input, c.why)
			}
			if c.input == "" || strings.TrimSpace(c.input) == "" {
				if !errors.Is(err, ErrEmptyProxy) {
					t.Errorf("空串应返回 ErrEmptyProxy，实际 %v", err)
				}
			}
		})
	}
}

// **关键**：没配代理时必须是直连，而不是"跟着系统代理环境变量走"。
//
// 这条规矩的理由：用户点「关闭代理」的意图是「不走代理」。
// 如果 transport 的 Proxy 留成 `http.ProxyFromEnvironment`（Go 的默认），
// 在设了 HTTP_PROXY 的机器上关掉代理等于没关——而界面上开关是关的。
func TestEmptyProxyMeansDirectConnection(t *testing.T) {
	t.Setenv("HTTP_PROXY", "http://should-not-be-used:3128")
	t.Setenv("HTTPS_PROXY", "http://should-not-be-used:3128")

	tr, err := Transport("", false)
	if err != nil {
		t.Fatal(err)
	}
	if tr.Proxy != nil {
		t.Fatal("未配置代理时 transport.Proxy 必须是 nil（直连），否则关掉开关不生效")
	}
}

func TestHTTPProxyIsApplied(t *testing.T) {
	tr, err := Transport("http://127.0.0.1:7890", false)
	if err != nil {
		t.Fatal(err)
	}
	if tr.Proxy == nil {
		t.Fatal("配置了代理却没有设到 transport 上")
	}
	req, _ := http.NewRequest(http.MethodGet, "https://example.com/", nil)
	u, err := tr.Proxy(req)
	if err != nil {
		t.Fatal(err)
	}
	if u == nil || u.Host != "127.0.0.1:7890" {
		t.Fatalf("代理没有生效：%v", u)
	}
}

// socks5 明确不支持内置 HTTP 客户端，必须给出可行动的说明而不是静默直连。
//
// 静默直连是最糟的选择：用户以为走代理了，实际暴露了真实 IP。
func TestSocks5IsRejectedNotSilentlyIgnored(t *testing.T) {
	_, err := Transport("socks5://127.0.0.1:1080", false)
	if !errors.Is(err, ErrSocks5Unsupported) {
		t.Fatalf("socks5 应返回 ErrSocks5Unsupported，实际 %v", err)
	}
	if !strings.Contains(err.Error(), "yt-dlp") {
		t.Errorf("错误信息应说明 socks5 对 yt-dlp 仍然有效：%v", err)
	}
}

// Probe 对不可用的代理必须返回 OK=false（而不是超时后假装成功）。
func TestProbeFailsForClosedPort(t *testing.T) {
	// 1 号端口在测试机上不会有人监听
	res := Probe(context.Background(), "http://127.0.0.1:1")
	if res.OK {
		t.Fatalf("连不上却报告成功：%+v", res)
	}
	if res.Error == "" {
		t.Error("失败时必须给出原因")
	}
	if res.Kind != string(ProxyHTTP) {
		t.Errorf("Kind = %q，期望 http", res.Kind)
	}
}

// 格式非法时就该立刻失败，不必等一次网络超时。
func TestProbeRejectsBadFormatFast(t *testing.T) {
	start := time.Now()
	res := Probe(context.Background(), "ftp://x")
	elapsed := time.Since(start)
	if res.OK {
		t.Fatal("非法协议不该报告成功")
	}
	if elapsed > 2*time.Second {
		t.Fatalf("格式错误应立刻返回，实际等了 %s", elapsed)
	}
}

// 通过一个**真实**的 HTTP 代理访问 httptest 服务，验证链路真的通。
//
// 这是唯一能证明「代理确实被用上了」的测试：只看 transport.Proxy 非 nil
// 不够（可能根本没发出去），这里让代理服务器自己计数。
func TestProbeGoesThroughProxy(t *testing.T) {
	var proxied int
	proxySrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// CONNECT（https）与普通转发（http）都算经过代理
		proxied++
		if r.Method == http.MethodConnect {
			w.WriteHeader(http.StatusOK)
			return
		}
		http.Error(w, "ok", http.StatusNoContent)
	}))
	defer proxySrv.Close()

	// 用一个 http 目标（httptest 是 http，不是 https，避免真要证书）
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer target.Close()

	client, err := Client(proxySrv.URL, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := client.Get(target.URL)
	if err != nil {
		t.Fatalf("经代理请求失败：%v", err)
	}
	_ = resp.Body.Close()

	if proxied == 0 {
		t.Fatal("请求没有经过代理（代理服务器一次都没被调用）")
	}
}

// 代理地址里的认证信息要能正常解析（不带进日志/回显的要求在别处）。
func TestParseProxyWithAuth(t *testing.T) {
	p, err := ParseProxy("http://user:pa%40ss@127.0.0.1:7890")
	if err != nil {
		t.Fatal(err)
	}
	if p.URL.User == nil || p.URL.User.Username() != "user" {
		t.Errorf("用户名没解析出来：%v", p.URL.User)
	}
	if pw, _ := p.URL.User.Password(); pw != "pa@ss" {
		t.Errorf("密码没正确解码：%q", pw)
	}
	_ = url.URL{} // 保持 import 使用（URL 类型在断言里用到）
}
