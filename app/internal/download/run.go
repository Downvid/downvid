// Package download —— 执行 yt-dlp 下载。
//
// 本文件是 electron/download/ytdlp.ts 的 `runYtdlpDownload` 的 Go 移植。
//
// ## 与原实现对齐的四件事
//
//  1. **spawn 时设进程组**（`SetProcessGroup`）：暂停要能一次信号收掉整棵树
//     （yt-dlp 与它拉的 aria2c / ffmpeg）。不设的话暂停后 aria2c 变孤儿继续写文件，
//     而且会把 `.aria2` 控制文件写坏，恢复时从零重下整个文件。
//  2. **stdout 与 stderr 都按行解析**：`--print` 隐含 `--quiet`，后处理进度走 stderr。
//  3. **进度模板可能半行到达**：TCP/管道的分块边界不保证按行，必须自己缓冲。
//     原 TS 实现里有个 `pending` 变量专门处理这个，Go 版用 `lineReader`。
//  4. **下载未开始就失败时回退为 URL**：解析阶段缓存的 info JSON 可能已过期
//     （CDN 直链有时效），回退重试比直接报错好。
package download

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// RunOptions 是一次下载的执行参数。
type RunOptions struct {
	// YtdlpPath 是 yt-dlp 可执行文件路径
	YtdlpPath string
	// Args 是 BuildArgs 的结果（不含 URL 与 cookie 参数）
	Args []string
	// URL 是目标地址（拼在最后）
	URL string
	// CookieArgs 是 cookie 相关参数，拼在 URL 之前
	CookieArgs []string
	// OutputDir 是输出目录
	OutputDir string
	// WantSubtitles 用于从字幕输出里挑语言
	WantSubtitles []string
	// OnEvent 每条解析出的事件都会回调（由调用方决定怎么发出去）
	OnEvent func(Event)
	// Timeout 是总超时。0 表示不限制
	Timeout time.Duration
}

// RunResult 是一次下载的结果。
type RunResult struct {
	// Code 是退出码。nil 表示被信号终止（暂停）
	Code *int
	// Stderr 是累积的错误输出（用于诊断）
	Stderr string
	// FilePath 是最终产物路径（可能为空，视 yt-dlp 输出而定）
	FilePath string
	// Paused 表示是被主动终止的
	Paused bool
	// StartErr 是**尚未开始下载**就失败时的错误（调用方可据此回退重试）
	StartErr error
}

// Runner 管理正在运行的下载，支持按任务终止。
type Runner struct {
	mu      sync.Mutex
	running map[string]*runningTask
}

type runningTask struct {
	cmd     *exec.Cmd
	paused  bool
	started bool
}

// NewRunner 创建下载管理器。
func NewRunner() *Runner {
	return &Runner{running: map[string]*runningTask{}}
}

// ErrAlreadyRunning 表示同一任务已有下载在进行。
var ErrAlreadyRunning = errors.New("该任务已在下载中")

