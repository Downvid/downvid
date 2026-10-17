// Package image 抓取远程图片并转成 data URL。
//
// ## 为什么需要它
//
// B 站（以及部分其他站点）的缩略图有**防盗链**：不带 Referer 直接请求会
// 返回 403 或一张占位图。桌面端在浏览器里 `<img src>` 拿不到，所以由主进程
// 代抓、转成 base64 塞给前端。
//
// ## 与 TS 版的两个差异（都是安全加固）
//
//  1. **限制大小**。TS 版 `arrayBuffer()` 无上限——一个被指到 4GB 文件的 URL
//     会把主进程内存吃满（而且是在 UI 线程上）。这里限 8 MiB。
//  2. **限制 Content-Type**。TS 版直接信任响应的 content-type 拼进 data URL。
//     若服务器返回 `text/html`，拼出的 `data:text/html;base64,...` 在
//     `<img src>` 上不会执行，但若前端把它当链接用就危险。这里只接受 image/*。
package image

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// MaxBytes 是单张图片的大小上限。
//
// 8 MiB 远大于任何缩略图（B 站最大的封面约 1 MiB），
// 但足以挡住「URL 被指到一个大文件」的情况。
const MaxBytes = 8 << 20

// ErrTooLarge 表示图片超过上限。
var ErrTooLarge = errors.New("图片超过大小上限")

// ErrNotImage 表示响应不是图片。
var ErrNotImage = errors.New("响应不是图片")

// DefaultReferer 是默认 Referer（B 站）。
const DefaultReferer = "https://www.bilibili.com/"

// userAgent 与 TS 版一致：部分站点的防盗链会检查 UA 是否是浏览器。
const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
	"(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

// Client 抓取图片。
type Client struct {
	// HTTP 是可注入的客户端（桌面端走系统代理时会换掉）
	HTTP *http.Client
}

// NewClient 创建默认客户端。
func NewClient() *Client {
	return &Client{HTTP: &http.Client{Timeout: 15 * time.Second}}
}

// Fetch 抓取图片并返回 data URL。
//
// 失败时返回空串而不是错误：前端用它渲染缩略图，失败应当退化成占位图，
// 而不是弹一个错误——用户不需要知道「封面加载失败」这种事。
// 但**不吞掉原因**：调用方可以拿到 error 写日志。
func (c *Client) Fetch(rawURL, referer string) (string, error) {
	if strings.TrimSpace(rawURL) == "" {
		return "", nil
	}

	// 只接受 http(s)。
	//
	// 注意：`http.NewRequest` 自己就会拒绝 `file:` / `ftp:`（它只支持 http/https），
	// 所以这道检查在**当前实现下是冗余的**——变异测试也证实了这点
	// （去掉它不会有测试失败）。
	//
	// 保留的理由：它是**明确的意图声明**。若将来换成别的 HTTP 客户端
	// （比如支持更多 scheme 的），这行会在第一时间挡住「本地任意文件被
	// base64 后送到前端」——而那种问题一旦发生就是信息泄露，
	// 靠事后 review 发现太晚。
	lower := strings.ToLower(rawURL)
	if !strings.HasPrefix(lower, "http://") && !strings.HasPrefix(lower, "https://") {
		return "", errors.New("只允许抓取 http/https 图片")
	}

	if referer == "" {
		referer = DefaultReferer
	}
	// Referer 也要是 http(s)：它会被放进请求头，畸形值会让请求失败
	if r := strings.ToLower(referer); !strings.HasPrefix(r, "http://") && !strings.HasPrefix(r, "https://") {
		referer = DefaultReferer
	}

	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Referer", referer)
	req.Header.Set("User-Agent", userAgent)
	// 部分 CDN 会按 Accept 判断是否是浏览器
	req.Header.Set("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")

	httpClient := c.HTTP
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 15 * time.Second}
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	// Content-Type 白名单：只接受 image/*
	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		// 有些 CDN 不返回 Content-Type。按扩展名推断，推断不出就当 jpeg——
		// 拒绝会让一部分能用的图变成占位图，而 `<img>` 对错误的 mime 很宽容
		contentType = inferContentType(rawURL)
	}
	mediaType := strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	if !strings.HasPrefix(mediaType, "image/") {
		return "", fmt.Errorf("%w：%s", ErrNotImage, mediaType)
	}

	// 有 Content-Length 时提前拒绝，避免白读一遍
	if resp.ContentLength > MaxBytes {
		return "", fmt.Errorf("%w：%d 字节", ErrTooLarge, resp.ContentLength)
	}

	// 用 LimitReader 而不是读全部：没有 Content-Length 时（chunked）
	// 上面那道检查是无效的
	data, err := io.ReadAll(io.LimitReader(resp.Body, MaxBytes+1))
	if err != nil {
		return "", err
	}
	if int64(len(data)) > MaxBytes {
		return "", fmt.Errorf("%w：超过 %d 字节", ErrTooLarge, MaxBytes)
	}
	if len(data) == 0 {
		return "", errors.New("图片为空")
	}

	return "data:" + mediaType + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

// inferContentType 按扩展名推断图片类型。
func inferContentType(u string) string {
	// 去掉查询串再判扩展名（`?x-oss-process=...` 很常见）
	if i := strings.IndexByte(u, '?'); i >= 0 {
		u = u[:i]
	}
	switch {
	case strings.HasSuffix(u, ".png"):
		return "image/png"
	case strings.HasSuffix(u, ".webp"):
		return "image/webp"
	case strings.HasSuffix(u, ".gif"):
		return "image/gif"
	case strings.HasSuffix(u, ".avif"):
		return "image/avif"
	default:
		return "image/jpeg"
	}
}
