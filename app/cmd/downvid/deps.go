package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/Downvid/downvid/app/internal/appdir"
	"github.com/Downvid/downvid/app/internal/deps"
	"github.com/Downvid/downvid/app/internal/settings"
	"github.com/Downvid/downvid/app/internal/sidecar"
)

// runDeps 是 `downvid deps status|install`：复用桌面版的依赖边车，
// 把 yt-dlp / ffmpeg / ffprobe / aria2 装进 `~/.downvid/runtime/bin`。
func runDeps(args []string, only string, force bool, mirror string, stdout, stderr io.Writer, asJSON bool) int {
	userData := appdir.UserData()
	st, err := settings.NewStore(appdir.SettingsPath(userData)).Load()
	if err != nil {
		fmt.Fprintf(stderr, "提示：读取设置失败，使用默认值（%v）\n", err)
	}
	st = settings.Normalize(st)

	managed := appdir.ManagedBinDir(userData)
	sc := findSidecar(managed)
	if sc == "" {
		return depFail(stdout, stderr, asJSON, "没有找到 downvid-deps：请用 bash app/scripts/build-cli.sh 构建（内嵌边车），或先打开 DownVid 一次")
	}
	m := deps.NewManager(sc, managed)

	action := "status"
	if len(args) > 0 {
		action = args[0]
	}
	switch action {
	case "status":
		snap, err := m.Detect(true)
		if err != nil {
			return depFail(stdout, stderr, asJSON, "依赖探测失败：%v", err)
		}
		if asJSON {
			writeJSON(stdout, snap)
			return 0
		}
		fmt.Fprintln(stdout, "依赖            版本          来源      路径")
		for _, d := range snap.Results {
			found := "缺失"
			if d.Found {
				found = "已安装"
			}
			if d.Stale {
				found = "版本过旧"
			}
			src := d.Source
			if src == "" {
				src = found
			}
			fmt.Fprintf(stdout, "  %-12s  %-12s  %-8s  %s\n", d.Kind, d.Version, src, d.Path)
		}
		fmt.Fprintf(stdout, "\n托管目录：%s\n", snap.ManagedDir)
		return 0

	case "install":
		kinds := deps.AllKinds
		if strings.TrimSpace(only) != "" {
			kinds = nil
			for _, k := range strings.Split(only, ",") {
				k = strings.TrimSpace(k)
				if k == "" {
					continue
				}
				if !knownKind(k) {
					return depFail(stdout, stderr, asJSON, "未知依赖 %q（可选：%s）", k, strings.Join(deps.AllKinds, ", "))
				}
				kinds = append(kinds, k)
			}
			if len(kinds) == 0 {
				return depFail(stdout, stderr, asJSON, "--only 没有给出依赖")
			}
		}
		proxy := st.Proxy
		if st.BypassProxy {
			proxy = ""
		}
		if mirror == "" {
			mirror = st.DepMirror
		}
		tty := isTerminal(os.Stderr)
		last := ""
		err := m.Install(deps.FetchOptions{
			Only:    kinds,
			Force:   force,
			Proxy:   proxy,
			Mirror:  mirror,
			Timeout: 30 * time.Minute,
		}, func(p deps.Progress) {
			switch p.Event {
			case "progress":
				if !tty || p.Total <= 0 {
					return
				}
				fmt.Fprintf(stderr, "\r  %-8s %3.0f%%  %s/%s", p.Tool,
					100*float64(p.Downloaded)/float64(p.Total),
					depsBytes(p.Downloaded), depsBytes(p.Total))
			case "mirror", "retry":
				last = p.Message
			case "done":
				if p.Tool != "" {
					fmt.Fprintf(stderr, "\r  %-8s 完成\n", p.Tool)
				}
			case "error":
				last = p.Message
			}
		})
		fmt.Fprintln(stderr)
		if err != nil {
			return depFail(stdout, stderr, asJSON, "依赖安装失败：%v", err)
		}
		if asJSON {
			writeJSON(stdout, map[string]any{"ok": true, "installed": kinds, "managedDir": managed})
		} else {
			if last != "" {
				fmt.Fprintln(stdout, last)
			}
			fmt.Fprintf(stdout, "依赖已安装到 %s\n", managed)
		}
		return 0
	}
	return depFail(stdout, stderr, asJSON, "未知 deps 子命令 %q（用 status 或 install）", action)
}

func knownKind(k string) bool {
	for _, known := range deps.AllKinds {
		if k == known {
			return true
		}
	}
	return false
}

// findSidecar 找依赖边车：内嵌的优先，其次桌面版解出来的、开发构建的。
func findSidecar(managed string) string {
	if sidecar.Available {
		if p, err := sidecar.Extract(managed); err == nil {
			return p
		}
	}
	name := "downvid-deps"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	for _, p := range []string{
		filepath.Join(managed, name),
		filepath.Join("..", "backend", "build", runtime.GOOS+"-"+runtime.GOARCH, name),
		filepath.Join("backend", "build", runtime.GOOS+"-"+runtime.GOARCH, name),
	} {
		if fileExists(p) {
			return p
		}
	}
	return ""
}

func depsBytes(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for m := n / unit; m >= unit; m /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(n)/float64(div), "KMGTPE"[exp])
}

func depFail(stdout, stderr io.Writer, asJSON bool, format string, args ...any) int {
	msg := fmt.Sprintf(format, args...)
	fmt.Fprintf(stderr, "downvid: %s\n", msg)
	if asJSON {
		writeJSON(stdout, map[string]any{"ok": false, "error": msg})
	}
	return 1
}
