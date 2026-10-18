// Package clipboard 读系统剪贴板。
//
// ## 为什么不能用 navigator.clipboard
//
// WebView 里 `navigator.clipboard.readText()` 需要**剪贴板读权限**。
// macOS 上首次调用会弹一个系统授权对话框（"允许 DownVid 访问剪贴板？"），
// 用户点「粘贴」看到的是一个权限菜单而不是真的粘贴 —— 而这类授权在某些
// 系统版本上还会对每次调用重新询问。
//
// 桌面应用本来就是本机程序，直接读系统剪贴板是最自然的做法，也不需要
// 任何授权。三个平台各一条命令：
//
//	macOS   pbpaste
//	Windows powershell Get-Clipboard
//	Linux   wl-paste / xclip / xsel
//
// ## 为什么不用第三方库
//
// 与 shell 包同一个理由：三个平台各一条命令就够，引入库只会增加依赖与
// 审计面（而且这类库大多要 cgo，会毁掉纯静态交叉编译）。
package clipboard

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// ErrEmpty 表示剪贴板里没有文本。
var ErrEmpty = errors.New("剪贴板里没有文本")

// readTimeout 是一次读取的上限。
//
// 必须有：某些桌面环境（尤其是 Wayland 下没有剪贴板管理器时）的
// `wl-paste` 会一直等新内容，不加超时会把「点粘贴」变成永久卡住。
const readTimeout = 3 * time.Second

// Read 返回剪贴板里的文本。
func Read() (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), readTimeout)
	defer cancel()

	out, err := run(ctx)
	if err != nil {
		return "", err
	}
	text := strings.TrimSpace(out)
	if text == "" {
		return "", ErrEmpty
	}
	return text, nil
}

// run 按平台执行对应的读取命令。
func run(ctx context.Context) (string, error) {
	switch runtime.GOOS {
	case "darwin":
		return execText(ctx, "pbpaste")
	case "windows":
		// `Get-Clipboard -Raw` 保留换行；输出带 CRLF，调用方已 trim
		return execText(ctx, "powershell", "-NoProfile", "-Command", "Get-Clipboard -Raw")
	default:
		// 依次尝试：Wayland 的 wl-paste → X11 的 xclip → xsel。
		// 「装了哪个」只能在运行时知道，所以逐个试。
		var lastErr error
		for _, candidate := range []struct {
			name string
			args []string
		}{
			{"wl-paste", []string{"--no-newline"}},
			{"xclip", []string{"-selection", "clipboard", "-o"}},
			{"xsel", []string{"--clipboard", "--output"}},
		} {
			out, err := execText(ctx, candidate.name, candidate.args...)
			if err == nil {
				return out, nil
			}
			lastErr = err
		}
		if lastErr != nil {
			return "", fmt.Errorf("读不到剪贴板（需要 wl-paste / xclip / xsel 之一）：%w", lastErr)
		}
		return "", errors.New("读不到剪贴板")
	}
}

// execText 执行命令并返回 stdout。
func execText(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	var out, stderr strings.Builder
	cmd.Stdout = &out
	cmd.Stderr = &stderr
	hideWindow(cmd)

	if err := cmd.Run(); err != nil {
		// 命令不存在时给出更明确的话：这是最常见的一类失败
		if errors.Is(err, exec.ErrNotFound) || strings.Contains(err.Error(), "executable file not found") {
			return "", fmt.Errorf("找不到命令 %s", name)
		}
		if msg := strings.TrimSpace(stderr.String()); msg != "" {
			return "", fmt.Errorf("%s 失败：%s", name, msg)
		}
		return "", err
	}
	return out.String(), nil
}
