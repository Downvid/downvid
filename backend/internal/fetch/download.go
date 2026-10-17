// Package fetch 负责下载并安装 yt-dlp / ffmpeg / ffprobe 到托管目录。
//
// 下载先落到临时文件并做 SHA-256 校验，校验通过后才解压并原子重命名，
// 因此不会因为网络中断或损坏的镜像而装上一个半成品可执行文件。
package fetch

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

// Event 一条进度事件，CLI 会逐行输出为 NDJSON
type Event struct {
	Event      string `json:"event"`
	Tool       string `json:"tool,omitempty"`
	Downloaded int64  `json:"downloaded,omitempty"`
	Total      int64  `json:"total,omitempty"`
	Path       string `json:"path,omitempty"`
	Message    string `json:"message,omitempty"`
}

// Emitter 接收进度事件
type Emitter func(Event)

// Task 一次安装任务
type Task struct {
	Tool   string // yt-dlp / ffmpeg / ffprobe / aria2
	URL    string
	SHA256 string // 下载内容的校验值（压缩包时为压缩文件的哈希）
	Gzip   bool   // 单成员 gzip 流（ffmpeg-static 的产物）
	// ZipInner 非空表示下载物是 zip 包，安装时取包内该文件名。
	// aria2 的静态构建是 zip（内含单个 aria2c[.exe]），与 gzip 的「裸流」不同：
	// 硬塞给 gunzipFile 会解不开，而错误信息只会说「解压失败」，很难归因。
	ZipInner string
	// TarInner 同理，用于 .tar.gz（macOS 的 aria2 构建是 tar.gz）。
	// 与 ZipInner 互斥；两者都为空时下载物本身就是可执行文件。
	TarInner string
	Target   string // 最终安装路径
}

// Options 下载选项
type Options struct {
	Proxy      string
	Timeout    time.Duration
	Retries    int
	HTTPClient *http.Client
	Emit       Emitter
	// SkipSign 跳过 macOS 的 ad-hoc 签名（测试用）
	SkipSign bool
	// Mirror 镜像偏好：""/"auto" 走完整链路，其余钉死某个镜像 ID（见 MirrorPreference）。
	// 钉死时不回退，用于排查是哪个镜像在捣乱。
	Mirror string
}

// retryable 判断这次失败是否值得重试。
//
// 只有**网络层**失败才重试：`connect: connection refused`、TLS 握手失败、
// 超时、连接被重置……这些是瞬时或路径问题，换一次可能就好。
// 反过来，几乎全部依赖都托管在同一个 GitHub Release 上，
// 让一份 37MB 的文件在完全连不通时重试三次（每次还要等 2 秒、4 秒退避），
// 结果是用户盯着界面等半分钟才看到同一句错误。
func retryable(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	for _, bad := range []string{
		"校验失败",           // 字节不对：重下同一地址大概率还是不对，交给镜像回退
		"http 4",         // 4xx（404 / 403）重试没有意义
		"unexpected eof", // 内容被截断：先换镜像
	} {
		if strings.Contains(msg, bad) {
			return false
		}
	}
	return true
}

func (o *Options) emit(e Event) {
	if o.Emit != nil {
		o.Emit(e)
	}
}

