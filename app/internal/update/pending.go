package update

import (
	"encoding/json"
	"os"
	"path/filepath"
)

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
