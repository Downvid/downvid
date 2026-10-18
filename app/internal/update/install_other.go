//go:build !darwin && !windows && !linux

package update

// 其余平台（FreeBSD 等）没有实现自更新。
//
// 编译上必须存在这些符号：`app.go` 里的 switch 会引用它们，
// 而 Go 不按平台裁剪调用点。运行时会如实报错，不会静默假装成功。

import "errors"

var errUnsupportedPlatform = errors.New("当前平台不支持自动更新，请到发布页手动下载")

// InstallMac 在非 macOS 平台上是占位实现。
func InstallMac(zipPath, appBundle, logPath string) error { return errUnsupportedPlatform }

// InstallWindows 在非 Windows 平台上是占位实现。
func InstallWindows(installerPath, logPath string) error { return errUnsupportedPlatform }

// InstallLinux 在非 Linux 平台上是占位实现。
func InstallLinux(newAppImage string) error { return errUnsupportedPlatform }
