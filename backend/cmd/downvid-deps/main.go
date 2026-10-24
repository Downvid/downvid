// Command downvid-deps 是 DownVid 的依赖探测与下载边车。
//
// DownVid 不再自带 yt-dlp / ffmpeg 二进制：安装包只带本程序，
// 启动时由它识别机器上已安装的依赖并直接复用，缺失的再由用户点击下载。
//
// 输出约定：stdout 为 NDJSON 事件流（供 Electron 逐行解析），stderr 为人类可读日志。
//
// 用法：
//
//	downvid-deps detect  --managed-dir <dir> [--manual yt-dlp=<path>] [--json]
//	downvid-deps fetch   --managed-dir <dir> [--only yt-dlp,ffmpeg] [--proxy <url>] [--force]
//	downvid-deps version
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/yxxbc/downvid/backend/internal/cli"
	"github.com/yxxbc/downvid/backend/internal/fetch"
	"github.com/yxxbc/downvid/backend/internal/manifest"
	rt "github.com/yxxbc/downvid/backend/internal/runtime"
)

// Version 构建号，由 package.json 的下载后端版本决定
const Version = "1.0.0"

func main() {
	// 先补齐 PATH，再探测或启动任何子进程。
	//
	// GUI 应用从 Finder 启动时只有精简 PATH，而托管目录里的 yt-dlp 是
	// zipapp（`#!/usr/bin/env python3`）：找不到用户的 Python 3.11+ 就会
	// 退回系统 3.9 并直接 ImportError。表现为「下载成功、版本也对，却始终
	// 显示缺依赖」。
	rt.EnsureChildPath()

	// 把清单里 pin 的版本注入 runtime 作为最低门槛。
	// 放这里是因为 runtime 不能 import manifest（会形成 import cycle），
	// 而 CLI 同时依赖两者。
	rt.MinVersions[rt.KindYtDlp] = manifest.MinYtDlpVersion()

	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}

	switch os.Args[1] {
	case "detect":
		runDetect(os.Args[2:])
	case "fetch", "download":
		runFetch(os.Args[2:])
	case "version", "--version", "-v":
		fmt.Println("downvid-deps", Version, manifest.CurrentPlatform())
	case "help", "--help", "-h":
		usage()
	default:
		cli.Fail("未知子命令：" + os.Args[1])
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `downvid-deps — DownVid 依赖探测与下载

  detect  探测 yt-dlp / ffmpeg / ffprobe，输出 JSON 结果
  fetch   下载缺失的依赖到托管目录（SHA-256 校验）
  version 输出版本与平台

detect 参数：
  --managed-dir <dir>     托管目录（下载安装位置）
  --manual <kind>=<path>  手动指定的可执行文件路径，可重复
  --json                  单行 JSON 输出（默认按事件流输出）
  --timeout <秒>          检测总时限，默认 80（不传即用 rt.DetectTimeout）

fetch 参数：
  --managed-dir <dir>     托管目录（必填）
  --only <a,b>            只下载指定依赖，默认全部
  --proxy <url>           下载使用的代理
  --mirror <id>           下载源：auto（默认，GitHub → 公共镜像依次降级）或钉死某个镜像
  --force                 即使已存在也重新下载
  --timeout <秒>          单次请求超时，默认 1800
`)
}

// ===== detect =====

type detectRequest struct {
	ManagedDir string            `json:"managedDir"`
	Manual     map[string]string `json:"manual"`
}

func runDetect(args []string) {
	fs := flag.NewFlagSet("detect", flag.ExitOnError)
	managedDir := fs.String("managed-dir", "", "托管目录")
	jsonOutput := fs.Bool("json", false, "单行 JSON 输出")
	timeout := fs.Int("timeout", int(rt.DetectTimeout/time.Second), "检测总时限（秒）")
	var manual manualFlags
	fs.Var(&manual, "manual", "手动指定路径 kind=path，可重复")
	// 兼容 --manual-dir/--manual-path 两种等价写法
	_ = fs.Parse(args)

	manualPaths := make(map[rt.Kind]string, len(manual))
	for kind, path := range manual {
		manualPaths[rt.Kind(kind)] = path
	}
	opts := rt.Options{ManagedDir: *managedDir, ManualPaths: manualPaths}
	if *timeout <= 0 {
		cli.Fail("检测时限必须大于 0")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(*timeout)*time.Second)
	defer cancel()
	results := rt.FindAllContext(ctx, opts)

	payload := map[string]any{
		"event":    "detect",
		"platform": manifest.CurrentPlatform(),
		// 同时给出 Go 的命名，便于排查"平台键对不上资产表"这类问题
		// （曾经因此让所有 x64 平台的依赖下载失效，见 issue #40）
		"goPlatform": runtime.GOOS + "/" + runtime.GOARCH,
		"managedDir": *managedDir,
		// 合并后的 PATH（当前进程 + 登录 shell）。宿主 App 之后要自己启动
		// yt-dlp/ffmpeg，用同一份 PATH 才不会在 GUI 环境里找不到 python3。
		"path":    rt.LivePath(),
		"results": results,
	}

	if *jsonOutput {
		encoded, _ := json.Marshal(payload)
		fmt.Println(string(encoded))
		return
	}
	cli.Emit(payload)
	for _, r := range results {
		if r.Found {
			cli.Log(fmt.Sprintf("%s 已就绪：%s（%s，%s）", r.Kind, r.Version, r.Source, r.Path))
		} else {
			cli.Log(fmt.Sprintf("%s 缺失：%s", r.Kind, r.Reason))
		}
	}
}

