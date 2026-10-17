// Package netx 提供「带代理的 HTTP 客户端」与「代理探活」。
//
// ## 为什么需要单独一个包
//
// 代理设置原先只在一处生效：yt-dlp 的 `--proxy` 参数。也就是说
//
//   - 抖音/快手的直链下载（走 Go 自己的 fetch）**完全不走代理**
//   - 依赖下载（yt-dlp / ffmpeg 的资产）**不走代理**
//   - 更新检查**不走代理**
//
// 用户在设置里填了代理，界面显示「已保存」，实际只有解析走代理。
// 这类问题的表现是「开了代理还是连不上」，而日志里没有任何异常。
//
// 把「构造 transport」收敛到这里，任何要发 HTTP 的地方都从 `Client()` 拿，
// 就不会再有漏网的调用点。
package netx

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ProxyKind 是代理协议。
type ProxyKind string

const (
	ProxyHTTP   ProxyKind = "http"
	ProxyHTTPS  ProxyKind = "https"
	ProxySocks5 ProxyKind = "socks5"
)

// Proxy 是解析后的代理设置。
type Proxy struct {
	Kind ProxyKind
	URL  *url.URL
	// Raw 是用户原始输入（原样回显到界面/日志，便于核对）
	Raw string
}

// ErrEmptyProxy 表示没配置代理（不是错误，调用方通常直接走直连）。
var ErrEmptyProxy = errors.New("未配置代理")

// ParseProxy 解析用户输入的代理地址。
//
// ## 为什么要「补 scheme」而不是直接拒绝
//
// 用户最常粘贴的是 `127.0.0.1:7890`（Clash / Surge 界面里显示的就是这个）。
// 直接 `url.Parse` 会得到 `Scheme="127.0.0.1"`，随后 `http.Transport` 报
// `unsupported protocol scheme`——而这条错误在下载失败时被归成「网络错误」，
// 用户看到的是「下载失败，请检查网络」，完全指不到代理格式上。
//
// 所以这里补成 `http://127.0.0.1:7890`，并把「补了什么」如实告诉调用方。
func ParseProxy(raw string) (Proxy, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return Proxy{}, ErrEmptyProxy
	}

	// 没写 scheme 时补 http://（用户手写与系统代理列表都是这个习惯）
	if !strings.Contains(s, "://") {
		s = "http://" + s
	}

	u, err := url.Parse(s)
	if err != nil {
		return Proxy{}, fmt.Errorf("代理地址无法解析：%w", err)
	}
	// 必须带 host：`http://` 这种只给了 scheme 的输入要拒绝
	if u.Host == "" {
		return Proxy{}, errors.New("代理地址缺少主机名（例如 http://127.0.0.1:7890）")
	}

	kind := ProxyKind(strings.ToLower(u.Scheme))
	switch kind {
	case ProxyHTTP, ProxyHTTPS, ProxySocks5:
	default:
		return Proxy{}, fmt.Errorf("不支持的代理协议 %q（只支持 http / https / socks5）", u.Scheme)
	}

	// 端口留空时补默认值，让界面上「能不能用」的判断更准
	if u.Port() == "" {
		port := "8080"
		if kind == ProxySocks5 {
			port = "1080"
		}
		u.Host = net.JoinHostPort(u.Hostname(), port)
	}

	return Proxy{Kind: kind, URL: u, Raw: strings.TrimSpace(raw)}, nil
}

// Transport 构造带代理的 transport。
//
// `proxy` 为空时返回**直连** transport（而不是 nil）：调用方可以无条件使用，
// 不必到处写 `if proxy != ""`——那种分散判断迟早漏一处，而漏掉的表现就是
// 「这个功能不走代理」。
func Transport(proxy string, insecureSkipVerify bool) (*http.Transport, error) {
	t := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout:   15 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		TLSHandshakeTimeout:   15 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		MaxIdleConnsPerHost:   8,
		// 不跟随系统代理环境变量：用户显式配置了就用他的，
		// 没配置就用直连。混用会让「关掉代理」变成「用 HTTP_PROXY 里的那个」。
		Proxy: nil,
	}
	_ = insecureSkipVerify // 目前不支持跳过校验；保留参数是为了将来加自签证书时不用改签名

	p, err := ParseProxy(proxy)
	if err != nil {
		if errors.Is(err, ErrEmptyProxy) {
			return t, nil
		}
		return nil, err
	}

	// socks5 用标准库的 golang.org/x/net/proxy？——不，标准库没有 socks5，
	// 而 `http.Transport.Proxy` 对 socks5 的支持依赖 `golang.org/x/net`。
	// 因此这里只对 http/https 设置 Proxy；socks5 交给 yt-dlp 的 --proxy，
	// 并如实告诉调用方（见 TestSocks5NotSupportedByTransport）。
	if p.Kind == ProxySocks5 {
		return nil, ErrSocks5Unsupported
	}
	t.Proxy = http.ProxyURL(p.URL)
	return t, nil
}

