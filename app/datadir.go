package main

import (
	"io"
	"log"
	"os"
	"path/filepath"
)

// downvidHome 是 DownVid 自己的数据根：`~/.downvid`，三端统一。
//
// 运行依赖（yt-dlp / ffmpeg / 边车本体）都落在这里：系统数据目录在三个平台上
// 各不相同（macOS 的 Application Support、Windows 的 %APPDATA%、Linux 的
// XDG 目录），跨平台排障时「依赖到底装哪了」全靠猜。
//
// 不能用 os.UserConfigDir()：它在 Windows 上指向 %APPDATA%（漫游配置，
// 可能被同步到域服务器），且与旧版本 userData 的关系不明确。
func downvidHome() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		home = "."
	}
	return filepath.Join(home, ".downvid")
}

// resolveHistoryPath 返回下载历史文件的位置：`~/.downvid/download-history.json`。
//
// 旧版本把它放在系统数据目录（Electron 的 userData）。**升级时必须搬**，
// 否则用户的历史「凭空消失」——而历史损坏/丢失不会让任何测试变红。
func resolveHistoryPath(dataDir string) string {
	target := filepath.Join(downvidHome(), "download-history.json")
	if dataDir != "" {
		migrateFile(filepath.Join(dataDir, "download-history.json"), target)
	}
	return target
}

// migrateTree 把 srcDir 里的每一项搬到 dstDir，**不覆盖**目标已有的同名项。
//
// 早先的实现只在 `dstDir` 不存在时才整体搬：用户手动建过空目录、或上次搬家
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

// migrateFile 把单个文件从旧位置搬到新位置。
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
//
// userData 与 ~ 可能不在同一个挂载点（Linux 上 XDG 目录指到别处、Windows 上
// 漫游配置在域服务器），rename 直接失败。失败要落日志：这个函数搬的是用户
// 的 80MB 依赖和历史文件，静默失败正是要避免的。
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