func (o *Options) client() (*http.Client, error) {
	if o.HTTPClient != nil {
		return o.HTTPClient, nil
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if o.Proxy != "" {
		u, err := url.Parse(o.Proxy)
		if err != nil {
			return nil, fmt.Errorf("代理地址无效：%w", err)
		}
		transport.Proxy = http.ProxyURL(u)
	} else {
		transport.Proxy = http.ProxyFromEnvironment
	}
	timeout := o.Timeout
	if timeout <= 0 {
		timeout = 30 * time.Minute
	}
	return &http.Client{Transport: transport, Timeout: timeout}, nil
}

// Install 依次执行全部任务；任一任务失败即返回，已完成的任务保留
func Install(ctx context.Context, tasks []Task, opts Options) error {
	if len(tasks) == 0 {
		return errors.New("没有需要下载的依赖")
	}
	client, err := opts.client()
	if err != nil {
		return err
	}
	opt := opts
	opt.HTTPClient = client

	for _, task := range tasks {
		opt.emit(Event{Event: "start", Tool: task.Tool})
		if err := installOne(ctx, task, opt); err != nil {
			opt.emit(Event{Event: "error", Tool: task.Tool, Message: err.Error()})
			return fmt.Errorf("%s：%w", task.Tool, err)
		}
		opt.emit(Event{Event: "installed", Tool: task.Tool, Path: task.Target})
	}
	return nil
}

func installOne(ctx context.Context, task Task, opts Options) error {
	if task.Target == "" {
		return errors.New("安装路径为空")
	}
	if err := os.MkdirAll(filepath.Dir(task.Target), 0o755); err != nil {
		return fmt.Errorf("创建目录失败：%w", err)
	}

	// 先下到临时文件，校验/解压通过后再原子替换目标文件
	staging := task.Target + ".part"
	switch {
	case task.Gzip:
		staging += ".gz"
	case task.ZipInner != "":
		staging += ".zip"
	case task.TarInner != "":
		staging += ".tar.gz"
	}
	_ = os.Remove(staging)
	defer os.Remove(staging)

	retries := opts.Retries
	if retries <= 0 {
		retries = 3
	}

	// 沿镜像链逐个尝试：每个镜像内部再按 retries 重试瞬时错误。
	//
	// 顺序是「先试完当前镜像的重试，再换下一个镜像」而不是「每轮换一个镜像」：
	// 网络抖动是瞬时的（同一个地址重试常常就好），而镜像不通是**路径**问题
	// （重试多少次都不通）。两类失败分开处理，总耗时才可控。
	var lastErr error
	chain := MirrorChain(opts.Mirror)
	for _, mirror := range chain {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		url := mirrorURL(mirror, task.URL)
		// 只有在**真的换了一条路**时才提示。首个候选就是直连（或地址不需要改写），
		// 那时还没失败过，报「改用镜像」只会让用户以为直连已经挂了。
		if len(chain) > 1 && mirror.Prefix != "" && lastErr != nil {
			opts.emit(Event{Event: "mirror", Tool: task.Tool, Message: "改用镜像 " + mirror.Name})
		}

		for attempt := 1; attempt <= retries; attempt++ {
			if attempt > 1 {
				opts.emit(Event{Event: "retry", Tool: task.Tool, Message: fmt.Sprintf("第 %d 次重试", attempt)})
				select {
				case <-time.After(time.Duration(attempt-1) * 2 * time.Second):
				case <-ctx.Done():
					return ctx.Err()
				}
			}
			lastErr = fetchOnceURL(ctx, task, url, staging, opts)
			if lastErr == nil {
				break
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if !retryable(lastErr) {
				break
			}
		}
		if lastErr == nil {
			break
		}
	}

	if lastErr != nil {
		// 全部镜像都失败时，把「试过哪些」说清楚：用户据此判断是换网络还是
		// 等一会儿再试，而不是反复点「下载」期待不同结果。
		if len(chain) > 1 {
			return fmt.Errorf("%w\n\n提示：已尝试 %d 个下载源（GitHub 与公共镜像）均失败，请检查网络或代理后重试。", lastErr, len(chain))
		}
		return lastErr
	}
	return promote(task, staging)
}

// fetchOnceURL 从指定的一个地址下载并校验，结果写到 staging。
func fetchOnceURL(ctx context.Context, task Task, url, staging string, opts Options) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "DownVid (+https://github.com/yxxbc/downvid)")

	res, err := opts.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("网络请求失败：%s%s", sanitizeURL(err.Error()), networkHint(err))
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("下载失败：HTTP %d %s", res.StatusCode, res.Status)
	}

	file, err := os.Create(staging)
	if err != nil {
		return fmt.Errorf("创建临时文件失败：%w", err)
	}

	hasher := sha256.New()
	counter := newProgressCounter(task.Tool, res.ContentLength, opts.emit)
	_, copyErr := io.Copy(io.MultiWriter(file, hasher, counter), res.Body)
	closeErr := file.Close()
	if copyErr != nil {
		return fmt.Errorf("下载中断：%w", copyErr)
	}
	if closeErr != nil {
		return fmt.Errorf("写入文件失败：%w", closeErr)
	}

	if task.SHA256 != "" {
		got := hex.EncodeToString(hasher.Sum(nil))
		if !strings.EqualFold(got, task.SHA256) {
			return fmt.Errorf("校验失败：期望 %s…，实际 %s…", short(task.SHA256), short(got))
		}
	}
	return nil
}

