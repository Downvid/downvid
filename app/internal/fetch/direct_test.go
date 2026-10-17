package fetch

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// 这一组用例全部打**真实 HTTP 服务**。
//
// 直链下载器的错误几乎都不是「逻辑写错」，而是「协议细节没对上」：
// Range 的边界、206 的 Content-Range 格式、If-Range 的强弱校验、
// 429 的退避。这些用 mock 断言参数是测不出来的——只有真发请求、
// 真比字节才知道对不对。

// payload 造一段可校验的内容（0..255 循环，重复 20 次 → 5120 字节）。
func payload() []byte {
	out := make([]byte, 0, 5120)
	for i := 0; i < 20; i++ {
		for b := 0; b < 256; b++ {
			out = append(out, byte(b))
		}
	}
	return out
}

func sumOf(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

// rangeServer 是一个**支持 Range** 的测试服务，并记录每次请求的范围。
type rangeServer struct {
	data     []byte
	etag     string
	mu       sync.Mutex
	requests []string // 每次请求的 Range 头
	throttle int32    // 前 N 个分段请求返回 503（模拟限流）
	// requestedBeyondHalf 记录「有没有请求从文件后半段开始」。
	requestedBeyondHalf bool
	// rangeStarts 记录每个分段请求的起点（探测用的 bytes=0-0 不算）。
	// 续传用例靠它断言「已完成的区间一次都没被重新请求」——
	// 只看 requestedBeyondHalf 不够：从头重下同样会有请求落在后半段。
	rangeStarts []int64
}

func (s *rangeServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	rangeHeader := r.Header.Get("Range")

	if rangeHeader != "" && len(s.data) > 0 {
		var rs, re int64
		if n, err := fmt.Sscanf(rangeHeader, "bytes=%d-%d", &rs, &re); err == nil && n == 2 {
			s.mu.Lock()
			// bytes=0-0 是探测请求，不计入
			if !(rs == 0 && re == 0) {
				s.rangeStarts = append(s.rangeStarts, rs)
			}
			if rs >= int64(len(s.data)/2) {
				s.requestedBeyondHalf = true
			}
			s.mu.Unlock()
		}
	}

	s.mu.Lock()
	s.requests = append(s.requests, rangeHeader)
	s.mu.Unlock()

	// 限流模拟：先回几个 503，观察客户端是否降并发并重试
	if n := atomic.LoadInt32(&s.throttle); n > 0 {
		atomic.AddInt32(&s.throttle, -1)
		w.Header().Set("Retry-After", "0")
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}

	// If-Range 不匹配时按 RFC 返回 200 + 完整内容
	if ifRange := r.Header.Get("If-Range"); ifRange != "" && ifRange != s.etag {
		w.Header().Set("Etag", s.etag)
		w.Header().Set("Content-Length", strconv.Itoa(len(s.data)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(s.data)
		return
	}

	w.Header().Set("Etag", s.etag)
	w.Header().Set("Accept-Ranges", "bytes")

	if rangeHeader == "" {
		w.Header().Set("Content-Length", strconv.Itoa(len(s.data)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(s.data)
		return
	}

	var start, end int64
	if _, err := fmt.Sscanf(rangeHeader, "bytes=%d-%d", &start, &end); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	total := int64(len(s.data))
	if start >= total {
		w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
		return
	}
	if end >= total {
		end = total - 1
	}
	w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, total))
	w.Header().Set("Content-Length", strconv.FormatInt(end-start+1, 10))
	w.WriteHeader(http.StatusPartialContent)
	_, _ = w.Write(s.data[start : end+1])
}

func newClient(t *testing.T) *http.Client {
	t.Helper()
	return &http.Client{Timeout: 30 * time.Second}
}

// 端到端：分段下载后产物必须与源文件**逐字节一致**。
func TestDirectSegmentedDownloadMatchesSource(t *testing.T) {
	data := payload()
	srv := httptest.NewServer(&rangeServer{data: data, etag: `"v1"`})
	defer srv.Close()

	outDir := t.TempDir()
	out := filepath.Join(outDir, "video.mp4")

	var lastPercent float64
	res, err := (Direct{}).Download(context.Background(), DirectOptions{
		CDNURL:      srv.URL + "/v.mp4",
		PageURL:     "https://www.douyin.com/video/1",
		OutputPath:  out,
		Connections: 4,
		Client:      newClient(t),
		OnProgress: func(p DirectProgress) {
			lastPercent = p.Percent
		},
	})
	if err != nil {
		t.Fatalf("下载失败：%v", err)
	}
	if res.Total != int64(len(data)) {
		t.Errorf("Total = %d，期望 %d", res.Total, len(data))
	}

	got, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	if sumOf(got) != sumOf(data) {
		t.Fatalf("产物与源文件不一致（长度 %d vs %d）", len(got), len(data))
	}
	if lastPercent < 99.9 {
		t.Errorf("结束时百分比 = %.1f，应到 100", lastPercent)
	}

	// 收尾必须干净：没有 .part、没有检查点
	for _, leftover := range []string{out + ".part", out + ".part.json"} {
		if _, err := os.Stat(leftover); err == nil {
			t.Errorf("下载完成后残留了 %s", leftover)
		}
	}
}

// 暂停（取消 ctx）后必须留下可续传的检查点，且**已下的字节不能丢**。
func TestDirectPauseKeepsCheckpoint(t *testing.T) {
	data := make([]byte, 4<<20) // 4MB：够大到能在中途被取消
	for i := range data {
		data[i] = byte(i % 251)
	}
	// 让服务端慢一点，好在下载中途取消
	slow := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		(&rangeServer{data: data, etag: `"v1"`}).ServeHTTP(&slowWriter{w: w, delay: 2 * time.Millisecond}, r)
	})
	srv := httptest.NewServer(slow)
	defer srv.Close()

	outDir := t.TempDir()
	out := filepath.Join(outDir, "big.mp4")

	ctx, cancel := context.WithCancel(context.Background())
	progressed := make(chan struct{}, 1)
	go func() {
		select {
		case <-progressed:
			cancel()
		case <-time.After(3 * time.Second):
			cancel()
		}
	}()

	_, err := (Direct{}).Download(ctx, DirectOptions{
		CDNURL:      srv.URL + "/big.mp4",
		PageURL:     "https://www.kuaishou.com/short-video/1",
		OutputPath:  out,
		Connections: 2,
		Client:      newClient(t),
		OnProgress: func(p DirectProgress) {
			if p.Downloaded > 0 {
				select {
				case progressed <- struct{}{}:
				default:
				}
			}
		},
	})
	if err == nil {
		t.Skip("下载在取消前就完成了（服务端太快），跳过续传检查")
	}

	// 检查点必须存在且能被读回
	raw, readErr := os.ReadFile(out + ".part.json")
	if readErr != nil {
		t.Fatalf("暂停后没有检查点，无法续传：%v", readErr)
	}
	var cp Checkpoint
	if err := json.Unmarshal(raw, &cp); err != nil {
		t.Fatalf("检查点不是合法 JSON：%v", err)
	}
	if len(cp.Segments) == 0 {
		t.Fatal("检查点里没有分段")
	}
	// 产物还没生成（未完成）
	if _, statErr := os.Stat(out); statErr == nil {
		t.Error("未完成的下载不该产生最终产物")
	}
	// .part 应该已经被预分配成完整大小（这样「暂停后文件大小」与最终一致）
	if info, statErr := os.Stat(out + ".part"); statErr == nil {
		if info.Size() != int64(len(data)) {
			t.Errorf(".part 大小 = %d，期望预分配到 %d", info.Size(), len(data))
		}
	}
}

// slowWriter 给响应加延迟，模拟慢速 CDN。
type slowWriter struct {
	w     http.ResponseWriter
	delay time.Duration
}

func (s *slowWriter) Header() http.Header        { return s.w.Header() }
func (s *slowWriter) WriteHeader(statusCode int) { s.w.WriteHeader(statusCode) }
func (s *slowWriter) Write(b []byte) (int, error) {
	time.Sleep(s.delay)
	return s.w.Write(b)
}

// 续传：先下一部分留下检查点，再从头调用一次，最终产物仍必须逐字节正确。
//
// **必须用大于 1MB 的数据**：分段粒度的下限是 1MiB（见 fetch.Unit），
// 小文件只会得到**一个**分段，「跳过前半段」就无从谈起——第一版用 5KB，
// 于是把 `loadCheckpoint` 改成永不命中，用例照样通过（变异验证抓到的）。
func TestDirectResumeProducesCorrectFile(t *testing.T) {
	data := make([]byte, 3<<20) // 3MB → 4 路连接会切成多个 1MiB 分段
	for i := range data {
		data[i] = byte(i % 251)
	}
	handler := &rangeServer{data: data, etag: `"v1"`}
	srv := httptest.NewServer(handler)
	defer srv.Close()

	outDir := t.TempDir()
	out := filepath.Join(outDir, "resume.mp4")

	// 先造一个「下载了一半」的现场：预分配 + 检查点里前两段已完成
	half := int64(len(data) / 2)
	if err := os.WriteFile(out+".part", make([]byte, len(data)), 0o644); err != nil {
		t.Fatal(err)
	}
	// 真的把前半段数据写进去
	f, err := os.OpenFile(out+".part", os.O_RDWR, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteAt(data[:half], 0); err != nil {
		t.Fatal(err)
	}
	_ = f.Close()

	segs := CreateDirectSegments(int64(len(data)), 2)
	// 把**前两段**标记为已完成（3MB → 3 段，前两段覆盖前 2MB）。
	//
	// 这里有个容易写错的地方：只跳过"End <= half"的那些段，在
	// `connections=2` 时会得到 3 个 1MiB 段，而 half=1.5MiB，
	// 于是**只有第一段**被跳过，剩下的请求起点都 < half，
	// 「有没有请求后半段」的断言永远不成立（用例等于没测）。
	completed := 0
	for i := range segs {
		if completed >= 2 {
			break
		}
		segs[i].Offset = segs[i].End
		completed++
	}
	// 把已标记完成的那部分**真的写进 .part**，否则续传会认为前 2MB 已有数据
	// 而实际是空洞——最终产物与源文件不一致（这正是本用例第一版失败的原因）。
	if completed > 0 {
		done := segs[completed-1].End
		wf, openErr := os.OpenFile(out+".part", os.O_RDWR, 0o644)
		if openErr != nil {
			t.Fatal(openErr)
		}
		if _, writeErr := wf.WriteAt(data[:done], 0); writeErr != nil {
			t.Fatal(writeErr)
		}
		_ = wf.Close()
	}
	cp := Checkpoint{
		Resource: Resource{URL: srv.URL + "/v.mp4", Total: int64(len(data)), ETag: `"v1"`},
		Segments: segs,
	}
	raw, _ := json.Marshal(cp)
	if err := os.WriteFile(out+".part.json", raw, 0o644); err != nil {
		t.Fatal(err)
	}

	_, err = (Direct{}).Download(context.Background(), DirectOptions{
		CDNURL:      srv.URL + "/v.mp4",
		PageURL:     "https://www.douyin.com/video/1",
		OutputPath:  out,
		Connections: 2,
		Client:      newClient(t),
	})
	if err != nil {
		t.Fatalf("续传失败：%v", err)
	}

	got, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	if sumOf(got) != sumOf(data) {
		t.Fatal("续传后产物与源文件不一致（检查点里的偏移没有真的被跳过）")
	}

	// **关键断言**：已完成的区间一次都不该被重新请求。
	//
	// 只比最终字节不够——从头下完也能得到正确结果；只看「有没有请求落在
	// 后半段」也不够——从头重下同样会有。必须断言**没有请求从前 2MB 之内开始**
	// （变异验证：把 loadCheckpoint 改成永不命中，这条立刻失败）。
	resumeFrom := segs[completed-1].End
	handler.mu.Lock()
	starts := append([]int64(nil), handler.rangeStarts...)
	handler.mu.Unlock()
	for _, start := range starts {
		if start < resumeFrom {
			t.Fatalf("续传时重新请求了已完成的区间（起点 %d < %d），说明检查点没被采用", start, resumeFrom)
		}
	}
}

// 服务器限流（503 + Retry-After）时必须重试成功，而不是直接失败。
func TestDirectRetriesThrottledSegments(t *testing.T) {
	data := payload()
	srv := httptest.NewServer(&rangeServer{data: data, etag: `"v1"`, throttle: 2})
	defer srv.Close()

	out := filepath.Join(t.TempDir(), "throttled.mp4")
	_, err := (Direct{}).Download(context.Background(), DirectOptions{
		CDNURL:      srv.URL + "/v.mp4",
		PageURL:     "https://www.douyin.com/video/1",
		OutputPath:  out,
		Connections: 2,
		Client:      newClient(t),
	})
	if err != nil {
		t.Fatalf("遇到 503 应该重试而不是失败：%v", err)
	}
	got, _ := os.ReadFile(out)
	if sumOf(got) != sumOf(data) {
		t.Fatal("重试后的产物不一致")
	}
}

// 不支持 Range 的服务器必须退回单流，且产物正确。
//
// 退回的条件不能写错：很多 CDN 对 Range 请求直接回 200 + 完整内容，
// 此时**不能**按分段解析（会得到一堆错位的字节）。
func TestDirectFallsBackToSingleStream(t *testing.T) {
	data := payload()
	noRange := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)
	}))
	defer noRange.Close()

	out := filepath.Join(t.TempDir(), "single.mp4")
	res, err := (Direct{}).Download(context.Background(), DirectOptions{
		CDNURL:      noRange.URL + "/v.mp4",
		PageURL:     "https://www.douyin.com/video/1",
		OutputPath:  out,
		Connections: 8, // 就算配了 8 路，服务器不支持也只能单流
		Client:      newClient(t),
	})
	if err != nil {
		t.Fatalf("单流下载失败：%v", err)
	}
	got, _ := os.ReadFile(out)
	if sumOf(got) != sumOf(data) {
		t.Fatalf("单流产物不一致（长度 %d vs %d）", len(got), len(data))
	}
	if res.Total != int64(len(data)) {
		t.Errorf("Total = %d，期望 %d", res.Total, len(data))
	}
}

