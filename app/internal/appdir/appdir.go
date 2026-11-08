// Package appdir 描述 DownVid 在磁盘上的位置。
//
// 桌面壳与 CLI 必须看到同一份数据：`~/.downvid` 放运行依赖与历史，
// 系统 userData 放设置、Cookie 与解析缓存。路径规则只留在这里一份，
// 两边各自拼路径迟早会出现「GUI 装好的 yt-dlp，CLI 找不到」。
package appdir

import (
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// Home 是 DownVid 自己的数据根：`~/.downvid`，三端统一。
//
// 运行依赖（yt-dlp / ffmpeg / 边车本体）都落在这里：系统数据目录在三个平台上
// 各不相同（macOS 的 Application Support、Windows 的 %APPDATA%、Linux 的
// XDG 目录），跨平台排障时「依赖到底装哪了」全靠猜。
func Home() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		home = "."
	}
	return filepath.Join(home, ".downvid")
}

// UserData 复刻 Electron `app.getPath('userData')` 的位置。
//
// 必须与旧版本一致，否则用户升级后历史、Cookie、托管依赖全部「消失」。
func UserData() string {
	const appName = "downvid"

	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		home = "."
	}

	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", appName)
	case "windows":
		if appData := os.Getenv("APPDATA"); appData != "" {
			return filepath.Join(appData, appName)
		}
		return filepath.Join(home, "AppData", "Roaming", appName)
	default:
		if xdg := os.Getenv("XDG_CONFIG_HOME"); xdg != "" {
			return filepath.Join(xdg, appName)
		}
		return filepath.Join(home, ".config", appName)
	}
}

// DownloadsDir 返回默认下载目录。
func DownloadsDir() string {
	if home, err := os.UserHomeDir(); err == nil {
		downloads := filepath.Join(home, "Downloads")
		if st, err := os.Stat(downloads); err == nil && st.IsDir() {
			return downloads
		}
	}
	wd, _ := os.Getwd()
	return filepath.Join(wd, "downloads")
}

// SettingsPath 是 `settings.json` 的位置。
func SettingsPath(userData string) string {
	return filepath.Join(userData, "settings.json")
}

// ParseCacheDir 是解析出的原始 info JSON 的落盘目录。
func ParseCacheDir(userData string) string {
	return filepath.Join(userData, "parse-cache")
}

// HistoryPath 返回下载历史文件的位置：`~/.downvid/download-history.json`。
//
// 旧版本把它放在系统数据目录。**升级时必须搬**，否则用户的历史「凭空消失」。
func HistoryPath(userData string) string {
	target := filepath.Join(Home(), "download-history.json")
	if userData != "" {
		migrateFile(filepath.Join(userData, "download-history.json"), target)
	}
	return target
}

// ManagedBinDir 返回依赖托管目录（`~/.downvid/runtime/bin`），并把旧位置
// （userData/runtime/bin）里的依赖逐项搬过来。
func ManagedBinDir(userData string) string {
	fixed := filepath.Join(Home(), "runtime", "bin")
	if userData != "" {
		migrateTree(filepath.Join(userData, "runtime", "bin"), fixed)
	}
	return fixed
}

// toolNames 是设置里的 kind 到可执行文件名的映射。
// 注意 aria2 的键是 "aria2"，二进制却叫 aria2c。
var toolNames = map[string]string{
	"yt-dlp":  "yt-dlp",
	"ffmpeg":  "ffmpeg",
	"ffprobe": "ffprobe",
	"aria2":   "aria2c",
}

// FindTool 按「设置里的手动路径 → ~/.downvid/runtime/bin → PATH」找依赖。
//
// GUI 走边车探测（能读版本、判过期）；CLI 只需要一个可执行的路径，
// 这条顺序与托管目录的约定一致即可。
func FindTool(kind string, manual map[string]string) (string, bool) {
	if p := strings.TrimSpace(manual[kind]); p != "" && isExecutable(p) {
		return p, true
	}

	name := toolNames[kind]
	if name == "" {
		name = kind
	}
	managed := name
	if runtime.GOOS == "windows" {
		managed += ".exe"
	}
	p := filepath.Join(Home(), "runtime", "bin", managed)
	if isExecutable(p) {
		return p, true
	}
	if p, err := exec.LookPath(name); err == nil {
		return p, true
	}
	return "", false
}

func isExecutable(path string) bool {
	st, err := os.Stat(path)
	if err != nil || !st.Mode().IsRegular() {
		return false
	}
	if runtime.GOOS == "windows" {
		return true
	}
	return st.Mode().Perm()&0o111 != 0
}

// migrateTree 把 srcDir 里的每一项搬到 dstDir，**不覆盖**目标已有的同名项。
//
// 早先的实现只在 dstDir 不存在时才整体搬：用户手动建过空目录、或上次搬家
// 中途失败留下半个目录后，旧目录里的 yt-dlp/ffmpeg 会一直躺着，而探测只看新
// 目录——用户看到依赖「消失」、白重下 80MB。所以这里按项逐搬。
func migrateTree(srcDir, dstDir string) {
	if srcDir == "" || dstDir == "" || srcDir == dstDir {
		return
	}
	entries, err := os.ReadDir(srcDir)
	if err != nil || len(entries) == 0 {
		return
	}
	if err := os.MkdirAll(dstDir, 0o755); err != nil {
		log.Printf("[downvid] 无法创建 %s：%v", dstDir, err)
		return
	}
	for _, entry := range entries {
		src := filepath.Join(srcDir, entry.Name())
		dst := filepath.Join(dstDir, entry.Name())
		// 目标已有同名项：以它为准，源保留在原地（宁可多留一份，也不覆盖用户的东西）
		if _, err := os.Lstat(dst); err == nil {
			continue
		}
		movePath(src, dst)
	}
	// 只剩空目录时删掉，免得旧路径继续存在误导排查；非空则保留
	_ = os.Remove(srcDir)
}

func migrateFile(srcPath, dstPath string) {
	if srcPath == "" || srcPath == dstPath {
		return
	}
	// 新位置已经有文件 → 以新为准，绝不用旧文件覆盖
	if _, err := os.Stat(dstPath); err == nil {
		return
	}
	if _, err := os.Stat(srcPath); err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(dstPath), 0o755); err != nil {
		log.Printf("[downvid] 无法创建 %s：%v", filepath.Dir(dstPath), err)
		return
	}
	movePath(srcPath, dstPath)
}

// movePath 先试 rename；跨设备（EXDEV）时退回复制 + 删除。
func movePath(src, dst string) {
	if err := os.Rename(src, dst); err == nil {
		return
	}
	if err := copyPath(src, dst); err != nil {
		log.Printf("[downvid] 迁移 %s → %s 失败：%v", src, dst, err)
		return
	}
	if err := os.RemoveAll(src); err != nil {
		log.Printf("[downvid] 迁移后无法删除旧路径 %s：%v", src, err)
	}
}

// copyPath 复制普通文件并保留权限位。
func copyPath(src, dst string) error {
	info, err := os.Stat(src)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return &os.PathError{Op: "copy", Path: src, Err: os.ErrInvalid}
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, info.Mode().Perm())
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}
