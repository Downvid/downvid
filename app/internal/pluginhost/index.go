// Package pluginhost —— 插件索引。
//
// 索引是一份 `index.json`，列出被收录的第三方解析插件。**它只记 `owner/repo`**，
// 不托管插件代码：代码留在作者自己的仓库，收录不等于背书。
//
// ## 为什么要有一份索引，而不是直接用 GitHub 搜索
//
// 搜索（例如按 topic）无法人工审核，也无法下架——只要作者打上 topic 就会出现在
// 列表里。而插件在这个应用里能访问网络、能读到自己的数据目录，一旦被滥用，
// 用户看到的第一反应是「DownVid 给我的插件有问题」。所以列表必须可控。
package pluginhost

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

// IndexURL 是官方索引的地址。
//
// 用 raw.githubusercontent 而不是 api.github.com：后者对匿名请求限流很紧
// （60 次/小时/出口 IP），而这里只需要一个静态文件。
//
// 分支是 **master**：仓库创建时没有指定默认分支，GitHub 沿用了 git init 的
// master。写错分支名不会报错，只会 404 —— 表现是「插件列表永远为空」，
// 而索引其实好好的。
const IndexURL = "https://raw.githubusercontent.com/Downvid/plugins/master/index.json"

// indexVersion 是本包认识的索引格式版本。
//
// 只认这一个值：索引将来若改结构，旧应用应当提示「升级应用」，
// 而不是按旧字段去解析一份新文件——那会静默读出一堆零值。
const indexVersion = 1

// Entry 是索引里的一条插件。
type Entry struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	Repo        string   `json:"repo"`
	Author      string   `json:"author,omitempty"`
	Sites       []string `json:"sites,omitempty"`
	Added       string   `json:"added,omitempty"`
	// Icon 是 emoji 或 http(s) 图片地址。空则界面用名称首字。
	Icon string `json:"icon,omitempty"`
	// Version 取自 plugin.json，界面用它判断「可更新」。
	Version string `json:"version,omitempty"`
}

// Index 是整份索引。
type Index struct {
	Version int     `json:"version"`
	Updated string  `json:"updated,omitempty"`
	Plugins []Entry `json:"plugins"`
}

// ErrIndexTooNew 表示索引格式比本应用新。
var ErrIndexTooNew = errors.New("插件索引格式比当前应用新，请升级 DownVid")

// ParseIndex 解析索引内容。
//
// 与「拉取」分开：解析是纯函数，可以直接用固定输入测，不需要起 HTTP 服务。
func ParseIndex(raw []byte) (*Index, error) {
	var idx Index
	if err := json.Unmarshal(raw, &idx); err != nil {
		return nil, fmt.Errorf("插件索引不是合法 JSON：%w", err)
	}
	if idx.Version == 0 {
		return nil, errors.New("插件索引缺少 version 字段")
	}
	if idx.Version > indexVersion {
		return nil, ErrIndexTooNew
	}

	// 逐条校验，坏条目**丢弃而不是让整份索引失败**：
	// 有人手抖写错一条，不该让所有用户都看不到其他插件。
	kept := make([]Entry, 0, len(idx.Plugins))
	seen := map[string]bool{}
	for _, e := range idx.Plugins {
		if err := validateEntry(e); err != nil {
			continue
		}
		if seen[e.ID] {
			continue // 重复 id 保留第一条，避免列表里出现两个同名插件
		}
		seen[e.ID] = true
		kept = append(kept, e)
	}
	// 排序稳定：索引文件里的顺序会被人为调整，界面不该跟着跳
	sort.Slice(kept, func(i, j int) bool { return kept[i].ID < kept[j].ID })
	idx.Plugins = kept
	return &idx, nil
}

// validateEntry 校验一条索引。
//
// 重点是 `Repo`：它会被拼成下载地址，必须严格是 `owner/name`。
// 放任 `../../x` 这类值等于让索引文件能指向任意位置。
func validateEntry(e Entry) error {
	if strings.TrimSpace(e.ID) == "" || strings.TrimSpace(e.Name) == "" {
		return errors.New("缺少 id 或 name")
	}
	if !ValidRepo(e.Repo) {
		return fmt.Errorf("repo %q 不是 owner/name 形态", e.Repo)
	}
	if strings.ContainsAny(e.ID, "/\\.") || strings.Contains(e.ID, "..") {
		return fmt.Errorf("id %q 含非法字符", e.ID)
	}
	// icon 会直接进界面：只允许短 emoji 串或 http(s) 地址。
	// 放任 `javascript:` 之类等于把索引文件变成注入点。
	if e.Icon != "" && !validIcon(e.Icon) {
		e.Icon = ""
	}
	return nil
}

// validIcon 判断 icon 是不是可以安全渲染的值。
func validIcon(s string) bool {
	if isHTTPURL(s) {
		return true
	}
	// emoji：长度很短且不含控制字符与尖括号
	if len([]rune(s)) > 8 || strings.ContainsAny(s, "<>\"'&") {
		return false
	}
	for _, r := range s {
		if r < 0x20 {
			return false
		}
	}
	return true
}

// ValidRepo 报告 s 是否是 `owner/name`。
//
// 与 mygo-plugin 的 GitHub.ValidRepo 同一形状，但**不 import 它**：
// 这个校验是安全边界（要拼 URL），值得在本地有一份可独立测试的实现。
func ValidRepo(s string) bool {
	if s == "" || strings.Count(s, "/") != 1 {
		return false
	}
	for _, part := range strings.SplitN(s, "/", 2) {
		if part == "" || part == "." || part == ".." {
			return false
		}
		for _, r := range part {
			ok := r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' ||
				r >= '0' && r <= '9' || r == '-' || r == '_' || r == '.'
			if !ok {
				return false
			}
		}
	}
	return true
}

// ValidPluginID 报告 id 是否可以安全地拼进文件系统路径。
//
// **这是安全边界**：卸载插件要 `os.RemoveAll(filepath.Join(dir, id))`，
// 若 id 是 `../../..`，删掉的就是用户主目录。所以这里比 index 的
// validateEntry 更严：只允许小写字母、数字、连字符。
func ValidPluginID(id string) bool {
	if id == "" || len(id) > 64 {
		return false
	}
	for _, r := range id {
		if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-') {
			return false
		}
	}
	return id[0] != '-'
}

// FetchIndex 拉取并解析索引。
//
// client 为 nil 时用默认客户端；调用方（Wails 壳）应传入带代理设置的客户端，
// 否则在需要代理的网络下，索引拉不下来而插件列表永远是空的。
func FetchIndex(ctx context.Context, client *http.Client, url string) (*Index, error) {
	if url == "" {
		url = IndexURL
	}
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("拉取插件索引失败：%w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("拉取插件索引失败：HTTP %d", resp.StatusCode)
	}
	// 索引只有几十 KB，限一下防止拉到异常的巨大响应
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, fmt.Errorf("读取插件索引失败：%w", err)
	}
	return ParseIndex(raw)
}