// Run 执行一次下载（阻塞直到结束）。
//
// taskID 用于暂停与清理；调用方必须保证同一 taskID 不会并发 Run。
func (r *Runner) Run(taskID string, opts RunOptions) (RunResult, error) {
	if opts.YtdlpPath == "" {
		return RunResult{}, errors.New("缺少 yt-dlp 路径")
	}

	r.mu.Lock()
	if _, exists := r.running[taskID]; exists {
		r.mu.Unlock()
		return RunResult{}, ErrAlreadyRunning
	}
	task := &runningTask{}
	r.running[taskID] = task
	r.mu.Unlock()

	defer func() {
		r.mu.Lock()
		delete(r.running, taskID)
		r.mu.Unlock()
	}()

	ctx := context.Background()
	var cancel context.CancelFunc
	if opts.Timeout > 0 {
		ctx, cancel = context.WithTimeout(ctx, opts.Timeout)
		defer cancel()
	}

	// URL 拼在最后：与 TS 的 `spawn(ytdlp, [...args, ...cookieArgs, url])` 一致。
	// 顺序错了 yt-dlp 会把 URL 当成又一个选项值，不报错但行为变了。
	argv := append([]string{}, opts.Args...)
	argv = append(argv, opts.CookieArgs...)
	argv = append(argv, opts.URL)

	cmd := exec.CommandContext(ctx, opts.YtdlpPath, argv...)
	cmd.Dir = opts.OutputDir
	// 成为新进程组的组长：暂停时对 -pid 发信号才能收掉整棵树
	SetProcessGroup(cmd, "")

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return RunResult{}, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return RunResult{}, err
	}

	if err := cmd.Start(); err != nil {
		return RunResult{}, fmt.Errorf("无法启动 yt-dlp：%w", err)
	}

	r.mu.Lock()
	task.cmd = cmd
	r.mu.Unlock()

	var stderrBuf strings.Builder
	state := &LineState{}
	var filePath string
	var emitMu sync.Mutex

	emit := func(ev Event) {
		if ev.Kind == "file" && ev.FilePath != "" {
			emitMu.Lock()
			filePath = ev.FilePath
			emitMu.Unlock()
		}
		if ev.Kind != "ignored" && opts.OnEvent != nil {
			opts.OnEvent(ev)
		}
		if ev.Kind == "progress" || ev.Kind == "merging" {
			r.mu.Lock()
			task.started = true
			r.mu.Unlock()
		}
	}

	// stdout 与 stderr 都要读：`--print` 隐含 `--quiet`，后处理进度走 stderr。
	// 串行读会死锁（管道填满后子进程阻塞），必须各起一个协程。
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		readLines(stdout, func(line string) { emit(ParseLine(line, state, opts.WantSubtitles)) })
	}()
	go func() {
		defer wg.Done()
		readLines(stderr, func(line string) {
			stderrBuf.WriteString(line)
			stderrBuf.WriteString("\n")
			emit(ParseLine(line, state, opts.WantSubtitles))
		})
	}()

	wg.Wait()
	waitErr := cmd.Wait()

	r.mu.Lock()
	paused := task.paused
	started := task.started
	r.mu.Unlock()

	res := RunResult{Stderr: stderrBuf.String(), FilePath: filePath, Paused: paused}

	if waitErr != nil {
		var exitErr *exec.ExitError
		if errors.As(waitErr, &exitErr) {
			code := exitErr.ExitCode()
			res.Code = &code
		} else {
			return res, waitErr
		}
	} else {
		code := 0
		res.Code = &code
	}

	// 「尚未开始下载就失败」单独标出来：调用方据此回退为按 URL 重试
	// （解析阶段缓存的 info JSON 可能已过期，CDN 直链有时效）
	if !started && !paused && res.Code != nil && *res.Code != 0 {
		res.StartErr = fmt.Errorf("yt-dlp 退出码 %d：%s", *res.Code, tail(res.Stderr, 300))
	}

	return res, nil
}

// Pause 终止指定任务的整棵进程树。
//
// 等进程真的退出后才返回：调用方（界面）必须等 aria2c 把控制文件写完，
// 否则恢复时会读到半截文件，前功尽弃。
// MarkPaused 只把任务标记为「用户要暂停」，供 Pause 的后台终止使用。
//
// 单独拆出来是为了让绑定层能**立刻**应答界面（见 App.PauseDownload）：
// 真正的终止要走 SIGTERM → 等宽限期 → SIGKILL，那 3 秒不能卡在 RPC 里。
func (r *Runner) MarkPaused(taskID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	task, ok := r.running[taskID]
	if !ok {
		return false
	}
	task.paused = true
	return true
}

func (r *Runner) Pause(taskID string) bool {
	r.mu.Lock()
	task, ok := r.running[taskID]
	if ok {
		task.paused = true
	}
	r.mu.Unlock()

	if !ok || task.cmd == nil || task.cmd.Process == nil {
		return false
	}

	_ = KillProcessTree(KillTarget{
		PID: uint32(task.cmd.Process.Pid),
		Exited: func() bool {
			// ProcessState 在 Wait 返回后才非 nil；这里探活用信号 0
			return !isProcessAlive(task.cmd.Process.Pid)
		},
	}, KillOptions{Grace: 3 * time.Second})
	return true
}

// IsRunning 报告指定任务是否在下载。
func (r *Runner) IsRunning(taskID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, ok := r.running[taskID]
	return ok
}

// RunningCount 返回正在下载的任务数。
func (r *Runner) RunningCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.running)
}

// readLines 把流按行切分并回调。
//
// 必须自己缓冲：管道的分块边界**不保证**与行对齐，一次 Read 可能拿到半行。
// 原 TS 实现里专门有个 `pending` 变量处理这个——不处理会把半行当成完整行，
// 解析出错误的进度（表现为进度条乱跳）。
//
// 用 bufio.Scanner 而不是自己拼缓冲：它已经处理了超长行与 EOF 尾部。
// 注意默认上限 64KB，yt-dlp 的单行不会那么大，但字幕 JSON 可能接近——
// 放宽到 1MB 以免截断。
func readLines(rd io.Reader, onLine func(string)) {
	sc := bufio.NewScanner(rd)
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for sc.Scan() {
		onLine(sc.Text())
	}
}

// tail 返回字符串末尾 n 个字符（给诊断用）。
func tail(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return "…" + s[len(s)-n:]
}
