package cookie

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// NormalizeCookieFile 把「浏览器扩展导出的 JSON」转成 Netscape 文本。
//
// 为什么必须转：yt-dlp 的 `--cookies` **只认 Netscape 格式**，喂它一份 JSON
// 不会报错，也不会带任何 cookie——用户看到的是「配了 cookie 还是解析不了」，
// 而且没有任何一处提示格式不对。实测用户从扩展里导出的就是 JSON 数组。
//
// 已经是 Netscape 的文件原样返回（第二个返回值为 false）。转换结果写在
// workDir 下的临时文件里，调用方用完负责删除。
func NormalizeCookieFile(path, workDir string) (string, bool, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return path, false, err
	}
	trimmed := strings.TrimSpace(string(raw))
	if !strings.HasPrefix(trimmed, "[") {
		return path, false, nil
	}

	var items []jsonCookie
	if err := json.Unmarshal([]byte(trimmed), &items); err != nil {
		return path, false, fmt.Errorf("看起来是 JSON 导出，但解析失败：%w", err)
	}
	if len(items) == 0 {
		return path, false, nil
	}

	var sb strings.Builder
	sb.WriteString("# Netscape HTTP Cookie File\n")
	for _, it := range items {
		if it.Name == "" || it.Domain == "" {
			continue
		}
		hostOnly := it.HostOnly != nil && *it.HostOnly
		domain := it.Domain
		// Netscape 用前导点表示「包含子域」；JSON 里是 hostOnly=false
		if !hostOnly && !strings.HasPrefix(domain, ".") {
			domain = "." + domain
		}
		subdomains := "TRUE"
		if hostOnly {
			subdomains = "FALSE"
		}
		path := it.Path
		if path == "" {
			path = "/"
		}
		secure := "FALSE"
		if it.Secure {
			secure = "TRUE"
		}
		expiry := int64(it.ExpirationDate)
		fmt.Fprintf(&sb, "%s\t%s\t%s\t%s\t%d\t%s\t%s\n",
			domain, subdomains, path, secure, expiry, it.Name, it.Value)
	}
	if sb.Len() == len("# Netscape HTTP Cookie File\n") {
		return path, false, nil
	}

	if err := os.MkdirAll(workDir, 0o755); err != nil {
		return path, false, err
	}
	target := filepath.Join(workDir, fmt.Sprintf("cookies-netscape-%d-%d.txt", os.Getpid(), len(items)))
	if err := os.WriteFile(target, []byte(sb.String()), 0o600); err != nil {
		return path, false, err
	}
	return target, true, nil
}

// jsonCookie 是浏览器扩展导出的单个 cookie（字段名与 Chrome 扩展一致）。
type jsonCookie struct {
	Domain         string  `json:"domain"`
	Name           string  `json:"name"`
	Value          string  `json:"value"`
	Path           string  `json:"path"`
	Secure         bool    `json:"secure"`
	HostOnly       *bool   `json:"hostOnly"`
	ExpirationDate float64 `json:"expirationDate"`
}
