package fetch

// 抖音 / 快手直链下载器。
//
// 本文件是 electron/download/direct.ts 的 Go 移植（209 行）。
// 分段规划与续传判据在 direct_state.go（已有 32 条交叉验证用例），
// 这里只负责「发请求、写文件、报进度、收尾」。
//
// ## 为什么这两家要走独立路径
//
// 解析器拿到的是平台 CDN 的直链，**有效期很短**（实测几分钟）。交给 yt-dlp
// 会二次请求平台接口，不仅更慢，还可能拿不到同一份地址（拿到的是另一份
// 带不同签名的 URL，甚至是另一档清晰度）。所以这里直接对着 CDN 拉。
//
// ## 与 yt-dlp 路径的行为对齐
//
// - 支持 Range 时按分块队列调度（默认 8 路，最多 16）；不支持的服务器退回单流
// - `.part` + `.part.json` 保存逐段进度，暂停后恢复只请求尚未写入的范围
// - 429/503 降并发（对半砍），并遵守 `Retry-After`
// - 分段失败从**已写入位置**重试，而不是重下整段
//
// ## 代理
//
// 这里的 HTTP 客户端由调用方传入（见 `Client`）。之前这条路径完全不支持代理
// ——用户开了代理，直链下载仍然直连，而界面显示「代理已启用」。

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// DirectOptions 是一次直链下载的参数。
type DirectOptions struct {
	// CDNURL 是解析器给出的直链
	CDNURL string
	// PageURL 是原页面地址，用来推 Referer（快手与抖音的防盗链不同）
	PageURL string
	// OutputPath 是最终产物路径（临时文件是它的 `.part`）
	OutputPath string
	// Connections 是并发连接数（来自加速设置，1 表示单流）
	Connections int
	// Client 必须非 nil：调用方用 netx.Client(proxy, timeout) 构造，
	// 这样代理设置会自动生效
	Client *http.Client
	// OnProgress 进度回调（已节流，每 200ms 最多一次）
	OnProgress func(DirectProgress)
}

// DirectProgress 是一次进度更新。
type DirectProgress struct {
	Percent    float64
	Total      int64
	Downloaded int64
	SpeedBps   float64
	ETASec     int64
	// Resumed 为 true 表示这次是从检查点续传（总进度里有一部分不是本次下的）
	Resumed bool
}

// DirectResult 是下载结果。
type DirectResult struct {
	Path string
	// Total 是字节数（服务器没给 Content-Length 时为 0）
	Total int64
}

// 抖音 / 快手的防盗链：不带 UA + Referer 会直接 403 或返回占位图。
const directUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
	"AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

// errRangeMismatch 表示服务器返回的分段范围与请求不符。
//
// 它**不可重试**：服务器对这个区间给出的就是错位的数据，再问三次还是同一份。
// 重试只会让用户多等 6 秒（1+2+3）才看到同一句错误。实测用例里这条占了
// 整个测试 6 秒的绝大部分。
var errRangeMismatch = errors.New("服务器返回的分段范围与请求不符")

// directRetries 是单个分段的重试次数上限。
//
// 3 次是实测的结果：CDN 的瞬时 5xx 基本在 2 次内恢复，再多只会让
// 「确实下不了」的情况多等半分钟才报错。
const directRetries = 3

// readIdleTimeout 是「多久没读到数据就判定连接已死」。
//
// 必须有这条：CDN 有时会保持连接但不再发数据（半开连接），
// 此时 Read 会一直阻塞，用户看到的是「进度卡住但没报错」。
const readIdleTimeout = 30 * time.Second

// Direct 是直链下载器（无状态，可复用）。
type Direct struct{}

