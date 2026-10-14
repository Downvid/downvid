// 原生 Windows 回归用的可控工具，不依赖 cmd 或 shell 脚本。
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func main() {
	exe, _ := os.Executable()
	mode, _ := os.ReadFile(filepath.Join(filepath.Dir(exe), "mode.txt"))
	switch strings.TrimSpace(string(mode)) {
	case "slow":
		time.Sleep(20 * time.Second)
		return
	case "error":
		fmt.Fprintln(os.Stderr, "ERROR: missing runtime DLL")
		os.Exit(1)
	case "error-zero":
		fmt.Println("ERROR: missing runtime DLL")
		return
	case "version-error":
		fmt.Println("ffmpeg version 6.0")
		os.Exit(1)
	case "old":
		fmt.Println("ffprobe version 3.0")
		return
	}
	name := strings.TrimSuffix(filepath.Base(exe), ".exe")
	if name == "yt-dlp" {
		fmt.Println("2026.10.14")
	} else {
		fmt.Println(name + " version 6.0")
	}
}
