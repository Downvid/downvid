// Package server 是容器端 / 无头模式的 Go 服务。
//
// ## 它与前端的关系
//
// 前端（Svelte，以及过渡期的 Vue）通过 **WebSocket RPC** 调它。协议刻意沿用
// 现有的 `docker/web/bridge.ts` 形状，这样过渡期前端一行不用改：
//
//	请求  {"id": 1, "channel": "history:get", "args": []}
//	响应  {"id": 1, "result": ...}  或  {"id": 1, "error": "..."}
//	事件  {"event": "history:updated", "data": ...}
//
// ## 为什么用 Go 重写（原实现 524 行单文件）
//
//  1. 原实现在 `docker/server/index.ts` 里混了 HTTP 服务、RPC 分发、历史读写、
//     依赖设置清洗、日志读取——一个文件 524 行，无法单测。
//  2. 它靠 `electron-shim.ts` 伪造 electron 模块来复用桌面代码；shim 漏一个 API
//     只有容器端会炸，桌面端完全正常。
//  3. Go 侧已经有 `internal/*` 的可靠实现（全部与 TS 对拍过），复用它。
//
// ## 安全边界（与 TS 实现一致，不含糊）
//
//   - 默认只监听 `127.0.0.1`，容器里由环境变量显式改成 `0.0.0.0`
//   - WebSocket 做 Origin 校验（防 CSWSH：恶意网页偷用用户的本地服务）
//   - **没有多租户、没有账号系统**：个人自托管工具，公网暴露必须靠前置反代 + 认证
package server

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
)

// Config 是服务配置。
type Config struct {
	// Host 监听地址。默认 127.0.0.1，容器里由 DOWNVID_WEB_HOST=0.0.0.0 覆盖
	Host string
	Port int
	// StaticDir 是前端构建产物目录
	StaticDir string
	// Version 是应用版本（由构建期注入）
	Version string
}

// Method 是一个 RPC 方法的实现。
//
// args 是前端传来的位置参数（对应 TS 的 `...args`）。返回值直接序列化成 JSON。
// 返回 error 时前端收到 `{error: message}`，而不是让整个连接断掉——
// 一次失败的调用不该影响后续调用。
type Method func(args []any) (any, error)

// Server 是服务实例。
type Server struct {
	cfg     Config
	methods map[string]Method
	// subscribers 按事件名保存订阅者（每个连接一个 send 函数）
	subsMu      sync.RWMutex
	subscribers map[string]map[*conn]bool
	mu          sync.RWMutex
	conns       map[*conn]bool
}

type conn struct {
	ws   *websocket.Conn
	send chan []byte
	// closed 由读写协程共享：一方退出后另一方也要停
	closed chan struct{}
	once   sync.Once
}

func (c *conn) close() {
	c.once.Do(func() { close(c.closed) })
}

// New 创建服务。
func New(cfg Config) *Server {
	if cfg.Host == "" {
		cfg.Host = "127.0.0.1"
	}
	if cfg.Port == 0 {
		cfg.Port = 6080
	}
	return &Server{
		cfg:         cfg,
		methods:     map[string]Method{},
		subscribers: map[string]map[*conn]bool{},
		conns:       map[*conn]bool{},
	}
}

// Handle 注册一个 RPC 方法。
//
// 注册时机是启动期（单线程），所以不加锁；运行期只读。
func (s *Server) Handle(channel string, m Method) {
	s.methods[channel] = m
}

// Channels 返回已注册的通道名（供诊断与契约校验用）。
//
// 排序后返回，避免 map 迭代顺序让两次调用的输出不同——
// 契约校验会比对这份列表，顺序不稳定会让它随机红。
func (s *Server) Channels() []string {
	out := make([]string, 0, len(s.methods))
	for k := range s.methods {
		out = append(out, k)
	}
	sortStrings(out)
	return out
}

// Emit 广播事件到所有订阅者。
//
// 对应 TS 的 `wsEventBus.emit`。非阻塞：某个客户端读得慢不该拖住整个服务，
// 缓冲区满了就丢掉这条事件——进度事件丢一条最多是进度条跳一下，
// 而阻塞会让所有下载卡住。
func (s *Server) Emit(event string, data any) {
	payload, err := json.Marshal(map[string]any{"event": event, "data": data})
	if err != nil {
		return
	}

	s.subsMu.RLock()
	targets := make([]*conn, 0, len(s.subscribers[event]))
	for c := range s.subscribers[event] {
		targets = append(targets, c)
	}
	s.subsMu.RUnlock()

	for _, c := range targets {
		select {
		case c.send <- payload:
		default:
			// 缓冲满：丢这条事件，不断开连接
		}
	}
}