// Download 执行一次直链下载。
//
// ctx 取消 = 用户暂停：保留 `.part` 与检查点，下次从已有位置继续。
func (Direct) Download(ctx context.Context, opts DirectOptions) (DirectResult, error) {
	if opts.CDNURL == "" || opts.OutputPath == "" {
		return DirectResult{}, errors.New("缺少 CDN 地址或输出路径")
	}
	if opts.Client == nil {
		return DirectResult{}, errors.New("缺少 HTTP 客户端（代理设置无处生效）")
	}
	if opts.Connections <= 0 {
		opts.Connections = 1
	}

	tempPath := opts.OutputPath + ".part"
	checkpointPath := tempPath + ".json"

	progress := newProgressReporter(opts.OnProgress)

	// 1) 探测：只请求 1 个字节，看服务器支不支持 Range、总大小是多少
	probe := probeDirect(ctx, opts)
	if err := ctx.Err(); err != nil {
		return DirectResult{}, err
	}

	if probe.rangeSupported {
		err := downloadSegmented(ctx, opts, probe.resource, tempPath, checkpointPath, progress)
		if err != nil {
			return DirectResult{}, err
		}
	} else {
		err := downloadSingleStream(ctx, opts, tempPath, checkpointPath, progress)
		if err != nil {
			return DirectResult{}, err
		}
		// 单流时探测阶段拿不到总大小（服务器不支持 Range），
		// 它在下载过程中才知道 —— 用实际写入的字节数覆盖掉探测值。
		// 早先没这一步，`Total` 恒为 0，界面上的「总大小」永远是空的。
		if info, statErr := os.Stat(tempPath); statErr == nil {
			probe.resource.Total = info.Size()
		}
	}

	if err := ctx.Err(); err != nil {
		return DirectResult{}, err
	}

	// 原子收尾：先 rename 再删检查点。反过来的话，rename 失败会留下
	// 一个「没有检查点的 .part」，那段数据就永远续不上了。
	if err := os.Rename(tempPath, opts.OutputPath); err != nil {
		return DirectResult{}, fmt.Errorf("重命名产物失败：%w", err)
	}
	_ = os.Remove(checkpointPath)

	progress.flush(opts.OutputPath)
	return DirectResult{Path: opts.OutputPath, Total: probe.resource.Total}, nil
}

// ===== 探测 =====

type probeResult struct {
	rangeSupported bool
	resource       Resource
}

// probeDirect 用 `Range: bytes=0-0` 探一次。
//
// 三个信息一次拿全：总大小（Content-Range 的分母）、是否支持 Range
// （206 + 头解析成功）、以及续传校验用的 ETag / Last-Modified。
//
// 探测失败**不算错误**：退化成单流下载即可（有些 CDN 对 Range 请求返回 200）。
func probeDirect(ctx context.Context, opts DirectOptions) probeResult {
	fallback := probeResult{resource: Resource{URL: opts.CDNURL}}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, opts.CDNURL, nil)
	if err != nil {
		return fallback
	}
	for k, v := range directHeaders(opts.PageURL) {
		req.Header.Set(k, v)
	}
	req.Header.Set("Range", "bytes=0-0")

	// 探测也要处理限流：503 只说明「这一下不行」，不代表服务器不支持 Range。
	// 早先这里直接 return fallback，于是整个下载静默退化成分段不可用——
	// 后续走单流，还会因为 Content-Length 拿不到而把总大小记成 0。
	var resp *http.Response
	for attempt := 0; ; attempt++ {
		resp, err = opts.Client.Do(req)
		if err != nil {
			return fallback
		}
		if resp.StatusCode != http.StatusTooManyRequests &&
			resp.StatusCode != http.StatusServiceUnavailable {
			break
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1024))
		resp.Body.Close()
		if attempt >= directRetries {
			return fallback
		}
		wait := parseRetryAfter(resp.Header.Get("Retry-After"))
		if wait <= 0 {
			wait = time.Duration(attempt+1) * 200 * time.Millisecond
		}
		select {
		case <-ctx.Done():
			return fallback
		case <-time.After(wait):
		}
		// 请求体已消费，重建一次
		req, err = http.NewRequestWithContext(ctx, http.MethodGet, opts.CDNURL, nil)
		if err != nil {
			return fallback
		}
		for k, v := range directHeaders(opts.PageURL) {
			req.Header.Set(k, v)
		}
		req.Header.Set("Range", "bytes=0-0")
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1024))

	contentRange := resp.Header.Get("Content-Range")
	total := parseContentRangeTotal(contentRange)
	resource := Resource{
		URL:          opts.CDNURL,
		Total:        total,
		ETag:         resp.Header.Get("Etag"),
		LastModified: resp.Header.Get("Last-Modified"),
	}

	supported := resp.StatusCode == http.StatusPartialContent &&
		total > 0 &&
		MatchesDirectRange(contentRange, 0, 1, total)
	return probeResult{rangeSupported: supported, resource: resource}
}

