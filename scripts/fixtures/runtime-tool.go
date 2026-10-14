// 原生 Windows 回归用的可控工具，不依赖 cmd 或 shell 脚本。
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func main() {
	exe, _ := os.Executable()
	if len(os.Args) > 1 && os.Args[1] == "--child" {
		for i := 0; i < 200; i++ {
			_ = os.WriteFile(filepath.Join(filepath.Dir(exe), "progress.txt"), []byte(strconv.Itoa(i)), 0o644)
			time.Sleep(100 * time.Millisecond)
		}
		return
	}
	mode, _ := os.ReadFile(filepath.Join(filepath.Dir(exe), "mode.txt"))
	switch strings.TrimSpace(string(mode)) {
	case "tree":
		child := exec.Command(exe, "--child")
		child.Stdout, child.Stderr = os.Stdout, os.Stderr
		if err := child.Start(); err != nil {
			panic(err)
		}
		_ = os.WriteFile(filepath.Join(filepath.Dir(exe), "child-pid.txt"), []byte(strconv.Itoa(child.Process.Pid)), 0o644)
		time.Sleep(20 * time.Second)
		return
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
	} else if name == "deno" {
		fmt.Println("deno 2.3.0")
	} else if name == "node" {
		fmt.Println("v22.0.0")
	} else {
		fmt.Println(name + " version 6.0")
	}
}