// ===== HTTP =====

// Handler 返回 HTTP handler（方便测试用 httptest）。
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/ws", s.handleWS)
	mux.HandleFunc("/", s.handleStatic)
	return mux
}

// handleHealth 是健康检查。
//
// 返回体带上镜像名与版本：用户排障时把这一行贴出来就够了，
// 不用再问「你装的是哪个镜像、什么版本」。
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":      true,
		"version": s.cfg.Version,
		"mode":    "container",
	})
}

// handleStatic 提供前端静态文件，未知路径回退到 index.html（SPA）。
func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	if s.cfg.StaticDir == "" {
		http.Error(w, "static dir not configured", http.StatusInternalServerError)
		return
	}

	// 路径穿越防护：把 URL 路径归一化并确保最终落点在 StaticDir 内
	clean := strings.TrimPrefix(r.URL.Path, "/")
	if clean == "" {
		clean = "index.html"
	}
	full := joinUnder(s.cfg.StaticDir, clean)
	if full == "" {
		http.Error(w, "bad path", http.StatusBadRequest)
		return
	}

	http.ServeFile(w, r, full)
}

// ===== WebSocket =====

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	// Origin 校验自己做（见 checkOrigin），不用库的默认实现——
	// 默认实现只比对 Host，容器里经反代时 Host 可能被改写。
	CheckOrigin: func(r *http.Request) bool { return true },
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	if !CheckOrigin(r.Header.Get("Origin"), r.Header.Get("Host")) {
		// 跨站脚本尝试偷用本地服务（CSWSH）时直接拒绝
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	c := &conn{ws: ws, send: make(chan []byte, 256), closed: make(chan struct{})}
	s.mu.Lock()
	s.conns[c] = true
	s.mu.Unlock()

	go s.writeLoop(c)
	s.readLoop(c)
}

// readLoop 处理来自客户端的消息。
func (s *Server) readLoop(c *conn) {
	defer func() {
		s.dropConn(c)
		c.close()
		c.ws.Close()
	}()

	for {
		_, raw, err := c.ws.ReadMessage()
		if err != nil {
			return
		}

		var msg struct {
			ID      *int   `json:"id"`
			Channel string `json:"channel"`
			Args    []any  `json:"args"`
			// 客户端也可以用同一条连接订阅事件
			Subscribe   string `json:"subscribe"`
			Unsubscribe string `json:"unsubscribe"`
		}
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue // 坏消息直接丢弃，不断连接
		}

		if msg.Subscribe != "" {
			s.addSubscriber(c, msg.Subscribe)
			continue
		}
		if msg.Unsubscribe != "" {
			s.removeSubscriber(c, msg.Unsubscribe)
			continue
		}
		if msg.ID == nil {
			continue
		}

		resp := map[string]any{"id": *msg.ID}
		m, ok := s.methods[msg.Channel]
		if !ok {
			// 未知通道如实报错（而不是静默无响应——那会让前端一直转圈）
			resp["error"] = fmt.Sprintf("unknown channel: %s", msg.Channel)
		} else if result, err := m(msg.Args); err != nil {
			resp["error"] = err.Error()
		} else {
			resp["result"] = result
		}

		out, err := json.Marshal(resp)
		if err != nil {
			continue
		}
		select {
		case c.send <- out:
		case <-c.closed:
			return
		}
	}
}

// writeLoop 把待发消息写出去。
//
// 所有写操作集中在一个协程：gorilla/websocket 不允许并发写。
func (s *Server) writeLoop(c *conn) {
	for {
		select {
		case msg := <-c.send:
			if err := c.ws.WriteMessage(websocket.TextMessage, msg); err != nil {
				c.close()
				return
			}
		case <-c.closed:
			return
		}
	}
}