// parseContentRangeTotal 从 `bytes 0-0/12345` 里取出 12345。
func parseContentRangeTotal(header string) int64 {
	if header == "" {
		return 0
	}
	idx := strings.LastIndex(header, "/")
	if idx < 0 || idx+1 >= len(header) {
		return 0
	}
	tail := strings.TrimSpace(header[idx+1:])
	if tail == "*" || tail == "" {
		return 0
	}
	var total int64
	if _, err := fmt.Sscanf(tail, "%d", &total); err != nil {
		return 0
	}
	return total
}

// ===== 单流（不支持 Range）=====

func downloadSingleStream(
	ctx context.Context,
	opts DirectOptions,
	tempPath, checkpointPath string,
	progress *progressReporter,
) error {
	// 不支持 Range 的服务器无法安全续传：必须丢掉旧片段重新下，
	// 否则会把两次下载的内容拼成一个坏文件。
	_ = os.Remove(checkpointPath)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, opts.CDNURL, nil)
	if err != nil {
		return err
	}
	for k, v := range directHeaders(opts.PageURL) {
		req.Header.Set(k, v)
	}

	resp, err := opts.Client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d：%s", resp.StatusCode, resp.Status)
	}

	f, err := os.Create(tempPath)
	if err != nil {
		return err
	}
	defer f.Close()

	total := resp.ContentLength
	if total < 0 {
		total = 0
	}
	progress.setTotal(total)

	// 8KB 起步有点小，但配合 bufio 的预读已经足够；真正决定吞吐的是
	// 单次 Read 能拿多少——CDN 一般给 16-64KB。
	buf := make([]byte, 64*1024)
	var written int64
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		n, readErr := readWithIdleTimeout(ctx, resp.Body, buf)
		if n > 0 {
			if _, writeErr := f.Write(buf[:n]); writeErr != nil {
				return writeErr
			}
			written += int64(n)
			progress.advance(int64(n))
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}

	if total > 0 && written != total {
		return fmt.Errorf("下载数据不完整：%d / %d 字节", written, total)
	}
	return nil
}

// ===== 分段 =====

