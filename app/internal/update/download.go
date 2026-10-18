package update

// 自更新的下载与安装编排。
//
// 这一层把「选包 → 下载 → 校验 → 安装」串起来，但**把真正危险的动作
// （替换文件、起安装器）留给各平台实现**，而且都要求调用方显式传参，
// 便于测试时不碰真实文件系统。
//
// ## 为什么下载与安装要分开
//
// 用户可能：下载完但先不装（等手头工作结束）。所以 `Download` 把包装到
// 临时目录并校验，`Install` 负责替换。两者之间应用可以继续正常运行 ——
// 这也是 electron-updater 的做法（`downloaded` 状态）。

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// DownloadProgress 是下载进度回调的载荷。
type DownloadProgress struct {
	Received int64
	Total    int64
	Percent  float64
}

// Downloader 负责把一个安装包下到本地并校验。
type Downloader struct {
	// Client 必须由调用方传（要带上用户配置的代理）
	Client *http.Client
	// Dir 是存放下载包的临时目录
	Dir string
}

// Download 下载并校验，返回本地文件路径。
//
// 校验失败时**删除已下载的文件**：留着它只会在下次重试时被误用。
func (d Downloader) Download(ctx context.Context, asset *InstallAsset, onProgress func(DownloadProgress)) (string, error) {
	if asset == nil || asset.URL == "" {
		return "", fmt.Errorf("没有可下载的安装包")
	}
	if d.Client == nil {
		return "", fmt.Errorf("缺少 HTTP 客户端（代理设置无处生效）")
	}
	if err := os.MkdirAll(d.Dir, 0o755); err != nil {
		return "", err
	}

	target := filepath.Join(d.Dir, asset.Name)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, asset.URL, nil)
	if err != nil {
		return "", err
	}
	// GitHub 的 release 直链没有 UA 会给 403
	req.Header.Set("User-Agent", "DownVid-updater/1")

	resp, err := d.Client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("下载失败：HTTP %d", resp.StatusCode)
	}

	total := resp.ContentLength
	if total <= 0 && asset.Size > 0 {
		total = asset.Size
	}

	// 先写 `.part` 再 rename：中途失败不会留下半个包被当成完整包
	part := target + ".part"
	f, err := os.Create(part)
	if err != nil {
		return "", err
	}

	var received int64
	buf := make([]byte, 64*1024)
	lastEmit := time.Time{}
	cleanup := func() {
		_ = f.Close()
		_ = os.Remove(part)
	}

	for {
		if err := ctx.Err(); err != nil {
			cleanup()
			return "", err
		}
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, writeErr := f.Write(buf[:n]); writeErr != nil {
				cleanup()
				return "", writeErr
			}
			received += int64(n)
			// 节流到 ~5 次/秒：每 64KB 回调一次会产生上百次/秒的跨语言调用
			if onProgress != nil && time.Since(lastEmit) >= 200*time.Millisecond {
				lastEmit = time.Now()
				pct := float64(0)
				if total > 0 {
					pct = float64(received) / float64(total) * 100
				}
				onProgress(DownloadProgress{Received: received, Total: total, Percent: pct})
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			cleanup()
			return "", readErr
		}
	}

	if err := f.Close(); err != nil {
		_ = os.Remove(part)
		return "", err
	}

	// 校验在 rename **之前**做：校验不过就不该出现一个"看起来完整"的文件
	data, err := os.ReadFile(part)
	if err != nil {
		_ = os.Remove(part)
		return "", err
	}
	if err := ValidateDownload(data, asset); err != nil {
		_ = os.Remove(part)
		return "", err
	}
	if err := os.Rename(part, target); err != nil {
		_ = os.Remove(part)
		return "", err
	}

	if onProgress != nil {
		onProgress(DownloadProgress{Received: received, Total: received, Percent: 100})
	}
	return target, nil
}

// PendingUpdate 是一次「已下载、待安装」的更新。
//
// 写成 JSON 落盘：用户可能下载完就关掉应用，下次启动要能接着装。
type PendingUpdate struct {
	Version string    `json:"version"`
	Path    string    `json:"path"`
	Kind    AssetKind `json:"kind"`
	// DownloadedAt 是 ISO 时间，便于排查「这个包放太久了」
	DownloadedAt string `json:"downloadedAt"`
}

// SavePending 把待安装的更新写到文件（原子写）。
func SavePending(path string, p PendingUpdate) error {
	raw, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// LoadPending 读回待安装的更新。
//
// 文件不存在 / 损坏 / 指向的文件已被删除 时返回 nil —— 这些情况都只是
// 「没有待安装的更新」，不该让调用方处理错误。
func LoadPending(path string) *PendingUpdate {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var p PendingUpdate
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil
	}
	if p.Path == "" || p.Version == "" {
		return nil
	}
	if _, err := os.Stat(p.Path); err != nil {
		// 包没了：把记录也清掉，免得每次启动都尝试装一个不存在的文件
		_ = os.Remove(path)
		return nil
	}
	return &p
}

// ClearPending 删除待安装记录（安装成功后调）。
func ClearPending(path string) {
	_ = os.Remove(path)
}
