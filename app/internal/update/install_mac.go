//go:build darwin

package update

// macOS 的安装实现。
//
// 与 Electron 版同一套思路（`electron/updater.ts` 的 `installMacUpdate`），
// 因为那条路径已经被大量用户验证过。核心约束：
//
//  1. **替换整个 `.app`**，不是里面那个可执行文件。只换二进制的话
//     Info.plist / Resources 还是旧的，表现为「版本号变了但功能没变」。
//  2. 不能在自己运行时替换自己（macOS 允许，但会留下半新半旧的包）。
//     所以写一个 shell 脚本：等本进程退出 → 备份旧包 → ditto 新包 →
//     失败则回滚 → 重开。
//  3. 必须 `xattr -dr com.apple.quarantine`：从网络下载的包带隔离属性，
//     Apple Silicon 上直接 `killed: 9`。
//  4. 重签（ad-hoc）：不签的话换掉的包会被 Gatekeeper 判定为「已损坏」。

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

// macInstallScript 是安装脚本的模板。
//
// `%s` 依次是：日志文件、pid、解压后的 .app、目标 .app、备份路径。
//
// **失败必须回滚**：换到一半失败会让用户失去应用（既没有新的也没有旧的）。
const macInstallScript = `#!/bin/bash
LOG=%q
PID=%q
NEW_APP=%q
TARGET=%q
BACKUP=%q

echo "[$(date)] installing $NEW_APP -> $TARGET" >> "$LOG"

# 等本进程退出（最多 120 秒）
for _ in $(seq 1 240); do
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.5
done
# 再给一点时间让文件句柄释放
sleep 0.5

rm -rf "$BACKUP"
if mv "$TARGET" "$BACKUP"; then
  if ditto "$NEW_APP" "$TARGET"; then
    xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
    codesign --force --deep --sign - "$TARGET" 2>/dev/null
    rm -rf "$BACKUP"
    echo "[$(date)] installed" >> "$LOG"
    open "$TARGET"
    rm -f "$0"
    exit 0
  fi
  echo "[$(date)] ditto failed, rolling back" >> "$LOG"
  rm -rf "$TARGET"
  mv "$BACKUP" "$TARGET"
  open "$TARGET"
else
  echo "[$(date)] mv failed, target untouched" >> "$LOG"
fi
rm -f "$0"
exit 1
`

// InstallMac 把下载好的 zip 装成新的 .app，并重启应用。
//
// 返回前**不会**真正替换文件（那时本进程还活着），而是启动一个脚本去做。
// 调用方应在返回后立即 `os.Exit(0)`，让脚本能接管。
func InstallMac(zipPath, appBundle string, logPath string) error {
	if zipPath == "" || appBundle == "" {
		return errors.New("缺少安装包或目标路径")
	}
	if !executableExists("/usr/bin/ditto") {
		return errors.New("系统缺少 ditto，无法解压安装包")
	}

	workDir, err := os.MkdirTemp("", "downvid-install-")
	if err != nil {
		return err
	}

	// 解压到一个临时目录：解压失败时目标 .app 还完好无损
	extractDir := filepath.Join(workDir, "app")
	if out, err := exec.Command("/usr/bin/ditto", "-x", "-k", zipPath, extractDir).CombinedOutput(); err != nil {
		_ = os.RemoveAll(workDir)
		return errors.New("解压安装包失败：" + string(out))
	}

	newApp := findAppBundle(extractDir)
	if newApp == "" {
		_ = os.RemoveAll(workDir)
		return errors.New("安装包里没有找到 .app")
	}

	// 提前去掉隔离属性与重签：这些在脚本里做会拖慢「重启后能否立刻用」
	_ = exec.Command("/usr/bin/xattr", "-dr", "com.apple.quarantine", newApp).Run()
	_ = exec.Command("/usr/bin/codesign", "--force", "--deep", "--sign", "-", newApp).Run()

	backup := appBundle + ".downvid-old"
	script := filepath.Join(workDir, "install.sh")
	body := fmt.Sprintf(
		macInstallScript,
		logPath, itoaPtr(os.Getpid()), newApp, appBundle, backup,
	)
	if err := os.WriteFile(script, []byte(body), 0o755); err != nil {
		_ = os.RemoveAll(workDir)
		return err
	}

	// 独立进程跑脚本：它要等我们退出，不能被我们的进程组带走
	cmd := exec.Command("/bin/bash", script)
	cmd.Dir = workDir
	if err := cmd.Start(); err != nil {
		_ = os.RemoveAll(workDir)
		return errors.New("启动安装脚本失败：" + err.Error())
	}
	return nil
}

// findAppBundle 在目录里找第一个 `.app`。
func findAppBundle(dir string) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	for _, e := range entries {
		if e.IsDir() && filepath.Ext(e.Name()) == ".app" {
			return filepath.Join(dir, e.Name())
		}
	}
	return ""
}

func executableExists(path string) bool {
	st, err := os.Stat(path)
	return err == nil && st.Mode().IsRegular()
}

func itoaPtr(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	if neg {
		b = append([]byte{'-'}, b...)
	}
	return string(b)
}

// InstallWindows / InstallLinux 在 macOS 上不会被调用（app.go 按 GOOS 分发），
// 但必须存在：Go 不按平台裁剪 switch 的各个分支。
func InstallWindows(installerPath, logPath string) error {
	return errors.New("Windows 安装器不能在 macOS 上运行")
}

func InstallLinux(newAppImage string) error {
	return errors.New("AppImage 不能在 macOS 上安装")
}