// ErrSocks5Unsupported 表示 socks5 无法用于内置 HTTP 客户端。
//
// 标准库的 `http.Transport` 只认 http/https 代理；socks5 需要额外依赖。
// 我们不引那个依赖（见 package 注释的「零第三方依赖」原则），
// 改成：yt-dlp 走 `--proxy socks5://...` 没问题，而应用自己的 HTTP
// （直链下载 / 依赖下载 / 更新检查）走直连，并在界面上说明。
var ErrSocks5Unsupported = errors.New(
	"socks5 代理只对 yt-dlp 生效；应用内置下载与更新检查需要 http(s) 代理",
)

// Client 返回一个带代理的 http.Client。
func Client(proxy string, timeout time.Duration) (*http.Client, error) {
	t, err := Transport(proxy, false)
	if err != nil {
		return nil, err
	}
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	return &http.Client{Transport: t, Timeout: timeout}, nil
}

// ProbeResult 是代理探活的结果。
type ProbeResult struct {
	OK bool `json:"ok"`
	// LatencyMs 是到目标站点的往返耗时（含代理转发）
	LatencyMs int64 `json:"latencyMs,omitempty"`
	// Status 是 HTTP 状态码（0 表示连请求都没发出去）
	Status int `json:"status,omitempty"`
	// Error 是给人看的原因
	Error string `json:"error,omitempty"`
	// Kind 是识别出的代理协议（空表示没配代理，本次是直连探测）
	Kind string `json:"kind,omitempty"`
}

// probeURL 是探活目标。
//
// 用 `generate_204` 而不是首页：它返回 204 + 空 body，
// 判断「通不通」只需要状态码，不必下载任何内容。
// 选 gstatic 而不是自己的仓库：探活不该依赖本项目的可用性。
const probeURL = "https://connectivitycheck.gstatic.com/generate_204"

// fallbackProbeURL 在第一个目标失败时尝试。
//
// 有些网络会拦 gstatic（国内较常见），换一个云厂商的 204 端点。
// **仍然返回 204**：只要能拿到任意 HTTP 响应，就说明代理链路是通的——
// 状态码具体是几不重要，重要的是「请求真的出去了并回来了」。
const fallbackProbeURL = "https://www.cloudflare.com/cdn-cgi/trace"

// Probe 实际测一次代理连通性。
//
// ## 为什么不能只做格式校验
//
// 早先界面上的「测试」按钮只跑正则，用户填了 `http://127.0.0.1:7890`
// （Clash 没开）也提示「代理可用」。随后所有下载都超时，
// 而用户以为代理是好的——这类「假阳性」比不检查更糟。
func Probe(ctx context.Context, proxy string) ProbeResult {
	p, err := ParseProxy(proxy)
	kind := ""
	if err == nil {
		kind = string(p.Kind)
	} else if !errors.Is(err, ErrEmptyProxy) {
		// 格式都不对：不必发请求
		return ProbeResult{OK: false, Error: err.Error()}
	}

	client, err := Client(proxy, 8*time.Second)
	if err != nil {
		// socks5 之类：明确告知限制，而不是假装成功
		return ProbeResult{OK: false, Kind: kind, Error: err.Error()}
	}

	targets := []string{probeURL, fallbackProbeURL}
	var lastErr string
	for _, target := range targets {
		start := time.Now()
		req, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
		if reqErr != nil {
			lastErr = reqErr.Error()
			continue
		}
		// 有些站点会对缺 UA 的请求返回 403，那会被误判成「代理不通」
		req.Header.Set("User-Agent", "DownVid-probe/1")

		resp, doErr := client.Do(req)
		elapsed := time.Since(start).Milliseconds()
		if doErr != nil {
			lastErr = describeNetError(doErr)
			continue
		}
		// 只要拿到响应就算通：状态码可能是 204 / 200 / 403，不重要
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<12))
		_ = resp.Body.Close()
		return ProbeResult{OK: true, LatencyMs: elapsed, Status: resp.StatusCode, Kind: kind}
	}

	return ProbeResult{OK: false, Kind: kind, Error: lastErr}
}

// describeNetError 把网络错误翻译成用户能行动的话。
//
// Go 的原始错误（`dial tcp 127.0.0.1:7890: connect: connection refused`）
// 对普通用户没有意义，而它恰好是「代理没开」最常见的样子。
func describeNetError(err error) string {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "connection refused"):
		return "连接被拒绝：代理软件没启动，或端口填错了"
	case strings.Contains(msg, "no such host"):
		return "代理地址解析不到：主机名写错了吗"
	case strings.Contains(msg, "i/o timeout"), strings.Contains(msg, "deadline exceeded"):
		return "连接超时：代理没响应，检查它是否在运行"
	case strings.Contains(msg, "certificate"):
		return "TLS 证书校验失败：代理可能在做 HTTPS 中间人解密，需要在代理里信任该证书"
	case strings.Contains(msg, "proxyconnect"):
		return "代理握手失败：确认它支持 HTTP CONNECT（透明代理/仅 SOCKS 的填 socks5://）"
	}
	return msg
}