// 缺 HTTP 客户端时必须**明确报错**，不能悄悄用直连。
//
// 悄悄直连会让「开了代理却暴露真实 IP」，而用户完全察觉不到。
func TestDirectRequiresClient(t *testing.T) {
	_, err := (Direct{}).Download(context.Background(), DirectOptions{
		CDNURL:     "https://example.com/v.mp4",
		OutputPath: filepath.Join(t.TempDir(), "x.mp4"),
	})
	if err == nil {
		t.Fatal("缺 Client 应该报错")
	}
	if !strings.Contains(err.Error(), "代理") {
		t.Errorf("错误信息应说明为什么需要 Client：%v", err)
	}
}

func TestParseContentRangeTotal(t *testing.T) {
	cases := map[string]int64{
		"bytes 0-0/12345":   12345,
		"bytes 100-199/500": 500,
		"":                  0,
		"bytes 0-0/*":       0,
		"garbage":           0,
	}
	for header, want := range cases {
		if got := parseContentRangeTotal(header); got != want {
			t.Errorf("parseContentRangeTotal(%q) = %d，期望 %d", header, got, want)
		}
	}
}

// 弱 ETag 不能用于 If-Range（RFC 7233 要求强校验），应退回 Last-Modified。
func TestRangeValidatorRejectsWeakETag(t *testing.T) {
	if got := rangeValidator(Resource{ETag: `W/"weak"`, LastModified: "Wed, 21 Oct 2015 07:28:00 GMT"}); got != "Wed, 21 Oct 2015 07:28:00 GMT" {
		t.Errorf("弱 ETag 应被跳过，实际用了 %q", got)
	}
	if got := rangeValidator(Resource{ETag: `"strong"`}); got != `"strong"` {
		t.Errorf("强 ETag 应被采用，实际 %q", got)
	}
}