// promote 解压（如需要）、赋权并原子替换目标文件
func promote(task Task, staging string) error {
	source := staging
	if task.Gzip {
		decompressed := staging[:len(staging)-3] // 去掉 .gz
		if err := gunzipFile(staging, decompressed); err != nil {
			return err
		}
		defer os.Remove(decompressed)
		source = decompressed
	} else if task.ZipInner != "" {
		extracted, err := extractZipMember(staging, task.ZipInner)
		if err != nil {
			return err
		}
		defer os.Remove(extracted)
		source = extracted
	} else if task.TarInner != "" {
		extracted, extractErr := extractTarGzMember(staging, task.TarInner)
		if extractErr != nil {
			return extractErr
		}
		defer os.Remove(extracted)
		source = extracted
	}

	if err := os.Chmod(source, 0o755); err != nil {
		return fmt.Errorf("设置执行权限失败：%w", err)
	}
	// 先删旧文件：Windows 上无法覆盖正在运行的 exe，但可以重命名
	_ = os.Remove(task.Target)
	if err := os.Rename(source, task.Target); err != nil {
		return fmt.Errorf("替换 %s 失败：%w", task.Target, err)
	}
	return nil
}

// extractZipMember 从 zip 包里取出指定文件，返回解包后的路径。
//
// 只取包内**一个**已知文件名（aria2 的静态构建就是这样打包的），
// 并且**拒绝目录穿越**：包内名字若含 `..` 或绝对路径，直接报错。
// 用 zip 包而不是自己拼一个可执行文件，是因为上游只提供 zip。
func extractZipMember(archive, name string) (string, error) {
	r, err := zip.OpenReader(archive)
	if err != nil {
		return "", fmt.Errorf("解压失败：%w", err)
	}
	defer r.Close()

	for _, f := range r.File {
		base := filepath.Base(f.Name)
		if base != name {
			continue
		}
		if f.FileInfo().IsDir() || strings.Contains(f.Name, "..") || filepath.IsAbs(f.Name) {
			return "", errors.New("解压失败：压缩包内路径不安全")
		}
		rc, err := f.Open()
		if err != nil {
			return "", fmt.Errorf("解压失败：%w", err)
		}
		defer rc.Close()

		out := archive + "." + base
		dst, err := os.OpenFile(out, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
		if err != nil {
			return "", fmt.Errorf("创建文件失败：%w", err)
		}
		if _, err := io.Copy(dst, rc); err != nil {
			dst.Close()
			os.Remove(out)
			return "", fmt.Errorf("解压失败：%w", err)
		}
		if err := dst.Close(); err != nil {
			os.Remove(out)
			return "", fmt.Errorf("写入文件失败：%w", err)
		}
		return out, nil
	}
	return "", fmt.Errorf("解压失败：压缩包内缺少 %s", name)
}

// extractTarGzMember 从 .tar.gz 里取出指定文件。
//
// 与 extractZipMember 同样的两条约束：只取**一个**已知文件名，
// 并且拒绝目录穿越（包内名字含 `..` 或绝对路径直接报错）。
// 用 tar.gz 而不是 zip 是因为 macOS 的 aria2 构建只发 tar.gz。
func extractTarGzMember(archive, name string) (string, error) {
	f, err := os.Open(archive)
	if err != nil {
		return "", fmt.Errorf("打开临时文件失败：%w", err)
	}
	defer f.Close()

	gz, err := gzip.NewReader(f)
	if err != nil {
		return "", fmt.Errorf("解压失败：%w", err)
	}
	defer gz.Close()

	tr := tar.NewReader(gz)
	for {
		header, nextErr := tr.Next()
		if nextErr == io.EOF {
			break
		}
		if nextErr != nil {
			return "", fmt.Errorf("解压失败：%w", nextErr)
		}
		if filepath.Base(header.Name) != name {
			continue
		}
		if header.Typeflag == tar.TypeDir || strings.Contains(header.Name, "..") || filepath.IsAbs(header.Name) {
			return "", errors.New("解压失败：压缩包内路径不安全")
		}
		out := archive + "." + name
		dst, createErr := os.OpenFile(out, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
		if createErr != nil {
			return "", fmt.Errorf("创建文件失败：%w", createErr)
		}
		// 限制单文件大小：上游包很小，限一个宽松的上界防止被塞进一个巨大文件
		if _, copyErr := io.Copy(dst, io.LimitReader(tr, 256<<20)); copyErr != nil {
			dst.Close()
			os.Remove(out)
			return "", fmt.Errorf("解压失败：%w", copyErr)
		}
		if closeErr := dst.Close(); closeErr != nil {
			os.Remove(out)
			return "", fmt.Errorf("写入文件失败：%w", closeErr)
		}
		return out, nil
	}
	return "", fmt.Errorf("解压失败：压缩包内缺少 %s", name)
}

// gunzipFile 解压单成员 gzip；ffmpeg-static 发布的就是裸 gzip 流（不是 tar.gz）
func gunzipFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("打开临时文件失败：%w", err)
	}
	defer in.Close()

	zr, err := gzip.NewReader(in)
	if err != nil {
		return errors.New("解压失败：" + err.Error())
	}
	defer zr.Close()

	out, err := os.Create(dst)
	if err != nil {
		return fmt.Errorf("创建文件失败：%w", err)
	}
	if _, err := io.Copy(out, zr); err != nil {
		out.Close()
		os.Remove(dst)
		return fmt.Errorf("解压失败：%w", err)
	}
	if err := out.Close(); err != nil {
		os.Remove(dst)
		return fmt.Errorf("写入文件失败：%w", err)
	}
	return nil
}

