// Package deps 管理运行依赖（yt-dlp / ffmpeg / ffprobe / aria2）的探测与下载。
//
// ## 为什么这一层不能省
//
// 安装包**不再携带**这三个二进制（此前每架构约 80MB，仓库靠 Git LFS 膨胀到 800MB+）。
// 启动后由 Go 边车按「系统优先，缺失才下载」的顺序解析。所以「下载依赖」不是
// 可选功能——它是「应用能不能用」的前提。
//
// ## 与边车的分工
//
// 探测与下载的**真实逻辑都在边车**（`backend/internal/{probe,runtime,fetch}`）：
// 候选路径表、镜像回退、SHA-256 校验、解压、原子替换、macOS 的
// xattr/codesign 处理，全在那边。这一层只做两件事：
//  1. 起边车进程，把参数拼对
//  2. 把边车输出的 NDJSON 逐行转成事件（**流式**，不是等进程结束）
//
// 照搬 `electron/utils/runtime.ts` 的分工，不重复实现候选表——
// 那正是「依赖页说装了、加速页说没装」的来源。
package deps

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Kind 是依赖种类。
type Kind = string

const (
	KindYtdlp   Kind = "yt-dlp"
	KindFfmpeg  Kind = "ffmpeg"
	KindFfprobe Kind = "ffprobe"
	KindAria2   Kind = "aria2"
)

// AllKinds 是全部依赖（顺序即展示顺序）。
var AllKinds = []Kind{KindYtdlp, KindFfmpeg, KindFfprobe, KindAria2}

// Optional 标记非必需依赖。
//
// ffprobe 只在部分后处理场景用到（合并时读时长/轨道）；aria2 只是加速引擎。
// 缺了它们应用仍能下载，只是功能与速度退化——界面上不该把它们标成「缺少」。
var Optional = map[Kind]bool{
	KindFfprobe: true,
	KindAria2:   true,
}

// Status 是单个依赖的探测结果。
type Status struct {
	Kind     Kind   `json:"kind"`
	Found    bool   `json:"found"`
	Optional bool   `json:"optional,omitempty"`
	Path     string `json:"path,omitempty"`
	Version  string `json:"version,omitempty"`
	Source   string `json:"source,omitempty"` // system / managed / manual / scanned
	Reason   string `json:"reason,omitempty"`
	// Stale 表示「找到了但版本过旧」，与「没找到」要分开提示
	Stale bool `json:"stale,omitempty"`
	// Form 仅对 yt-dlp 有意义（zipapp 启动 0.4s / native 首次 9~12s）
	Form string `json:"form,omitempty"`
}

// Snapshot 是一次完整探测结果。
type Snapshot struct {
	Platform   string   `json:"platform"`
	ManagedDir string   `json:"managedDir"`
	CheckedAt  int64    `json:"checkedAt"`
	Results    []Status `json:"results"`
	// Path 是边车合并「当前进程 + 登录 shell」后的 PATH。
	//
	// 宿主 App 自己也会起 yt-dlp / ffmpeg（不是每次都经边车），而 GUI 进程
	// 的 PATH 通常只有 /usr/bin:/bin:/usr/sbin:/sbin。托管目录里的 yt-dlp 是
	// zipapp，靠 shebang 找 python3：只看到系统 Python 3.9 时会直接
	// ImportError。用边车解析好的同一份 PATH，两端行为才一致。
	Path string `json:"path,omitempty"`
}

// Progress 是下载过程中的一次事件（对应边车的 fetch.Event）。
type Progress struct {
	Event      string `json:"event"` // progress / done / error / mirror / retry
	Tool       string `json:"tool,omitempty"`
	Downloaded int64  `json:"downloaded,omitempty"`
	Total      int64  `json:"total,omitempty"`
	Path       string `json:"path,omitempty"`
	Message    string `json:"message,omitempty"`
}

// FetchOptions 是下载依赖的参数。
type FetchOptions struct {
	// Only 为空表示全部；否则只装指定的
	Only []Kind
	// Force 已存在也重新下载
	Force bool
	// Proxy 可选
	Proxy string
	// Mirror 下载源：`auto` 沿镜像链降级，或钉死某个镜像 ID
	Mirror string
	// Timeout 总时限
	Timeout time.Duration
}

// Manager 管理边车进程与探测缓存。
type Manager struct {
	sidecarPath string
	managedDir  string

	mu       sync.Mutex
	cache    *Snapshot
	cachedAt time.Time
	inflight *sync.WaitGroup
	// active 是正在进行的下载（用于取消）
	active    *exec.Cmd
	activeCtx context.Context
	canceling bool
}