func downloadSegmented(
	ctx context.Context,
	opts DirectOptions,
	resource Resource,
	tempPath, checkpointPath string,
	progress *progressReporter,
) error {
	state := Checkpoint{Resource: resource, Segments: CreateDirectSegments(resource.Total, opts.Connections)}
	resume := false

	// 尝试读回检查点。**任何不一致都要放弃续传**（而不是「尽力而为」）：
	// 把两个不同文件的片段拼起来会产出损坏视频，比丢进度更糟。
	if saved, ok := loadCheckpoint(checkpointPath, resource, tempPath); ok {
		state = saved
		resume = true
	}

	flags := os.O_RDWR | os.O_CREATE
	if !resume {
		flags |= os.O_TRUNC
	}
	f, err := os.OpenFile(tempPath, flags, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()

	if !resume {
		// 预分配到最终大小：避免边下边扩导致的碎片化，
		// 也让「暂停后文件大小」与最终产物一致（用户看的是这个数）
		if err := f.Truncate(resource.Total); err != nil {
			// 预分配失败不是致命错误（有些文件系统不支持），继续即可
			_ = err
		}
	}

	progress.setTotal(resource.Total)

	// 已下载量 = 各段已写入的字节总和（续传时不为 0）
	var done int64
	for _, seg := range state.Segments {
		done += seg.Offset - seg.Start
	}
	if resume {
		progress.setBaseline(done)
	}

	var (
		next     int64
		active   int64
		limit    = int64(opts.Connections)
		mu       sync.Mutex
		cond     = sync.NewCond(&mu)
		firstErr error
	)

	// 并发闸门：`limit` 会在遇到 429/503 时被砍半（见 acquire）
	acquire := func() bool {
		mu.Lock()
		defer mu.Unlock()
		for active >= limit && firstErr == nil && ctx.Err() == nil {
			cond.Wait()
		}
		if firstErr != nil || ctx.Err() != nil {
			return false
		}
		active++
		return true
	}
	release := func() {
		mu.Lock()
		active--
		cond.Broadcast()
		mu.Unlock()
	}
	fail := func(err error) {
		mu.Lock()
		if firstErr == nil {
			firstErr = err
		}
		cond.Broadcast()
		mu.Unlock()
	}
	shrink := func() {
		mu.Lock()
		if limit > 1 {
			limit /= 2
		}
		cond.Broadcast()
		mu.Unlock()
	}

	worker := func() {
		for {
			mu.Lock()
			idx := next
			next++
			mu.Unlock()
			if idx >= int64(len(state.Segments)) {
				return
			}
			seg := &state.Segments[idx]

			for attempt := 0; seg.Offset < seg.End; attempt++ {
				if ctx.Err() != nil || firstErr != nil {
					return
				}
				if !acquire() {
					return
				}
				retryAfter, err := fetchSegment(ctx, opts, resource, seg, f, progress, shrink)
				release()

				if err == nil {
					break
				}
				if ctx.Err() != nil {
					return
				}
				// 范围不符是「服务器不可信」，重试没有意义（见 errRangeMismatch）
				if errors.Is(err, errRangeMismatch) || attempt >= directRetries {
					fail(err)
					return
				}
				wait := time.Duration(attempt+1) * time.Second
				if retryAfter > wait {
					wait = retryAfter
				}
				if wait > 30*time.Second {
					wait = 30 * time.Second
				}
				select {
				case <-ctx.Done():
					return
				case <-time.After(wait):
				}
			}
		}
	}

	workers := opts.Connections
	if workers > len(state.Segments) {
		workers = len(state.Segments)
	}
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			worker()
		}()
	}
	wg.Wait()

	// 无论成功还是失败都要把检查点写下去：暂停时它就是「下次从哪继续」的唯一依据。
	// 用 `.tmp` + rename，避免进程被杀时留下半个 JSON（那会让整段进度作废）。
	saveCheckpoint(checkpointPath, state)

	// 同步到磁盘再返回：调用方（暂停）必须等数据真的落盘，
	// 否则恢复时会读到还没写完的区域。
	if err := f.Sync(); err != nil {
		return err
	}
	if firstErr != nil {
		return firstErr
	}
	return ctx.Err()
}