// Finalize 做安装后的平台处理：macOS 清理隔离属性并 ad-hoc 签名。
// 从网络下载的可执行文件带 com.apple.quarantine，在 Apple Silicon 上会直接 "killed: 9"。
func Finalize(path string, opts Options, emit Emitter) {
	if runtime.GOOS != "darwin" || opts.SkipSign {
		return
	}
	if emit == nil {
		emit = func(Event) {}
	}
	if err := runQuiet("xattr", "-c", path); err != nil {
		emit(Event{Event: "warn", Message: "清理隔离属性失败：" + err.Error()})
	}
	if err := runQuiet("codesign", "--force", "--sign", "-", path); err != nil {
		emit(Event{Event: "warn", Message: "ad-hoc 签名失败：" + err.Error()})
	}
}

func runQuiet(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	hideWindow(cmd)
	out, err := cmd.CombinedOutput()
	if err != nil {
		if msg := strings.TrimSpace(string(out)); msg != "" {
			return errors.New(msg)
		}
		return err
	}
	return nil
}

// progressCounter 按 1% 的步进上报进度，避免刷屏
type progressCounter struct {
	tool    string
	total   int64
	written int64
	lastPct int64
	emit    Emitter
}

func newProgressCounter(tool string, total int64, emit Emitter) *progressCounter {
	return &progressCounter{tool: tool, total: total, emit: emit}
}

func (w *progressCounter) Write(p []byte) (int, error) {
	w.written += int64(len(p))
	if w.emit != nil {
		pct := int64(-1)
		if w.total > 0 {
			pct = w.written * 100 / w.total
		}
		if pct != w.lastPct {
			w.lastPct = pct
			w.emit(Event{Event: "progress", Tool: w.tool, Downloaded: w.written, Total: w.total})
		}
	}
	return len(p), nil
}

func short(hash string) string {
	if len(hash) <= 12 {
		return hash
	}
	return hash[:12]
}

// reQueryString 匹配 URL 的查询串
var reQueryString = regexp.MustCompile(`\?[^\s"]*`)

// sanitizeURL 去掉 URL 的查询串。
//
// GitHub 的下载地址会带一串超长签名 JWT，直接展示给用户既看不懂也占满界面，
// 只保留 主机/路径 就够了。
func sanitizeURL(msg string) string {
	return reQueryString.ReplaceAllString(msg, "")
}

// networkHint 针对常见网络故障补一句可执行的建议
func networkHint(err error) string {
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "proxyconnect"), strings.Contains(msg, "proxy"):
		return "\n\n提示：代理不可用，请在「设置 → 代理」中检查代理地址后重试。"
	case strings.Contains(msg, "tls"), strings.Contains(msg, "timeout"), strings.Contains(msg, "deadline"):
		return "\n\n提示：连接超时。若所在网络需要代理，请在「设置 → 代理」中配置后重试。"
	}
	return ""
}
