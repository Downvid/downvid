//go:build withsidecar

// Package sidecar 把依赖探测边车**打进主二进制**。
//
// ## 为什么是嵌入而不是"拷到 Resources/"
//
// Wails 没有 `extraResources` 那种机制（electron-builder 有）。边车是
// 一个独立的 Go 二进制（`backend/cmd/downvid-deps`，约 10MB），必须由
// 应用自己带上。两种做法：
//
//	拷进 app 包的 Resources/  → 依赖打包脚本按平台摆对位置，漏了就是
//	                           静默失效：依赖页只剩 yt-dlp 一条，且显示「未找到」
//	嵌进主二进制并运行时落盘  → 与打包方式无关，`wails build` 出来就有
//
// 选了后者。真实故障就是这么发生的：Wails 版打出来的 app 里根本没有
// sidecar，`DetectDependencies` 直接返回「探测程序缺失」，用户看到
// 「系统怎么只剩下这么一点依赖」——而代码里没有任何一处会报错。
//
// ## 为什么要落盘而不是管道直传
//
// 边车要能被独立执行（它自己会 spawn yt-dlp/ffmpeg 并读它们的输出）。
// 从内存里跑一个 ELF/Mach-O 需要 memfd 或临时文件，跨平台差异大；
// 落盘到数据目录最简单，且**与 Electron 版的位置一致**
// （`<userData>/runtime/bin/downvid-deps`），升级不会留下两份。
package sidecar

import (
	"crypto/sha256"
	"embed"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
)

// 构建时由 `go build -tags withsidecar` 决定带不带。
//
// 用 build tag 而不是无条件 embed：`go test ./...` 与普通的 `go build`
// 不需要那个 10MB 的产物，仓库里也不该有二进制。打包脚本会：
//  1. 先编译边车到 `internal/sidecar/bin/<goos>-<goarch>/downvid-deps`
//  2. 用 `-tags withsidecar` 编译主程序
//
// 目录不存在时 `//go:embed all:bin` 会编译失败——所以有一个 `.gitkeep`
// 保证默认构建（不带 tag）也能通过。

//go:embed all:bin
var embedded embed.FS

// Available 报告这个构建是否带上了边车。
const Available = true

// Extract 把内嵌的边车写到 dir 下，返回可执行文件路径。
//
// 已经存在且内容一致时不重写：每次启动都写 10MB 会拖慢冷启动，
// 也会让「文件被占用」（Windows）之类的问题变多。
func Extract(dir string) (string, error) {
	name := "downvid-deps"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	// 内嵌目录按**目标平台**分（构建时只放一个平台的产物）
	key := runtime.GOOS + "-" + runtime.GOARCH
	data, err := embedded.ReadFile(filepath.Join("bin", key, name))
	if err != nil {
		return "", fmt.Errorf("这个构建没有带上 %s 的依赖边车：%w", key, err)
	}

	target := filepath.Join(dir, name)
	if ok, _ := sameContent(target, data); ok {
		return target, nil
	}

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	// 先写临时文件再 rename：写到一半被中断不会留下半个可执行文件
	tmp := target + ".tmp"
	if err := os.WriteFile(tmp, data, 0o755); err != nil {
		return "", err
	}
	// Windows 上目标可能正被占用（上一次运行留下的进程），rename 会失败
	if err := os.Rename(tmp, target); err != nil {
		_ = os.Remove(tmp)
		if ok, _ := sameContent(target, data); ok {
			return target, nil
		}
		return "", err
	}
	return target, nil
}

// sameContent 比较文件内容与给定字节是否一致。
func sameContent(path string, want []byte) (bool, error) {
	f, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.Size() != int64(len(want)) {
		return false, err
	}
	// 10MB 全量比对太重：先比大小，再比前 4KB 与整体 SHA-256 的开销取舍。
	// 这里直接算 SHA-256：10MB 约 20ms，只在启动时一次。
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return false, err
	}
	sum := sha256.Sum256(want)
	return string(h.Sum(nil)) == string(sum[:]), nil
}