func (s *Server) addSubscriber(c *conn, event string) {
	s.subsMu.Lock()
	defer s.subsMu.Unlock()
	if s.subscribers[event] == nil {
		s.subscribers[event] = map[*conn]bool{}
	}
	s.subscribers[event][c] = true
}

func (s *Server) removeSubscriber(c *conn, event string) {
	s.subsMu.Lock()
	defer s.subsMu.Unlock()
	delete(s.subscribers[event], c)
	if len(s.subscribers[event]) == 0 {
		delete(s.subscribers, event)
	}
}

func (s *Server) dropConn(c *conn) {
	s.mu.Lock()
	delete(s.conns, c)
	s.mu.Unlock()

	// 从所有订阅里摘掉，避免向已关闭的连接发消息
	s.subsMu.Lock()
	for event, set := range s.subscribers {
		delete(set, c)
		if len(set) == 0 {
			delete(s.subscribers, event)
		}
	}
	s.subsMu.Unlock()
}

// ListenAndServe 启动服务（阻塞）。
func (s *Server) ListenAndServe() error {
	addr := fmt.Sprintf("%s:%d", s.cfg.Host, s.cfg.Port)
	log.Printf("[downvid] listening on http://%s", addr)
	return http.ListenAndServe(addr, s.Handler())
}

// ===== 辅助 =====

// CheckOrigin 校验 WebSocket 的 Origin（防 CSWSH）。
//
// 规则与 TS 实现一致：
//  1. 无 Origin（非浏览器环境，如 curl / 移动客户端）→ 允许
//  2. Origin 的 host 与请求的 Host 相同 → 同源，允许
//  3. Origin 是本机回环（localhost / 127.0.0.1 / ::1）→ 允许
//  4. 其余一律拒绝
//
// 第 1 条看起来宽松，但它拦不住的情况本来也拦不住——能伪造 Origin 的客户端
// 同样能伪造 Host，而真正的威胁是浏览器里的第三方网页，浏览器**必须**带 Origin。
func CheckOrigin(originHeader, hostHeader string) bool {
	if originHeader == "" {
		return true
	}
	u, err := url.Parse(originHeader)
	if err != nil {
		return false
	}

	// 同源
	if hostHeader != "" && strings.EqualFold(u.Host, hostHeader) {
		return true
	}

	// 本地回环
	switch strings.ToLower(u.Hostname()) {
	case "localhost", "127.0.0.1", "::1":
		return true
	}
	return false
}

// joinUnder 把相对路径安全地拼到 base 下，越界时返回空串。
//
// 这个函数存在的理由（安全）：`GET /../../etc/passwd` 这类请求若能读到
// 容器外的文件，等于把宿主机交出去。原 TS 实现用正则剥前导 `../`，
// 但那只处理了开头——`a/../../b` 仍能穿出去。这里用 Clean + 前缀校验。
func joinUnder(base, rel string) string {
	// 先归一化：消掉 `..`、重复分隔符
	cleaned := cleanPath(rel)
	if cleaned == "" {
		return ""
	}
	full := cleanPath(base + "/" + cleaned)

	// 前缀校验必须在路径分隔符边界上：`/static-evil` 不该匹配 `/static`
	baseClean := cleanPath(base)
	if full != baseClean && !strings.HasPrefix(full, baseClean+"/") {
		return ""
	}
	return full
}

// cleanPath 是 POSIX 风格的路径归一化（不受宿主平台影响）。
//
// 不用 filepath.Clean：它的行为随编译平台变化，而这里要的是**确定性**——
// 同样的请求在 CI 的任何平台都该得到同样的判定。
func cleanPath(p string) string {
	p = strings.ReplaceAll(p, "\\", "/")
	absolute := strings.HasPrefix(p, "/")
	parts := strings.Split(p, "/")
	stack := make([]string, 0, len(parts))
	for _, seg := range parts {
		switch seg {
		case "", ".":
			continue
		case "..":
			if len(stack) > 0 && stack[len(stack)-1] != ".." {
				stack = stack[:len(stack)-1]
			} else if !absolute {
				stack = append(stack, "..")
			}
		default:
			stack = append(stack, seg)
		}
	}
	out := strings.Join(stack, "/")
	if absolute {
		out = "/" + out
	}
	return out
}

// sortStrings 是稳定排序（避免引入 sort 包的额外 import 噪音时用）。
func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}