func TestParseRetryAfter(t *testing.T) {
	if d := parseRetryAfter("3"); d != 3*time.Second {
		t.Errorf("秒数形式 = %v，期望 3s", d)
	}
	if d := parseRetryAfter(""); d != 0 {
		t.Errorf("空串应为 0，实际 %v", d)
	}
	// 过去的日期 → 0（不要产生负等待）
	if d := parseRetryAfter("Wed, 21 Oct 2015 07:28:00 GMT"); d != 0 {
		t.Errorf("过期日期应为 0，实际 %v", d)
	}
}

// 服务器返回**错位**的分段时必须报错，而不是把错位的字节写进产物。
//
// 真实场景：CDN 忽略 Range 头、返回整个文件（200）或返回别的区间。
// 不校验的话，多个分段会把同一段内容反复写到不同位置，
// 最终得到一个「大小对但内容全乱」的视频——这比下载失败更难排查。
func TestDirectRejectsMismatchedRange(t *testing.T) {
	// 内容必须**不可循环**：早先用 `byte(i%251)`，于是"错位拼接"
	// 也能拼回原文件，用例直接 skip 掉了（等于没测）。
	// 用一个简单的 PRNG 保证任意位置的内容都不同。
	data := make([]byte, 2<<20)
	seed := uint32(12345)
	for i := range data {
		seed = seed*1664525 + 1013904223
		data[i] = byte(seed >> 24)
	}

	// 一个**声称支持 Range、但对分段请求返回错位区间**的服务器。
	//
	// 关键细节：探测用的 `bytes=0-0` 必须正常回 `0-0/total`（否则探测会判定
	// 「不支持 Range」并退回单流——那样永远不会碰到分段校验，用例也就测不到
	// 想测的东西。第一版就是这么写的，结果被 skip 掉了）。
	lying := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Etag", `"v1"`)
		rangeHeader := r.Header.Get("Range")
		var rs, re int64
		if n, err := fmt.Sscanf(rangeHeader, "bytes=%d-%d", &rs, &re); err == nil && n == 2 {
			if rs == 0 && re == 0 {
				// 探测：正常回答，让客户端相信 Range 可用
				w.Header().Set("Content-Range", fmt.Sprintf("bytes 0-0/%d", len(data)))
				w.Header().Set("Content-Length", "1")
				w.WriteHeader(http.StatusPartialContent)
				_, _ = w.Write(data[:1])
				return
			}
			// 真正的分段请求：**故意忽略起点**，永远给前 512KB
			w.Header().Set("Content-Range", fmt.Sprintf("bytes 0-524287/%d", len(data)))
			w.Header().Set("Content-Length", "524288")
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write(data[:524288])
			return
		}
		w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)
	}))
	defer lying.Close()

	out := filepath.Join(t.TempDir(), "lying.mp4")
	_, err := (Direct{}).Download(context.Background(), DirectOptions{
		CDNURL:      lying.URL + "/v.mp4",
		PageURL:     "https://www.douyin.com/video/1",
		OutputPath:  out,
		Connections: 4,
		Client:      newClient(t),
	})
	if err == nil {
		t.Fatal("服务器返回错位区间却报告成功：Content-Range 校验没生效，产物一定是坏的")
	}
	if !strings.Contains(err.Error(), "范围") {
		t.Errorf("错误信息应指出范围不符，实际：%v", err)
	}
}