// fetchSegment 拉取一个分段的剩余部分。
//
// 返回的 retryAfter 用于 429/503（服务器明示要等多久）。
func fetchSegment(
	ctx context.Context,
	opts DirectOptions,
	resource Resource,
	seg *Segment,
	f *os.File,
	progress *progressReporter,
	shrink func(),
) (time.Duration, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, opts.CDNURL, nil)
	if err != nil {
		return 0, err
	}
	for k, v := range directHeaders(opts.PageURL) {
		req.Header.Set(k, v)
	}
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", seg.Offset, seg.End-1))
	// If-Range 让服务器在文件已变时返回 200（而不是错位的 206），
	// 我们从状态码就能发现「内容换了」并放弃这次续传。
	if validator := rangeValidator(resource); validator != "" {
		req.Header.Set("If-Range", validator)
	}

	resp, err := opts.Client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	var retryAfter time.Duration
	if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode == http.StatusServiceUnavailable {
		shrink() // 服务器在限流：降低并发，别把它惹更急
		retryAfter = parseRetryAfter(resp.Header.Get("Retry-After"))
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1024))
		return retryAfter, fmt.Errorf("服务器限流（HTTP %d）", resp.StatusCode)
	}

	if resp.StatusCode != http.StatusPartialContent {
		return 0, fmt.Errorf("下载范围不可用（HTTP %d）", resp.StatusCode)
	}
	if !MatchesDirectRange(resp.Header.Get("Content-Range"), seg.Offset, seg.End, resource.Total) {
		return 0, errRangeMismatch
	}

	buf := make([]byte, 64*1024)
	for seg.Offset < seg.End {
		remaining := seg.End - seg.Offset
		chunk := buf
		if int64(len(chunk)) > remaining {
			chunk = chunk[:remaining]
		}
		n, readErr := readWithIdleTimeout(ctx, resp.Body, chunk)
		if n > 0 {
			// 写到**分段的绝对位置**，多路并发各写各的区间，不需要加锁
			if _, writeErr := f.WriteAt(chunk[:n], seg.Offset); writeErr != nil {
				return 0, writeErr
			}
			seg.Offset += int64(n)
			progress.advance(int64(n))
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return 0, readErr
		}
	}
	if seg.Offset != seg.End {
		return 0, errors.New("分段数据不完整")
	}
	return 0, nil
}

// ===== 辅助 =====

// directHeaders 构造防盗链需要的头。
func directHeaders(pageURL string) map[string]string {
	referer := "https://www.douyin.com/"
	if strings.Contains(pageURL, "kuaishou.com") {
		referer = "https://www.kuaishou.com/"
	}
	return map[string]string{
		"User-Agent": directUserAgent,
		"Referer":    referer,
	}
}

// rangeValidator 返回可用于 If-Range 的校验值。
//
// 弱 ETag（`W/"..."`）**不能**用于 If-Range：RFC 7233 明确要求强校验，
// 用弱校验值会让服务器忽略 Range 头、直接返回整个文件。
func rangeValidator(r Resource) string {
	if r.ETag != "" && !strings.HasPrefix(r.ETag, "W/") {
		return r.ETag
	}
	return r.LastModified
}

// parseRetryAfter 解析 `Retry-After`（秒数或 HTTP 日期）。
func parseRetryAfter(raw string) time.Duration {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	var seconds int
	if _, err := fmt.Sscanf(raw, "%d", &seconds); err == nil && seconds >= 0 {
		return time.Duration(seconds) * time.Second
	}
	if t, err := http.ParseTime(raw); err == nil {
		d := time.Until(t)
		if d > 0 {
			return d
		}
	}
	return 0
}

// loadCheckpoint 读回检查点，并校验它是否仍适用于这次下载。
func loadCheckpoint(path string, resource Resource, tempPath string) (Checkpoint, bool) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return Checkpoint{}, false
	}
	// **必须反序列化成 Checkpoint**，不能先解析成 `any`。
	//
	// `CanResumeDirect(value any, ...)` 内部做的是类型断言
	// `value.(Checkpoint)`；从 `json.Unmarshal` 到 `any` 得到的是
	// `map[string]any`，断言必然失败 → 每个检查点都被判为「不可续传」
	// → **每次暂停后都从零重下**。
	//
	// 这个 bug 不会报错，只会让「续传」静默退化成「重下」。第一版用例
	// 也没抓到（它只比最终字节，从头下完同样正确），后来加了
	// 「有没有请求跳过前半段」的断言 + 变异验证才暴露出来。
	var saved Checkpoint
	if err := json.Unmarshal(raw, &saved); err != nil {
		return Checkpoint{}, false
	}
	info, err := os.Stat(tempPath)
	if err != nil {
		return Checkpoint{}, false
	}
	return CanResumeDirect(saved, resource, info.Size())
}