// 探测结果缓存 60 秒：界面切来切去时不必反复起边车。
//
// 每次探测都要真的执行 yt-dlp / ffmpeg（验证能跑），而托管副本的
// PyInstaller 构建首次启动 8~12 秒，无缓存的话每次切页面都要等。
const cacheTTL = 60 * time.Second

// NewManager 创建管理器。
//
// sidecarPath 为空时所有方法返回「边车缺失」的错误——
// 打包漏了边车是真实发生过的事故，必须如实报，不能假装成功。
func NewManager(sidecarPath, managedDir string) *Manager {
	return &Manager{sidecarPath: sidecarPath, managedDir: managedDir}
}

// ErrNoSidecar 表示边车不存在。
var ErrNoSidecar = errors.New("依赖探测程序缺失（downvid-deps 未打包），无法检测或下载依赖")

// Detect 探测所有依赖。
//
// force 为 true 时忽略缓存。
func (m *Manager) Detect(force bool) (*Snapshot, error) {
	if m.sidecarPath == "" {
		return nil, ErrNoSidecar
	}

	m.mu.Lock()
	if !force && m.cache != nil && time.Since(m.cachedAt) < cacheTTL {
		snap := m.cache
		m.mu.Unlock()
		return snap, nil
	}
	m.mu.Unlock()

	args := []string{"detect", "--managed-dir", m.managedDir, "--json"}
	out, err := m.runSidecar(90*time.Second, args...)
	if err != nil {
		return nil, err
	}

	var payload struct {
		Platform   string   `json:"platform"`
		ManagedDir string   `json:"managedDir"`
		Path       string   `json:"path"`
		Results    []Status `json:"results"`
	}
	if err := json.Unmarshal([]byte(out), &payload); err != nil {
		return nil, fmt.Errorf("探测结果解析失败：%w", err)
	}

	snap := &Snapshot{
		Platform:   payload.Platform,
		ManagedDir: payload.ManagedDir,
		CheckedAt:  time.Now().UnixMilli(),
		Results:    payload.Results,
		Path:       payload.Path,
	}

	m.mu.Lock()
	m.cache = snap
	m.cachedAt = time.Now()
	m.mu.Unlock()

	return snap, nil
}

// InvalidateCache 清掉探测缓存（下载完成后调，让界面看到新状态）。
func (m *Manager) InvalidateCache() {
	m.mu.Lock()
	m.cache = nil
	m.cachedAt = time.Time{}
	m.mu.Unlock()
}