// ===== fetch =====

func runFetch(args []string) {
	fs := flag.NewFlagSet("fetch", flag.ExitOnError)
	managedDir := fs.String("managed-dir", "", "托管目录（必填）")
	only := fs.String("only", "", "只下载指定依赖，逗号分隔")
	proxy := fs.String("proxy", "", "下载代理")
	force := fs.Bool("force", false, "已存在时也重新下载")
	mirror := fs.String("mirror", "auto", "下载源：auto（GitHub → 公共镜像依次降级）或钉死某个镜像 ID")
	timeout := fs.Int("timeout", 1800, "单次请求超时（秒）")
	_ = fs.Parse(args)

	if *managedDir == "" {
		cli.Fail("fetch 需要 --managed-dir 参数")
	}

	var onlyList []string
	for _, item := range strings.Split(*only, ",") {
		if trimmed := strings.TrimSpace(item); trimmed != "" {
			onlyList = append(onlyList, trimmed)
		}
	}

	tasks, err := manifest.Tasks(*managedDir, onlyList)
	if err != nil {
		cli.Fail(err.Error())
	}

	// 非 --force 时跳过已存在且可执行的依赖
	if !*force {
		tasks = filterMissing(tasks, *managedDir)
	}
	if len(tasks) == 0 {
		cli.Emit(map[string]any{"event": "done", "skipped": true, "message": "依赖已存在，无需下载"})
		cli.Log("所有依赖均已存在，跳过下载")
		return
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	emit := func(e fetch.Event) {
		cli.Emit(e)
		if e.Event == "progress" {
			return
		}
		if e.Message != "" {
			cli.Log(e.Tool + " " + e.Event + "：" + e.Message)
		} else {
			cli.Log(e.Tool + " " + e.Event)
		}
	}

	summary := make([]fetch.Event, 0, 8)
	err = fetch.Install(ctx, tasks, fetch.Options{
		Proxy:   *proxy,
		Timeout: time.Duration(*timeout) * time.Second,
		Mirror:  *mirror,
		Emit:    emit,
	})
	if err != nil {
		cli.Fail(err.Error())
	}

	// 安装后的平台处理（macOS 去隔离属性 + ad-hoc 签名）
	for _, task := range tasks {
		fetch.Finalize(task.Target, fetch.Options{}, emit)
		summary = append(summary, fetch.Event{Event: "installed", Tool: task.Tool, Path: task.Target})
	}

	// 回读刚装好的版本，让界面能立即显示
	opts := rt.Options{ManagedDir: *managedDir}
	results := make([]rt.Result, 0, len(tasks))
	for _, task := range tasks {
		results = append(results, rt.FindOne(rt.Kind(task.Tool), opts))
	}
	cli.Emit(map[string]any{"event": "done", "installed": summary, "results": results})
	cli.Log("依赖安装完成")
}

// filterMissing 只保留尚未安装（或安装位置不可执行）的依赖
func filterMissing(tasks []fetch.Task, managedDir string) []fetch.Task {
	opts := rt.Options{ManagedDir: managedDir}
	keep := make([]fetch.Task, 0, len(tasks))
	for _, task := range tasks {
		res := rt.FindOne(rt.Kind(task.Tool), opts)
		if res.Found && res.Managed {
			cli.Log(task.Tool + " 已存在，跳过")
			continue
		}
		keep = append(keep, task)
	}
	return keep
}

// manualFlags 支持 --manual kind=path 重复出现
type manualFlags map[string]string

func (m *manualFlags) String() string {
	if m == nil {
		return ""
	}
	parts := make([]string, 0, len(*m))
	for k, v := range *m {
		parts = append(parts, k+"="+v)
	}
	return strings.Join(parts, ",")
}

func (m *manualFlags) Set(value string) error {
	key, val, ok := strings.Cut(value, "=")
	if !ok {
		return fmt.Errorf("格式应为 kind=path，收到 %q", value)
	}
	if *m == nil {
		*m = map[string]string{}
	}
	(*m)[strings.TrimSpace(key)] = strings.TrimSpace(val)
	return nil
}