// saveCheckpoint 原子地写检查点。
func saveCheckpoint(path string, state Checkpoint) {
	raw, err := json.Marshal(state)
	if err != nil {
		return
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return
	}
	_ = os.Rename(tmp, path)
}

// readWithIdleTimeout 读一次，超过 readIdleTimeout 没数据就报错。
//
// 直接在 body 上读会在「连接还在但服务器不再发数据」时永久阻塞
// （CDN 掐断流量时常见），用户看到的是进度卡住且永不报错。
func readWithIdleTimeout(ctx context.Context, body io.Reader, buf []byte) (int, error) {
	type result struct {
		n   int
		err error
	}
	ch := make(chan result, 1)
	go func() {
		n, err := body.Read(buf)
		ch <- result{n, err}
	}()

	timer := time.NewTimer(readIdleTimeout)
	defer timer.Stop()

	select {
	case r := <-ch:
		return r.n, r.err
	case <-ctx.Done():
		return 0, ctx.Err()
	case <-timer.C:
		return 0, errors.New("下载连接读取超时（30 秒没有收到数据）")
	}
}

// ===== 进度节流 =====

// progressReporter 节流进度回调。
//
// 与 IPC 那层同一个理由：每读到 64KB 就回调一次的话，一个大文件会产生
// 上百次/秒的跨语言调用，而界面只需要 5 次/秒。
type progressReporter struct {
	cb       func(DirectProgress)
	total    int64
	baseline int64
	done     int64
	start    time.Time

	mu       sync.Mutex
	lastEmit time.Time
}

func newProgressReporter(cb func(DirectProgress)) *progressReporter {
	return &progressReporter{cb: cb, start: time.Now()}
}

func (p *progressReporter) setTotal(total int64) {
	p.mu.Lock()
	p.total = total
	p.mu.Unlock()
}

// setBaseline 记录「续传时已经有的字节数」。
//
// 它只影响进度分母的呈现，**不计入速度**：那些字节不是本次下的，
// 算进速度会得到一个荒谬的瞬时值（一开始就几十 MB/s）。
func (p *progressReporter) setBaseline(done int64) {
	p.mu.Lock()
	p.baseline = done
	p.done = done
	p.mu.Unlock()
}

func (p *progressReporter) advance(n int64) {
	p.mu.Lock()
	p.done += n
	shouldEmit := time.Since(p.lastEmit) >= 200*time.Millisecond
	p.mu.Unlock()
	if shouldEmit {
		p.emit()
	}
}

func (p *progressReporter) flush(path string) {
	_ = path
	p.mu.Lock()
	p.done = p.total
	p.mu.Unlock()
	p.emit()
}

func (p *progressReporter) emit() {
	if p.cb == nil {
		return
	}
	p.mu.Lock()
	p.lastEmit = time.Now()
	done, total, baseline := p.done, p.total, p.baseline
	p.mu.Unlock()

	elapsed := time.Since(p.start).Seconds()
	// 速度只算本次下载的部分
	fresh := done - baseline
	var speed float64
	if elapsed > 0 && fresh > 0 {
		speed = float64(fresh) / elapsed
	}
	var percent float64
	if total > 0 {
		percent = float64(done) / float64(total) * 100
	}
	var eta int64
	if speed > 0 && total > done {
		eta = int64(float64(total-done) / speed)
	}
	p.cb(DirectProgress{
		Percent:    percent,
		Total:      total,
		Downloaded: done,
		SpeedBps:   speed,
		ETASec:     eta,
		Resumed:    baseline > 0,
	})
}

// 保证 atomic 包被使用（并发计数在 Windows 上曾因对齐问题出过 bug，
// 这里保留 import 以提醒：凡是跨 goroutine 的计数器都应走 atomic）。
var _ = atomic.Int64{}

// 保证 filepath 被使用（调用方通常要拼 `.part` 路径）
var _ = filepath.Join
