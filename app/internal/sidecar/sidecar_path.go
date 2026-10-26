package sidecar

import (
	"path"
)

// embeddedPath 返回给定平台与架构在 embed.FS 内部的路径。
//
// 必须严格使用正斜杠 `/`（由 package path 保证），严禁使用 filepath.Join。
// Go 的 io/fs 与 embed.FS 规范要求路径必须以 `/` 分隔；在 Windows 上用
// filepath.Join 会得到反斜杠 `\`（`bin\windows-amd64\downvid-deps.exe`），
// 导致 embed.FS.ReadFile 抛出 "file does not exist"，使 Windows 版的内嵌边车
// 永远无法被解出，导致依赖探测和下载报「依赖探测程序缺失（downvid-deps 未打包）」。
func embeddedPath(goos, goarch string) string {
	name := "downvid-deps"
	if goos == "windows" {
		name += ".exe"
	}
	key := goos + "-" + goarch
	return path.Join("bin", key, name)
}