// Install 下载并安装依赖。
//
// **流式**推送进度：边车每完成一块就写一行 NDJSON，这里逐行读并回调。
// 等进程结束再一次性解析的话，界面在整个下载期间（可能几分钟）都看不到进度。
func (m *Manager) Install(opts FetchOptions, onProgress func(Progress)) error {
	if m.sidecarPath == "" {
		return ErrNoSidecar
	}

	m.mu.Lock()
	if m.active != nil {
		m.mu.Unlock()
		return errors.New("已有依赖下载正在进行")
	}
	ctx, cancel := context.WithCancel(context.Background())
	m.activeCtx = ctx
	m.canceling = false
	m.mu.Unlock()

	defer func() {
		cancel()
		m.mu.Lock()
		m.active = nil
		m.activeCtx = nil
		m.mu.Unlock()
	}()

	args := []string{"fetch", "--managed-dir", m.managedDir}
	if len(opts.Only) > 0 {
		names := make([]string, len(opts.Only))
		for i, k := range opts.Only {
			names[i] = string(k)
		}
		args = append(args, "--only", strings.Join(names, ","))
	}
	if opts.Force {
		args = append(args, "--force")
	}
	if opts.Proxy != "" {
		args = append(args, "--proxy", opts.Proxy)
	}
	if opts.Mirror != "" {
		args = append(args, "--mirror", opts.Mirror)
	}

	timeout := opts.Timeout
	if timeout <= 0 {
		// 默认 10 分钟：一个 37MB 的 yt-dlp + 80MB 的 ffmpeg，慢网络下需要时间
		timeout = 10 * time.Minute
	}
	runCtx, runCancel := context.WithTimeout(ctx, timeout)
	defer runCancel()

	cmd := exec.CommandContext(runCtx, m.sidecarPath, args...)
	hideWindow(cmd)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}

	m.mu.Lock()
	m.active = cmd
	m.mu.Unlock()

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("无法启动依赖下载程序：%w", err)
	}

	// 边车的约定：**stdout 只放 JSON，日志走 stderr**。
	// 所以 stdout 逐行解析、stderr 只收集（出错时附在错误里）。
	var stderrBuf strings.Builder
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		sc := bufio.NewScanner(stdout)
		sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			// 只处理 JSON 对象行。前缀检查与 json.Unmarshal 的失败是**冗余**的
			// （后者本来就会拒绝非 JSON），保留它是为了省掉「在日志行上白跑一次
			// 解析器」的开销——边车的日志量不小，全量尝试解析会明显变慢。
			if line == "" || !strings.HasPrefix(line, "{") {
				continue
			}
			var p Progress
			if err := json.Unmarshal([]byte(line), &p); err != nil {
				// 单行解析失败不该中断整个下载——继续读下一行
				continue
			}
			if onProgress != nil {
				onProgress(p)
			}
		}
	}()

	go func() {
		defer wg.Done()
		buf := make([]byte, 4096)
		for {
			n, err := stderr.Read(buf)
			if n > 0 {
				stderrBuf.Write(buf[:n])
			}
			if err != nil {
				return
			}
		}
	}()

	wg.Wait()
	waitErr := cmd.Wait()

	m.mu.Lock()
	wasCanceling := m.canceling
	m.canceling = false
	m.mu.Unlock()

	if wasCanceling {
		return errors.New("已取消")
	}
	if runCtx.Err() == context.DeadlineExceeded {
		return errors.New("依赖下载超时，请检查网络后重试")
	}
	if waitErr != nil {
		// 边车用 cli.Fail 输出 `{"event":"error","message":...}` 后 os.Exit(1)，
		// 所以真正的错误在 stdout 里已经通过 onProgress 给出；
		// 这里的 stderr 只用于补足上下文
		msg := strings.TrimSpace(stderrBuf.String())
		if msg != "" {
			if lines := strings.Split(msg, "\n"); len(lines) > 0 {
				msg = lines[len(lines)-1]
			}
			return fmt.Errorf("依赖下载失败：%s", msg)
		}
		return fmt.Errorf("依赖下载失败：%w", waitErr)
	}

	// 下载完成后清缓存：界面上必须立刻看到新状态
	m.InvalidateCache()
	return nil
}

// Cancel 取消正在进行的下载。
//
// 边车收到 SIGTERM 后会自己清理 `.part`，所以这里不需要额外清理。
func (m *Manager) Cancel() bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.activeCtx == nil || m.active == nil {
		return false
	}
	m.canceling = true
	if m.active.Process != nil {
		_ = m.active.Process.Signal(os.Interrupt)
	}
	return true
}

// IsDownloading 报告是否有下载在进行。
func (m *Manager) IsDownloading() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.active != nil
}

// ManagedDir 返回托管目录（界面上的「打开目录」用它）。
func (m *Manager) ManagedDir() string { return m.managedDir }

// runSidecar 执行边车并返回 stdout（一次性，用于 detect）。
func (m *Manager) runSidecar(timeout time.Duration, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, m.sidecarPath, args...)
	hideWindow(cmd)

	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg != "" {
			if lines := strings.Split(msg, "\n"); len(lines) > 0 {
				msg = lines[len(lines)-1]
			}
			return stdout.String(), fmt.Errorf("%v：%s", err, msg)
		}
		return stdout.String(), err
	}
	return stdout.String(), nil
}

// Summarize 把探测结果压成「缺什么」的一句话。
//
// 只算**必需**依赖：把可选依赖说成「缺少」会让用户以为应用坏了。
func Summarize(snap *Snapshot) (missing []Kind, stale []Kind) {
	if snap == nil {
		return nil, nil
	}
	for _, r := range snap.Results {
		if Optional[r.Kind] {
			continue
		}
		if !r.Found {
			missing = append(missing, r.Kind)
		} else if r.Stale {
			stale = append(stale, r.Kind)
		}
	}
	return missing, stale
}

// FormatBytes 把字节数转成展示字符串（与下载进度用同一套规则）。
func FormatBytes(n int64) string {
	if n <= 0 {
		return ""
	}
	const (
		kb = 1024
		mb = kb * 1024
		gb = mb * 1024
	)
	switch {
	case n >= gb:
		return fmt.Sprintf("%.2f GB", float64(n)/gb)
	case n >= mb:
		return fmt.Sprintf("%.1f MB", float64(n)/mb)
	default:
		return fmt.Sprintf("%d KB", (n+512)/kb)
	}
}

var _ = io.Discard
var _ = filepath.Join
